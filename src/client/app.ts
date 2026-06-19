import type {
  CapturedRequest,
  Endpoint,
  ReplayResult,
  RequestSummary,
} from "../shared/types";

type EndpointWithUrl = Endpoint & { capture_url: string };

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const state: {
  endpoints: EndpointWithUrl[];
  current: EndpointWithUrl | null;
  requests: RequestSummary[];
  selectedId: string | null;
  detail: CapturedRequest | null;
  activeTab: string;
  es: EventSource | null;
} = {
  endpoints: [],
  current: null,
  requests: [],
  selectedId: null,
  detail: null,
  activeTab: "pretty",
  es: null,
};

// ---- API helpers ----
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 401) {
    location.reload();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function toast(msg: string): void {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 2200);
}

function fmtSize(n: number | null): string {
  if (n == null) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString() + " · " + d.toLocaleDateString();
}

function methodClass(m: string): string {
  return "m-" + m.toLowerCase();
}

// ---- Rendering ----
function renderEndpointBar(): void {
  const bar = $("endpointBar");
  if (!state.current) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  $<HTMLElement>("captureUrl").textContent = state.current.capture_url;

  const sel = $<HTMLSelectElement>("endpointSelect");
  sel.innerHTML = "";
  for (const e of state.endpoints) {
    const opt = document.createElement("option");
    opt.value = e.slug;
    opt.textContent = e.name ? `${e.name} (${e.slug})` : e.slug;
    if (e.slug === state.current.slug) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderList(): void {
  const ul = $("reqList");
  const empty = $("listEmpty");
  $("listCount").textContent = `${state.requests.length} request${
    state.requests.length === 1 ? "" : "s"
  }`;

  ul.innerHTML = "";
  empty.style.display = state.requests.length === 0 ? "block" : "none";

  for (const r of state.requests) {
    const li = document.createElement("li");
    li.className = "req-item" + (r.id === state.selectedId ? " active" : "");
    li.dataset.id = r.id;
    li.innerHTML = `
      <span class="method-badge ${methodClass(r.method)}">${r.method}</span>
      <span class="col">
        <span class="path">${escapeHtml(shortPath(r.path))}</span>
        <span class="sub">${fmtSize(r.body_size)} · ${new Date(
          r.received_at,
        ).toLocaleTimeString()}</span>
      </span>`;
    li.addEventListener("click", () => selectRequest(r.id));
    ul.appendChild(li);
  }
}

function shortPath(path: string | null): string {
  if (!path) return "/";
  return path.replace(/^\/hook\/[^/]+/, "") || "/";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDetail(): void {
  const d = state.detail;
  $("detailEmpty").style.display = d ? "none" : "block";
  $("detail").hidden = !d;
  if (!d) return;

  const mb = $("dMethod");
  mb.textContent = d.method;
  mb.className = "method-badge " + methodClass(d.method);
  $("dPath").textContent = d.path ?? "/";

  const meta = $("dMeta");
  meta.innerHTML = `
    <span>${fmtTime(d.received_at)}</span>
    <span>${fmtSize(d.body_size)}</span>
    <span>${escapeHtml(d.content_type ?? "—")}</span>
    <span>from ${escapeHtml(d.source_ip ?? "—")}</span>
    ${d.truncated ? '<span class="trunc">⚠ body truncated</span>' : ""}`;

  renderTab();
}

function renderTab(): void {
  const d = state.detail;
  const body = $("tabBody");
  if (!d) return;

  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle(
      "active",
      (t as HTMLElement).dataset.tab === state.activeTab,
    );
  });

  if (state.activeTab === "pretty") {
    body.innerHTML = `<pre>${escapeHtml(prettyBody(d))}</pre>`;
  } else if (state.activeTab === "raw") {
    body.innerHTML = `<pre>${escapeHtml(d.body_raw ?? "(empty body)")}</pre>`;
  } else if (state.activeTab === "headers") {
    body.innerHTML = kvTable(d.headers ?? {});
  } else if (state.activeTab === "query") {
    body.innerHTML = kvTable(d.query ?? {});
  }
}

function prettyBody(d: CapturedRequest): string {
  if (!d.body_raw) return "(empty body)";
  const ct = (d.content_type ?? "").toLowerCase();
  if (ct.includes("json") || d.body_raw.trim().startsWith("{") || d.body_raw.trim().startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(d.body_raw), null, 2);
    } catch {
      /* fall through */
    }
  }
  return d.body_raw;
}

function kvTable(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return '<p class="muted">None.</p>';
  const rows = keys
    .map(
      (k) =>
        `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(
          String(obj[k]),
        )}</td></tr>`,
    )
    .join("");
  return `<table class="kv">${rows}</table>`;
}

// ---- Data loading ----
async function loadEndpoints(): Promise<void> {
  state.endpoints = await api<EndpointWithUrl[]>("/api/endpoints");
  const savedSlug = localStorage.getItem("wi.slug");
  let current = state.endpoints.find((e) => e.slug === savedSlug) ?? null;
  if (!current && state.endpoints.length > 0) current = state.endpoints[0];
  if (!current) {
    current = await createEndpoint();
  }
  await selectEndpoint(current.slug);
}

async function selectEndpoint(slug: string): Promise<void> {
  state.current =
    state.endpoints.find((e) => e.slug === slug) ??
    (await api<EndpointWithUrl>(`/api/endpoints/${slug}`));
  localStorage.setItem("wi.slug", slug);
  state.selectedId = null;
  state.detail = null;
  renderEndpointBar();
  renderDetail();
  await loadRequests();
  connectStream();
}

async function loadRequests(): Promise<void> {
  if (!state.current) return;
  const res = await api<{ requests: RequestSummary[] }>(
    `/api/endpoints/${state.current.slug}/requests?limit=200`,
  );
  state.requests = res.requests;
  renderList();
}

async function selectRequest(id: string): Promise<void> {
  state.selectedId = id;
  renderList();
  state.detail = await api<CapturedRequest>(`/api/requests/${id}`);
  state.activeTab = "pretty";
  renderDetail();
}

async function createEndpoint(): Promise<EndpointWithUrl> {
  const ep = await api<EndpointWithUrl>("/api/endpoints", { method: "POST", body: "{}" });
  state.endpoints.unshift(ep);
  return ep;
}

// ---- SSE ----
function connectStream(): void {
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  if (!state.current) return;
  const es = new EventSource(`/api/endpoints/${state.current.slug}/stream`);
  state.es = es;

  es.addEventListener("connected", () => setLive(true));
  es.addEventListener("request", (ev) => {
    const summary = JSON.parse((ev as MessageEvent).data) as RequestSummary;
    state.requests.unshift(summary);
    renderList();
    const first = document.querySelector(".req-item");
    first?.classList.add("new");
  });
  es.onerror = () => setLive(false);
  es.onopen = () => setLive(true);
}

function setLive(on: boolean): void {
  const el = $("liveIndicator");
  el.classList.toggle("on", on);
  $("liveText").textContent = on ? "live" : "offline";
}

// ---- Actions ----
function bindEvents(): void {
  $("copyUrl").addEventListener("click", async () => {
    if (!state.current) return;
    await navigator.clipboard.writeText(state.current.capture_url);
    toast("Capture URL copied");
  });

  $("endpointSelect").addEventListener("change", (e) => {
    void selectEndpoint((e.target as HTMLSelectElement).value);
  });

  $("newBtn").addEventListener("click", async () => {
    const ep = await createEndpoint();
    await selectEndpoint(ep.slug);
    toast("New endpoint created");
  });

  $("clearBtn").addEventListener("click", async () => {
    if (!state.current) return;
    if (!confirm("Delete all captured requests for this endpoint?")) return;
    await api(`/api/endpoints/${state.current.slug}/requests`, { method: "DELETE" });
    state.requests = [];
    state.detail = null;
    state.selectedId = null;
    renderList();
    renderDetail();
    toast("Requests cleared");
  });

  $("tabs").addEventListener("click", (e) => {
    const tab = (e.target as HTMLElement).dataset.tab;
    if (!tab) return;
    state.activeTab = tab;
    renderTab();
  });

  $("delReqBtn").addEventListener("click", async () => {
    if (!state.detail) return;
    await api(`/api/requests/${state.detail.id}`, { method: "DELETE" });
    state.requests = state.requests.filter((r) => r.id !== state.detail!.id);
    state.detail = null;
    state.selectedId = null;
    renderList();
    renderDetail();
    toast("Request deleted");
  });

  // Replay modal
  $("replayBtn").addEventListener("click", () => {
    $("replayResult").hidden = true;
    $<HTMLInputElement>("replayTarget").value =
      localStorage.getItem("wi.replayTarget") ?? "";
    $("replayModal").hidden = false;
  });
  $("replayCancel").addEventListener("click", () => ($("replayModal").hidden = true));
  $("replaySend").addEventListener("click", doReplay);

  // Config modal
  $("configBtn").addEventListener("click", () => {
    if (!state.current) return;
    $<HTMLInputElement>("cfgStatus").value = String(state.current.response_status);
    $<HTMLInputElement>("cfgType").value = state.current.response_content_type;
    $<HTMLTextAreaElement>("cfgBody").value = state.current.response_body;
    $("configModal").hidden = false;
  });
  $("cfgCancel").addEventListener("click", () => ($("configModal").hidden = true));
  $("cfgSave").addEventListener("click", saveConfig);

  for (const el of [$("replayModal"), $("configModal")]) {
    el.addEventListener("click", (e) => {
      if (e.target === el) el.hidden = true;
    });
  }
}

async function doReplay(): Promise<void> {
  if (!state.detail) return;
  const target = $<HTMLInputElement>("replayTarget").value.trim();
  if (!target) return;
  localStorage.setItem("wi.replayTarget", target);
  const out = $("replayResult");
  out.hidden = false;
  out.className = "replay-result";
  out.textContent = "Sending…";
  try {
    const r = await api<ReplayResult>(`/api/requests/${state.detail.id}/replay`, {
      method: "POST",
      body: JSON.stringify({ target }),
    });
    out.className = "replay-result " + (r.ok ? "ok" : "err");
    out.textContent =
      `${r.status} ${r.statusText} · ${r.durationMs}ms\n\n` +
      r.body.slice(0, 4000);
  } catch (err) {
    out.className = "replay-result err";
    out.textContent = "Error: " + (err as Error).message;
  }
}

async function saveConfig(): Promise<void> {
  if (!state.current) return;
  const patch = {
    response_status: Number($<HTMLInputElement>("cfgStatus").value),
    response_content_type: $<HTMLInputElement>("cfgType").value,
    response_body: $<HTMLTextAreaElement>("cfgBody").value,
  };
  const updated = await api<EndpointWithUrl>(
    `/api/endpoints/${state.current.slug}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  state.current = updated;
  const idx = state.endpoints.findIndex((e) => e.slug === updated.slug);
  if (idx >= 0) state.endpoints[idx] = updated;
  $("configModal").hidden = true;
  toast("Response configuration saved");
}

// ---- Boot ----
bindEvents();
loadEndpoints().catch((err) => toast("Error: " + err.message));
