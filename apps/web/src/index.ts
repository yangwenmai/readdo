import { existsSync, readFileSync, statSync } from "node:fs";
import { IncomingMessage, ServerResponse, createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.WEB_PORT ?? 5173);
const apiBase = process.env.API_BASE_URL ?? "http://localhost:8787/api";
const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const exportsRoot = resolve(repoRoot, "exports");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Read→Do Inbox</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; margin: 0; background: #f7f8fa; color: #1f2937; }
      header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #111827; color: white; }
      main { display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; padding: 12px; min-height: calc(100vh - 56px); }
      section { background: white; border-radius: 10px; padding: 12px; overflow: auto; }
      h1 { font-size: 18px; margin: 0; }
      h2 { margin: 0 0 8px; font-size: 16px; }
      .controls { display: flex; gap: 8px; align-items: center; }
      button { padding: 6px 10px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; cursor: pointer; }
      button.primary { background: #111827; color: #fff; border-color: #111827; }
      .item-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fcfcfd; }
      .item-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 8px; }
      .intent { font-weight: 700; margin: 4px 0; }
      .muted { color: #6b7280; font-size: 12px; }
      .status { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #eef2ff; color: #3730a3; }
      .actions { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
      .actions button:disabled { cursor: not-allowed; opacity: 0.6; }
      .group-title { margin: 12px 0 6px; font-size: 13px; color: #374151; text-transform: uppercase; letter-spacing: 0.04em; }
      pre { background: #0b1020; color: #d1d5db; padding: 8px; border-radius: 8px; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
      .empty { padding: 16px; border: 1px dashed #d1d5db; border-radius: 8px; color: #6b7280; text-align: center; }
      .error { color: #b91c1c; font-size: 13px; }
      textarea { width: 100%; min-height: 180px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .editor-row { display: flex; gap: 8px; margin: 8px 0; align-items: center; flex-wrap: wrap; }
      .hint { font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 8px; margin-top: 6px; }
      .diff { font-size: 12px; color: #1f2937; background: #ecfeff; border: 1px solid #a5f3fc; border-radius: 6px; padding: 6px 8px; margin-top: 6px; white-space: pre-wrap; }
      .failure-note { font-size: 12px; color: #991b1b; margin-top: 6px; }
      .file-row { display: flex; gap: 8px; align-items: center; margin: 4px 0; }
      .file-path { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #374151; }
      .diff-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
      .diff-column { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px; background: #fafafa; }
      .diff-column h4 { margin: 0 0 6px; font-size: 12px; color: #374151; }
      .diff-column ul { margin: 0; padding-left: 16px; max-height: 160px; overflow: auto; }
      .diff-column li { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      @media (max-width: 1100px) { main { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Read→Do Inbox</h1>
      <div class="controls">
        <span class="muted">API: ${apiBase}</span>
        <span class="muted" id="workerStats">Queue: -</span>
        <button id="runWorkerBtn" type="button">Run Worker Once</button>
        <button id="previewRetryBtn" type="button">Preview Retry</button>
        <button id="previewNextBtn" type="button" style="display:none;">Preview Next</button>
        <button id="retryFailedBtn" type="button">Retry Failed</button>
        <button id="previewArchiveBtn" type="button">Preview Archive</button>
        <button id="archiveBlockedBtn" type="button">Archive Failed</button>
        <button id="previewUnarchiveBtn" type="button">Preview Unarchive</button>
        <button id="unarchiveBatchBtn" type="button">Unarchive Archived</button>
        <label class="muted" style="display:flex;align-items:center;gap:4px;">
          <input id="autoRefreshToggle" type="checkbox" />
          Auto refresh
        </label>
        <input id="queryInput" placeholder="Search title/domain/intent" />
        <select id="statusFilter">
          <option value="">All Status</option>
          <option value="CAPTURED">CAPTURED</option>
          <option value="QUEUED">QUEUED</option>
          <option value="PROCESSING">PROCESSING</option>
          <option value="READY">READY</option>
          <option value="FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT">FAILED_*</option>
          <option value="SHIPPED">SHIPPED</option>
          <option value="ARCHIVED">ARCHIVED</option>
        </select>
        <select id="retryableFilter">
          <option value="">Retryable: All</option>
          <option value="true">Retryable: true</option>
          <option value="false">Retryable: false</option>
        </select>
        <select id="failureStepFilter">
          <option value="">Failure Step: All</option>
          <option value="extract">extract</option>
          <option value="pipeline">pipeline</option>
          <option value="export">export</option>
        </select>
        <select id="archiveRetryableFilter">
          <option value="false">Archive Scope: blocked</option>
          <option value="true">Archive Scope: retryable</option>
          <option value="all">Archive Scope: all failed</option>
        </select>
        <select id="unarchiveModeFilter">
          <option value="smart">Unarchive Mode: smart</option>
          <option value="regenerate">Unarchive Mode: regenerate</option>
        </select>
        <label class="muted" style="display:flex;align-items:center;gap:4px;">
          Batch Limit
          <input id="batchLimitInput" type="number" min="1" max="200" step="1" value="100" style="width:72px;" />
        </label>
        <label class="muted" style="display:flex;align-items:center;gap:4px;">
          Preview Offset
          <input id="previewOffsetInput" type="number" min="0" step="1" value="0" style="width:72px;" />
        </label>
        <button class="primary" id="refreshBtn">Refresh</button>
      </div>
    </header>
    <main>
      <section>
        <h2>Decision Queue</h2>
        <div id="error" class="error"></div>
        <pre id="retryPreviewOutput" style="display:none;"></pre>
        <div id="inbox"></div>
      </section>
      <section>
        <h2>Detail</h2>
        <div id="detail" class="empty">Select one item from the list.</div>
      </section>
    </main>
    <script>
      const API_BASE = ${JSON.stringify(apiBase)};
      const inboxEl = document.getElementById("inbox");
      const detailEl = document.getElementById("detail");
      const errorEl = document.getElementById("error");
      const retryPreviewOutputEl = document.getElementById("retryPreviewOutput");
      const refreshBtn = document.getElementById("refreshBtn");
      const queryInput = document.getElementById("queryInput");
      const statusFilter = document.getElementById("statusFilter");
      const retryableFilter = document.getElementById("retryableFilter");
      const failureStepFilter = document.getElementById("failureStepFilter");
      const archiveRetryableFilter = document.getElementById("archiveRetryableFilter");
      const workerStatsEl = document.getElementById("workerStats");
      const runWorkerBtn = document.getElementById("runWorkerBtn");
      const previewRetryBtn = document.getElementById("previewRetryBtn");
      const previewNextBtn = document.getElementById("previewNextBtn");
      const retryFailedBtn = document.getElementById("retryFailedBtn");
      const previewArchiveBtn = document.getElementById("previewArchiveBtn");
      const archiveBlockedBtn = document.getElementById("archiveBlockedBtn");
      const previewUnarchiveBtn = document.getElementById("previewUnarchiveBtn");
      const unarchiveBatchBtn = document.getElementById("unarchiveBatchBtn");
      const autoRefreshToggle = document.getElementById("autoRefreshToggle");
      const unarchiveModeFilter = document.getElementById("unarchiveModeFilter");
      const batchLimitInput = document.getElementById("batchLimitInput");
      const previewOffsetInput = document.getElementById("previewOffsetInput");

      let allItems = [];
      let selectedId = null;
      let selectedDetail = null;
      let isLoadingItems = false;
      let autoRefreshTimer = null;
      let previewContinuation = null;
      const controlsStorageKey = "readdo.web.controls.v1";

      function clearPreviewContinuation() {
        previewContinuation = null;
        previewNextBtn.style.display = "none";
        previewNextBtn.textContent = "Preview Next";
        previewNextBtn.disabled = false;
      }

      function setPreviewContinuation(kind, nextOffset) {
        if (nextOffset == null) {
          clearPreviewContinuation();
          return;
        }
        previewContinuation = { kind, next_offset: Number(nextOffset) };
        previewNextBtn.style.display = "inline-block";
        previewNextBtn.textContent = "Preview Next (" + nextOffset + ")";
      }

      function persistControls() {
        try {
          const payload = {
            q: queryInput.value || "",
            status: statusFilter.value || "",
            retryable: retryableFilter.value || "",
            failure_step: failureStepFilter.value || "",
            archive_retryable: archiveRetryableFilter.value || "false",
            unarchive_mode: unarchiveModeFilter.value || "smart",
            batch_limit: normalizedBatchLimit(),
            preview_offset: normalizedPreviewOffset(),
            auto_refresh: Boolean(autoRefreshToggle.checked),
          };
          localStorage.setItem(controlsStorageKey, JSON.stringify(payload));
        } catch {
          // ignore storage failures
        }
      }

      function restoreControls() {
        try {
          const raw = localStorage.getItem(controlsStorageKey);
          if (!raw) return;
          const payload = JSON.parse(raw);
          if (typeof payload?.q === "string") queryInput.value = payload.q;
          if (typeof payload?.status === "string") statusFilter.value = payload.status;
          if (typeof payload?.retryable === "string") retryableFilter.value = payload.retryable;
          if (typeof payload?.failure_step === "string") failureStepFilter.value = payload.failure_step;
          if (typeof payload?.archive_retryable === "string") archiveRetryableFilter.value = payload.archive_retryable;
          if (typeof payload?.unarchive_mode === "string") unarchiveModeFilter.value = payload.unarchive_mode;
          if (Number.isInteger(Number(payload?.batch_limit))) {
            batchLimitInput.value = String(Math.min(Math.max(Number(payload.batch_limit), 1), 200));
          }
          if (Number.isInteger(Number(payload?.preview_offset))) {
            previewOffsetInput.value = String(Math.max(Number(payload.preview_offset), 0));
          }
          autoRefreshToggle.checked = Boolean(payload?.auto_refresh);
        } catch {
          // ignore malformed storage payloads
        }
      }

      function groupedItems(items) {
        const groups = {
          read_next: [],
          worth_it: [],
          if_time: [],
          in_progress: [],
          needs_attention: [],
          skip: [],
          shipped: [],
          archived: []
        };

        for (const item of items) {
          if (item.status === "ARCHIVED") {
            groups.archived.push(item);
            continue;
          }
          if (item.status === "SHIPPED") {
            groups.shipped.push(item);
            continue;
          }
          if (item.status === "READY") {
            if (item.priority === "READ_NEXT") groups.read_next.push(item);
            else if (item.priority === "WORTH_IT") groups.worth_it.push(item);
            else if (item.priority === "IF_TIME") groups.if_time.push(item);
            else groups.skip.push(item);
            continue;
          }
          if (item.status.startsWith("FAILED_")) {
            groups.needs_attention.push(item);
          } else {
            groups.in_progress.push(item);
          }
        }
        return groups;
      }

      async function request(path, options = {}) {
        const response = await fetch(API_BASE + path, {
          headers: { "content-type": "application/json", ...(options.headers || {}) },
          ...options
        });
        const data = await response.json();
        if (!response.ok) {
          const message = data?.error?.message || ("Request failed: " + response.status);
          const code = data?.error?.code || "UNKNOWN_ERROR";
          const err = new Error(message);
          err.code = code;
          throw err;
        }
        return data;
      }

      function retryInfo(item) {
        const failure = item?.failure || {};
        const retryLimit = Number(failure.retry_limit ?? 0);
        const retryAttempts = Number(failure.retry_attempts ?? 0);
        const retryable = failure.retryable !== false;
        const remaining = retryLimit > 0 ? Math.max(retryLimit - retryAttempts, 0) : null;
        return { retryLimit, retryAttempts, retryable, remaining };
      }

      function isRetryableFailedItem(item) {
        if (!String(item?.status || "").startsWith("FAILED_")) return false;
        return retryInfo(item).retryable;
      }

      function buttonsFor(item) {
        const ops = [];
        ops.push({ label: "Detail", action: () => selectItem(item.id) });
        if (item.status === "READY") {
          ops.push({ label: "Regenerate", action: () => processItem(item.id, "REGENERATE") });
        } else if (["FAILED_EXTRACTION", "FAILED_AI", "FAILED_EXPORT"].includes(item.status)) {
          const info = retryInfo(item);
          if (info.retryable) {
            const suffix = info.remaining == null ? "" : " (" + info.remaining + " left)";
            ops.push({ label: "Retry" + suffix, action: () => processItem(item.id, "RETRY") });
          } else {
            ops.push({ label: "Retry Limit Reached", action: () => {}, disabled: true });
          }
        } else if (item.status === "CAPTURED") {
          ops.push({ label: "Process", action: () => processItem(item.id, "PROCESS") });
        }
        if (["READY", "SHIPPED", "FAILED_EXPORT"].includes(item.status)) {
          ops.push({ label: item.status === "SHIPPED" ? "Re-export" : "Export", action: () => exportItem(item.id) });
        }
        if (item.status === "ARCHIVED") {
          ops.push({ label: "Unarchive", action: () => unarchiveItem(item.id) });
        } else if (item.status !== "PROCESSING") {
          ops.push({ label: "Archive", action: () => archiveItem(item.id) });
        }
        return ops;
      }

      function renderItem(item) {
        const card = document.createElement("div");
        card.className = "item-card";
        const title = item.title || item.url;
        const score = item.match_score != null ? Number(item.match_score).toFixed(1) : "—";
        const retry = retryInfo(item);
        let failureNoteHtml = "";
        if (item.status.startsWith("FAILED_") && retry.retryLimit > 0) {
          if (retry.retryable) {
            failureNoteHtml =
              '<div class="failure-note">retry: ' +
              retry.retryAttempts +
              "/" +
              retry.retryLimit +
              " used, " +
              retry.remaining +
              " left</div>";
          } else {
            failureNoteHtml = '<div class="failure-note">retry limit reached (' + retry.retryAttempts + "/" + retry.retryLimit + ")</div>";
          }
        }
        card.innerHTML = \`
          <div class="item-head">
            <span class="status">\${item.status}</span>
            <span class="muted">\${item.priority || "N/A"} · \${score}</span>
          </div>
          <div class="intent">\${item.intent_text}</div>
          <div>\${title}</div>
          <div class="muted">\${item.domain || ""}</div>
          \${failureNoteHtml}
          <div class="actions"></div>
        \`;
        const actionEl = card.querySelector(".actions");
        const ops = buttonsFor(item);
        for (const op of ops) {
          const btn = document.createElement("button");
          btn.textContent = op.label;
          btn.disabled = Boolean(op.disabled);
          btn.addEventListener("click", async () => {
            if (op.disabled) return;
            try {
              errorEl.textContent = "";
              await op.action();
            } catch (err) {
              errorEl.textContent = String(err);
            }
          });
          actionEl.appendChild(btn);
        }
        return card;
      }

      function appendGroup(target, title, items) {
        if (!items.length) return;
        const label = document.createElement("div");
        label.className = "group-title";
        label.textContent = title + " (" + items.length + ")";
        target.appendChild(label);
        for (const item of items) {
          target.appendChild(renderItem(item));
        }
      }

      function renderInbox(items) {
        inboxEl.innerHTML = "";
        if (!items.length) {
          inboxEl.innerHTML = '<div class="empty">No items yet. Use the extension to capture links.</div>';
          return;
        }
        const groups = groupedItems(items);
        appendGroup(inboxEl, "Read Next", groups.read_next);
        appendGroup(inboxEl, "Worth It", groups.worth_it);
        appendGroup(inboxEl, "If Time", groups.if_time);
        appendGroup(inboxEl, "In Progress", groups.in_progress);
        appendGroup(inboxEl, "Needs Attention", groups.needs_attention);
        appendGroup(inboxEl, "Skip", groups.skip);
        appendGroup(inboxEl, "Shipped", groups.shipped);
        appendGroup(inboxEl, "Archived", groups.archived);
      }

      async function loadItems() {
        if (isLoadingItems) return;
        isLoadingItems = true;
        try {
          persistControls();
          const query = queryInput.value.trim();
          const status = statusFilter.value;
          const retryable = retryableFilter.value;
          const failureStep = failureStepFilter.value;
          const params = new URLSearchParams({
            sort: "priority_score_desc",
            limit: "100"
          });
          if (query) params.set("q", query);
          if (status) params.set("status", status);
          if (retryable) params.set("retryable", retryable);
          if (failureStep) params.set("failure_step", failureStep);

          const payload = await request("/items?" + params.toString());
          allItems = payload.items || [];
          renderInbox(allItems);
          const retryableCount = allItems.filter((item) => isRetryableFailedItem(item)).length;
          retryFailedBtn.textContent = retryableCount > 0 ? "Retry Failed (" + retryableCount + ")" : "Retry Failed";
          await loadWorkerStats();
          if (selectedId) {
            await selectItem(selectedId);
          }
        } finally {
          isLoadingItems = false;
        }
      }

      async function loadWorkerStats() {
        try {
          const stats = await request("/system/worker");
          const queueQueued = stats?.queue?.QUEUED ?? 0;
          const queueLeased = stats?.queue?.LEASED ?? 0;
          const processing = stats?.items?.PROCESSING ?? 0;
          const failedExtract = stats?.failure_steps?.extract ?? 0;
          const failedPipeline = stats?.failure_steps?.pipeline ?? 0;
          const failedExport = stats?.failure_steps?.export ?? 0;
          const retryable = stats?.retry?.retryable_items ?? 0;
          const blocked = stats?.retry?.non_retryable_items ?? 0;
          const archivedCount = stats?.items?.ARCHIVED ?? 0;
          workerStatsEl.textContent =
            "Queue: " +
            queueQueued +
            " | Leased: " +
            queueLeased +
            " | Processing: " +
            processing +
            " | Failed(e/p/x): " +
            failedExtract +
            "/" +
            failedPipeline +
            "/" +
            failedExport +
            " | Retryable: " +
            retryable +
            " | Retry blocked: " +
            blocked;
          if (archiveRetryableFilter.value === "false") {
            archiveBlockedBtn.textContent = blocked > 0 ? "Archive Failed (blocked " + blocked + ")" : "Archive Failed";
          } else {
            archiveBlockedBtn.textContent = "Archive Failed";
          }
          previewUnarchiveBtn.textContent = archivedCount > 0 ? "Preview Unarchive (" + archivedCount + ")" : "Preview Unarchive";
          unarchiveBatchBtn.textContent = archivedCount > 0 ? "Unarchive Archived (" + archivedCount + ")" : "Unarchive Archived";
        } catch {
          workerStatsEl.textContent = "Queue: unavailable";
          archiveBlockedBtn.textContent = "Archive Failed";
          previewUnarchiveBtn.textContent = "Preview Unarchive";
          unarchiveBatchBtn.textContent = "Unarchive Archived";
        }
      }

      async function selectItem(id) {
        selectedId = id;
        const detail = await request("/items/" + id + "?include_history=true");
        selectedDetail = detail;
        detailEl.innerHTML = "";

        const wrap = document.createElement("div");
        wrap.innerHTML = \`
          <div class="item-card">
            <div class="item-head">
              <span class="status">\${detail.item.status}</span>
              <span class="muted">\${detail.item.priority || "N/A"} · \${detail.item.match_score ?? "—"}</span>
            </div>
            <div class="intent">\${detail.item.intent_text}</div>
            <div>\${detail.item.title || detail.item.url}</div>
            <div class="muted">\${detail.item.domain || ""}</div>
          </div>
          <h3>Artifacts</h3>
          <pre>\${JSON.stringify(detail.artifacts || {}, null, 2)}</pre>
          <h3>Artifact History</h3>
          <pre>\${JSON.stringify(detail.artifact_history || {}, null, 2)}</pre>
          <h3>Failure</h3>
          <pre>\${JSON.stringify(detail.failure || null, null, 2)}</pre>
        \`;
        detailEl.appendChild(wrap);
        renderFailureGuidance(detail);
        renderExportPanel(detail);
        renderArtifactVersionViewer(detail);
        renderIntentEditor(detail);
        renderArtifactEditor(detail);
      }

      function renderFailureGuidance(detail) {
        const failure = detail.failure || null;
        if (!failure) return;

        const card = document.createElement("div");
        card.className = "item-card";
        const retryAttempts = Number(failure.retry_attempts ?? 0);
        const retryLimit = Number(failure.retry_limit ?? 0);
        const retryable = failure.retryable !== false;
        const remaining = retryLimit > 0 ? Math.max(retryLimit - retryAttempts, 0) : null;

        let actionGuide = "You can retry processing from Inbox.";
        if (failure.failed_step === "extract") {
          actionGuide = "Extraction failed. Verify URL accessibility/content length, then retry.";
        } else if (failure.failed_step === "pipeline") {
          actionGuide = "Pipeline failed. Review intent and content quality, then retry/regenerate.";
        } else if (failure.failed_step === "export") {
          actionGuide = "Export failed. Try md+caption export first, then retry png.";
        }
        if (!retryable) {
          actionGuide = "Retry is blocked. Edit intent/artifact first, then run regenerate if needed.";
        }

        card.innerHTML = \`
          <h3>Failure Guidance</h3>
          <div class="muted">step: \${failure.failed_step || "unknown"} · code: \${failure.error_code || "UNKNOWN"}</div>
          <div class="hint">\${actionGuide}</div>
          <div class="muted">retry: \${retryAttempts}/\${retryLimit || "N/A"} used\${remaining == null ? "" : ", remaining: " + remaining}</div>
        \`;
        detailEl.appendChild(card);
      }

      function renderExportPanel(detail) {
        const exportHistory = detail.artifact_history?.export ?? [];
        const panel = document.createElement("div");
        panel.className = "item-card";

        const status = detail.item.status;
        const failure = detail.failure || null;

        let statusHint = "";
        if (status === "FAILED_EXPORT") {
          statusHint = "Export failed. Try re-export with md/caption fallback first, then retry png.";
        } else if (status === "SHIPPED") {
          statusHint = "Item is shipped. You can re-export to get latest files.";
        } else if (status === "READY") {
          statusHint = "Item is ready to export.";
        }
        const statusHintHtml = statusHint ? "<div class=\\"hint\\">" + statusHint + "</div>" : "";

        panel.innerHTML = \`
          <h3>Export Records</h3>
          <div class="muted">Current status: \${status}</div>
          \${statusHintHtml}
          <div id="exportRecordList"></div>
          <div id="exportFailureHint"></div>
        \`;

        const listEl = panel.querySelector("#exportRecordList");
        if (!exportHistory.length) {
          listEl.innerHTML = '<div class="empty">No export artifacts yet.</div>';
        } else {
          for (const exp of exportHistory) {
            const card = document.createElement("div");
            card.className = "item-card";
            const files = exp?.payload?.files ?? [];
            card.innerHTML = \`
              <div class="item-head">
                <span class="status">export v\${exp.version}</span>
                <span class="muted">\${exp.created_by} · \${exp.created_at}</span>
              </div>
              <div class="muted">renderer: \${exp?.payload?.renderer?.name || "N/A"}</div>
              <div class="muted">export_key: \${exp?.payload?.export_key || "N/A"}</div>
              <div class="file-list"></div>
            \`;
            const fileListEl = card.querySelector(".file-list");
            for (const file of files) {
              const row = document.createElement("div");
              row.className = "file-row";
              const fileHref = "/" + String(file.path || "").replace(/^\/+/, "");
              row.innerHTML = \`
                <span class="status">\${file.type}</span>
                <span class="file-path">\${file.path}</span>
                <button type="button">Copy Path</button>
                <a href="\${encodeURI(fileHref)}" target="_blank" rel="noopener noreferrer">Open</a>
              \`;
              const copyBtn = row.querySelector("button");
              copyBtn.addEventListener("click", async () => {
                try {
                  await navigator.clipboard.writeText(file.path);
                  errorEl.textContent = "Copied path: " + file.path;
                } catch {
                  errorEl.textContent = "Copy failed for path: " + file.path;
                }
              });
              fileListEl.appendChild(row);
            }
            listEl.appendChild(card);
          }
        }

        const failureEl = panel.querySelector("#exportFailureHint");
        if (failure?.failed_step === "export") {
          failureEl.innerHTML = \`
            <div class="hint">
              Export failure code: <b>\${failure.error_code || "UNKNOWN"}</b><br/>
              Message: \${failure.message || "No details"}
            </div>
          \`;
        }

        detailEl.appendChild(panel);
      }

      function renderArtifactVersionViewer(detail) {
        const historyMap = detail.artifact_history || {};
        const artifactTypes = Object.keys(historyMap).filter((type) => Array.isArray(historyMap[type]) && historyMap[type].length > 0);
        if (!artifactTypes.length) return;

        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = \`
          <h3>Version Viewer</h3>
          <div class="editor-row">
            <label for="versionTypeSelect">Artifact:</label>
            <select id="versionTypeSelect"></select>
            <label for="baseVersionSelect">Base:</label>
            <select id="baseVersionSelect"></select>
            <label for="targetVersionSelect">Target:</label>
            <select id="targetVersionSelect"></select>
            <button id="loadVersionBtn" type="button">Compare Versions</button>
            <button id="copyDiffBtn" type="button" disabled>Copy Diff Summary</button>
            <button id="exportDiffBtn" type="button" disabled>Export Diff JSON</button>
          </div>
          <div class="diff" id="versionDiffSummary">Select base/target versions to compare.</div>
          <div class="diff-grid">
            <div class="diff-column">
              <h4>Changed Paths</h4>
              <ul id="changedPathsList"><li>—</li></ul>
            </div>
            <div class="diff-column">
              <h4>Added Paths</h4>
              <ul id="addedPathsList"><li>—</li></ul>
            </div>
            <div class="diff-column">
              <h4>Removed Paths</h4>
              <ul id="removedPathsList"><li>—</li></ul>
            </div>
          </div>
          <div class="editor-row">
            <div style="flex:1;">
              <div class="muted">Base payload</div>
              <pre id="baseArtifactPreview"></pre>
            </div>
            <div style="flex:1;">
              <div class="muted">Target payload</div>
              <pre id="targetArtifactPreview"></pre>
            </div>
          </div>
        \`;

        const typeSelect = card.querySelector("#versionTypeSelect");
        const baseVersionSelect = card.querySelector("#baseVersionSelect");
        const targetVersionSelect = card.querySelector("#targetVersionSelect");
        const loadBtn = card.querySelector("#loadVersionBtn");
        const copyDiffBtn = card.querySelector("#copyDiffBtn");
        const exportDiffBtn = card.querySelector("#exportDiffBtn");
        const basePreviewEl = card.querySelector("#baseArtifactPreview");
        const targetPreviewEl = card.querySelector("#targetArtifactPreview");
        const diffEl = card.querySelector("#versionDiffSummary");
        const changedListEl = card.querySelector("#changedPathsList");
        const addedListEl = card.querySelector("#addedPathsList");
        const removedListEl = card.querySelector("#removedPathsList");
        let lastCompareResult = null;

        function setDiffActionButtons(enabled) {
          copyDiffBtn.disabled = !enabled;
          exportDiffBtn.disabled = !enabled;
        }

        for (const type of artifactTypes) {
          const opt = document.createElement("option");
          opt.value = type;
          opt.textContent = type;
          typeSelect.appendChild(opt);
        }

        function renderPathList(targetEl, paths) {
          targetEl.innerHTML = "";
          if (!paths.length) {
            targetEl.innerHTML = "<li>—</li>";
            return;
          }
          for (const path of paths.slice(0, 20)) {
            const li = document.createElement("li");
            li.textContent = path;
            targetEl.appendChild(li);
          }
          if (paths.length > 20) {
            const li = document.createElement("li");
            li.textContent = "... +" + (paths.length - 20) + " more";
            targetEl.appendChild(li);
          }
        }

        function fillVersionOptions() {
          const selectedType = typeSelect.value;
          baseVersionSelect.innerHTML = "";
          targetVersionSelect.innerHTML = "";
          const versions = historyMap[selectedType] || [];
          for (const row of versions) {
            const opt = document.createElement("option");
            opt.value = String(row.version);
            opt.textContent = "v" + row.version + " · " + row.created_by;
            baseVersionSelect.appendChild(opt.cloneNode(true));
            targetVersionSelect.appendChild(opt);
          }
          if (versions.length > 0) {
            targetVersionSelect.value = String(versions[0].version);
            baseVersionSelect.value = String(versions[Math.min(1, versions.length - 1)].version);
            basePreviewEl.textContent = "{}";
            targetPreviewEl.textContent = "{}";
            renderPathList(changedListEl, []);
            renderPathList(addedListEl, []);
            renderPathList(removedListEl, []);
            setDiffActionButtons(false);
            lastCompareResult = null;
          } else {
            basePreviewEl.textContent = "{}";
            targetPreviewEl.textContent = "{}";
            setDiffActionButtons(false);
            lastCompareResult = null;
          }
        }

        typeSelect.addEventListener("change", fillVersionOptions);
        fillVersionOptions();

        loadBtn.addEventListener("click", async () => {
          const type = typeSelect.value;
          const baseVersion = Number(baseVersionSelect.value);
          const targetVersion = Number(targetVersionSelect.value);
          if (!type || !baseVersion || !targetVersion) return;
          try {
            const baseQuery = encodeURIComponent(JSON.stringify({ [type]: baseVersion }));
            const targetQuery = encodeURIComponent(JSON.stringify({ [type]: targetVersion }));
            const [baseDetail, targetDetail] = await Promise.all([
              request("/items/" + detail.item.id + "?artifact_versions=" + baseQuery),
              request("/items/" + detail.item.id + "?artifact_versions=" + targetQuery),
            ]);
            const baseArtifact = baseDetail.artifacts?.[type] ?? null;
            const targetArtifact = targetDetail.artifacts?.[type] ?? null;
            basePreviewEl.textContent = JSON.stringify(baseArtifact, null, 2);
            targetPreviewEl.textContent = JSON.stringify(targetArtifact, null, 2);

            if (baseVersion === targetVersion) {
              diffEl.textContent = "No payload difference: base and target versions are identical.";
              renderPathList(changedListEl, []);
              renderPathList(addedListEl, []);
              renderPathList(removedListEl, []);
              lastCompareResult = {
                item_id: detail.item.id,
                artifact_type: type,
                base_version: baseVersion,
                target_version: targetVersion,
                summary: {
                  changed_paths: [],
                  added_paths: [],
                  removed_paths: [],
                  changed_line_count: 0,
                  compared_line_count: 0
                }
              };
              setDiffActionButtons(true);
            } else {
              const compare = await request(
                "/items/" +
                  detail.item.id +
                  "/artifacts/" +
                  type +
                  "/compare?base_version=" +
                  baseVersion +
                  "&target_version=" +
                  targetVersion,
              );
              const changedPaths = compare?.summary?.changed_paths ?? [];
              const addedPaths = compare?.summary?.added_paths ?? [];
              const removedPaths = compare?.summary?.removed_paths ?? [];
              renderPathList(changedListEl, changedPaths);
              renderPathList(addedListEl, addedPaths);
              renderPathList(removedListEl, removedPaths);
              diffEl.textContent =
                "Diff summary for v" + baseVersion + " -> v" + targetVersion + "\\n" +
                "changed_lines=" + (compare?.summary?.changed_line_count ?? "N/A") +
                " / compared_lines=" + (compare?.summary?.compared_line_count ?? "N/A") + "\\n" +
                "changed_paths=" + changedPaths.length +
                ", added_paths=" + addedPaths.length +
                ", removed_paths=" + removedPaths.length;
              lastCompareResult = compare;
              setDiffActionButtons(true);
            }
          } catch (err) {
            basePreviewEl.textContent = "Load failed: " + String(err);
            targetPreviewEl.textContent = "Load failed: " + String(err);
            renderPathList(changedListEl, []);
            renderPathList(addedListEl, []);
            renderPathList(removedListEl, []);
            diffEl.textContent = "Diff unavailable due to load failure.";
            setDiffActionButtons(false);
            lastCompareResult = null;
          }
        });

        copyDiffBtn.addEventListener("click", async () => {
          if (!lastCompareResult) return;
          try {
            await navigator.clipboard.writeText(JSON.stringify(lastCompareResult, null, 2));
            errorEl.textContent = "Copied diff summary to clipboard.";
          } catch {
            errorEl.textContent = "Copy diff summary failed.";
          }
        });

        exportDiffBtn.addEventListener("click", () => {
          if (!lastCompareResult) return;
          const payload = JSON.stringify(lastCompareResult, null, 2);
          const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const artifactType = lastCompareResult.artifact_type || "artifact";
          const baseVersion = lastCompareResult.base?.version ?? baseVersionSelect.value;
          const targetVersion = lastCompareResult.target?.version ?? targetVersionSelect.value;
          a.href = url;
          a.download = "diff_" + artifactType + "_v" + baseVersion + "_to_v" + targetVersion + ".json";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        });

        detailEl.appendChild(card);
      }

      function renderIntentEditor(detail) {
        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = \`
          <h3>Edit Intent</h3>
          <textarea id="intentEditor">\${detail.item.intent_text || ""}</textarea>
          <div class="editor-row">
            <button id="saveIntentBtn" type="button">Save Intent</button>
            <button id="saveIntentRegenerateBtn" class="primary" type="button">Save + Regenerate</button>
          </div>
          <div id="intentEditorMsg" class="muted"></div>
        \`;

        const intentEl = card.querySelector("#intentEditor");
        const saveBtn = card.querySelector("#saveIntentBtn");
        const saveRegenBtn = card.querySelector("#saveIntentRegenerateBtn");
        const msgEl = card.querySelector("#intentEditorMsg");

        async function submitIntent(regenerate) {
          const intentText = intentEl.value.trim();
          if (!intentText) {
            msgEl.textContent = "Intent cannot be empty.";
            return;
          }
          try {
            await request("/items/" + detail.item.id + "/intent", {
              method: "POST",
              body: JSON.stringify({
                intent_text: intentText,
                regenerate
              })
            });
            msgEl.textContent = regenerate ? "Saved and queued for regenerate." : "Intent saved.";
            await loadItems();
            await selectItem(detail.item.id);
          } catch (err) {
            msgEl.textContent = "Intent update failed: " + String(err);
          }
        }

        saveBtn.addEventListener("click", () => {
          void submitIntent(false);
        });
        saveRegenBtn.addEventListener("click", () => {
          void submitIntent(true);
        });

        detailEl.appendChild(card);
      }

      function renderArtifactEditor(detail) {
        const editableTypes = ["summary", "score", "todos", "card"].filter((type) => detail.artifacts?.[type]);
        if (!editableTypes.length) {
          return;
        }

        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = \`
          <h3>Edit Artifact (Create User Version)</h3>
          <div class="editor-row">
            <label for="artifactTypeSelect">Artifact:</label>
            <select id="artifactTypeSelect"></select>
            <button id="loadHistoryBtn" type="button">Load History For Type</button>
          </div>
          <textarea id="artifactPayloadEditor"></textarea>
          <div class="editor-row">
            <button class="primary" id="saveArtifactBtn" type="button">Save User Version</button>
          </div>
          <div id="artifactEditorMsg" class="muted"></div>
          <pre id="artifactTypeHistory" style="display:none;"></pre>
        \`;

        const selectEl = card.querySelector("#artifactTypeSelect");
        const editorEl = card.querySelector("#artifactPayloadEditor");
        const saveBtn = card.querySelector("#saveArtifactBtn");
        const msgEl = card.querySelector("#artifactEditorMsg");
        const historyBtn = card.querySelector("#loadHistoryBtn");
        const historyEl = card.querySelector("#artifactTypeHistory");

        for (const type of editableTypes) {
          const option = document.createElement("option");
          option.value = type;
          option.textContent = type;
          selectEl.appendChild(option);
        }

        function renderCurrentPayload() {
          const type = selectEl.value;
          const payload = detail.artifacts?.[type]?.payload ?? {};
          editorEl.value = JSON.stringify(payload, null, 2);
          msgEl.textContent = "Editing latest payload. Saving will create created_by=user new version.";
          historyEl.style.display = "none";
        }

        selectEl.addEventListener("change", renderCurrentPayload);
        renderCurrentPayload();

        historyBtn.addEventListener("click", () => {
          const type = selectEl.value;
          const history = detail.artifact_history?.[type] ?? [];
          historyEl.textContent = JSON.stringify(history, null, 2);
          historyEl.style.display = "block";
        });

        saveBtn.addEventListener("click", async () => {
          const type = selectEl.value;
          let payload;
          try {
            payload = JSON.parse(editorEl.value);
          } catch (err) {
            msgEl.textContent = "Invalid JSON: " + String(err);
            return;
          }

          try {
            await request("/items/" + detail.item.id + "/artifacts/" + type, {
              method: "POST",
              body: JSON.stringify({
                payload,
                template_version: "user." + type + ".edit.v1"
              })
            });
            msgEl.textContent = "Saved. Reloading latest detail...";
            await loadItems();
            await selectItem(detail.item.id);
          } catch (err) {
            msgEl.textContent = "Save failed: " + String(err);
          }
        });

        detailEl.appendChild(card);
      }

      async function processItem(id, mode) {
        await request("/items/" + id + "/process", {
          method: "POST",
          body: JSON.stringify({
            process_request_id: crypto.randomUUID(),
            mode
          }),
          headers: { "Idempotency-Key": crypto.randomUUID() }
        });
        await loadItems();
      }

      async function exportItem(id) {
        try {
          await request("/items/" + id + "/export", {
            method: "POST",
            body: JSON.stringify({
              export_key: "web_" + crypto.randomUUID(),
              formats: ["png", "md", "caption"]
            }),
            headers: { "Idempotency-Key": crypto.randomUUID() }
          });
        } catch (err) {
          if (err?.code === "EXPORT_RENDER_FAILED") {
            await request("/items/" + id + "/export", {
              method: "POST",
              body: JSON.stringify({
                export_key: "web_fallback_" + crypto.randomUUID(),
                formats: ["md", "caption"]
              }),
              headers: { "Idempotency-Key": crypto.randomUUID() }
            });
            errorEl.textContent = "PNG failed; fallback export (md+caption) succeeded.";
          } else {
            throw err;
          }
        }
        await loadItems();
        await selectItem(id);
      }

      async function archiveItem(id) {
        await request("/items/" + id + "/archive", {
          method: "POST",
          body: JSON.stringify({ reason: "USER_ARCHIVE" })
        });
        await loadItems();
      }

      async function unarchiveItem(id) {
        await request("/items/" + id + "/unarchive", {
          method: "POST",
          body: JSON.stringify({ regenerate: false })
        });
        await loadItems();
      }

      refreshBtn.addEventListener("click", async () => {
        try {
          errorEl.textContent = "";
          clearPreviewContinuation();
          await loadItems();
        } catch (err) {
          errorEl.textContent = String(err);
        }
      });

      runWorkerBtn.addEventListener("click", async () => {
        try {
          errorEl.textContent = "";
          await request("/system/worker/run-once", { method: "POST", body: JSON.stringify({}) });
          await loadItems();
        } catch (err) {
          errorEl.textContent = String(err);
        }
      });

      function retryFailedPayload(dryRun, offset = 0) {
        const payload = { limit: normalizedBatchLimit(), offset, dry_run: dryRun };
        const q = queryInput.value.trim();
        if (q) {
          Object.assign(payload, { q });
        }
        if (failureStepFilter.value) {
          return { ...payload, failure_step: failureStepFilter.value };
        }
        return payload;
      }

      function archiveBlockedPayload(dryRun, offset = 0) {
        const retryableValue = archiveRetryableFilter.value;
        const retryableFilter = retryableValue === "true" ? true : retryableValue === "false" ? false : null;
        const payload = { limit: normalizedBatchLimit(), offset, dry_run: dryRun, retryable: retryableFilter };
        const q = queryInput.value.trim();
        if (q) {
          Object.assign(payload, { q });
        }
        if (failureStepFilter.value) {
          return { ...payload, failure_step: failureStepFilter.value };
        }
        return payload;
      }

      function unarchiveBatchPayload(dryRun, offset = 0) {
        const regenerate = unarchiveModeFilter.value === "regenerate";
        const payload = { limit: normalizedBatchLimit(), offset, dry_run: dryRun, regenerate };
        const q = queryInput.value.trim();
        if (q) {
          return { ...payload, q };
        }
        return payload;
      }

      function normalizedBatchLimit() {
        const raw = Number(batchLimitInput.value);
        if (!Number.isInteger(raw)) return 100;
        return Math.min(Math.max(raw, 1), 200);
      }

      function normalizedPreviewOffset() {
        const raw = Number(previewOffsetInput.value);
        if (!Number.isInteger(raw)) return 0;
        return Math.max(raw, 0);
      }

      function syncPreviewOffsetFromResponse(preview) {
        const requestedOffset = Number(preview?.requested_offset ?? 0);
        previewOffsetInput.value = String(Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0);
        persistControls();
      }

      previewArchiveBtn.addEventListener("click", async () => {
        previewArchiveBtn.disabled = true;
        try {
          clearPreviewContinuation();
          const previewOffset = normalizedPreviewOffset();
          const preview = await request("/items/archive-failed", {
            method: "POST",
            body: JSON.stringify(archiveBlockedPayload(true, previewOffset))
          });
          syncPreviewOffsetFromResponse(preview);
          errorEl.textContent =
            "Archive preview: scanned=" +
            (preview.scanned ?? 0) +
            "/" +
            (preview.scanned_total ?? preview.scanned ?? 0) +
            ", limit=" +
            (preview.requested_limit ?? normalizedBatchLimit()) +
            ", offset=" +
            (preview.requested_offset ?? 0) +
            ", retryable=" +
            (preview.retryable_filter == null ? "all" : String(preview.retryable_filter)) +
            ", q=" +
            (preview.q_filter || "all") +
            ", filter=" +
            (preview.failure_step_filter || "all") +
            ", truncated=" +
            (preview.scan_truncated ? "yes" : "no") +
            ", next_offset=" +
            (preview.next_offset == null ? "null" : String(preview.next_offset)) +
            ", eligible=" +
            (preview.eligible ?? 0) +
            ", skipped_retryable_mismatch=" +
            (preview.skipped_retryable_mismatch ?? 0) +
            ".";
          retryPreviewOutputEl.style.display = "block";
          retryPreviewOutputEl.textContent = JSON.stringify(
            {
              preview_type: "archive_blocked",
              retryable_filter: preview.retryable_filter == null ? "all" : preview.retryable_filter,
              q_filter: preview.q_filter || null,
              filter: preview.failure_step_filter || "all",
              scanned: preview.scanned ?? 0,
              scanned_total: preview.scanned_total ?? preview.scanned ?? 0,
              scan_truncated: Boolean(preview.scan_truncated),
              requested_offset: preview.requested_offset ?? 0,
              next_offset: preview.next_offset ?? null,
              eligible_item_ids: preview.eligible_item_ids || [],
              skipped_retryable_mismatch: preview.skipped_retryable_mismatch || 0,
            },
            null,
            2,
          );
          setPreviewContinuation("archive", preview.next_offset);
        } catch (err) {
          errorEl.textContent = "Archive preview failed: " + String(err);
          retryPreviewOutputEl.style.display = "none";
          retryPreviewOutputEl.textContent = "";
          clearPreviewContinuation();
        } finally {
          previewArchiveBtn.disabled = false;
        }
      });

      retryFailedBtn.addEventListener("click", async () => {
        const candidates = allItems.filter((item) => isRetryableFailedItem(item));
        if (!candidates.length) {
          errorEl.textContent = "No retryable failed items.";
          return;
        }
        clearPreviewContinuation();
        retryPreviewOutputEl.style.display = "none";
        retryPreviewOutputEl.textContent = "";
        retryFailedBtn.disabled = true;
        let exportSuccess = 0;
        let exportFailed = 0;
        try {
          errorEl.textContent = "Retrying " + candidates.length + " failed items...";
          const executionOffset = normalizedPreviewOffset();
          const batchRes = await request("/items/retry-failed", {
            method: "POST",
            body: JSON.stringify(retryFailedPayload(false, executionOffset))
          });
          const exportItemIds = batchRes.eligible_export_item_ids || [];
          for (const itemId of exportItemIds) {
            try {
              await request("/items/" + itemId + "/export", {
                method: "POST",
                body: JSON.stringify({
                  export_key: "batch_retry_" + crypto.randomUUID(),
                  formats: ["png", "md", "caption"]
                }),
                headers: { "Idempotency-Key": crypto.randomUUID() }
              });
              exportSuccess += 1;
            } catch {
              exportFailed += 1;
            }
          }
          errorEl.textContent =
            "Batch retry done. queued=" +
            (batchRes.queued ?? 0) +
            ", scanned=" +
            (batchRes.scanned ?? 0) +
            "/" +
            (batchRes.scanned_total ?? batchRes.scanned ?? 0) +
            ", limit=" +
            (batchRes.requested_limit ?? normalizedBatchLimit()) +
            ", offset=" +
            (batchRes.requested_offset ?? 0) +
            ", q=" +
            (batchRes.q_filter || "all") +
            ", truncated=" +
            (batchRes.scan_truncated ? "yes" : "no") +
            ", next_offset=" +
            (batchRes.next_offset == null ? "null" : String(batchRes.next_offset)) +
            ", skipped_non_retryable=" +
            (batchRes.skipped_non_retryable ?? 0) +
            ", eligible_export=" +
            (batchRes.eligible_export ?? 0) +
            ", export_success=" +
            exportSuccess +
            ", export_failed=" +
            exportFailed +
            ".";
        } finally {
          retryFailedBtn.disabled = false;
          await loadItems();
        }
      });

      previewRetryBtn.addEventListener("click", async () => {
        previewRetryBtn.disabled = true;
        try {
          clearPreviewContinuation();
          const previewOffset = normalizedPreviewOffset();
          const preview = await request("/items/retry-failed", {
            method: "POST",
            body: JSON.stringify(retryFailedPayload(true, previewOffset))
          });
          syncPreviewOffsetFromResponse(preview);
          errorEl.textContent =
            "Retry preview: scanned=" +
            (preview.scanned ?? 0) +
            "/" +
            (preview.scanned_total ?? preview.scanned ?? 0) +
            ", limit=" +
            (preview.requested_limit ?? normalizedBatchLimit()) +
            ", offset=" +
            (preview.requested_offset ?? 0) +
            ", q=" +
            (preview.q_filter || "all") +
            ", filter=" +
            (preview.failure_step_filter || "all") +
            ", truncated=" +
            (preview.scan_truncated ? "yes" : "no") +
            ", next_offset=" +
            (preview.next_offset == null ? "null" : String(preview.next_offset)) +
            ", eligible_pipeline=" +
            (preview.eligible_pipeline ?? 0) +
            ", eligible_export=" +
            (preview.eligible_export ?? 0) +
            ", skipped_non_retryable=" +
            (preview.skipped_non_retryable ?? 0) +
            ".";
          retryPreviewOutputEl.style.display = "block";
          retryPreviewOutputEl.textContent = JSON.stringify(
            {
              q_filter: preview.q_filter || null,
              filter: preview.failure_step_filter || "all",
              scanned: preview.scanned ?? 0,
              scanned_total: preview.scanned_total ?? preview.scanned ?? 0,
              scan_truncated: Boolean(preview.scan_truncated),
              requested_offset: preview.requested_offset ?? 0,
              next_offset: preview.next_offset ?? null,
              eligible_pipeline_item_ids: preview.eligible_pipeline_item_ids || [],
              eligible_export_item_ids: preview.eligible_export_item_ids || [],
              skipped_non_retryable: preview.skipped_non_retryable || 0,
            },
            null,
            2,
          );
          setPreviewContinuation("retry", preview.next_offset);
        } catch (err) {
          errorEl.textContent = "Retry preview failed: " + String(err);
          retryPreviewOutputEl.style.display = "none";
          retryPreviewOutputEl.textContent = "";
          clearPreviewContinuation();
        } finally {
          previewRetryBtn.disabled = false;
        }
      });

      archiveBlockedBtn.addEventListener("click", async () => {
        archiveBlockedBtn.disabled = true;
        try {
          clearPreviewContinuation();
          const previewOffset = normalizedPreviewOffset();
          const preview = await request("/items/archive-failed", {
            method: "POST",
            body: JSON.stringify(archiveBlockedPayload(true, previewOffset))
          });
          syncPreviewOffsetFromResponse(preview);
          const eligible = Number(preview.eligible ?? 0);
          if (!eligible) {
            errorEl.textContent = "No failed items matching archive filter.";
            return;
          }
          retryPreviewOutputEl.style.display = "block";
          retryPreviewOutputEl.textContent = JSON.stringify(
            {
              preview_type: "archive_blocked",
              retryable_filter: preview.retryable_filter == null ? "all" : preview.retryable_filter,
              q_filter: preview.q_filter || null,
              filter: preview.failure_step_filter || "all",
              scanned: preview.scanned ?? 0,
              scanned_total: preview.scanned_total ?? preview.scanned ?? 0,
              scan_truncated: Boolean(preview.scan_truncated),
              requested_offset: preview.requested_offset ?? 0,
              next_offset: preview.next_offset ?? null,
              eligible_item_ids: preview.eligible_item_ids || [],
              skipped_retryable_mismatch: preview.skipped_retryable_mismatch || 0,
            },
            null,
            2,
          );
          const confirmed = confirm(
            "Archive " +
              eligible +
              " failed items" +
              " [retryable=" +
              (preview.retryable_filter == null ? "all" : String(preview.retryable_filter)) +
              ", q=" +
              (preview.q_filter || "all") +
              "]" +
              (preview.failure_step_filter ? " (failure_step=" + preview.failure_step_filter + ")" : "") +
              "?",
          );
          if (!confirmed) {
            errorEl.textContent = "Archive blocked action cancelled.";
            return;
          }
          const result = await request("/items/archive-failed", {
            method: "POST",
            body: JSON.stringify(archiveBlockedPayload(false, previewOffset))
          });
          errorEl.textContent =
            "Archive blocked done. archived=" +
            (result.archived ?? 0) +
            ", skipped_retryable_mismatch=" +
            (result.skipped_retryable_mismatch ?? 0) +
            ".";
        } catch (err) {
          errorEl.textContent = "Archive blocked failed: " + String(err);
        } finally {
          archiveBlockedBtn.disabled = false;
          await loadItems();
        }
      });

      previewUnarchiveBtn.addEventListener("click", async () => {
        previewUnarchiveBtn.disabled = true;
        try {
          clearPreviewContinuation();
          const previewOffset = normalizedPreviewOffset();
          const preview = await request("/items/unarchive-batch", {
            method: "POST",
            body: JSON.stringify(unarchiveBatchPayload(true, previewOffset))
          });
          syncPreviewOffsetFromResponse(preview);
          errorEl.textContent =
            "Unarchive preview: scanned=" +
            (preview.scanned ?? 0) +
            "/" +
            (preview.scanned_total ?? preview.scanned ?? 0) +
            ", limit=" +
            (preview.requested_limit ?? normalizedBatchLimit()) +
            ", offset=" +
            (preview.requested_offset ?? 0) +
            ", mode=" +
            (preview.regenerate ? "regenerate" : "smart") +
            ", q=" +
            (preview.q_filter || "all") +
            ", truncated=" +
            (preview.scan_truncated ? "yes" : "no") +
            ", next_offset=" +
            (preview.next_offset == null ? "null" : String(preview.next_offset)) +
            ", eligible_ready=" +
            (preview.eligible_ready ?? 0) +
            ", eligible_queued=" +
            (preview.eligible_queued ?? 0) +
            ".";
          retryPreviewOutputEl.style.display = "block";
          retryPreviewOutputEl.textContent = JSON.stringify(
            {
              preview_type: "unarchive_batch",
              mode: preview.regenerate ? "regenerate" : "smart",
              q_filter: preview.q_filter || null,
              scanned: preview.scanned ?? 0,
              scanned_total: preview.scanned_total ?? preview.scanned ?? 0,
              scan_truncated: Boolean(preview.scan_truncated),
              requested_offset: preview.requested_offset ?? 0,
              next_offset: preview.next_offset ?? null,
              eligible_ready_item_ids: preview.eligible_ready_item_ids || [],
              eligible_queued_item_ids: preview.eligible_queued_item_ids || [],
            },
            null,
            2,
          );
          setPreviewContinuation("unarchive", preview.next_offset);
        } catch (err) {
          errorEl.textContent = "Unarchive preview failed: " + String(err);
          retryPreviewOutputEl.style.display = "none";
          retryPreviewOutputEl.textContent = "";
          clearPreviewContinuation();
        } finally {
          previewUnarchiveBtn.disabled = false;
        }
      });

      previewNextBtn.addEventListener("click", async () => {
        if (!previewContinuation || previewContinuation.next_offset == null) return;
        previewNextBtn.disabled = true;
        try {
          const nextOffset = Number(previewContinuation.next_offset);
          if (previewContinuation.kind === "retry") {
            const preview = await request("/items/retry-failed", {
              method: "POST",
              body: JSON.stringify(retryFailedPayload(true, nextOffset))
            });
            syncPreviewOffsetFromResponse(preview);
            errorEl.textContent =
              "Retry preview: scanned=" +
              (preview.scanned ?? 0) +
              "/" +
              (preview.scanned_total ?? preview.scanned ?? 0) +
              ", limit=" +
              (preview.requested_limit ?? normalizedBatchLimit()) +
              ", offset=" +
              (preview.requested_offset ?? 0) +
              ", q=" +
              (preview.q_filter || "all") +
              ", filter=" +
              (preview.failure_step_filter || "all") +
              ", truncated=" +
              (preview.scan_truncated ? "yes" : "no") +
              ", next_offset=" +
              (preview.next_offset == null ? "null" : String(preview.next_offset)) +
              ", eligible_pipeline=" +
              (preview.eligible_pipeline ?? 0) +
              ", eligible_export=" +
              (preview.eligible_export ?? 0) +
              ", skipped_non_retryable=" +
              (preview.skipped_non_retryable ?? 0) +
              ".";
            retryPreviewOutputEl.style.display = "block";
            retryPreviewOutputEl.textContent = JSON.stringify(
              {
                q_filter: preview.q_filter || null,
                filter: preview.failure_step_filter || "all",
                scanned: preview.scanned ?? 0,
                scanned_total: preview.scanned_total ?? preview.scanned ?? 0,
                scan_truncated: Boolean(preview.scan_truncated),
                requested_offset: preview.requested_offset ?? 0,
                next_offset: preview.next_offset ?? null,
                eligible_pipeline_item_ids: preview.eligible_pipeline_item_ids || [],
                eligible_export_item_ids: preview.eligible_export_item_ids || [],
                skipped_non_retryable: preview.skipped_non_retryable || 0,
              },
              null,
              2,
            );
            setPreviewContinuation("retry", preview.next_offset);
            return;
          }
          if (previewContinuation.kind === "archive") {
            const preview = await request("/items/archive-failed", {
              method: "POST",
              body: JSON.stringify(archiveBlockedPayload(true, nextOffset))
            });
            syncPreviewOffsetFromResponse(preview);
            errorEl.textContent =
              "Archive preview: scanned=" +
              (preview.scanned ?? 0) +
              "/" +
              (preview.scanned_total ?? preview.scanned ?? 0) +
              ", limit=" +
              (preview.requested_limit ?? normalizedBatchLimit()) +
              ", offset=" +
              (preview.requested_offset ?? 0) +
              ", retryable=" +
              (preview.retryable_filter == null ? "all" : String(preview.retryable_filter)) +
              ", q=" +
              (preview.q_filter || "all") +
              ", filter=" +
              (preview.failure_step_filter || "all") +
              ", truncated=" +
              (preview.scan_truncated ? "yes" : "no") +
              ", next_offset=" +
              (preview.next_offset == null ? "null" : String(preview.next_offset)) +
              ", eligible=" +
              (preview.eligible ?? 0) +
              ", skipped_retryable_mismatch=" +
              (preview.skipped_retryable_mismatch ?? 0) +
              ".";
            retryPreviewOutputEl.style.display = "block";
            retryPreviewOutputEl.textContent = JSON.stringify(
              {
                preview_type: "archive_blocked",
                retryable_filter: preview.retryable_filter == null ? "all" : preview.retryable_filter,
                q_filter: preview.q_filter || null,
                filter: preview.failure_step_filter || "all",
                scanned: preview.scanned ?? 0,
                scanned_total: preview.scanned_total ?? preview.scanned ?? 0,
                scan_truncated: Boolean(preview.scan_truncated),
                requested_offset: preview.requested_offset ?? 0,
                next_offset: preview.next_offset ?? null,
                eligible_item_ids: preview.eligible_item_ids || [],
                skipped_retryable_mismatch: preview.skipped_retryable_mismatch || 0,
              },
              null,
              2,
            );
            setPreviewContinuation("archive", preview.next_offset);
            return;
          }
          if (previewContinuation.kind === "unarchive") {
            const preview = await request("/items/unarchive-batch", {
              method: "POST",
              body: JSON.stringify(unarchiveBatchPayload(true, nextOffset))
            });
            syncPreviewOffsetFromResponse(preview);
            errorEl.textContent =
              "Unarchive preview: scanned=" +
              (preview.scanned ?? 0) +
              "/" +
              (preview.scanned_total ?? preview.scanned ?? 0) +
              ", limit=" +
              (preview.requested_limit ?? normalizedBatchLimit()) +
              ", offset=" +
              (preview.requested_offset ?? 0) +
              ", mode=" +
              (preview.regenerate ? "regenerate" : "smart") +
              ", q=" +
              (preview.q_filter || "all") +
              ", truncated=" +
              (preview.scan_truncated ? "yes" : "no") +
              ", next_offset=" +
              (preview.next_offset == null ? "null" : String(preview.next_offset)) +
              ", eligible_ready=" +
              (preview.eligible_ready ?? 0) +
              ", eligible_queued=" +
              (preview.eligible_queued ?? 0) +
              ".";
            retryPreviewOutputEl.style.display = "block";
            retryPreviewOutputEl.textContent = JSON.stringify(
              {
                preview_type: "unarchive_batch",
                mode: preview.regenerate ? "regenerate" : "smart",
                q_filter: preview.q_filter || null,
                scanned: preview.scanned ?? 0,
                scanned_total: preview.scanned_total ?? preview.scanned ?? 0,
                scan_truncated: Boolean(preview.scan_truncated),
                requested_offset: preview.requested_offset ?? 0,
                next_offset: preview.next_offset ?? null,
                eligible_ready_item_ids: preview.eligible_ready_item_ids || [],
                eligible_queued_item_ids: preview.eligible_queued_item_ids || [],
              },
              null,
              2,
            );
            setPreviewContinuation("unarchive", preview.next_offset);
            return;
          }
          clearPreviewContinuation();
        } catch (err) {
          errorEl.textContent = "Preview next failed: " + String(err);
          clearPreviewContinuation();
        } finally {
          previewNextBtn.disabled = false;
        }
      });

      unarchiveBatchBtn.addEventListener("click", async () => {
        unarchiveBatchBtn.disabled = true;
        try {
          clearPreviewContinuation();
          const previewOffset = normalizedPreviewOffset();
          const preview = await request("/items/unarchive-batch", {
            method: "POST",
            body: JSON.stringify(unarchiveBatchPayload(true, previewOffset))
          });
          syncPreviewOffsetFromResponse(preview);
          const eligible = Number(preview.eligible ?? 0);
          if (!eligible) {
            errorEl.textContent = "No archived items to unarchive.";
            return;
          }
          const modeLabel = preview.regenerate ? "regenerate" : "smart";
          const confirmed = confirm(
            "Unarchive " +
              eligible +
              " archived items" +
              " [mode=" +
              modeLabel +
              ", q=" +
              (preview.q_filter || "all") +
              "]?",
          );
          if (!confirmed) {
            errorEl.textContent = "Unarchive action cancelled.";
            return;
          }
          const result = await request("/items/unarchive-batch", {
            method: "POST",
            body: JSON.stringify(unarchiveBatchPayload(false, previewOffset))
          });
          errorEl.textContent =
            "Unarchive done. unarchived=" +
            (result.unarchived ?? 0) +
            ", queued_jobs_created=" +
            (result.queued_jobs_created ?? 0) +
            ".";
        } catch (err) {
          errorEl.textContent = "Unarchive batch failed: " + String(err);
        } finally {
          unarchiveBatchBtn.disabled = false;
          await loadItems();
        }
      });

      archiveRetryableFilter.addEventListener("change", async () => {
        persistControls();
        clearPreviewContinuation();
        await loadWorkerStats();
      });

      unarchiveModeFilter.addEventListener("change", () => {
        persistControls();
        clearPreviewContinuation();
      });

      batchLimitInput.addEventListener("change", () => {
        batchLimitInput.value = String(normalizedBatchLimit());
        persistControls();
        clearPreviewContinuation();
      });

      previewOffsetInput.addEventListener("change", () => {
        previewOffsetInput.value = String(normalizedPreviewOffset());
        persistControls();
        clearPreviewContinuation();
      });

      queryInput.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter") return;
        try {
          errorEl.textContent = "";
          persistControls();
          clearPreviewContinuation();
          await loadItems();
        } catch (err) {
          errorEl.textContent = String(err);
        }
      });

      statusFilter.addEventListener("change", async () => {
        try {
          errorEl.textContent = "";
          persistControls();
          clearPreviewContinuation();
          await loadItems();
        } catch (err) {
          errorEl.textContent = String(err);
        }
      });

      retryableFilter.addEventListener("change", async () => {
        try {
          errorEl.textContent = "";
          persistControls();
          clearPreviewContinuation();
          await loadItems();
        } catch (err) {
          errorEl.textContent = String(err);
        }
      });

      failureStepFilter.addEventListener("change", async () => {
        try {
          errorEl.textContent = "";
          persistControls();
          clearPreviewContinuation();
          await loadItems();
        } catch (err) {
          errorEl.textContent = String(err);
        }
      });

      restoreControls();
      setAutoRefresh(Boolean(autoRefreshToggle.checked));
      loadItems().catch((err) => {
        errorEl.textContent = String(err);
      });

      function setAutoRefresh(enabled) {
        if (autoRefreshTimer) {
          clearInterval(autoRefreshTimer);
          autoRefreshTimer = null;
        }
        if (enabled) {
          autoRefreshTimer = setInterval(() => {
            loadItems().catch((err) => {
              errorEl.textContent = String(err);
            });
          }, 5000);
        }
      }

      autoRefreshToggle.addEventListener("change", () => {
        persistControls();
        setAutoRefresh(Boolean(autoRefreshToggle.checked));
      });
    </script>
  </body>
</html>`;

function contentTypeForFile(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function resolveExportPath(pathname: string): string | null {
  if (!pathname.startsWith("/exports/")) return null;
  const relativePath = pathname.replace(/^\/+/, "");
  const absolutePath = resolve(repoRoot, relativePath);
  if (!(absolutePath === exportsRoot || absolutePath.startsWith(exportsRoot + "/"))) {
    return null;
  }
  return absolutePath;
}

export function handleWebRequest(req: IncomingMessage, res: ServerResponse): void {
  const rawPathname = (req.url ?? "/").split("?")[0] || "/";
  let pathname = rawPathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    pathname = rawPathname;
  }
  const exportPath = resolveExportPath(pathname);

  if (pathname.startsWith("/exports/")) {
    if (!exportPath) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }
    if (!existsSync(exportPath) || !statSync(exportPath).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": contentTypeForFile(exportPath) });
    res.end(readFileSync(exportPath));
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

export function startWebServer(listenPort = port) {
  const server = createServer(handleWebRequest);
  return server.listen(listenPort, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`Web shell running on http://localhost:${listenPort}`);
  });
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  startWebServer();
}
