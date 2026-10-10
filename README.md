# 📡 Uptime Pinger

Free, serverless endpoint monitor built on GitHub Actions. It pings the URLs listed in [`endpoints.js`](./endpoints.js) on their own cron schedules and updates the table below automatically.

## Status

<!-- STATUS:START -->
| ID | Name | Status | Response | Checked |
|:--:|:-----|:------:|:--------:|:-------:|
| 01 | inoob | 🟢 Up | 460 ms | 10 Oct, 14:50 |

<sub>Times are in UTC</sub>
<!-- STATUS:END -->

## Setup

1. Create a new **public** GitHub repo and upload these files (keep the `.github/workflows/` folder).
2. Edit `endpoints.js` with your endpoints.
3. **Settings → Actions → General → Workflow permissions** → choose **Read and write permissions** → Save.
4. **Actions → Ping endpoints → Run workflow** to run it once. The table fills in right away.

## Adding an endpoint

```js
{ id: "02", name: "my api", cronjob: "*/10 * * * *", endpoint: "https://example.com/health" }
```

`id` must be a unique string. `cronjob` is a standard 5-field cron in **UTC**.

## Private endpoints / secrets

This repo is public, so never paste tokens into `endpoints.js`. Instead:

1. **Settings → Secrets and variables → Actions → New repository secret** (e.g. `MY_API_KEY`).
2. Reference it with `{{MY_API_KEY}}` in `endpoint` or `headers`:

```js
{ id: "03", name: "private api", cronjob: "*/10 * * * *",
  endpoint: "https://example.com/health?key={{MY_API_KEY}}",
  headers: { Authorization: "Bearer {{MY_TOKEN}}" } }
```

Secret values are never logged or written to this README, and the table never shows URLs.

## How it stays within GitHub's limits

| Limit | What this repo does |
|-------|---------------------|
| Scheduled runs are 5 min minimum and can be delayed | Each run stays alive ~5 min and checks schedules every 10 s, so pings land within seconds of their cron time while a run is active. If GitHub skips or delays a run, missed slots are caught on the next one. |
| Private repos have limited free minutes | The job only runs on public repos. For a private repo, set a repository variable `ALLOW_PRIVATE=true` (this will use your monthly minutes quickly). |
| Scheduled workflows pause after 60 days of inactivity | The workflow commits status updates and re-enables itself on every run. If it ever stops, enable it in the Actions tab. |
| Public repo exposes `endpoints.js` | Use `{{SECRET}}` placeholders (above); secrets live in GitHub Secrets, not in the code. |

## Local test

```bash
FORCE=true node scripts/ping.js
```
