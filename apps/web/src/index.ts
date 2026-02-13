import { createServer } from "node:http";

const port = Number(process.env.WEB_PORT ?? 5173);
const apiBase = process.env.API_BASE_URL ?? "http://localhost:8787/api";

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
      .group-title { margin: 12px 0 6px; font-size: 13px; color: #374151; text-transform: uppercase; letter-spacing: 0.04em; }
      pre { background: #0b1020; color: #d1d5db; padding: 8px; border-radius: 8px; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
      .empty { padding: 16px; border: 1px dashed #d1d5db; border-radius: 8px; color: #6b7280; text-align: center; }
      .error { color: #b91c1c; font-size: 13px; }
      @media (max-width: 1100px) { main { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Read→Do Inbox</h1>
      <div class="controls">
        <span class="muted">API: ${apiBase}</span>
        <button class="primary" id="refreshBtn">Refresh</button>
      </div>
    </header>
    <main>
      <section>
        <h2>Decision Queue</h2>
        <div id="error" class="error"></div>
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
      const refreshBtn = document.getElementById("refreshBtn");

      let allItems = [];
      let selectedId = null;

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
          throw new Error(message);
        }
        return data;
      }

      function buttonsFor(item) {
        const ops = [];
        ops.push({ label: "Detail", action: () => selectItem(item.id) });
        if (item.status === "READY") {
          ops.push({ label: "Regenerate", action: () => processItem(item.id, "REGENERATE") });
        } else if (["FAILED_EXTRACTION", "FAILED_AI", "FAILED_EXPORT"].includes(item.status)) {
          ops.push({ label: "Retry", action: () => processItem(item.id, "RETRY") });
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
        card.innerHTML = \`
          <div class="item-head">
            <span class="status">\${item.status}</span>
            <span class="muted">\${item.priority || "N/A"} · \${score}</span>
          </div>
          <div class="intent">\${item.intent_text}</div>
          <div>\${title}</div>
          <div class="muted">\${item.domain || ""}</div>
          <div class="actions"></div>
        \`;
        const actionEl = card.querySelector(".actions");
        const ops = buttonsFor(item);
        for (const op of ops) {
          const btn = document.createElement("button");
          btn.textContent = op.label;
          btn.addEventListener("click", async () => {
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
        const payload = await request("/items?sort=priority_score_desc&limit=100");
        allItems = payload.items || [];
        renderInbox(allItems);
        if (selectedId) {
          await selectItem(selectedId);
        }
      }

      async function selectItem(id) {
        selectedId = id;
        const detail = await request("/items/" + id);
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
          <h3>Failure</h3>
          <pre>\${JSON.stringify(detail.failure || null, null, 2)}</pre>
        \`;
        detailEl.appendChild(wrap);
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
        await request("/items/" + id + "/export", {
          method: "POST",
          body: JSON.stringify({
            export_key: "web_" + crypto.randomUUID(),
            formats: ["md", "caption"]
          }),
          headers: { "Idempotency-Key": crypto.randomUUID() }
        });
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
          await loadItems();
        } catch (err) {
          errorEl.textContent = String(err);
        }
      });

      loadItems().catch((err) => {
        errorEl.textContent = String(err);
      });
    </script>
  </body>
</html>`;

createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`Web shell running on http://localhost:${port}`);
});
