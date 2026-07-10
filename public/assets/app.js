const state = {
  needsSetup: false,
  authenticated: false,
  hasApiKey: false,
  links: [],
  total: 0,
  offset: 0,
  limit: 20,
  query: "",
  editing: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function initializeSiteCopy() {
  const host = window.location.host;
  document.title = `${host} · Edge Links`;
  $$('[data-public-host]').forEach((element) => { element.textContent = host; });
  $$('[data-public-prefix]').forEach((element) => { element.textContent = `${host}/`; });

  const authDomain = $('#auth-domain');
  const dot = host.indexOf('.');
  authDomain.replaceChildren(document.createTextNode(dot > 0 ? host.slice(0, dot) : host));
  if (dot > 0) {
    const suffix = document.createElement('span');
    suffix.textContent = host.slice(dot);
    authDomain.append(suffix);
  }

  $('#api-example').textContent = `curl -X POST ${window.location.origin}/api/v2/links \\
  -H "Authorization: Bearer lnk_YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"target":"https://example.com"}'`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function setBusy(button, busy, label = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("visible"), 2600);
}

function copyText(value) {
  return navigator.clipboard.writeText(value).then(() => toast("Copied to clipboard"));
}

function applyAuthState() {
  $$(".authenticated-only").forEach((element) => { element.hidden = !state.authenticated; });
  const gate = $("#auth-gate");
  gate.hidden = state.authenticated;
  $("#setup-copy").hidden = !state.needsSetup;
  $("#login-copy").hidden = state.needsSetup;
  $("#auth-submit").textContent = state.needsSetup ? "Create admin account" : "Sign in";
  $("#auth-password").autocomplete = state.needsSetup ? "new-password" : "current-password";
  $("#api-key-status").textContent = state.hasApiKey
    ? "An active token exists. Generating another will revoke it."
    : "No API token is active.";
}

async function loadStatus() {
  const status = await api("/api/auth/status");
  state.needsSetup = status.needsSetup;
  state.authenticated = status.authenticated;
  state.hasApiKey = status.hasApiKey;
  applyAuthState();
  if (state.authenticated) await loadLinks();
}

function formatDate(timestamp) {
  if (!timestamp) return "Never";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function linkStatus(link) {
  if (link.expiresAt && link.expiresAt <= Date.now()) return ["Expired", "expired"];
  return ["Live", "live"];
}

function actionButton(label, action, slug) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button action-button";
  button.dataset.action = action;
  button.dataset.slug = slug;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.textContent = { copy: "⧉", stats: "↗", edit: "✎", delete: "×" }[action] || "·";
  return button;
}

function renderLinks() {
  const list = $("#link-list");
  list.replaceChildren();
  $("#empty-state").hidden = state.links.length > 0 || state.query !== "";
  if (state.links.length === 0 && state.query) {
    const result = document.createElement("div");
    result.className = "no-results";
    result.textContent = `No links match “${state.query}”.`;
    list.append(result);
  }

  for (const link of state.links) {
    const row = document.createElement("article");
    row.className = "link-row";

    const main = document.createElement("div");
    main.className = "link-main";
    const top = document.createElement("div");
    top.className = "link-topline";
    const short = document.createElement("a");
    short.href = link.link;
    short.target = "_blank";
    short.rel = "noreferrer";
    short.textContent = link.link.replace(/^https?:\/\//, "");
    const [statusText, statusClass] = linkStatus(link);
    const badge = document.createElement("span");
    badge.className = `status-badge ${statusClass}`;
    badge.textContent = statusText;
    top.append(short, badge);
    const target = document.createElement("p");
    target.className = "target-url";
    target.textContent = link.target;
    const description = document.createElement("p");
    description.className = "link-description";
    description.textContent = link.description || "No internal note";
    main.append(top, target, description);

    const metrics = document.createElement("div");
    metrics.className = "link-metrics";
    const clicks = document.createElement("div");
    clicks.innerHTML = `<strong>${Number(link.visitCount).toLocaleString()}</strong><span>clicks</span>`;
    const created = document.createElement("div");
    created.innerHTML = `<strong>${formatDate(link.createdAt).split(",")[0]}</strong><span>created</span>`;
    const expiry = document.createElement("div");
    expiry.innerHTML = `<strong>${link.expiresAt ? formatDate(link.expiresAt).split(",")[0] : "∞"}</strong><span>expires</span>`;
    metrics.append(clicks, created, expiry);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(
      actionButton("Copy link", "copy", link.slug),
      actionButton("View analytics", "stats", link.slug),
      actionButton("Edit link", "edit", link.slug),
      actionButton("Delete link", "delete", link.slug),
    );
    row.append(main, metrics, actions);
    list.append(row);
  }

  const pagination = $("#pagination");
  pagination.hidden = state.total <= state.limit;
  $("#previous-page").disabled = state.offset === 0;
  $("#next-page").disabled = state.offset + state.limit >= state.total;
  const from = state.total === 0 ? 0 : state.offset + 1;
  $("#page-summary").textContent = `${from}–${Math.min(state.offset + state.limit, state.total)} of ${state.total}`;
}

async function loadLinks() {
  const params = new URLSearchParams({ limit: state.limit, offset: state.offset, q: state.query });
  try {
    const result = await api(`/api/links?${params}`);
    state.links = result.data;
    state.total = result.total;
    renderLinks();
  } catch (error) {
    if (error.status === 401) {
      state.authenticated = false;
      state.needsSetup = false;
      applyAuthState();
    } else toast(error.message);
  }
}

function toLocalDateTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function openEdit(link) {
  state.editing = link;
  $("#edit-title").textContent = link.link.replace(/^https?:\/\//, "");
  $("#edit-target").value = link.target;
  $("#edit-description").value = link.description || "";
  $("#edit-expiry").value = toLocalDateTime(link.expiresAt);
  $("#edit-dialog").showModal();
}

function renderRankedList(selector, items) {
  const root = $(selector);
  root.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No data yet";
    root.append(empty);
    return;
  }
  const max = Math.max(...items.map((item) => item.count), 1);
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "rank-row";
    const label = document.createElement("span");
    label.textContent = item.value;
    const bar = document.createElement("i");
    bar.style.width = `${Math.max(4, item.count / max * 100)}%`;
    const count = document.createElement("b");
    count.textContent = item.count.toLocaleString();
    row.append(label, bar, count);
    root.append(row);
  }
}

function renderDailyChart(items) {
  const chart = $("#daily-chart");
  chart.replaceChildren();
  const recent = items.slice(-30);
  if (!recent.length) {
    chart.textContent = "Clicks over time will appear here.";
    chart.classList.add("empty-chart");
    return;
  }
  chart.classList.remove("empty-chart");
  const max = Math.max(...recent.map((item) => item.count), 1);
  for (const item of recent) {
    const bar = document.createElement("i");
    bar.style.height = `${Math.max(5, item.count / max * 100)}%`;
    bar.title = `${item.day}: ${item.count} click${item.count === 1 ? "" : "s"}`;
    chart.append(bar);
  }
}

async function openStats(link) {
  $("#stats-title").textContent = link.link.replace(/^https?:\/\//, "");
  $("#stats-total").textContent = "…";
  $("#stats-dialog").showModal();
  try {
    const stats = await api(`/api/links/${encodeURIComponent(link.slug)}/stats`);
    $("#stats-total").textContent = Number(stats.total).toLocaleString();
    renderDailyChart(stats.daily);
    renderRankedList("#country-stats", stats.countries);
    renderRankedList("#referrer-stats", stats.referrers);
    renderRankedList("#browser-stats", stats.browsers);
  } catch (error) {
    toast(error.message);
    $("#stats-dialog").close();
  }
}

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#auth-submit");
  const errorElement = $("#auth-error");
  errorElement.textContent = "";
  setBusy(button, true, state.needsSetup ? "Creating account…" : "Signing in…");
  try {
    await api(state.needsSetup ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("#auth-email").value, password: $("#auth-password").value }),
    });
    state.authenticated = true;
    state.needsSetup = false;
    applyAuthState();
    await loadStatus();
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
});

$("#create-link-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  setBusy(button, true, "Creating…");
  const expiryValue = $("#expires-at").value;
  try {
    const link = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({
        target: $("#target").value,
        slug: $("#slug").value || undefined,
        description: $("#description").value || undefined,
        expiresAt: expiryValue ? new Date(expiryValue).toISOString() : undefined,
      }),
    });
    const created = $("#created-link");
    const anchor = $("#created-link-anchor");
    anchor.href = link.link;
    anchor.textContent = link.link;
    created.hidden = false;
    created.dataset.url = link.link;
    form.reset();
    state.offset = 0;
    await loadLinks();
    toast("Short link created");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(button, false);
  }
});

$("#copy-created-link").addEventListener("click", () => copyText($("#created-link").dataset.url));

$("#link-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const link = state.links.find((item) => item.slug === button.dataset.slug);
  if (!link) return;
  if (button.dataset.action === "copy") await copyText(link.link);
  if (button.dataset.action === "edit") openEdit(link);
  if (button.dataset.action === "stats") await openStats(link);
  if (button.dataset.action === "delete" && confirm(`Delete ${link.link}? This cannot be undone.`)) {
    try {
      await api(`/api/links/${encodeURIComponent(link.slug)}`, { method: "DELETE" });
      await loadLinks();
      toast("Link deleted");
    } catch (error) { toast(error.message); }
  }
});

$("#edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.editing) return;
  const button = $("#save-edit");
  setBusy(button, true, "Saving…");
  const expiry = $("#edit-expiry").value;
  try {
    await api(`/api/links/${encodeURIComponent(state.editing.slug)}`, {
      method: "PATCH",
      body: JSON.stringify({
        target: $("#edit-target").value,
        description: $("#edit-description").value,
        expiresAt: expiry ? new Date(expiry).toISOString() : null,
      }),
    });
    $("#edit-dialog").close();
    await loadLinks();
    toast("Link updated");
  } catch (error) { toast(error.message); }
  finally { setBusy(button, false); }
});

$("#logout-button").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  state.authenticated = false;
  state.links = [];
  applyAuthState();
});

$("#api-key-button").addEventListener("click", () => $("#api-dialog").showModal());
$("#generate-api-key").addEventListener("click", async () => {
  try {
    const result = await api("/api/auth/apikey", { method: "POST" });
    $("#api-token").hidden = false;
    $("#api-token-value").textContent = result.apiKey;
    state.hasApiKey = true;
    applyAuthState();
    toast("New API token generated");
  } catch (error) { toast(error.message); }
});
$("#revoke-api-key").addEventListener("click", async () => {
  try {
    await api("/api/auth/apikey", { method: "DELETE" });
    $("#api-token").hidden = true;
    $("#api-token-value").textContent = "";
    state.hasApiKey = false;
    applyAuthState();
    toast("API token revoked");
  } catch (error) { toast(error.message); }
});
$("#copy-api-key").addEventListener("click", () => copyText($("#api-token-value").textContent));

$$(".close-dialog").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$("#previous-page").addEventListener("click", () => { state.offset = Math.max(0, state.offset - state.limit); loadLinks(); });
$("#next-page").addEventListener("click", () => { state.offset += state.limit; loadLinks(); });

let searchTimer;
$("#search").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = event.target.value.trim();
    state.offset = 0;
    loadLinks();
  }, 220);
});

initializeSiteCopy();
loadStatus().catch((error) => {
  toast(error.message);
  $("#auth-gate").hidden = false;
});
