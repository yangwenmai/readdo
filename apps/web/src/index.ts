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
      body {
        font-family: Inter, "Segoe UI", Arial, sans-serif;
        margin: 0;
        background:
          radial-gradient(circle at top right, #dbeafe 0%, rgba(219, 234, 254, 0) 45%),
          radial-gradient(circle at top left, #ede9fe 0%, rgba(237, 233, 254, 0) 40%),
          #f4f6fb;
        color: #1f2937;
      }
      header {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px 16px;
        background: linear-gradient(135deg, #0f172a, #1d4ed8 55%, #312e81);
        color: white;
        box-shadow: 0 10px 30px rgba(30, 64, 175, 0.25);
      }
      .header-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .brand h1 { font-size: 22px; margin: 0; letter-spacing: 0.01em; }
      .brand p { margin: 4px 0 0; font-size: 13px; color: #dbeafe; }
      main { display: grid; grid-template-columns: 1.2fr 1fr; gap: 14px; padding: 14px; min-height: calc(100vh - 140px); }
      section {
        background: rgba(255, 255, 255, 0.94);
        border-radius: 14px;
        padding: 14px;
        overflow: auto;
        border: 1px solid rgba(148, 163, 184, 0.2);
        box-shadow: 0 8px 30px rgba(148, 163, 184, 0.16);
      }
      h2 { margin: 0; font-size: 16px; }
      h3 { margin: 12px 0 8px; font-size: 15px; color: #0f172a; }
      .panel-subtitle { margin: 6px 0 10px; font-size: 12px; color: #64748b; }
      .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .controls .muted { color: #e2e8f0; }
      button {
        padding: 7px 11px;
        border-radius: 10px;
        border: 1px solid #cbd5e1;
        background: #fff;
        cursor: pointer;
        color: #0f172a;
        transition: all 120ms ease-in-out;
      }
      button:hover { border-color: #60a5fa; box-shadow: 0 3px 10px rgba(37, 99, 235, 0.2); transform: translateY(-1px); }
      button.primary { background: #0f172a; color: #fff; border-color: #0f172a; }
      input, select {
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        padding: 7px 9px;
        background: #ffffff;
        color: #0f172a;
      }
      .item-card {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 10px 12px;
        margin-bottom: 10px;
        background: linear-gradient(180deg, #ffffff, #f8fafc);
        box-shadow: 0 4px 10px rgba(148, 163, 184, 0.16);
      }
      .item-card.clickable { cursor: pointer; }
      .item-card.clickable:hover { border-color: #93c5fd; box-shadow: 0 10px 24px rgba(59, 130, 246, 0.2); }
      .item-card.is-selected { border-color: #2563eb; box-shadow: 0 12px 28px rgba(37, 99, 235, 0.24); }
      .item-card.priority-read-next { border-left: 4px solid #2563eb; }
      .item-card.priority-worth-it { border-left: 4px solid #7c3aed; }
      .item-card.priority-if-time { border-left: 4px solid #14b8a6; }
      .item-card.priority-default { border-left: 4px solid #94a3b8; }
      .item-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 8px; }
      .intent { font-weight: 700; margin: 4px 0; color: #0f172a; }
      .muted { color: #64748b; font-size: 12px; }
      .status { font-size: 11px; padding: 3px 9px; border-radius: 999px; letter-spacing: 0.03em; font-weight: 700; border: 1px solid transparent; }
      .status-ready, .status-shipped { background: #dcfce7; color: #166534; border-color: #86efac; }
      .status-failed { background: #fee2e2; color: #991b1b; border-color: #fecaca; }
      .status-processing, .status-queued { background: #dbeafe; color: #1e40af; border-color: #bfdbfe; }
      .status-captured { background: #ede9fe; color: #5b21b6; border-color: #ddd6fe; }
      .status-archived { background: #f1f5f9; color: #334155; border-color: #cbd5e1; }
      .status-default { background: #eef2ff; color: #3730a3; border-color: #e0e7ff; }
      .actions { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
      .actions button:disabled { cursor: not-allowed; opacity: 0.6; transform: none; box-shadow: none; }
      .quick-action-grid {
        margin-top: 8px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .quick-action-group {
        border: 1px solid #dbeafe;
        border-radius: 10px;
        padding: 8px;
        background: #f8fbff;
      }
      .quick-action-group h4 {
        margin: 0 0 4px;
        font-size: 12px;
        color: #1e3a8a;
      }
      .quick-action-group .muted {
        display: block;
        margin-bottom: 6px;
      }
      .quick-action-group .actions {
        margin-top: 0;
      }
      .quick-action-group .actions .primary {
        border-color: #1d4ed8;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.26);
      }
      .action-feedback {
        margin-top: 8px;
      }
      .action-feedback.pending { color: #1d4ed8; }
      .action-feedback.done { color: #166534; }
      .action-feedback.error { color: #b91c1c; }
      .hero-actions {
        margin-top: 8px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }
      .hero-actions .muted {
        width: 100%;
      }
      .group-title {
        margin: 12px 0 6px;
        font-size: 13px;
        color: #334155;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 700;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .group-title .section-chip {
        padding: 3px 8px;
        font-size: 11px;
      }
      .aha-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
      .focus-chips {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin: 6px 0 10px;
      }
      .focus-chip {
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        color: #1e3a8a;
        border-radius: 999px;
        padding: 5px 10px;
        font-size: 12px;
      }
      .focus-chip.active {
        border-color: #1d4ed8;
        background: #1d4ed8;
        color: #ffffff;
      }
      .section-chip {
        border: 1px solid #cbd5e1;
        background: #ffffff;
        color: #1e293b;
        border-radius: 999px;
        padding: 5px 10px;
        font-size: 12px;
      }
      .section-chip:hover {
        border-color: #60a5fa;
        color: #1d4ed8;
      }
      .status-legend {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin: 8px 0 10px;
      }
      .legend-item {
        border: 1px solid #dbe2ea;
        border-radius: 999px;
        background: #ffffff;
        color: #334155;
        font-size: 12px;
        padding: 4px 10px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .legend-item.active {
        border-color: #1d4ed8;
        color: #1d4ed8;
        box-shadow: 0 3px 10px rgba(37, 99, 235, 0.22);
      }
      .legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        display: inline-block;
      }
      .legend-dot.ready { background: #22c55e; }
      .legend-dot.failed { background: #ef4444; }
      .legend-dot.processing { background: #3b82f6; }
      .legend-dot.captured { background: #8b5cf6; }
      .legend-dot.shipped { background: #10b981; }
      .legend-dot.archived { background: #94a3b8; }
      .aha-card {
        border: 1px solid #dbeafe;
        border-radius: 12px;
        padding: 10px;
        background: linear-gradient(145deg, #eff6ff, #ffffff);
        min-height: 86px;
      }
      .aha-nudge {
        border: 1px solid #bfdbfe;
        border-radius: 12px;
        background: linear-gradient(145deg, #dbeafe, #eff6ff);
        padding: 10px;
        margin-bottom: 10px;
      }
      .aha-nudge h4 {
        margin: 0 0 6px;
        color: #1e3a8a;
        font-size: 13px;
      }
      .aha-nudge .muted { margin-bottom: 8px; display: block; color: #334155; }
      .aha-label { color: #1e3a8a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
      .aha-value { color: #0f172a; font-size: 24px; font-weight: 800; line-height: 1; }
      .aha-meta { color: #475569; font-size: 12px; margin-top: 6px; }
      .detail-aha .aha-insight {
        font-size: 14px;
        line-height: 1.45;
        color: #0f172a;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 10px;
        padding: 10px;
        margin: 8px 0 10px;
      }
      .detail-aha-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .detail-aha-kpi {
        border: 1px solid #dbeafe;
        border-radius: 10px;
        padding: 8px;
        background: #ffffff;
      }
      .detail-aha-kpi .label {
        color: #1e3a8a;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .detail-aha-kpi .value {
        margin-top: 4px;
        font-size: 14px;
        color: #0f172a;
        font-weight: 700;
      }
      .score-meter {
        height: 8px;
        border-radius: 999px;
        background: #e2e8f0;
        overflow: hidden;
        margin-top: 6px;
      }
      .score-meter-fill {
        height: 100%;
        background: linear-gradient(90deg, #38bdf8, #2563eb);
      }
      .aha-reasons {
        margin: 10px 0 0;
        padding-left: 16px;
      }
      .aha-reasons li {
        color: #334155;
        margin: 4px 0;
        font-size: 12px;
      }
      details.raw-panel {
        border: 1px solid #dbe2ea;
        border-radius: 10px;
        padding: 8px 10px;
        background: #f8fafc;
        margin-top: 8px;
      }
      details.raw-panel > summary {
        cursor: pointer;
        color: #334155;
        font-weight: 700;
      }
      details.detail-section {
        border: 1px solid #dbe2ea;
        border-radius: 12px;
        background: #ffffff;
        margin-top: 10px;
        overflow: hidden;
      }
      details.detail-section > summary {
        cursor: pointer;
        list-style: none;
        padding: 10px 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: linear-gradient(180deg, #f8fafc, #f1f5f9);
      }
      details.detail-section > summary::-webkit-details-marker { display: none; }
      .detail-section-title { font-weight: 700; color: #0f172a; font-size: 14px; }
      .detail-section-subtitle { color: #64748b; font-size: 12px; }
      .detail-section-body { padding: 10px; border-top: 1px solid #e2e8f0; }
      .detail-section-body .item-card { margin: 0; box-shadow: none; }
      pre { background: #0b1020; color: #d1d5db; padding: 8px; border-radius: 8px; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
      .empty { padding: 18px; border: 1px dashed #cbd5e1; border-radius: 10px; color: #64748b; text-align: center; background: #f8fafc; }
      .error { color: #b91c1c; font-size: 13px; }
      textarea { width: 100%; min-height: 180px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .editor-row { display: flex; gap: 8px; margin: 8px 0; align-items: center; flex-wrap: wrap; }
      .hint { font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 8px; margin-top: 6px; }
      .coach-card {
        margin-top: 8px;
        border: 1px solid #bfdbfe;
        border-radius: 10px;
        background: #eff6ff;
        padding: 8px;
      }
      .coach-card h4 {
        margin: 0 0 6px;
        font-size: 12px;
        color: #1e3a8a;
      }
      .coach-list {
        margin: 0 0 8px 16px;
        padding: 0;
      }
      .coach-list li {
        margin: 4px 0;
        color: #334155;
        font-size: 12px;
      }
      .diff { font-size: 12px; color: #1f2937; background: #ecfeff; border: 1px solid #a5f3fc; border-radius: 6px; padding: 6px 8px; margin-top: 6px; white-space: pre-wrap; }
      .failure-note { font-size: 12px; color: #991b1b; margin-top: 6px; }
      .file-row { display: flex; gap: 8px; align-items: center; margin: 4px 0; }
      .file-path { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #374151; }
      .export-snapshot {
        border: 1px solid #bfdbfe;
        border-radius: 12px;
        background: linear-gradient(145deg, #eff6ff, #ffffff);
        padding: 10px;
        margin: 8px 0 10px;
      }
      .export-kpi-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }
      .export-kpi {
        border: 1px solid #dbeafe;
        border-radius: 10px;
        background: #ffffff;
        padding: 8px;
      }
      .export-kpi .label {
        color: #1e3a8a;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .export-kpi .value {
        margin-top: 4px;
        font-size: 14px;
        color: #0f172a;
        font-weight: 700;
        word-break: break-word;
      }
      .file-pills {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 8px;
      }
      .file-pill {
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
        border: 1px solid #bfdbfe;
        background: #ffffff;
        color: #1e3a8a;
      }
      .export-row { border-left: 4px solid #bfdbfe; }
      .diff-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
      .diff-column { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px; background: #fafafa; }
      .diff-column h4 { margin: 0 0 6px; font-size: 12px; color: #374151; }
      .diff-column ul { margin: 0; padding-left: 16px; max-height: 160px; overflow: auto; }
      .diff-column li { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      @media (max-width: 1200px) {
        .aha-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 900px) {
        .detail-aha-grid { grid-template-columns: 1fr; }
        .export-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .quick-action-grid { grid-template-columns: 1fr; }
      }
      @media (max-width: 1100px) {
        main { grid-template-columns: 1fr; min-height: auto; }
      }
      @media (max-width: 700px) {
        .aha-strip { grid-template-columns: 1fr; }
        .export-kpi-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="header-top">
        <div class="brand">
          <h1>Read→Do Inbox</h1>
          <p>从信息堆积到可执行决策，优先做最值得做的一件事。</p>
        </div>
      </div>
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
        <input id="queryInput" placeholder="Search title/domain/intent (press /)" />
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
        <button id="clearFiltersBtn" type="button">Clear Filters</button>
        <button id="resetControlsBtn" type="button">Reset Controls</button>
        <button class="primary" id="refreshBtn">Refresh</button>
      </div>
    </header>
    <main>
      <section>
        <h2>Decision Queue</h2>
        <p class="panel-subtitle">系统会自动提炼优先级与行动项，下面是当前最有产出的执行视图。</p>
        <div id="queueHighlights" class="aha-strip"></div>
        <div id="ahaNudge" class="aha-nudge"></div>
        <div id="queueActionBanner" class="muted action-feedback">Ready.</div>
        <div id="focusChips" class="focus-chips">
          <button type="button" class="focus-chip active" data-focus="all">All</button>
          <button type="button" class="focus-chip" data-focus="ready">Ready</button>
          <button type="button" class="focus-chip" data-focus="failed">Failed</button>
          <button type="button" class="focus-chip" data-focus="queued">Queued</button>
          <button type="button" class="focus-chip" data-focus="archived">Archived</button>
        </div>
        <div id="statusLegend" class="status-legend"></div>
        <div id="error" class="error"></div>
        <pre id="retryPreviewOutput" style="display:none;"></pre>
        <div id="inbox"></div>
      </section>
      <section>
        <h2>Detail</h2>
        <p class="panel-subtitle">查看结构化工件、版本差异与导出记录，快速完成从想法到交付。</p>
        <div id="detailModeChips" class="focus-chips">
          <button id="detailFocusModeBtn" type="button" class="focus-chip active">Focus Mode (F)</button>
          <button id="detailAdvancedModeBtn" type="button" class="focus-chip">Advanced Panels (A)</button>
        </div>
        <div id="detailSectionNav" class="focus-chips" style="display:none;"></div>
        <div id="detail" class="empty">Select one item from the list.</div>
      </section>
    </main>
    <script>
      const API_BASE = ${JSON.stringify(apiBase)};
      const inboxEl = document.getElementById("inbox");
      const detailEl = document.getElementById("detail");
      const detailModeChipsEl = document.getElementById("detailModeChips");
      const detailFocusModeBtn = document.getElementById("detailFocusModeBtn");
      const detailAdvancedModeBtn = document.getElementById("detailAdvancedModeBtn");
      const detailSectionNavEl = document.getElementById("detailSectionNav");
      const errorEl = document.getElementById("error");
      const queueHighlightsEl = document.getElementById("queueHighlights");
      const ahaNudgeEl = document.getElementById("ahaNudge");
      const queueActionBannerEl = document.getElementById("queueActionBanner");
      const focusChipsEl = document.getElementById("focusChips");
      const statusLegendEl = document.getElementById("statusLegend");
      const retryPreviewOutputEl = document.getElementById("retryPreviewOutput");
      const refreshBtn = document.getElementById("refreshBtn");
      const clearFiltersBtn = document.getElementById("clearFiltersBtn");
      const resetControlsBtn = document.getElementById("resetControlsBtn");
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
      let detailAdvancedEnabled = false;
      const controlsStorageKey = "readdo.web.controls.v1";
      const defaultCollapsedGroups = {
        read_next: false,
        worth_it: false,
        if_time: false,
        in_progress: false,
        needs_attention: false,
        skip: false,
        shipped: true,
        archived: true,
      };
      let collapsedGroups = { ...defaultCollapsedGroups };
      const controlDefaults = {
        q: "",
        status: "",
        retryable: "",
        failure_step: "",
        archive_retryable: "false",
        unarchive_mode: "smart",
        batch_limit: 100,
        preview_offset: 0,
        auto_refresh: false,
        detail_advanced: false,
        collapsed_groups: defaultCollapsedGroups,
      };

      function statusByFocusChip(focus) {
        if (focus === "ready") return "READY";
        if (focus === "failed") return "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT";
        if (focus === "queued") return "QUEUED";
        if (focus === "archived") return "ARCHIVED";
        return "";
      }

      function syncFocusChips() {
        if (!focusChipsEl) return;
        const buttons = focusChipsEl.querySelectorAll("[data-focus]");
        for (const button of buttons) {
          const focus = button.getAttribute("data-focus") || "all";
          const statusValue = statusByFocusChip(focus);
          const isActive = statusFilter.value === statusValue;
          button.classList.toggle("active", isActive);
        }
      }

      function clearPreviewContinuation() {
        previewContinuation = null;
        previewNextBtn.style.display = "none";
        previewNextBtn.textContent = "Preview Next";
        previewNextBtn.disabled = false;
      }

      function clearPreviewOutput() {
        retryPreviewOutputEl.style.display = "none";
        retryPreviewOutputEl.textContent = "";
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

      function clearDetailSectionNav() {
        if (!detailSectionNavEl) return;
        detailSectionNavEl.innerHTML = "";
        detailSectionNavEl.style.display = "none";
      }

      function syncDetailModeChips() {
        if (!detailModeChipsEl) return;
        detailFocusModeBtn?.classList.toggle("active", !detailAdvancedEnabled);
        detailAdvancedModeBtn?.classList.toggle("active", detailAdvancedEnabled);
      }

      function setDetailAdvancedEnabled(enabled, rerender = true) {
        detailAdvancedEnabled = Boolean(enabled);
        syncDetailModeChips();
        persistControls();
        if (rerender && selectedDetail) {
          renderDetailFromPayload(selectedDetail);
        }
      }

      function addDetailSectionNav(label, sectionId) {
        if (!detailSectionNavEl) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "section-chip";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          const section = document.getElementById(sectionId);
          if (!section) return;
          if (section instanceof HTMLDetailsElement) {
            section.open = true;
          }
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        detailSectionNavEl.appendChild(btn);
        detailSectionNavEl.style.display = "flex";
      }

      function appendDetailSection(sectionId, title, subtitle, contentEl, defaultOpen = false) {
        const wrapper = document.createElement("details");
        wrapper.className = "detail-section";
        wrapper.id = sectionId;
        wrapper.open = defaultOpen;
        wrapper.innerHTML =
          '<summary><div><div class="detail-section-title">' +
          title +
          '</div><div class="detail-section-subtitle">' +
          subtitle +
          "</div></div><span class=\"muted\">Expand</span></summary><div class=\"detail-section-body\"></div>";
        const body = wrapper.querySelector(".detail-section-body");
        body.appendChild(contentEl);
        detailEl.appendChild(wrapper);
        addDetailSectionNav(title, sectionId);
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
            detail_advanced: Boolean(detailAdvancedEnabled),
            collapsed_groups: collapsedGroups,
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
          detailAdvancedEnabled = Boolean(payload?.detail_advanced);
          if (payload?.collapsed_groups && typeof payload.collapsed_groups === "object" && !Array.isArray(payload.collapsed_groups)) {
            const normalizedGroups = { ...defaultCollapsedGroups };
            for (const [key, value] of Object.entries(payload.collapsed_groups)) {
              if (Object.prototype.hasOwnProperty.call(normalizedGroups, key)) {
                normalizedGroups[key] = Boolean(value);
              }
            }
            collapsedGroups = normalizedGroups;
          }
          syncDetailModeChips();
        } catch {
          // ignore malformed storage payloads
        }
      }

      function applyControlDefaults() {
        queryInput.value = controlDefaults.q;
        statusFilter.value = controlDefaults.status;
        retryableFilter.value = controlDefaults.retryable;
        failureStepFilter.value = controlDefaults.failure_step;
        archiveRetryableFilter.value = controlDefaults.archive_retryable;
        unarchiveModeFilter.value = controlDefaults.unarchive_mode;
        batchLimitInput.value = String(controlDefaults.batch_limit);
        previewOffsetInput.value = String(controlDefaults.preview_offset);
        autoRefreshToggle.checked = controlDefaults.auto_refresh;
        detailAdvancedEnabled = controlDefaults.detail_advanced;
        collapsedGroups = { ...controlDefaults.collapsed_groups };
        syncDetailModeChips();
      }

      function clearListFilters() {
        queryInput.value = controlDefaults.q;
        statusFilter.value = controlDefaults.status;
        retryableFilter.value = controlDefaults.retryable;
        failureStepFilter.value = controlDefaults.failure_step;
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

      function statusTone(status) {
        if (status === "READY" || status === "SHIPPED") return "ready";
        if (status === "CAPTURED") return "captured";
        if (status === "QUEUED") return "queued";
        if (status === "PROCESSING") return "processing";
        if (status === "ARCHIVED") return "archived";
        if (typeof status === "string" && status.startsWith("FAILED_")) return "failed";
        return "default";
      }

      function priorityTone(priority) {
        if (priority === "READ_NEXT") return "read-next";
        if (priority === "WORTH_IT") return "worth-it";
        if (priority === "IF_TIME") return "if-time";
        return "default";
      }

      function topReadyItem(items) {
        return items
          .filter((item) => item.status === "READY")
          .sort((a, b) => Number(b.match_score ?? -1) - Number(a.match_score ?? -1))[0];
      }

      function renderQueueHighlights(items) {
        if (!queueHighlightsEl) return;
        const readyCount = items.filter((item) => item.status === "READY").length;
        const shippedCount = items.filter((item) => item.status === "SHIPPED").length;
        const attentionCount = items.filter((item) => String(item.status || "").startsWith("FAILED_")).length;
        const retryableCount = items.filter((item) => isRetryableFailedItem(item)).length;
        const candidate = topReadyItem(items);
        const momentum = readyCount + retryableCount;

        queueHighlightsEl.innerHTML = "";
        const metrics = [
          { label: "Ready to Ship", value: String(readyCount), meta: "可直接导出" },
          { label: "Need Attention", value: String(attentionCount), meta: retryableCount + " 个可重试" },
          { label: "Shipped", value: String(shippedCount), meta: "已完成交付" },
          {
            label: "Next Best Move",
            value: candidate ? Number(candidate.match_score ?? 0).toFixed(1) : "—",
            meta: candidate ? (candidate.title || candidate.domain || candidate.url || "Ready item").slice(0, 44) : "等待新的 READY 项",
          },
        ];

        for (const metric of metrics) {
          const metricCard = document.createElement("div");
          metricCard.className = "aha-card";
          metricCard.innerHTML =
            '<div class="aha-label">' +
            metric.label +
            '</div><div class="aha-value">' +
            metric.value +
            '</div><div class="aha-meta">' +
            metric.meta +
            "</div>";
          queueHighlightsEl.appendChild(metricCard);
        }
        queueHighlightsEl.title = "Queue momentum: " + momentum;

        if (!ahaNudgeEl) return;
        const retryableFailed = items.find((item) => isRetryableFailedItem(item));
        const capturedCandidate = items.find((item) => item.status === "CAPTURED");
        let title = "Next Recommended Move";
        let message = "Capture or process more items to keep the decision queue active.";
        let ctaOp = null;
        if (candidate) {
          title = "Ship momentum available";
          message = "Top ready item score " + Number(candidate.match_score ?? 0).toFixed(1) + ". Ship now to keep output velocity.";
          ctaOp = {
            id: "nudge_export_top",
            label: "Open & Export Top Item",
            action: async () => {
              await selectItem(candidate.id);
              await exportItem(candidate.id);
            },
          };
        } else if (retryableFailed) {
          title = "Recover blocked value";
          message = "A retryable failed item is waiting. Recover it first to unblock downstream output.";
          ctaOp = {
            id: "nudge_retry_failed",
            label: "Retry First Failed Item",
            action: async () => {
              await processItem(retryableFailed.id, "RETRY");
            },
          };
        } else if (capturedCandidate) {
          title = "Convert captured into artifacts";
          message = "You still have captured items not processed. Turn one into actionable artifacts now.";
          ctaOp = {
            id: "nudge_process_captured",
            label: "Process First Captured Item",
            action: async () => {
              await processItem(capturedCandidate.id, "PROCESS");
            },
          };
        }
        ahaNudgeEl.innerHTML = '<h4>' + title + '</h4><span class="muted">' + message + "</span>";
        setActionFeedback(queueActionBannerEl, "", "Ready.");
        if (ctaOp) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "primary";
          btn.textContent = ctaOp.label;
          btn.addEventListener("click", async () => {
            await runActionWithFeedback(ctaOp, {
              button: btn,
              localFeedbackEl: queueActionBannerEl,
            });
          });
          ahaNudgeEl.appendChild(btn);
        } else {
          setActionFeedback(queueActionBannerEl, "", "No immediate CTA. Capture or process new items.");
        }
      }

      function renderStatusLegend(items) {
        if (!statusLegendEl) return;
        const counts = {
          CAPTURED: 0,
          QUEUED: 0,
          PROCESSING: 0,
          READY: 0,
          FAILED: 0,
          SHIPPED: 0,
          ARCHIVED: 0,
        };
        for (const item of items) {
          const status = String(item?.status || "");
          if (status === "CAPTURED") counts.CAPTURED += 1;
          else if (status === "QUEUED") counts.QUEUED += 1;
          else if (status === "PROCESSING") counts.PROCESSING += 1;
          else if (status === "READY") counts.READY += 1;
          else if (status === "SHIPPED") counts.SHIPPED += 1;
          else if (status === "ARCHIVED") counts.ARCHIVED += 1;
          else if (status.startsWith("FAILED_")) counts.FAILED += 1;
        }
        statusLegendEl.innerHTML = "";
        const entries = [
          { label: "Captured", dot: "captured", count: counts.CAPTURED, status: "CAPTURED" },
          { label: "Queued", dot: "processing", count: counts.QUEUED, status: "QUEUED" },
          { label: "Processing", dot: "processing", count: counts.PROCESSING, status: "PROCESSING" },
          { label: "Ready", dot: "ready", count: counts.READY, status: "READY" },
          { label: "Failed", dot: "failed", count: counts.FAILED, status: "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT" },
          { label: "Shipped", dot: "shipped", count: counts.SHIPPED, status: "SHIPPED" },
          { label: "Archived", dot: "archived", count: counts.ARCHIVED, status: "ARCHIVED" },
        ];
        for (const entry of entries) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "legend-item";
          if (statusFilter.value === entry.status) {
            btn.classList.add("active");
          }
          btn.innerHTML =
            '<span class="legend-dot ' +
            entry.dot +
            '"></span><span>' +
            entry.label +
            " " +
            entry.count +
            "</span>";
          btn.addEventListener("click", async () => {
            const op = {
              id: "legend_filter_" + entry.label.toLowerCase(),
              label: "Filter: " + entry.label,
              action: async () => {
                statusFilter.value = entry.status;
                syncFocusChips();
                persistControls();
                resetPreviewOffset();
                clearPreviewContinuation();
                clearPreviewOutput();
                await loadItems();
              },
            };
            await runActionWithFeedback(op, { button: btn, localFeedbackEl: queueActionBannerEl });
          });
          statusLegendEl.appendChild(btn);
        }
      }

      async function request(path, options = {}) {
        const response = await fetch(API_BASE + path, {
          headers: { "content-type": "application/json", ...(options.headers || {}) },
          ...options
        });
        const raw = await response.text();
        let data = {};
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = {};
          }
        }
        if (!response.ok) {
          const fallbackBody = raw && raw.trim() ? raw.trim().slice(0, 200) : "";
          const message = data?.error?.message || fallbackBody || ("Request failed: " + response.status);
          const code = data?.error?.code || "UNKNOWN_ERROR";
          const err = new Error(message);
          err.code = code;
          throw err;
        }
        return data || {};
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
        ops.push({ id: "detail", label: "Detail", action: () => selectItem(item.id), group: "view", priority: 100 });
        let primaryActionId = null;
        if (item.status === "CAPTURED") primaryActionId = "process";
        else if (item.status === "READY") primaryActionId = "export";
        else if (item.status === "SHIPPED") primaryActionId = "reexport";
        else if (item.status === "ARCHIVED") primaryActionId = "unarchive";
        else if (["FAILED_EXTRACTION", "FAILED_AI", "FAILED_EXPORT"].includes(item.status)) primaryActionId = "retry";
        if (item.status === "READY") {
          ops.push({ id: "regenerate", label: "Regenerate", action: () => processItem(item.id, "REGENERATE"), group: "process", priority: 30 });
        } else if (["FAILED_EXTRACTION", "FAILED_AI", "FAILED_EXPORT"].includes(item.status)) {
          const info = retryInfo(item);
          if (info.retryable) {
            const suffix = info.remaining == null ? "" : " (" + info.remaining + " left)";
            ops.push({ id: "retry", label: "Retry" + suffix, action: () => processItem(item.id, "RETRY"), group: "process", priority: 10 });
          } else {
            ops.push({ id: "retry_blocked", label: "Retry Limit Reached", action: () => {}, disabled: true, group: "process", priority: 50 });
            if (item.status === "FAILED_EXPORT") {
              primaryActionId = "export";
            } else {
              primaryActionId = "regenerate";
            }
          }
        } else if (item.status === "CAPTURED") {
          ops.push({ id: "process", label: "Process", action: () => processItem(item.id, "PROCESS"), group: "process", priority: 10 });
        }
        if (["READY", "SHIPPED", "FAILED_EXPORT"].includes(item.status)) {
          const isReExport = item.status === "SHIPPED";
          ops.push({
            id: isReExport ? "reexport" : "export",
            label: isReExport ? "Re-export" : "Export",
            action: () => exportItem(item.id),
            group: "ship",
            priority: isReExport ? 20 : 15,
          });
        }
        if (item.status === "ARCHIVED") {
          ops.push({ id: "unarchive", label: "Unarchive", action: () => unarchiveItem(item.id), group: "maintain", priority: 20 });
        } else if (item.status !== "PROCESSING") {
          ops.push({ id: "archive", label: "Archive", action: () => archiveItem(item.id), group: "maintain", priority: 80 });
        }
        if (primaryActionId === "regenerate" && !ops.find((op) => op.id === "regenerate")) {
          if (ops.find((op) => op.id === "process")) primaryActionId = "process";
          else if (ops.find((op) => op.id === "export")) primaryActionId = "export";
        }
        return ops
          .map((op) => ({ ...op, is_primary: op.id === primaryActionId }))
          .sort((a, b) => Number(a.priority ?? 100) - Number(b.priority ?? 100));
      }

      function detailOpsFor(item) {
        return buttonsFor(item).filter((op) => op.id !== "detail");
      }

      function detailActionBannerEl() {
        return document.getElementById("detailActionBanner");
      }

      function setActionFeedback(targetEl, state, text) {
        if (!targetEl) return;
        targetEl.textContent = text;
        targetEl.className = "muted action-feedback" + (state ? " " + state : "");
      }

      async function runActionWithFeedback(op, options = {}) {
        if (op.disabled) return;
        const button = options.button;
        const label = options.label || op.label || "Action";
        const localFeedbackEl = options.localFeedbackEl || null;
        const disableAll = typeof options.disableAll === "function" ? options.disableAll : null;
        const onStart = typeof options.onStart === "function" ? options.onStart : null;
        const onFinally = typeof options.onFinally === "function" ? options.onFinally : null;
        if (disableAll) disableAll(true);
        const previousDisabled = button ? button.disabled : false;
        if (button) {
          button.disabled = true;
        }
        if (onStart) {
          onStart();
        }
        setActionFeedback(detailActionBannerEl(), "pending", "Running: " + label);
        setActionFeedback(localFeedbackEl, "pending", "Running: " + label);
        try {
          errorEl.textContent = "";
          await op.action();
          setActionFeedback(detailActionBannerEl(), "done", "Completed: " + label);
          setActionFeedback(localFeedbackEl, "done", "Completed: " + label);
        } catch (err) {
          const message = String(err);
          setActionFeedback(detailActionBannerEl(), "error", "Failed: " + label + " — " + message);
          setActionFeedback(localFeedbackEl, "error", "Failed: " + label + " — " + message);
          errorEl.textContent = message;
        } finally {
          if (button) {
            button.disabled = previousDisabled;
          }
          if (disableAll) disableAll(false);
          if (onFinally) {
            onFinally();
          }
        }
      }

      async function applyListContextAndReload(label, options = {}) {
        const button = options.button;
        const mutate = typeof options.mutate === "function" ? options.mutate : null;
        const op = {
          id: "list_ctx_" + String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          label,
          action: async () => {
            if (mutate) mutate();
            syncFocusChips();
            persistControls();
            resetPreviewOffset();
            clearPreviewContinuation();
            clearPreviewOutput();
            await loadItems();
          },
        };
        await runActionWithFeedback(op, { button, localFeedbackEl: queueActionBannerEl });
      }

      async function applyQueueControlMutation(label, mutate, options = {}) {
        await runActionWithFeedback(
          {
            id: "queue_ctrl_" + String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_"),
            label,
            action: async () => {
              if (typeof mutate === "function") {
                mutate();
              }
              if (options.refresh_worker_stats) {
                await loadWorkerStats();
              }
            },
          },
          { localFeedbackEl: queueActionBannerEl },
        );
      }

      function renderItem(item) {
        const card = document.createElement("div");
        const isSelected = selectedId === item.id;
        card.className = "item-card clickable priority-" + priorityTone(item.priority) + (isSelected ? " is-selected" : "");
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
            <span class="status status-\${statusTone(item.status)}">\${item.status}</span>
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
        card.addEventListener("click", (event) => {
          const target = event.target;
          if (target instanceof HTMLElement && (target.closest("button") || target.closest("a"))) {
            return;
          }
          void selectItem(item.id).catch((err) => {
            errorEl.textContent = String(err);
          });
        });
        for (const op of ops) {
          const btn = document.createElement("button");
          btn.textContent = op.label;
          if (op.is_primary) {
            btn.classList.add("primary");
            btn.title = "Recommended action";
          }
          btn.disabled = Boolean(op.disabled);
          btn.addEventListener("click", async () => {
            await runActionWithFeedback(op, {
              button: btn,
              localFeedbackEl: queueActionBannerEl,
            });
          });
          actionEl.appendChild(btn);
        }
        return card;
      }

      function renderDetailAha(detail) {
        const summaryPayload = detail.artifacts?.summary?.payload ?? {};
        const scorePayload = detail.artifacts?.score?.payload ?? {};
        const todosPayload = detail.artifacts?.todos?.payload ?? {};
        const todos = Array.isArray(todosPayload.todos) ? todosPayload.todos : [];
        const reasons = Array.isArray(scorePayload.reasons) ? scorePayload.reasons.filter((x) => typeof x === "string") : [];
        const scoreRaw = Number(scorePayload.match_score ?? detail.item.match_score ?? 0);
        const score = Number.isFinite(scoreRaw) ? Math.min(Math.max(scoreRaw, 0), 100) : 0;
        const insight =
          typeof summaryPayload.insight === "string" && summaryPayload.insight.trim()
            ? summaryPayload.insight.trim()
            : "No insight yet. Run process/regenerate to build a stronger snapshot.";
        const nextTodo = todos[0] || null;

        const card = document.createElement("div");
        card.className = "item-card detail-aha";
        card.innerHTML = \`
          <h3>Aha Snapshot</h3>
          <div class="panel-subtitle">把内容价值压缩成“为什么现在做、先做什么、做完看到什么”。</div>
          <div class="aha-insight"></div>
          <div class="detail-aha-grid">
            <div class="detail-aha-kpi">
              <div class="label">Match Score</div>
              <div class="value">\${score.toFixed(1)} · \${scorePayload.priority || detail.item.priority || "N/A"}</div>
              <div class="score-meter"><div class="score-meter-fill" style="width:\${score}%;"></div></div>
            </div>
            <div class="detail-aha-kpi">
              <div class="label">Best Next Task</div>
              <div class="value" id="nextTaskValue">—</div>
            </div>
            <div class="detail-aha-kpi">
              <div class="label">Effort & Throughput</div>
              <div class="value" id="effortValue">—</div>
            </div>
          </div>
          <ul class="aha-reasons" id="ahaReasonsList"></ul>
        \`;
        const insightEl = card.querySelector(".aha-insight");
        const nextTaskValueEl = card.querySelector("#nextTaskValue");
        const effortValueEl = card.querySelector("#effortValue");
        const reasonsListEl = card.querySelector("#ahaReasonsList");
        insightEl.textContent = insight;
        nextTaskValueEl.textContent = nextTodo ? (nextTodo.title || "Untitled task") : "No task yet";
        if (nextTodo?.eta) {
          effortValueEl.textContent = nextTodo.eta + " first step · " + todos.length + " tasks total";
        } else {
          effortValueEl.textContent = todos.length + " tasks total";
        }
        const showReasons = reasons.length ? reasons.slice(0, 3) : ["No score reasons yet. Process this item to generate explainable reasons."];
        for (const reason of showReasons) {
          const li = document.createElement("li");
          li.textContent = reason;
          reasonsListEl.appendChild(li);
        }
        card.id = "detail-snapshot";
        detailEl.appendChild(card);
        addDetailSectionNav("Snapshot", "detail-snapshot");
      }

      function renderDetailQuickActions(detail, detailOps, hiddenActionIds = new Set()) {
        const ops = detailOps.filter((op) => !hiddenActionIds.has(op.id));
        if (!ops.length) {
          const emptyCard = document.createElement("div");
          emptyCard.className = "item-card";
          emptyCard.innerHTML = \`
            <h3>Quick Actions</h3>
            <div class="muted">Top actions are pinned in the header. Open Advanced Panels for deeper controls.</div>
          \`;
          emptyCard.id = "detail-quick-actions";
          detailEl.appendChild(emptyCard);
          addDetailSectionNav("Quick Actions", "detail-quick-actions");
          return;
        }

        const card = document.createElement("div");
        card.className = "item-card";
        const primaryOp = ops.find((op) => op.is_primary) || null;
        card.innerHTML = \`
          <h3>Quick Actions</h3>
          <div class="muted">无需回到列表，直接在详情完成处理、导出与归档。</div>
          <div class="hint">Recommended Action: \${primaryOp?.label || "Choose any action below based on your goal."}</div>
          <div class="quick-action-grid" id="detailQuickActions"></div>
          <div class="muted action-feedback" id="detailQuickActionMsg">Mirrors global action status.</div>
        \`;
        const actionEl = card.querySelector("#detailQuickActions");
        const msgEl = card.querySelector("#detailQuickActionMsg");
        const groupDefs = [
          { key: "process", title: "Process & Regenerate", hint: "生成或重试核心产物" },
          { key: "ship", title: "Ship & Export", hint: "导出可交付文件" },
          { key: "maintain", title: "Maintain Queue", hint: "归档与状态维护" },
        ];
        const quickButtons = [];
        function setButtonsDisabled(nextDisabled) {
          for (const button of quickButtons) {
            button.disabled = nextDisabled || button.dataset.locked === "true";
          }
        }
        for (const groupDef of groupDefs) {
          const groupOps = ops.filter((op) => (op.group || "maintain") === groupDef.key);
          if (!groupOps.length) continue;
          const groupEl = document.createElement("div");
          groupEl.className = "quick-action-group";
          groupEl.innerHTML = '<h4>' + groupDef.title + '</h4><span class="muted">' + groupDef.hint + '</span><div class="actions"></div>';
          const groupActionEl = groupEl.querySelector(".actions");
          for (const op of groupOps) {
            const btn = document.createElement("button");
            btn.textContent = op.label;
            if (op.is_primary) {
              btn.classList.add("primary");
            }
            const locked = Boolean(op.disabled);
            btn.disabled = locked;
            btn.dataset.locked = locked ? "true" : "false";
            quickButtons.push(btn);
            btn.addEventListener("click", async () => {
              const initialLabel = btn.textContent;
              await runActionWithFeedback(op, {
                button: btn,
                label: initialLabel,
                localFeedbackEl: msgEl,
                disableAll: setButtonsDisabled,
                onStart: () => {
                  btn.textContent = "Working…";
                },
                onFinally: () => {
                  btn.textContent = initialLabel;
                },
              });
            });
            groupActionEl.appendChild(btn);
          }
          actionEl.appendChild(groupEl);
        }
        card.id = "detail-quick-actions";
        detailEl.appendChild(card);
        addDetailSectionNav("Quick Actions", "detail-quick-actions");
      }

      function appendGroup(target, key, title, items) {
        if (!items.length) return;
        const isCollapsed = Boolean(collapsedGroups[key]);
        const label = document.createElement("div");
        label.className = "group-title";
        label.innerHTML = '<span>' + title + " (" + items.length + ")</span>";
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "section-chip";
        toggleBtn.textContent = isCollapsed ? "Expand" : "Collapse";
        toggleBtn.addEventListener("click", () => {
          collapsedGroups[key] = !Boolean(collapsedGroups[key]);
          persistControls();
          renderInbox(allItems);
        });
        label.appendChild(toggleBtn);
        target.appendChild(label);
        if (isCollapsed) return;
        for (const item of items) {
          target.appendChild(renderItem(item));
        }
      }

      function renderInbox(items) {
        inboxEl.innerHTML = "";
        renderQueueHighlights(items);
        renderStatusLegend(items);
        if (!items.length) {
          inboxEl.innerHTML = '<div class="empty">No items yet. Use the extension to capture links.</div>';
          return;
        }
        const groups = groupedItems(items);
        appendGroup(inboxEl, "read_next", "Read Next", groups.read_next);
        appendGroup(inboxEl, "worth_it", "Worth It", groups.worth_it);
        appendGroup(inboxEl, "if_time", "If Time", groups.if_time);
        appendGroup(inboxEl, "in_progress", "In Progress", groups.in_progress);
        appendGroup(inboxEl, "needs_attention", "Needs Attention", groups.needs_attention);
        appendGroup(inboxEl, "skip", "Skip", groups.skip);
        appendGroup(inboxEl, "shipped", "Shipped", groups.shipped);
        appendGroup(inboxEl, "archived", "Archived", groups.archived);
      }

      async function loadItems() {
        if (isLoadingItems) return;
        isLoadingItems = true;
        try {
          syncFocusChips();
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

      function renderRawDebugPanel(detail) {
        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = \`
          <h3>Raw Debug JSON</h3>
          <details class="raw-panel">
            <summary>Artifacts JSON</summary>
            <pre>\${JSON.stringify(detail.artifacts || {}, null, 2)}</pre>
          </details>
          <details class="raw-panel">
            <summary>Artifact History JSON</summary>
            <pre>\${JSON.stringify(detail.artifact_history || {}, null, 2)}</pre>
          </details>
          <details class="raw-panel">
            <summary>Failure JSON</summary>
            <pre>\${JSON.stringify(detail.failure || null, null, 2)}</pre>
          </details>
        \`;
        appendDetailSection("detail-raw-json", "Raw JSON", "调试与排障专用视图", card, false);
      }

      function renderDetailHeroActions(detail, hostEl, detailOps) {
        const actionHost = hostEl.querySelector("#detailHeroActions");
        const usedIds = new Set();
        if (!actionHost) return usedIds;
        const ops = detailOps;
        if (!ops.length) return usedIds;
        actionHost.innerHTML = '<div class="muted">Primary Next Step</div>';
        const primaryOp = ops.find((op) => op.is_primary) || ops[0];
        const secondaryOp = ops.find((op) => op.id === "archive" || op.id === "unarchive");
        const heroOps = [primaryOp];
        if (secondaryOp && secondaryOp.id !== primaryOp.id) {
          heroOps.push(secondaryOp);
        }
        for (const op of heroOps) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = op.label;
          if (op.is_primary) btn.classList.add("primary");
          btn.disabled = Boolean(op.disabled);
          btn.addEventListener("click", async () => {
            await runActionWithFeedback(op, { button: btn });
          });
          actionHost.appendChild(btn);
          usedIds.add(op.id);
        }
        return usedIds;
      }

      function renderAdvancedHintCard() {
        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = \`
          <h3>Advanced Panels Hidden</h3>
          <div class="muted">当前为 Focus Mode。版本对比、意图编辑、工件编辑与原始 JSON 已收起。</div>
          <div class="editor-row">
            <button id="enableAdvancedPanelsBtn" type="button">Enable Advanced Panels</button>
          </div>
        \`;
        const enableBtn = card.querySelector("#enableAdvancedPanelsBtn");
        enableBtn?.addEventListener("click", () => {
          setDetailAdvancedEnabled(true);
        });
        card.id = "detail-advanced-hint";
        detailEl.appendChild(card);
        addDetailSectionNav("Advanced", "detail-advanced-hint");
      }

      function renderDetailFromPayload(detail) {
        selectedDetail = detail;
        clearDetailSectionNav();
        detailEl.innerHTML = "";

        const wrap = document.createElement("div");
        wrap.innerHTML = \`
          <div class="item-card priority-\${priorityTone(detail.item.priority)}">
            <div class="item-head">
              <span class="status status-\${statusTone(detail.item.status)}">\${detail.item.status}</span>
              <span class="muted">\${detail.item.priority || "N/A"} · \${detail.item.match_score ?? "—"}</span>
            </div>
            <div class="intent">\${detail.item.intent_text}</div>
            <div>\${detail.item.title || detail.item.url}</div>
            <div class="muted">\${detail.item.domain || ""}</div>
            <div id="detailHeroActions" class="hero-actions"></div>
            <div id="detailActionBanner" class="muted action-feedback">Ready.</div>
          </div>
        \`;
        detailEl.appendChild(wrap);
        const detailOps = detailOpsFor(detail.item);
        const heroActionIds = renderDetailHeroActions(detail, wrap, detailOps);
        renderDetailAha(detail);
        renderDetailQuickActions(detail, detailOps, heroActionIds);
        renderFailureGuidance(detail, heroActionIds, detailOps);
        renderExportPanel(detail, heroActionIds, detailOps);

        if (detailAdvancedEnabled) {
          renderArtifactVersionViewer(detail);
          renderIntentEditor(detail);
          renderArtifactEditor(detail);
          renderRawDebugPanel(detail);
        } else {
          renderAdvancedHintCard();
        }
        syncDetailModeChips();
      }

      async function selectItem(id) {
        selectedId = id;
        if (allItems.length) {
          renderInbox(allItems);
        }
        detailEl.innerHTML = '<div class="item-card"><div class="muted">Loading detail…</div></div>';
        let detail;
        try {
          detail = await request("/items/" + id + "?include_history=true");
        } catch (err) {
          detailEl.innerHTML = '<div class="empty">Failed to load detail. Try refresh.</div>';
          throw err;
        }
        renderDetailFromPayload(detail);
      }

      function renderFailureGuidance(detail, heroActionIds = new Set(), detailOps = []) {
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
          <div class="coach-card">
            <h4>Recovery Playbook</h4>
            <ul class="coach-list" id="failureCoachList"></ul>
            <div class="actions" id="failureCoachActions"></div>
          </div>
        \`;
        const coachListEl = card.querySelector("#failureCoachList");
        const coachActionsEl = card.querySelector("#failureCoachActions");
        const actionMap = new Map(detailOps.map((op) => [op.id, op]));
        const steps = [];
        let primaryAction = null;
        if (failure.failed_step === "extract") {
          steps.push("Check whether the source URL is reachable and has readable content.");
          steps.push("If content is dynamic, try another source URL or capture again.");
          steps.push("Retry after confirming network accessibility.");
          if (retryable) {
            primaryAction = actionMap.get("retry") || { id: "retry", label: "Retry Extraction", action: () => processItem(detail.item.id, "RETRY") };
          }
        } else if (failure.failed_step === "pipeline") {
          steps.push("Refine intent so the expected output is concrete and narrow.");
          steps.push("Use Regenerate to re-run the structured pipeline.");
          steps.push("If repeatedly failing, edit artifact in Advanced mode.");
          if (retryable) {
            primaryAction = actionMap.get("retry") || { id: "retry", label: "Retry Pipeline", action: () => processItem(detail.item.id, "RETRY") };
          }
        } else if (failure.failed_step === "export") {
          steps.push("Keep md/caption output available while PNG rendering recovers.");
          steps.push("Re-export to regenerate missing files.");
          steps.push("Open latest export artifact to verify render output.");
          if (retryable) {
            primaryAction = actionMap.get("export") || { id: "export", label: "Retry Export", action: () => exportItem(detail.item.id) };
          }
        } else {
          steps.push("Inspect failure code and message for immediate cause.");
          steps.push("Try retry/regenerate depending on current item status.");
        }
        if (!retryable) {
          steps.push("Retry is blocked. Switch to Advanced Panels and edit intent/artifacts before rerun.");
          primaryAction = { id: "open_advanced", label: "Open Advanced Panels", action: () => setDetailAdvancedEnabled(true) };
        }
        for (const step of steps) {
          const li = document.createElement("li");
          li.textContent = step;
          coachListEl.appendChild(li);
        }
        if (primaryAction && !heroActionIds.has(primaryAction.id)) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = primaryAction.label;
          if (primaryAction.id === "open_advanced") {
            btn.classList.add("primary");
          }
          btn.addEventListener("click", async () => {
            await runActionWithFeedback(primaryAction, { button: btn });
          });
          coachActionsEl.appendChild(btn);
        } else if (primaryAction) {
          coachActionsEl.innerHTML = '<span class="muted">Primary action is already pinned in header: ' + primaryAction.label + ".</span>";
        }
        appendDetailSection("detail-failure", "Failure Guidance", "失败原因与恢复建议", card, true);
      }

      function renderExportPanel(detail, heroActionIds = new Set(), detailOps = []) {
        const exportHistory = detail.artifact_history?.export ?? [];
        const panel = document.createElement("div");
        panel.className = "item-card";

        const status = detail.item.status;
        const failure = detail.failure || null;
        const latestExport = exportHistory[0] ?? null;
        const latestFiles = Array.isArray(latestExport?.payload?.files) ? latestExport.payload.files : [];
        const latestFirstFile = latestFiles[0] ?? null;
        const latestTheme = latestExport?.payload?.options?.theme || "AUTO";
        const formatCounts = latestFiles.reduce((acc, file) => {
          const type = String(file?.type || "unknown").toUpperCase();
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {});
        const formatPillsHtml = Object.entries(formatCounts)
          .map(([type, count]) => '<span class="file-pill">' + type + " × " + count + "</span>")
          .join("");

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
          <div class="coach-card">
            <h4>Shipping Playbook</h4>
            <ul class="coach-list" id="exportCoachList"></ul>
            <div class="actions" id="exportCoachActions"></div>
          </div>
          <div class="export-snapshot">
            <div class="muted">Export Snapshot</div>
            <div class="export-kpi-grid">
              <div class="export-kpi">
                <div class="label">Total Exports</div>
                <div class="value">\${exportHistory.length}</div>
              </div>
              <div class="export-kpi">
                <div class="label">Latest Version</div>
                <div class="value">\${latestExport ? "v" + latestExport.version : "—"}</div>
              </div>
              <div class="export-kpi">
                <div class="label">Latest Theme</div>
                <div class="value">\${latestTheme}</div>
              </div>
              <div class="export-kpi">
                <div class="label">Latest Created</div>
                <div class="value">\${latestExport?.created_at || "—"}</div>
              </div>
            </div>
            <div class="file-pills">\${formatPillsHtml || '<span class="muted">No latest files yet.</span>'}</div>
            <div class="editor-row">
              <button id="copyLatestPathsBtn" type="button" \${latestFiles.length ? "" : "disabled"}>Copy Latest Paths</button>
              <button id="openLatestFileBtn" type="button" \${latestFirstFile ? "" : "disabled"}>Open Latest File</button>
            </div>
          </div>
          <div id="exportRecordList"></div>
          <div id="exportFailureHint"></div>
        \`;

        const listEl = panel.querySelector("#exportRecordList");
        const exportCoachListEl = panel.querySelector("#exportCoachList");
        const exportCoachActionsEl = panel.querySelector("#exportCoachActions");
        const actionMap = new Map(detailOps.map((op) => [op.id, op]));
        const copyLatestBtn = panel.querySelector("#copyLatestPathsBtn");
        const openLatestBtn = panel.querySelector("#openLatestFileBtn");
        const exportSteps = [];
        let exportPrimaryAction = null;
        if (status === "READY") {
          exportSteps.push("Run export now to produce shareable PNG/MD/CAPTION assets.");
          exportSteps.push("Review generated files and copy paths for downstream sharing.");
          exportPrimaryAction = actionMap.get("export") || { id: "export", label: "Export Now", action: () => exportItem(detail.item.id) };
        } else if (status === "FAILED_EXPORT") {
          exportSteps.push("Retry export to regenerate missing artifacts.");
          exportSteps.push("Open latest file to inspect renderer output differences.");
          exportPrimaryAction = actionMap.get("export") || { id: "export", label: "Retry Export", action: () => exportItem(detail.item.id) };
        } else if (status === "SHIPPED") {
          exportSteps.push("Use latest file link for immediate sharing.");
          exportSteps.push("Re-export if intent/artifacts changed and you need a fresh card.");
          exportPrimaryAction = actionMap.get("reexport") || { id: "reexport", label: "Re-export", action: () => exportItem(detail.item.id) };
        } else {
          exportSteps.push("Generate artifacts first, then export from READY state.");
          exportSteps.push("Use Quick Actions to process/regenerate before shipping.");
        }
        for (const step of exportSteps) {
          const li = document.createElement("li");
          li.textContent = step;
          exportCoachListEl.appendChild(li);
        }
        if (exportPrimaryAction && !heroActionIds.has(exportPrimaryAction.id)) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = exportPrimaryAction.label;
          btn.addEventListener("click", async () => {
            await runActionWithFeedback(exportPrimaryAction, { button: btn });
          });
          exportCoachActionsEl.appendChild(btn);
        } else if (exportPrimaryAction) {
          exportCoachActionsEl.innerHTML = '<span class="muted">Primary shipping action is already pinned in header: ' + exportPrimaryAction.label + ".</span>";
        }
        if (copyLatestBtn) {
          copyLatestBtn.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(latestFiles.map((file) => String(file.path || "")).filter(Boolean).join("\\n"));
              errorEl.textContent = "Copied latest export file paths.";
            } catch {
              errorEl.textContent = "Copy latest paths failed.";
            }
          });
        }
        if (openLatestBtn) {
          openLatestBtn.addEventListener("click", () => {
            if (!latestFirstFile?.path) return;
            const fileHref = "/" + String(latestFirstFile.path).replace(/^\/+/, "");
            window.open(encodeURI(fileHref), "_blank", "noopener,noreferrer");
          });
        }

        if (!exportHistory.length) {
          listEl.innerHTML = '<div class="empty">No export artifacts yet.</div>';
        } else {
          for (const exp of exportHistory) {
            const card = document.createElement("div");
            card.className = "item-card export-row";
            const files = exp?.payload?.files ?? [];
            card.innerHTML = \`
              <div class="item-head">
                <span class="status status-default">export v\${exp.version}</span>
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
                <span class="status status-default">\${String(file.type || "file").toUpperCase()}</span>
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

        appendDetailSection("detail-export", "Export Records", "导出快照、历史记录与文件快捷操作", panel, true);
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

        appendDetailSection("detail-versions", "Version Viewer", "比较不同 artifact 版本差异", card, false);
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

        appendDetailSection("detail-intent-editor", "Edit Intent", "调整意图并按需触发重新生成", card, false);
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

        appendDetailSection("detail-artifact-editor", "Edit Artifact", "创建用户版本并保留历史", card, false);
      }

      async function processItem(id, mode) {
        const requestId = crypto.randomUUID();
        const response = await request("/items/" + id + "/process", {
          method: "POST",
          body: JSON.stringify({
            process_request_id: requestId,
            mode
          }),
          headers: { "Idempotency-Key": requestId }
        });
        if (response?.idempotent_replay === true) {
          errorEl.textContent = "Process request replayed by idempotency key.";
        }
        await loadItems();
      }

      async function exportItem(id) {
        try {
          const requestId = crypto.randomUUID();
          const response = await request("/items/" + id + "/export", {
            method: "POST",
            body: JSON.stringify({
              export_key: "web_" + requestId,
              formats: ["png", "md", "caption"]
            }),
            headers: { "Idempotency-Key": requestId }
          });
          if (response?.idempotent_replay === true) {
            errorEl.textContent = "Export request replayed by idempotency key.";
          }
        } catch (err) {
          if (err?.code === "EXPORT_RENDER_FAILED") {
            const fallbackRequestId = crypto.randomUUID();
            const fallbackResponse = await request("/items/" + id + "/export", {
              method: "POST",
              body: JSON.stringify({
                export_key: "web_fallback_" + fallbackRequestId,
                formats: ["md", "caption"]
              }),
              headers: { "Idempotency-Key": fallbackRequestId }
            });
            errorEl.textContent =
              fallbackResponse?.idempotent_replay === true
                ? "PNG failed; fallback export replayed by idempotency key."
                : "PNG failed; fallback export (md+caption) succeeded.";
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
        await runActionWithFeedback(
          {
            id: "queue_refresh",
            label: "Refresh Queue",
            action: async () => {
              clearPreviewContinuation();
              clearPreviewOutput();
              await loadItems();
            },
          },
          { button: refreshBtn, localFeedbackEl: queueActionBannerEl },
        );
      });

      resetControlsBtn.addEventListener("click", async () => {
        await runActionWithFeedback(
          {
            id: "queue_reset_controls",
            label: "Reset Controls",
            action: async () => {
              clearPreviewContinuation();
              clearPreviewOutput();
              applyControlDefaults();
              localStorage.removeItem(controlsStorageKey);
              setAutoRefresh(false);
              await loadItems();
            },
          },
          { button: resetControlsBtn, localFeedbackEl: queueActionBannerEl },
        );
      });

      clearFiltersBtn.addEventListener("click", async () => {
        await runActionWithFeedback(
          {
            id: "queue_clear_filters",
            label: "Clear Filters",
            action: async () => {
              clearListFilters();
              resetPreviewOffset();
              clearPreviewContinuation();
              clearPreviewOutput();
              persistControls();
              await loadItems();
            },
          },
          { button: clearFiltersBtn, localFeedbackEl: queueActionBannerEl },
        );
      });

      runWorkerBtn.addEventListener("click", async () => {
        await runActionWithFeedback(
          {
            id: "queue_run_worker_once",
            label: "Run Worker Once",
            action: async () => {
              await request("/system/worker/run-once", { method: "POST", body: JSON.stringify({}) });
              await loadItems();
            },
          },
          { button: runWorkerBtn, localFeedbackEl: queueActionBannerEl },
        );
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

      function resetPreviewOffset() {
        previewOffsetInput.value = String(controlDefaults.preview_offset);
        persistControls();
      }

      function syncPreviewOffsetFromResponse(preview) {
        const requestedOffset = Number(preview?.requested_offset ?? 0);
        previewOffsetInput.value = String(Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0);
        persistControls();
      }

      function renderArchivePreviewOutput(preview) {
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
      }

      function renderRetryPreviewOutput(preview) {
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
      }

      function renderUnarchivePreviewOutput(preview) {
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
      }

      previewArchiveBtn.addEventListener("click", async () => {
        await runActionWithFeedback(
          {
            id: "queue_preview_archive",
            label: "Preview Archive",
            action: async () => {
              try {
                clearPreviewContinuation();
                const previewOffset = normalizedPreviewOffset();
                const preview = await request("/items/archive-failed", {
                  method: "POST",
                  body: JSON.stringify(archiveBlockedPayload(true, previewOffset))
                });
                syncPreviewOffsetFromResponse(preview);
                renderArchivePreviewOutput(preview);
                setPreviewContinuation("archive", preview.next_offset);
              } catch (err) {
                retryPreviewOutputEl.style.display = "none";
                retryPreviewOutputEl.textContent = "";
                clearPreviewContinuation();
                throw new Error("Archive preview failed: " + String(err));
              }
            },
          },
          { button: previewArchiveBtn, localFeedbackEl: queueActionBannerEl },
        );
      });

      retryFailedBtn.addEventListener("click", async () => {
        await runActionWithFeedback(
          {
            id: "queue_retry_failed",
            label: "Retry Failed Batch",
            action: async () => {
              clearPreviewContinuation();
              clearPreviewOutput();
              let exportSuccess = 0;
              let exportFailed = 0;
              let exportReplayed = 0;
              try {
                const executionOffset = normalizedPreviewOffset();
                const previewRes = await request("/items/retry-failed", {
                  method: "POST",
                  body: JSON.stringify(retryFailedPayload(true, executionOffset))
                });
                syncPreviewOffsetFromResponse(previewRes);
                const eligiblePipeline = Number(previewRes.eligible_pipeline ?? 0);
                const eligibleExport = Number(previewRes.eligible_export ?? 0);
                if (eligiblePipeline <= 0 && eligibleExport <= 0) {
                  errorEl.textContent =
                    "No retryable failed items matching current filters. scanned=" +
                    (previewRes.scanned ?? 0) +
                    "/" +
                    (previewRes.scanned_total ?? previewRes.scanned ?? 0) +
                    ", limit=" +
                    (previewRes.requested_limit ?? normalizedBatchLimit()) +
                    ", offset=" +
                    (previewRes.requested_offset ?? 0) +
                    ", q=" +
                    (previewRes.q_filter || "all") +
                    ", filter=" +
                    (previewRes.failure_step_filter || "all") +
                    ".";
                  return;
                }
                const confirmed = confirm(
                  "Retry failed items [q=" +
                    (previewRes.q_filter || "all") +
                    ", filter=" +
                    (previewRes.failure_step_filter || "all") +
                    "]? pipeline=" +
                    eligiblePipeline +
                    ", export=" +
                    eligibleExport +
                    ", scanned=" +
                    (previewRes.scanned ?? 0) +
                    "/" +
                    (previewRes.scanned_total ?? previewRes.scanned ?? 0),
                );
                if (!confirmed) {
                  errorEl.textContent = "Retry failed action cancelled.";
                  return;
                }
                errorEl.textContent = "Retrying failed items...";
                const executeOffset = normalizedPreviewOffset();
                const batchRes = await request("/items/retry-failed", {
                  method: "POST",
                  body: JSON.stringify(retryFailedPayload(false, executeOffset))
                });
                syncPreviewOffsetFromResponse(batchRes);
                const exportItemIds = batchRes.eligible_export_item_ids || [];
                for (const itemId of exportItemIds) {
                  try {
                    const requestId = crypto.randomUUID();
                    const response = await request("/items/" + itemId + "/export", {
                      method: "POST",
                      body: JSON.stringify({
                        export_key: "batch_retry_" + requestId,
                        formats: ["png", "md", "caption"]
                      }),
                      headers: { "Idempotency-Key": requestId }
                    });
                    exportSuccess += 1;
                    if (response?.idempotent_replay === true) {
                      exportReplayed += 1;
                    }
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
                  ", filter=" +
                  (batchRes.failure_step_filter || "all") +
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
                  ", export_replayed=" +
                  exportReplayed +
                  ", export_failed=" +
                  exportFailed +
                  ".";
              } catch (err) {
                throw new Error("Retry failed batch action failed: " + String(err));
              }
            },
          },
          {
            button: retryFailedBtn,
            localFeedbackEl: queueActionBannerEl,
            onFinally: async () => {
              await loadItems();
            },
          },
        );
      });

      previewRetryBtn.addEventListener("click", async () => {
        await runActionWithFeedback(
          {
            id: "queue_preview_retry",
            label: "Preview Retry",
            action: async () => {
              try {
                clearPreviewContinuation();
                const previewOffset = normalizedPreviewOffset();
                const preview = await request("/items/retry-failed", {
                  method: "POST",
                  body: JSON.stringify(retryFailedPayload(true, previewOffset))
                });
                syncPreviewOffsetFromResponse(preview);
                renderRetryPreviewOutput(preview);
                setPreviewContinuation("retry", preview.next_offset);
              } catch (err) {
                retryPreviewOutputEl.style.display = "none";
                retryPreviewOutputEl.textContent = "";
                clearPreviewContinuation();
                throw new Error("Retry preview failed: " + String(err));
              }
            },
          },
          { button: previewRetryBtn, localFeedbackEl: queueActionBannerEl },
        );
      });

      archiveBlockedBtn.addEventListener("click", async () => {
        await runActionWithFeedback(
          {
            id: "queue_archive_failed",
            label: "Archive Failed Batch",
            action: async () => {
              try {
                clearPreviewContinuation();
                clearPreviewOutput();
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
                const executeOffset = normalizedPreviewOffset();
                const result = await request("/items/archive-failed", {
                  method: "POST",
                  body: JSON.stringify(archiveBlockedPayload(false, executeOffset))
                });
                syncPreviewOffsetFromResponse(result);
                errorEl.textContent =
                  "Archive blocked done. archived=" +
                  (result.archived ?? 0) +
                  ", scanned=" +
                  (result.scanned ?? 0) +
                  "/" +
                  (result.scanned_total ?? result.scanned ?? 0) +
                  ", limit=" +
                  (result.requested_limit ?? normalizedBatchLimit()) +
                  ", offset=" +
                  (result.requested_offset ?? 0) +
                  ", q=" +
                  (result.q_filter || "all") +
                  ", retryable=" +
                  (result.retryable_filter == null ? "all" : String(result.retryable_filter)) +
                  ", filter=" +
                  (result.failure_step_filter || "all") +
                  ", truncated=" +
                  (result.scan_truncated ? "yes" : "no") +
                  ", next_offset=" +
                  (result.next_offset == null ? "null" : String(result.next_offset)) +
                  ", skipped_retryable_mismatch=" +
                  (result.skipped_retryable_mismatch ?? 0) +
                  ".";
              } catch (err) {
                throw new Error("Archive blocked failed: " + String(err));
              }
            },
          },
          {
            button: archiveBlockedBtn,
            localFeedbackEl: queueActionBannerEl,
            onFinally: async () => {
              await loadItems();
            },
          },
        );
      });

      previewUnarchiveBtn.addEventListener("click", async () => {
        await runActionWithFeedback(
          {
            id: "queue_preview_unarchive",
            label: "Preview Unarchive",
            action: async () => {
              try {
                clearPreviewContinuation();
                const previewOffset = normalizedPreviewOffset();
                const preview = await request("/items/unarchive-batch", {
                  method: "POST",
                  body: JSON.stringify(unarchiveBatchPayload(true, previewOffset))
                });
                syncPreviewOffsetFromResponse(preview);
                renderUnarchivePreviewOutput(preview);
                setPreviewContinuation("unarchive", preview.next_offset);
              } catch (err) {
                retryPreviewOutputEl.style.display = "none";
                retryPreviewOutputEl.textContent = "";
                clearPreviewContinuation();
                throw new Error("Unarchive preview failed: " + String(err));
              }
            },
          },
          { button: previewUnarchiveBtn, localFeedbackEl: queueActionBannerEl },
        );
      });

      previewNextBtn.addEventListener("click", async () => {
        if (!previewContinuation || previewContinuation.next_offset == null) return;
        await runActionWithFeedback(
          {
            id: "queue_preview_next",
            label: "Preview Next",
            action: async () => {
              try {
                const nextOffset = Number(previewContinuation.next_offset);
                if (previewContinuation.kind === "retry") {
                  const preview = await request("/items/retry-failed", {
                    method: "POST",
                    body: JSON.stringify(retryFailedPayload(true, nextOffset))
                  });
                  syncPreviewOffsetFromResponse(preview);
                  renderRetryPreviewOutput(preview);
                  setPreviewContinuation("retry", preview.next_offset);
                  return;
                }
                if (previewContinuation.kind === "archive") {
                  const preview = await request("/items/archive-failed", {
                    method: "POST",
                    body: JSON.stringify(archiveBlockedPayload(true, nextOffset))
                  });
                  syncPreviewOffsetFromResponse(preview);
                  renderArchivePreviewOutput(preview);
                  setPreviewContinuation("archive", preview.next_offset);
                  return;
                }
                if (previewContinuation.kind === "unarchive") {
                  const preview = await request("/items/unarchive-batch", {
                    method: "POST",
                    body: JSON.stringify(unarchiveBatchPayload(true, nextOffset))
                  });
                  syncPreviewOffsetFromResponse(preview);
                  renderUnarchivePreviewOutput(preview);
                  setPreviewContinuation("unarchive", preview.next_offset);
                  return;
                }
                clearPreviewContinuation();
              } catch (err) {
                clearPreviewContinuation();
                throw new Error("Preview next failed: " + String(err));
              }
            },
          },
          { button: previewNextBtn, localFeedbackEl: queueActionBannerEl },
        );
      });

      unarchiveBatchBtn.addEventListener("click", async () => {
        await runActionWithFeedback(
          {
            id: "queue_unarchive_batch",
            label: "Unarchive Batch",
            action: async () => {
              try {
                clearPreviewContinuation();
                clearPreviewOutput();
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
                const executeOffset = normalizedPreviewOffset();
                const result = await request("/items/unarchive-batch", {
                  method: "POST",
                  body: JSON.stringify(unarchiveBatchPayload(false, executeOffset))
                });
                syncPreviewOffsetFromResponse(result);
                errorEl.textContent =
                  "Unarchive done. unarchived=" +
                  (result.unarchived ?? 0) +
                  ", scanned=" +
                  (result.scanned ?? 0) +
                  "/" +
                  (result.scanned_total ?? result.scanned ?? 0) +
                  ", limit=" +
                  (result.requested_limit ?? normalizedBatchLimit()) +
                  ", offset=" +
                  (result.requested_offset ?? 0) +
                  ", mode=" +
                  (result.regenerate ? "regenerate" : "smart") +
                  ", q=" +
                  (result.q_filter || "all") +
                  ", truncated=" +
                  (result.scan_truncated ? "yes" : "no") +
                  ", next_offset=" +
                  (result.next_offset == null ? "null" : String(result.next_offset)) +
                  ", queued_jobs_created=" +
                  (result.queued_jobs_created ?? 0) +
                  ".";
              } catch (err) {
                throw new Error("Unarchive batch failed: " + String(err));
              }
            },
          },
          {
            button: unarchiveBatchBtn,
            localFeedbackEl: queueActionBannerEl,
            onFinally: async () => {
              await loadItems();
            },
          },
        );
      });

      archiveRetryableFilter.addEventListener("change", async () => {
        await applyQueueControlMutation(
          "Archive Scope",
          () => {
            persistControls();
            resetPreviewOffset();
            clearPreviewContinuation();
            clearPreviewOutput();
          },
          { refresh_worker_stats: true },
        );
      });

      unarchiveModeFilter.addEventListener("change", () => {
        void applyQueueControlMutation("Unarchive Mode", () => {
          persistControls();
          resetPreviewOffset();
          clearPreviewContinuation();
          clearPreviewOutput();
        });
      });

      batchLimitInput.addEventListener("change", () => {
        void applyQueueControlMutation("Batch Limit", () => {
          batchLimitInput.value = String(normalizedBatchLimit());
          persistControls();
          resetPreviewOffset();
          clearPreviewContinuation();
          clearPreviewOutput();
        });
      });

      previewOffsetInput.addEventListener("change", () => {
        void applyQueueControlMutation("Preview Offset", () => {
          previewOffsetInput.value = String(normalizedPreviewOffset());
          persistControls();
          clearPreviewContinuation();
          clearPreviewOutput();
        });
      });

      queryInput.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter") return;
        await applyListContextAndReload("Search");
      });

      queryInput.addEventListener("input", () => {
        persistControls();
        resetPreviewOffset();
        clearPreviewContinuation();
        clearPreviewOutput();
      });

      if (focusChipsEl) {
        focusChipsEl.querySelectorAll("[data-focus]").forEach((button) => {
          button.addEventListener("click", async () => {
            const focus = button.getAttribute("data-focus") || "all";
            await applyListContextAndReload("Focus: " + focus, {
              button,
              mutate: () => {
                statusFilter.value = statusByFocusChip(focus);
              },
            });
          });
        });
      }

      detailFocusModeBtn?.addEventListener("click", () => {
        setDetailAdvancedEnabled(false);
      });

      detailAdvancedModeBtn?.addEventListener("click", () => {
        setDetailAdvancedEnabled(true);
      });

      statusFilter.addEventListener("change", async () => {
        await applyListContextAndReload("Status Filter");
      });

      retryableFilter.addEventListener("change", async () => {
        await applyListContextAndReload("Retryable Filter");
      });

      failureStepFilter.addEventListener("change", async () => {
        await applyListContextAndReload("Failure Step Filter");
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

      document.addEventListener("keydown", (event) => {
        if (event.defaultPrevented) return;
        const target = event.target;
        if (target instanceof HTMLElement) {
          const tag = target.tagName.toLowerCase();
          if (tag === "input" || tag === "textarea" || target.isContentEditable) {
            return;
          }
        }
        if (event.key === "/") {
          event.preventDefault();
          queryInput.focus();
          queryInput.select();
          return;
        }
        if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          setDetailAdvancedEnabled(false);
          return;
        }
        if (event.key.toLowerCase() === "a") {
          event.preventDefault();
          setDetailAdvancedEnabled(true);
          return;
        }
        if (event.key.toLowerCase() === "r") {
          event.preventDefault();
          loadItems().catch((err) => {
            errorEl.textContent = String(err);
          });
        }
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
