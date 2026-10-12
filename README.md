# InkSocial Agent Command Center

Live dashboard for the InkSocial agents. Static site, no build step, hosted on Netlify.

## What it shows

- **Key numbers**: runs, success rate, alerts and handoffs.
- **Live handoff map**: the nine agents in pipeline order. A line turns solid green when the run log records that handoff. Labels mark the client's step in between (approves idea, picks hook, uploads footage, approves copy).
- **Run timeline**: every step of the selected run, timed from its start.
- **Recent runs**: what ran, for whom, why it started, and the result.
- **Agents roster** and **Alerts** (failed runs and data alerts).
- **Ask the agents**: questions about recent activity, answered by Claude from the run log.
- **Start demo run**: a real research run that does not notify the client.

## How it works

- Every agent writes to two Supabase tables, `agent_runs` and `agent_events` (see `utils/run_log.py` in `inksocial-agents`). Row-level security lets admin logins read them; nobody else.
- The page signs in with an InkSocial admin account and reads those tables with Supabase's publishable key, then listens for changes in real time.
- Demo runs and questions go to the agents service on Railway (`/api/command-center/*`), which checks the admin login. No secret key is in this site.

## Settings

All in `assets/config.js`:

- `AGENTS`: display names and roles. Rename agents here; keep the keys on the left.
- `AGENTS_API`: the Railway URL of `inksocial-agents`.
- `MAP_COLUMNS` / `MAP_EDGES`: the layout of the handoff map.

If the Netlify address is not `https://inksocial-commandcenter.netlify.app`, set `COMMAND_CENTER_ORIGIN` on Railway to the real address so the agents service accepts the dashboard's requests.

## Demo runs

Use the **Ink & Prosper Test** client. A demo run is real: on a client it writes that week's research and new ideas into their portal (only the notification is skipped).

## Deploy

Netlify: New site from Git, choose this repo, leave the build command empty, publish directory `.`.

`assets/vendor/supabase.esm.js` is supabase-js 2.117.3 bundled locally so the page has no CDN dependency.
