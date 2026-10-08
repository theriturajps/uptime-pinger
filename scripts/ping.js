import fs from "node:fs";
import endpoints from "../endpoints.js";

const STATE_FILE = "status.json";
const README_FILE = "README.md";
const START = "<!-- STATUS:START -->";
const END = "<!-- STATUS:END -->";

const TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 3_000;
const FORCE = process.env.FORCE === "true";
// Each scheduled run stays alive ~5 minutes and checks the schedule every TICK seconds,
// so pings land within seconds of their cron time instead of up to 5 minutes late.
const WINDOW_MS = FORCE ? 0 : Number(process.env.WINDOW_SECONDS ?? 280) * 1000;
const TICK_MS = Number(process.env.TICK_SECONDS ?? 10) * 1000;

/* ---------- secrets: {{NAME}} placeholders, resolved from GitHub Secrets ---------- */
const secrets = JSON.parse(process.env.SECRETS_JSON || "{}");
const secretValues = Object.values(secrets).filter((v) => typeof v === "string" && v.length > 3);

function fill(str) {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    if (!(key in secrets)) throw new Error(`missing secret ${key}`);
    return secrets[key];
  });
}
const redact = (s) => secretValues.reduce((acc, v) => acc.split(v).join("***"), String(s));

/* ---------- tiny cron matcher (UTC, no dependencies) ---------- */
function parseField(field, min, max) {
  const set = new Set();
  for (const part of field.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    let lo, hi;
    if (range === "*") [lo, hi] = [min, max];
    else if (range.includes("-")) [lo, hi] = range.split("-").map(Number);
    else [lo, hi] = [Number(range), stepStr ? max : Number(range)];
    if ([lo, hi, step].some(Number.isNaN) || step < 1 || lo < min || hi > max)
      throw new Error(`Invalid cron field "${field}"`);
    for (let i = lo; i <= hi; i += step) set.add(i);
  }
  return set;
}

function parseCron(expr) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`Cron must have 5 fields: "${expr}"`);
  const dow = parseField(f[4], 0, 7);
  if (dow.has(7)) dow.add(0);
  return {
    min: parseField(f[0], 0, 59),
    hour: parseField(f[1], 0, 23),
    dom: parseField(f[2], 1, 31),
    mon: parseField(f[3], 1, 12),
    dow,
    domStar: f[2] === "*",
    dowStar: f[4] === "*",
  };
}

function matches(c, d) {
  if (!c.min.has(d.getUTCMinutes()) || !c.hour.has(d.getUTCHours()) || !c.mon.has(d.getUTCMonth() + 1)) return false;
  const domOk = c.dom.has(d.getUTCDate());
  const dowOk = c.dow.has(d.getUTCDay());
  if (c.domStar || c.dowStar) return domOk && dowOk;
  return domOk || dowOk; // standard cron: OR when both are restricted
}

// Was there a scheduled slot between the last check and now?
// (Also catches slots missed because GitHub delayed or skipped a run.)
function isDue(expr, lastMs, nowMs) {
  if (!lastMs || nowMs - lastMs > 7 * 24 * 3600_000) return true;
  const cron = parseCron(expr);
  for (let m = Math.floor(lastMs / 60_000) + 1; m <= Math.floor(nowMs / 60_000); m++) {
    if (matches(cron, new Date(m * 60_000))) return true;
  }
  return false;
}

/* ---------- pinging ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ping(e) {
  let url, headers;
  try {
    url = fill(e.endpoint);
    headers = Object.fromEntries(Object.entries(e.headers ?? {}).map(([k, v]) => [k, fill(String(v))]));
  } catch (err) {
    return { ok: false, code: null, ms: 0, error: err.message };
  }

  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = performance.now();
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
        headers: { "User-Agent": "github-uptime-pinger", ...headers },
      });
      result = { ok: res.ok, code: res.status, ms: Math.round(performance.now() - t0), error: null };
      if (res.ok) return result;
    } catch (err) {
      // Never use err.message: Node puts the full URL (and any secret in it) in there.
      const error = err.name === "TimeoutError" ? "timeout" : err.cause?.code || "request failed";
      result = { ok: false, code: null, ms: Math.round(performance.now() - t0), error };
    }
    if (attempt === 0) await sleep(RETRY_DELAY_MS);
  }
  return result;
}

/* ---------- main loop ---------- */
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const deadline = Date.now() + WINDOW_MS;
let first = true;

while (true) {
  const now = Date.now();
  const due = endpoints.filter((e) => {
    const expr = e.cronjob ?? e.cornjob ?? "*/15 * * * *"; // also accepts the "cornjob" typo
    try {
      return (FORCE && first) || isDue(expr, state[e.id]?.checkedAt, now);
    } catch (err) {
      console.error(`[${e.id}] ${err.message}`);
      return false;
    }
  });
  first = false;

  await Promise.all(
    due.map(async (e) => {
      const r = await ping(e);
      const prev = state[e.id];
      state[e.id] = { ...r, checkedAt: now, since: prev && prev.ok === r.ok ? prev.since : now };
      console.log(redact(`[${e.id}] ${e.name}: ${r.ok ? "UP" : "DOWN"} (${r.code ?? r.error}) ${r.ms}ms`));
    })
  );

  if (Date.now() + TICK_MS > deadline) break;
  await sleep(TICK_MS);
}

// drop state for removed endpoints
for (const id of Object.keys(state)) if (!endpoints.some((e) => e.id === id)) delete state[id];
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

/* ---------- README table (URLs and secrets are never written here) ---------- */
const fmt = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const rows = endpoints.map((e) => {
  const s = state[e.id];
  const expr = e.cronjob ?? e.cornjob ?? "-";
  if (!s) return `| ${e.id} | ${e.name} | ⚪ Pending | - | - | - | \`${expr}\` |`;
  return redact(`| ${e.id} | ${e.name} | ${s.ok ? "🟢 Up" : "🔴 Down"} | ${s.code ?? s.error} | ${s.ms} ms | ${fmt(s.checkedAt)} | \`${expr}\` |`);
});

const table = [
  "| ID | Name | Status | Code | Response | Last checked | Schedule |",
  "|----|------|--------|------|----------|--------------|----------|",
  ...rows,
].join("\n");

let readme = fs.readFileSync(README_FILE, "utf8");
const block = `${START}\n${table}\n${END}`;
readme = readme.includes(START)
  ? readme.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
  : readme + `\n${block}\n`;
fs.writeFileSync(README_FILE, readme);
