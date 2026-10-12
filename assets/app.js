// Agent Command Center: live view of the InkSocial agents.
// Reads agent_runs / agent_events from Supabase (admin-only by row-level
// security), listens for changes in real time, and calls the agents service
// for demo runs and questions.

// Bundled locally (supabase-js 2.117.3) so the dashboard has no CDN dependency.
import { createClient } from "./vendor/supabase.esm.js";
import {
  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, AGENTS_API, AGENTS, MAP_COLUMNS, MAP_EDGES,
} from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = (id) => document.getElementById(id);
const DAY = 86400000;

const state = {
  session: null,
  runs: [],          // last 30 days, newest first
  events: [],        // last 7 days, oldest first
  clients: {},       // id -> name
  selectedRunId: null,
  followLatest: true,
  channel: null,
  clientFilter: null,   // client id the runs table is filtered to
  clientRows: [],       // full client rows for the Clients tab
  research: [],
  pieces: [],
  ideas: [],
  threads: [],
  threadId: null,
  messages: [],
  chatTargets: [],      // agents picked to answer the next message
  newMode: "direct",
  newPicked: [],
};

// ── helpers ──────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const agentName = (key) => (key === "coordinator" ? "Coordinator" : AGENTS[key]?.name || key);
const clientName = (id) => (id && state.clients[id]) || (id ? "Unknown client" : "No client");

function ago(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function clock(ts) {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function offset(from, to) {
  const s = Math.max(0, Math.round((new Date(to) - new Date(from)) / 1000));
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
const statusDot = (st) => ({ running: "dot-run", success: "dot-ok", failed: "dot-bad", skipped: "dot-skip", stopped: "dot-skip" }[st] || "dot-idle");
const statusLabel = (st) => ({ running: "Running", success: "Done", failed: "Failed", skipped: "Skipped", stopped: "Stopped" }[st] || "Idle");

// ── auth ─────────────────────────────────────────────────────────────────────
async function init() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  sb.auth.onAuthStateChange((_e, session) => { state.session = session; });
  state.session ? await enterApp() : showLogin();
}

function showLogin(message = "") {
  $("app-view").hidden = true;
  $("login-view").hidden = false;
  $("login-error").textContent = message;
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  const { data, error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(), password: $("password").value,
  });
  if (error) { $("login-error").textContent = error.message; return; }
  state.session = data.session;
  await enterApp();
});

$("signout-btn").addEventListener("click", async () => {
  if (state.channel) sb.removeChannel(state.channel);
  await sb.auth.signOut();
  showLogin();
});

async function enterApp() {
  const uid = state.session.user.id;
  const { data: me } = await sb.from("users").select("role").eq("id", uid).maybeSingle();
  if (!me || me.role !== "admin") {
    await sb.auth.signOut();
    showLogin("This account is not an InkSocial admin.");
    return;
  }
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  await loadClients();
  await reload();
  await Promise.all([loadClientData(), loadThreads()]);
  initTabs();
  subscribe();
  setInterval(renderRelativeTimes, 30000);
  window.addEventListener("resize", drawEdges);
}

// ── data ─────────────────────────────────────────────────────────────────────
async function loadClients() {
  const { data } = await sb.from("clients").select("id,name").order("name");
  state.clients = Object.fromEntries((data || []).map((c) => [c.id, c.name]));
  const sel = $("demo-client");
  sel.innerHTML = (data || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  const test = (data || []).find((c) => /test/i.test(c.name));
  if (test) sel.value = test.id;
}

async function reload() {
  const since30 = new Date(Date.now() - 30 * DAY).toISOString();
  const since7 = new Date(Date.now() - 7 * DAY).toISOString();
  const [runs, events] = await Promise.all([
    sb.from("agent_runs").select("*").gte("started_at", since30).order("started_at", { ascending: false }).limit(500),
    sb.from("agent_events").select("*").gte("created_at", since7).order("created_at", { ascending: true }).limit(3000),
  ]);
  if (runs.error || events.error) {
    setLive("bad", "Could not load the run log");
    return;
  }
  state.runs = runs.data || [];
  state.events = events.data || [];
  if (state.followLatest || !state.runs.find((r) => r.id === state.selectedRunId)) {
    state.selectedRunId = state.runs[0]?.id || null;
  }
  render();
}

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { reload(); loadClientData(); }, 400);
}

function subscribe() {
  state.channel = sb.channel("agent-log")
    .on("postgres_changes", { event: "*", schema: "public", table: "agent_runs" }, scheduleReload)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_events" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "agent_threads" }, scheduleTalkReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "agent_messages" }, scheduleTalkReload)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setLive("ok", "Live");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setLive("bad", "Live updates paused");
    });
}

function setLive(kind, label) {
  $("live-dot").className = `dot ${kind === "ok" ? "dot-ok" : kind === "bad" ? "dot-bad" : "dot-idle"}`;
  $("live-label").textContent = label;
}

// ── render ───────────────────────────────────────────────────────────────────
function render() {
  renderKpis();
  renderMap();
  renderRoster();
  renderAlerts();
  renderRuns();
  renderTimeline();
}

function within(ts, days) { return Date.now() - new Date(ts).getTime() <= days * DAY; }

function renderKpis() {
  const r7 = state.runs.filter((r) => within(r.started_at, 7));
  const done30 = state.runs.filter((r) => r.status === "success" || r.status === "failed");
  const ok30 = done30.filter((r) => r.status === "success").length;
  const alerts = alertItems().length;
  const handoffs = state.events.filter((e) => e.kind === "handoff").length;
  $("kpi-runs").textContent = r7.length;
  $("kpi-success").textContent = done30.length ? `${Math.round((ok30 / done30.length) * 100)}%` : "No runs";
  $("kpi-alerts").textContent = alerts;
  $("kpi-alerts").classList.toggle("bad", alerts > 0);
  $("kpi-handoffs").textContent = handoffs;
}

function latestRun(agent) {
  return state.runs.find((r) => r.agent === agent && within(r.started_at, 7));
}

function nodeHtml(key) {
  const run = latestRun(key);
  const count = state.runs.filter((r) => r.agent === key && within(r.started_at, 7)).length;
  const st = run?.status || "idle";
  const selected = state.runs.find((r) => r.id === state.selectedRunId)?.agent === key;
  const sub = key === "packaging" && !run
    ? "Not connected yet"
    : run ? `${count} run${count === 1 ? "" : "s"} · last ${ago(run.started_at)}` : "No runs this week";
  return `<button type="button" class="node ${st}${selected ? " selected" : ""}" data-agent="${key}" id="node-${key}">
    <span class="node-status">${esc(statusLabel(st).toUpperCase())}</span>
    <span class="node-name">${esc(agentName(key))}</span>
    <span class="node-sub" data-ago="${run ? esc(run.started_at) : ""}">${esc(sub)}</span>
  </button>`;
}

function renderMap() {
  $("map-cols").innerHTML = MAP_COLUMNS.map(
    (col) => `<div class="map-col">${col.map(nodeHtml).join("")}</div>`
  ).join("");
  const inMap = new Set(MAP_COLUMNS.flat());
  const standalone = Object.keys(AGENTS).filter((k) => !inMap.has(k));
  $("map-standalone").innerHTML = standalone.length
    ? `<span class="muted small">Runs on its own schedule:</span>${standalone.map(nodeHtml).join("")}`
    : "";
  document.querySelectorAll(".node").forEach((el) =>
    el.addEventListener("click", () => {
      const run = latestRun(el.dataset.agent) || state.runs.find((r) => r.agent === el.dataset.agent);
      if (run) selectRun(run.id);
    })
  );
  requestAnimationFrame(drawEdges);
}

function edgeHappened(from, to) {
  return state.events.some((e) => e.kind === "handoff" && e.to_agent === to &&
    state.runs.find((r) => r.id === e.run_id)?.agent === from);
}

function drawEdges() {
  const svg = $("map-edges");
  const map = $("map");
  if (!svg || !map) return;
  const box = map.getBoundingClientRect();
  const sx = map.scrollLeft;
  svg.setAttribute("width", map.scrollWidth);
  svg.setAttribute("height", map.scrollHeight);
  svg.style.width = `${map.scrollWidth}px`;
  const pos = (key) => {
    const el = $(`node-${key}`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left - box.left + sx, r: r.right - box.left + sx, t: r.top - box.top, b: r.bottom - box.top, cx: r.left - box.left + sx + r.width / 2, cy: r.top - box.top + r.height / 2 };
  };
  const parts = [];
  for (const e of MAP_EDGES) {
    const a = pos(e.from), b = pos(e.to);
    if (!a || !b) continue;
    let d, lx, ly;
    if (Math.abs(a.cx - b.cx) < 10) {           // same column: straight down
      d = `M ${a.cx} ${a.b} L ${b.cx} ${b.t}`;
      lx = a.cx; ly = (a.b + b.t) / 2;
    } else {
      const x1 = a.r, y1 = a.cy, x2 = b.l, y2 = b.cy, mx = (x1 + x2) / 2;
      d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      lx = mx; ly = (y1 + y2) / 2;
    }
    const done = edgeHappened(e.from, e.to);
    parts.push(`<path class="edge${done ? " done" : ""}" d="${d}" marker-end="url(#arrow-${done ? "on" : "off"})"/>`);
    if (e.gate) {
      const w = e.gate.length * 6 + 10;
      parts.push(`<rect class="edge-label-bg" x="${lx - w / 2}" y="${ly - 9}" width="${w}" height="16" rx="4"/>`);
      parts.push(`<text class="edge-label" x="${lx}" y="${ly + 3}" text-anchor="middle">${esc(e.gate)}</text>`);
    }
  }
  svg.innerHTML = `<defs>
      <marker id="arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5cc08a"/></marker>
      <marker id="arrow-off" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#6e747d"/></marker>
    </defs>${parts.join("")}`;
}
$("map").addEventListener("scroll", drawEdges);

function renderRoster() {
  $("roster").innerHTML = Object.keys(AGENTS).map((key) => {
    const run = state.runs.find((r) => r.agent === key);
    const st = run?.status || "idle";
    const meta = run ? `${statusLabel(st)} · <span data-ago="${esc(run.started_at)}">${ago(run.started_at)}</span>`
      : key === "packaging" ? "Not connected yet" : "No runs yet";
    return `<li title="${esc(AGENTS[key].role)}"><span class="dot ${statusDot(st)}"></span>
      <span class="r-name">${esc(agentName(key))}</span><span class="r-meta">${meta}</span></li>`;
  }).join("");
}

function alertItems() {
  const items = [];
  for (const r of state.runs) {
    if (r.status === "failed" && within(r.started_at, 7)) {
      items.push({ run: r.id, ts: r.finished_at || r.started_at, title: `${agentName(r.agent)} failed`, body: `${clientName(r.client_id)}: ${r.error || "no error recorded"}` });
    }
  }
  for (const e of state.events) {
    if (e.kind !== "alert" || e.message.startsWith("Run failed:")) continue;
    const r = state.runs.find((x) => x.id === e.run_id);
    items.push({ run: e.run_id, ts: e.created_at, title: `${agentName(r?.agent)} data alert`, body: `${clientName(r?.client_id)}: ${e.message}` });
  }
  return items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

function renderAlerts() {
  const items = alertItems().slice(0, 8);
  $("alerts").innerHTML = items.length
    ? items.map((a) => `<li data-run="${esc(a.run)}"><span class="a-title">${esc(a.title)}</span><span class="a-body">${esc(a.body)}</span><span class="small muted" data-ago="${esc(a.ts)}">${ago(a.ts)}</span></li>`).join("")
    : `<li class="empty" style="background:none;border:0;cursor:default">No alerts in the last 7 days.</li>`;
  document.querySelectorAll("#alerts li[data-run]").forEach((li) => li.addEventListener("click", () => selectRun(li.dataset.run)));
}

function renderRuns() {
  const demoOnly = $("filter-demo").checked;
  const rows = state.runs
    .filter((r) => (!demoOnly || r.demo) && (!state.clientFilter || r.client_id === state.clientFilter))
    .slice(0, 40);
  $("runs-h").innerHTML = state.clientFilter
    ? `Recent runs · ${esc(clientName(state.clientFilter))} <button type="button" class="chip small" id="clear-client-filter">Show all clients</button>`
    : "Recent runs";
  const clr = $("clear-client-filter");
  if (clr) clr.addEventListener("click", () => { state.clientFilter = null; renderRuns(); });
  $("runs-body").innerHTML = rows.length ? rows.map((r) => `
    <tr data-run="${esc(r.id)}" class="${r.id === state.selectedRunId ? "selected" : ""}">
      <td class="mono small" title="${esc(clock(r.started_at))}">${esc(clock(r.started_at))}</td>
      <td>${esc(agentName(r.agent))}${r.demo ? '<span class="tag">DEMO</span>' : ""}</td>
      <td>${esc(clientName(r.client_id))}</td>
      <td><span class="status"><span class="dot ${statusDot(r.status)}"></span>${esc(statusLabel(r.status))}</span></td>
      <td class="small muted">${esc(r.trigger || "")}</td>
      <td class="small">${esc(r.error || r.summary || "")}</td>
    </tr>`).join("")
    : `<tr><td colspan="6" class="empty">No runs yet. Start a demo run, or wait for the next scheduled one.</td></tr>`;
  document.querySelectorAll("#runs-body tr[data-run]").forEach((tr) => tr.addEventListener("click", () => selectRun(tr.dataset.run)));
}
$("filter-demo").addEventListener("change", renderRuns);

function renderTimeline() {
  const run = state.runs.find((r) => r.id === state.selectedRunId);
  if (!run) {
    $("tl-h").textContent = "Run timeline";
    $("tl-meta").textContent = "";
    $("timeline").innerHTML = `<li class="empty" style="display:block">Select a run to see each step.</li>`;
    return;
  }
  $("tl-h").textContent = `Run timeline · ${agentName(run.agent)} · ${clientName(run.client_id)}`;
  $("tl-meta").innerHTML = `${esc(clock(run.started_at))}${run.demo ? " · demo" : ""} · ${esc(run.trigger || "")}`
    + (run.status === "running"
      ? (run.stop_requested
        ? ` <span class="stop-note">Stopping after the current step…</span>`
        : ` <button type="button" class="btn btn-stop" id="stop-run">Stop this run</button>`)
      : "");
  const stopBtn = $("stop-run");
  if (stopBtn) stopBtn.addEventListener("click", () => stopRun(run.id));
  const evs = state.events.filter((e) => e.run_id === run.id);
  const rows = [`<li><span class="t-time">+0:00</span><span class="t-mark"></span><span class="t-msg">Started. ${esc(run.trigger || "")}</span></li>`];
  for (const e of evs) {
    const to = e.to_agent ? ` <span class="to">to ${esc(agentName(e.to_agent))}</span>` : "";
    rows.push(`<li><span class="t-time">${offset(run.started_at, e.created_at)}</span><span class="t-mark ${e.kind}"></span><span class="t-msg">${esc(e.message)}${to}</span></li>`);
  }
  if (run.status === "running") {
    rows.push(`<li><span class="t-time" style="color:var(--warn)">now</span><span class="t-mark" style="background:var(--warn)"></span><span class="t-msg muted">Working…</span></li>`);
  } else if (run.finished_at) {
    const end = run.status === "failed" ? `Failed: ${esc(run.error || "")}` : `${esc(statusLabel(run.status))}. ${esc(run.summary || "")}`;
    rows.push(`<li><span class="t-time">${offset(run.started_at, run.finished_at)}</span><span class="t-mark ${run.status === "failed" ? "alert" : ""}"></span><span class="t-msg">${end}</span></li>`);
  }
  $("timeline").innerHTML = rows.join("");
}

function selectRun(id) {
  state.selectedRunId = id;
  state.followLatest = id === state.runs[0]?.id;
  renderMap();
  renderRuns();
  renderTimeline();
}

function renderRelativeTimes() {
  document.querySelectorAll("[data-ago]").forEach((el) => {
    if (el.dataset.ago && el.textContent.match(/ago|just now/)) {
      el.textContent = el.textContent.replace(/(\d+[mhd] ago|just now)/, ago(el.dataset.ago));
    }
  });
}

// ── actions ──────────────────────────────────────────────────────────────────
async function stopRun(id) {
  const run = state.runs.find((r) => r.id === id);
  if (!run || !confirm(`Stop this ${agentName(run.agent)} run? The step in progress finishes, then it stops and saves nothing further.`)) return;
  try {
    await callApi(`/api/command-center/runs/${id}/stop`, {});
    run.stop_requested = true;
    renderTimeline();
    banner(`Stopping the ${agentName(run.agent)} run. It finishes the step in progress first, usually under a minute.`);
  } catch (err) {
    banner(`Could not stop the run: ${err.message}`, true);
  }
}

async function callApi(path, body) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${AGENTS_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

function banner(text, bad = false) {
  const el = $("demo-msg");
  el.textContent = text;
  el.classList.toggle("bad", bad);
  el.hidden = false;
  clearTimeout(banner.t);
  banner.t = setTimeout(() => { el.hidden = true; }, 12000);
}

$("demo-btn").addEventListener("click", async () => {
  const btn = $("demo-btn");
  btn.disabled = true;
  try {
    const out = await callApi("/api/command-center/demo-run", { client_id: $("demo-client").value });
    state.followLatest = true;
    banner(`Demo research run started for ${out.client}. It runs for real and the client is not notified. Steps appear below as they happen.`);
  } catch (err) {
    banner(`Could not start the demo run: ${err.message}`, true);
  } finally {
    setTimeout(() => { btn.disabled = false; }, 4000);
  }
});


// ── tabs ─────────────────────────────────────────────────────────────────────
const TABS = ["agents", "clients", "talk"];

function showTab(name) {
  if (!TABS.includes(name)) name = "agents";
  for (const t of TABS) {
    $(`view-${t}`).hidden = t !== name;
    $(`tab-${t}`).setAttribute("aria-selected", String(t === name));
  }
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  if (name === "agents") requestAnimationFrame(drawEdges);
  if (name === "talk") scrollChat();
}

function initTabs() {
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
  document.querySelectorAll("[data-open-talk]").forEach((b) => b.addEventListener("click", () => {
    showTab("talk");
    openNewPanel(b.dataset.openTalk === "meeting" ? "meeting" : "direct");
  }));
  showTab(location.hash.slice(1) || "agents");
}

// ── clients ──────────────────────────────────────────────────────────────────
const STAGES = [
  "Pending Concept Approval", "Pending Hook Approval", "Pending Script Approval",
  "Script Approved", "Ready for VA", "Scheduled",
];
const STAGE_SHORT = {
  "Pending Concept Approval": "Concept approval", "Pending Hook Approval": "Hook approval",
  "Pending Script Approval": "Script approval", "Script Approved": "Script approved",
  "Ready for VA": "Ready for VA", "Scheduled": "Scheduled",
};

async function loadClientData() {
  const [clients, research, pieces, ideas] = await Promise.all([
    sb.from("clients").select("id,name,subscription_status,video_enabled,blog_enabled,research_cadence_weeks,notification_email,notification_slack,platforms").order("name"),
    sb.from("research_results").select("client_id,week_of,post_count,outlier_count,analysis,created_at").order("week_of", { ascending: false }).limit(200),
    sb.from("content_pieces").select("client_id,status"),
    sb.from("content_ideas").select("client_id,status").eq("status", "Pending Review"),
  ]);
  state.clientRows = clients.data || [];
  state.research = research.data || [];
  state.pieces = pieces.data || [];
  state.ideas = ideas.data || [];
  for (const c of state.clientRows) state.clients[c.id] = c.name;
  renderClients();
}

function renderClients() {
  const rows = state.clientRows;
  const active = state.pieces.filter((p) => p.status !== "Scheduled").length;
  const ready = state.pieces.filter((p) => p.status === "Ready for VA").length;
  $("ck-clients").textContent = rows.length;
  $("ck-ideas").textContent = state.ideas.length;
  $("ck-pieces").textContent = active;
  $("ck-ready").textContent = ready;

  $("client-cards").innerHTML = rows.map((c) => {
    const latest = state.research.find((r) => r.client_id === c.id);
    const ideas = state.ideas.filter((i) => i.client_id === c.id).length;
    const pcs = state.pieces.filter((p) => p.client_id === c.id);
    const counts = Object.fromEntries(STAGES.map((st) => [st, pcs.filter((p) => p.status === st).length]));
    const inProd = pcs.filter((p) => p.status !== "Scheduled").length;
    const runs7 = state.runs.filter((r) => r.client_id === c.id && within(r.started_at, 7));
    const alerts = alertItems().filter((a) => state.runs.find((r) => r.id === a.run)?.client_id === c.id).length;
    const lastRun = state.runs.find((r) => r.client_id === c.id);
    const statusCls = c.subscription_status === "Active" ? "ok" : c.subscription_status === "Onboarding" ? "warn" : "";
    const cadence = (c.research_cadence_weeks || 1) === 1 ? "weekly" : `every ${c.research_cadence_weeks} weeks`;
    const notify = [c.notification_email && "email", c.notification_slack && "Slack"].filter(Boolean).join(" + ") || "no notifications";
    const research = latest
      ? `<p class="client-research${(latest.analysis || "").trim() ? "" : " empty"}">Latest research, week of ${esc(latest.week_of)}: ${latest.post_count} posts, ${latest.outlier_count} outliers${(latest.analysis || "").trim() ? "" : ", analysis empty"}</p>`
      : `<p class="client-research muted">No research yet</p>`;
    const stages = STAGES.filter((st) => counts[st]).map((st) =>
      `<span class="stage${st === "Ready for VA" ? " stuck" : ""}" title="${esc(st)}"><b>${counts[st]}</b> ${esc(STAGE_SHORT[st])}</span>`).join("")
      || `<span class="small muted">No content in production</span>`;
    return `<article class="client">
      <div class="client-head"><h3>${esc(c.name)}</h3><span class="badge ${statusCls}">${esc(c.subscription_status || "Unknown")}</span></div>
      <div class="client-settings">Video ${c.video_enabled === false ? "off (analysis only)" : "on"} · Blog ${c.blog_enabled ? "on" : "off"} · Research ${cadence} · ${esc(notify)}</div>
      <div class="client-stats">
        <div class="cstat"><div class="v">${ideas}</div><div class="l">Ideas to review</div></div>
        <div class="cstat"><div class="v">${inProd}</div><div class="l">In production</div></div>
        <div class="cstat${alerts ? " bad" : ""}"><div class="v">${alerts}</div><div class="l">Alerts, 7 days</div></div>
      </div>
      ${research}
      <div class="stages">${stages}</div>
      <div class="small muted">${runs7.length} agent run${runs7.length === 1 ? "" : "s"} this week${lastRun ? ` · last: ${esc(agentName(lastRun.agent))}, <span data-ago="${esc(lastRun.started_at)}">${ago(lastRun.started_at)}</span>` : ""}</div>
      <div class="row-btns">
        <button class="btn" type="button" data-client-runs="${esc(c.id)}">View runs</button>
        <button class="btn" type="button" data-client-meet="${esc(c.id)}">Review with the agents</button>
      </div>
    </article>`;
  }).join("") || `<p class="empty">No clients yet.</p>`;

  document.querySelectorAll("[data-client-runs]").forEach((b) => b.addEventListener("click", () => {
    state.clientFilter = b.dataset.clientRuns;
    showTab("agents");
    renderRuns();
    $("runs-h").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  document.querySelectorAll("[data-client-meet]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.clientMeet;
    showTab("talk");
    await startThread({
      mode: "meeting",
      agents: Object.keys(AGENTS),
      client_id: id,
      title: `${clientName(id)} review`,
      first: `Give me a status review of ${clientName(id)}: what ran, what's waiting on the client, and anything stuck or broken.`,
    });
  }));
}

// ── conversations ────────────────────────────────────────────────────────────
async function loadThreads() {
  const { data } = await sb.from("agent_threads").select("*").order("updated_at", { ascending: false }).limit(100);
  state.threads = data || [];
  renderThreads();
}

async function loadMessages() {
  if (!state.threadId) { state.messages = []; renderChat(); return; }
  const { data } = await sb.from("agent_messages").select("*").eq("thread_id", state.threadId).order("id").limit(500);
  state.messages = data || [];
  renderChat();
}

let talkTimer = null;
function scheduleTalkReload() {
  clearTimeout(talkTimer);
  talkTimer = setTimeout(() => { loadThreads(); loadMessages(); }, 250);
}

function threadSub(t) {
  const who = t.mode === "meeting" ? "Meeting" : t.agents.map(agentName).join(", ");
  return `${esc(who)}${t.client_id ? ` · ${esc(clientName(t.client_id))}` : ""} · <span data-ago="${esc(t.updated_at)}">${ago(t.updated_at)}</span>`;
}

function renderThreads() {
  $("thread-list").innerHTML = state.threads.length
    ? state.threads.map((t) => `<li><button type="button" data-thread="${esc(t.id)}" class="${t.id === state.threadId ? "active" : ""}">
        <span class="t-title">${esc(t.title)}</span><span class="t-sub">${threadSub(t)}</span></button></li>`).join("")
    : `<li class="empty">No conversations yet.</li>`;
  document.querySelectorAll("[data-thread]").forEach((b) => b.addEventListener("click", () => openThread(b.dataset.thread)));
}

function currentThread() { return state.threads.find((t) => t.id === state.threadId); }

async function openThread(id) {
  state.threadId = id;
  state.chatTargets = [];
  $("new-panel").hidden = true;
  $("chat-panel").hidden = false;
  renderThreads();
  await loadMessages();
  $("chat-input").focus();
}

function scrollChat() {
  const log = $("chat-log");
  if (log) log.scrollTop = log.scrollHeight;
}

function renderChat() {
  const t = currentThread();
  $("chat-form").hidden = !t;
  if (!t) {
    $("chat-title").textContent = "Pick or start a conversation";
    $("chat-who").textContent = "";
    $("chat-log").innerHTML = `<p class="empty">Start a new conversation with one agent or several, or call a meeting with all of them. Use @ and an agent's name to bring someone in mid-conversation.</p>`;
    return;
  }
  $("chat-title").textContent = t.title;
  $("chat-who").textContent = t.mode === "meeting"
    ? `Meeting with ${t.agents.map(agentName).join(", ")}`
    : `With ${t.agents.map(agentName).join(", ")}`;
  const nearBottom = $("chat-log").scrollHeight - $("chat-log").scrollTop - $("chat-log").clientHeight < 80;
  $("chat-log").innerHTML = state.messages.map((m) => {
    if (m.role === "user") {
      return `<div class="msg user"><span class="who">You</span><div class="body">${esc(m.content)}</div></div>`;
    }
    const cls = ["msg", "agent", m.agent === "coordinator" ? "coordinator" : "", m.status === "thinking" ? "thinking" : "", m.status === "error" ? "error" : ""].join(" ");
    const body = m.status === "thinking" ? `${esc(agentName(m.agent))} is thinking…` : esc(m.content);
    return `<div class="${cls}"><span class="who">${esc(agentName(m.agent))}${m.agent === "coordinator" ? " · meeting notes" : ""}</span><div class="body">${body}</div></div>`;
  }).join("") || `<p class="empty">Say hello, or ask what happened this week.</p>`;
  renderTargets(t);
  if (nearBottom || state.messages.some((m) => m.status === "thinking")) scrollChat();
}

function renderTargets(t) {
  const agents = t.mode === "meeting" ? t.agents : Object.keys(AGENTS);
  const label = t.mode === "meeting" ? "Answering: everyone in the meeting, or pick" : "Who should answer";
  $("chat-targets").innerHTML = `<span class="small muted">${label}:</span>` + agents.map((k) =>
    `<button type="button" class="chip" data-target="${k}" aria-pressed="${state.chatTargets.includes(k)}">${esc(agentName(k))}</button>`).join("");
  document.querySelectorAll("[data-target]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.target;
    state.chatTargets = state.chatTargets.includes(k) ? state.chatTargets.filter((x) => x !== k) : [...state.chatTargets, k];
    renderTargets(t);
  }));
}

function openNewPanel(mode) {
  state.newMode = mode;
  state.newPicked = mode === "meeting" ? Object.keys(AGENTS) : [];
  $("chat-panel").hidden = true;
  $("new-panel").hidden = false;
  $("new-title").textContent = mode === "meeting" ? "Call a meeting" : "New conversation";
  $("new-help").textContent = mode === "meeting"
    ? "Everyone is invited. Untick anyone you don't need. Each agent answers in pipeline order, then the Coordinator writes the notes."
    : "Pick one agent or several. You can bring others in later with @.";
  $("new-client").innerHTML = `<option value="">All clients</option>` + state.clientRows.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  renderNewChips();
}

function renderNewChips() {
  $("new-agents").innerHTML = Object.keys(AGENTS).map((k) =>
    `<button type="button" class="chip" data-new="${k}" aria-pressed="${state.newPicked.includes(k)}" title="${esc(AGENTS[k].role)}">${esc(agentName(k))}</button>`).join("");
  document.querySelectorAll("[data-new]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.new;
    state.newPicked = state.newPicked.includes(k) ? state.newPicked.filter((x) => x !== k) : [...state.newPicked, k];
    renderNewChips();
  }));
}

async function startThread({ mode, agents, client_id, title, first }) {
  try {
    const out = await callApi("/api/command-center/threads", { mode, agents, client_id, title });
    state.threads.unshift(out.thread);
    await openThread(out.thread.id);
    if (first) await sendMessage(first);
  } catch (err) {
    banner(`Could not start the conversation: ${err.message}`, true);
  }
}

async function sendMessage(text) {
  const t = currentThread();
  if (!t || !text.trim()) return;
  try {
    await callApi(`/api/command-center/threads/${t.id}/messages`, { content: text, agents: state.chatTargets });
    state.chatTargets = [];
    await loadMessages();
  } catch (err) {
    banner(`Message not sent: ${err.message}`, true);
  }
}

$("new-chat-btn").addEventListener("click", () => openNewPanel("direct"));
$("new-meeting-btn").addEventListener("click", () => openNewPanel("meeting"));
$("new-cancel").addEventListener("click", () => { $("new-panel").hidden = true; $("chat-panel").hidden = false; });
$("new-start").addEventListener("click", async () => {
  if (!state.newPicked.length) { banner("Pick at least one agent.", true); return; }
  const client_id = $("new-client").value || null;
  await startThread({
    mode: state.newMode,
    agents: state.newPicked,
    client_id,
    title: state.newMode === "meeting" && client_id ? `${clientName(client_id)} review` : undefined,
  });
});
$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("chat-input");
  const text = input.value;
  input.value = "";
  await sendMessage(text);
});
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("chat-form").requestSubmit(); }
});

init();
