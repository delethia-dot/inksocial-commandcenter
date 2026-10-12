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
};

// ── helpers ──────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const agentName = (key) => AGENTS[key]?.name || key;
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
const statusDot = (st) => ({ running: "dot-run", success: "dot-ok", failed: "dot-bad", skipped: "dot-skip" }[st] || "dot-idle");
const statusLabel = (st) => ({ running: "Running", success: "Done", failed: "Failed", skipped: "Skipped" }[st] || "Idle");

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
  reloadTimer = setTimeout(reload, 400);
}

function subscribe() {
  state.channel = sb.channel("agent-log")
    .on("postgres_changes", { event: "*", schema: "public", table: "agent_runs" }, scheduleReload)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_events" }, scheduleReload)
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
  const rows = state.runs.filter((r) => !demoOnly || r.demo).slice(0, 40);
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
  $("tl-meta").textContent = `${clock(run.started_at)}${run.demo ? " · demo" : ""} · ${run.trigger || ""}`;
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

$("ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("ask-input");
  const q = input.value.trim();
  if (!q) return;
  const log = $("ask-log");
  log.insertAdjacentHTML("beforeend", `<div class="bubble me">${esc(q)}</div>`);
  const pending = document.createElement("div");
  pending.className = "bubble bot";
  pending.textContent = "Checking the run log…";
  log.appendChild(pending);
  log.scrollTop = log.scrollHeight;
  input.value = "";
  try {
    const out = await callApi("/api/command-center/ask", { question: q });
    pending.textContent = out.answer || "No answer came back.";
  } catch (err) {
    pending.textContent = `Could not answer: ${err.message}`;
  }
  log.scrollTop = log.scrollHeight;
});

init();
