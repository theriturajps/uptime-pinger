// Add your endpoints here.
//
// id       -> unique STRING ("01"). A bare number like 01 is a syntax error in JS modules.
// name     -> label shown in the README table
// cronjob  -> standard 5-field cron (minute hour day month weekday), evaluated in UTC
// endpoint -> URL to ping (HTTP 2xx/3xx = Up)
// headers  -> optional request headers
//
// SECRETS: never paste tokens here (this file is public).
// Add them in GitHub: Settings -> Secrets and variables -> Actions -> New repository secret,
// then reference them as {{SECRET_NAME}} in `endpoint` or `headers`:
//
//   { id: "02", name: "private api", cronjob: "*/10 * * * *",
//     endpoint: "https://example.com/health?key={{MY_API_KEY}}",
//     headers: { Authorization: "Bearer {{MY_TOKEN}}" } }
//
// Secret values are never printed to logs or written to the README.

export default [
  { id: "01", name: "inoob", cronjob: "*/10 * * * *", endpoint: "https://inoob.koyeb.app" },
  // { id: "02", name: "backend 2", cronjob: "*/10 * * * *", endpoint: "https://example.com/health" },
];
