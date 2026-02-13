# Read→Do (readdo)
Save links less. Ship outputs more.

Read→Do is an AI-native “Read → Decide → Do → Ship” system:
- Capture links with a one-line intent
- Auto-generate structured artifacts (Summary / Score / Todos / Card)
- Export shareable outputs (PNG/MD/caption)
- Local-first by default (SQLite)

## What’s inside
- `apps/api`        Local backend (API + orchestrator + worker)
- `apps/web`        Web app (Inbox / Detail / Status Actions)
- `apps/extension`  Chrome extension (one-click capture)
- `packages/core`   Core engine (summary/score/todos/card generation)
- `packages/contracts` Runtime schema validators (AJV)
- `packages/eval-runner` Eval CLI (`pnpm eval`)
- `docs/contracts/schemas` JSON schemas (source of truth)
- `docs/templates`  Prompt templates (versioned)
- `docs/evals`      Regression cases + rubric + reports
- `docs`            PRD / System Design / Tech Spec / Execution Plan

---

## Quick start (MVP)
> This repo is designed to run locally first.

### 1) Install
```bash
pnpm install
````

### 2) Start API

```bash
pnpm dev:api
```

Default:

* API: `http://localhost:8787/api` (example)

> If you use a different port, update the web app + extension config accordingly.

### 3) Start Web

```bash
pnpm dev:web
```

Open `http://localhost:5173` in your browser.

Web Inbox 支持 `Retryable` 下拉筛选，可快速查看可重试失败项与已达上限失败项。
Web Inbox 还支持 `Failure Step` 下拉筛选（extract/pipeline/export），用于聚焦不同失败阶段。
点击 `Preview Retry` / `Retry Failed` 时会带上当前 Failure Step 过滤条件。
若输入搜索关键词，Retry 预览/执行也会仅作用于匹配关键词的失败项。
`Retry Failed` 以服务端批量扫描结果为准，不依赖当前列表首屏加载的条目数量。
点击 `Retry Failed` 时会先执行同参数 dry-run 预检并弹出确认，再进行真实执行。
若批量导出重试命中历史幂等重放，执行摘要会显示 `export_replayed` 计数。
点击 `Preview Archive` 可预览将被批量归档的 blocked 失败项 ID 列表。
`Archive Scope` 支持 blocked / retryable / all failed 三种归档范围。
点击 `Archive Failed` 可批量归档匹配范围的失败项（先预览再确认执行）。
若输入搜索关键词，Archive 预览/执行也会仅作用于匹配关键词的失败项。
点击 `Preview Unarchive` / `Unarchive Archived` 可批量恢复归档项，并支持 smart/regenerate 模式。
若输入搜索关键词，Unarchive 预览/执行会仅作用于匹配关键词的 archived 项。
批量预览会显示 `scanned/scanned_total` 与 `truncated`，用于识别是否被 limit 截断。
可通过 `Batch Limit` 输入框控制每次批量预览/执行扫描的最大条数（1..200）。
当 `truncated=yes` 时，可根据返回的 `next_offset` 继续翻页预览下一批候选。
UI 提供 `Preview Next` 按钮，可直接基于 `next_offset` 连续翻页预览。
也可通过 `Preview Offset` 输入框从任意 offset 起始预览（例如跳到第 200 条后再看）。
批量执行（Retry/Archive/Unarchive）会使用当前 `Preview Offset`，保证“预览页即执行页”。
批量执行会在预览后使用服务端回写的 `requested_offset` 再次发起请求，确保执行页与最终预览页严格一致。
`Clear Filters` 可快速清空 q/status/retryable/failure step 四类列表筛选，不影响 Batch Limit、Archive Scope、Unarchive Mode、Auto refresh。
`Reset Controls` 可一键恢复筛选/批量参数默认值，并关闭自动刷新。
单条行内操作按钮在请求进行中会临时禁用，避免重复点击导致的重复提交。
筛选条件、Batch Limit、Preview Offset、Auto refresh 会在浏览器本地持久化，刷新页面后自动恢复。
当修改搜索词、切换筛选条件或调整批量参数时，旧的预览结果会自动清空，并将 `Preview Offset` 归零，避免跨上下文误读。

### 4) Load Chrome Extension

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `apps/extension`
4. Pin the extension to the toolbar

### 5) Capture a link

* Open any webpage
* Click the extension
* Enter `Why save this?` (intent)
* Save → Open Inbox

> Extension 会基于“规范化 URL（去 hash、去常见跟踪参数、移除默认端口、移除 hostname 尾随点、移除 URL 凭据、稳定排序 query）+ 规范化 intent（合并多空白）”生成稳定幂等键；重复点击同一条输入不会重复创建 item。`stableCaptureKey` 内部也会做 URL 规范化，避免调用方遗漏预处理。扩展提交给 API 的 `url/domain/source_type` 也基于同一 canonical URL，减少存储形态漂移。
> API 在 capture 入库前也会做 URL 规范化（移除 credentials/hash/常见跟踪参数、移除默认端口和 hostname 尾点、稳定排序 query），用于统一存储形态。
> 即使调用方未显式提供 `Idempotency-Key/capture_id`，API 也会基于“规范化 url + 规范化 intent_text”推导稳定 capture key（与 extension `stableCaptureKey` 格式对齐），减少重复 capture。
> 对 `extcap_` 形态的 capture 幂等键，API 会按大小写不敏感处理，减少跨调用方大小写差异导致的重复请求。
> 当 `Idempotency-Key` 被代理合并为逗号分隔值（含前导空片段）时，API 会按首个非空片段解析，确保 capture/process/export 的幂等语义一致。
> `capture_id / process_request_id / export_key` 若提供，必须是字符串；否则 API 返回 `400 VALIDATION_ERROR`。
> 为避免无效请求，扩展仅允许在 `http/https` 页面发起捕获（`chrome://`、`file://` 等会在前端直接提示不支持）。
> API 层仍允许 `data:` URL（主要用于本地测试与回归用例），因此自动化测试中会看到 `data:text/plain,...` 的捕获样例。

---

## Run evals (quality gate)

Evals ensure schema + key behaviors don’t drift.

```bash
pnpm eval
```

Advanced examples:

```bash
# Use creator profile and only block on P0
pnpm eval -- --profile creator --fail-on P0

# Custom case glob and output report path
pnpm eval -- --cases "docs/evals/cases/case_00*.json" --out "docs/evals/reports/custom.json"
```

Quality gates:

* P0 must be 100% passing
* P1 must be 100% passing (unless you explicitly relax it)
* P2 allows small slack

See:

* `docs/05-Quality-Evals.md`
* `docs/evals/rubric.md`
* `docs/evals/cases/*`

---

## Contracts & governance

Artifacts are the source of truth. Any AI output must:

1. Match schema in `docs/contracts/schemas/*`
2. Carry required meta fields (run_id / engine_version / template_version / created_by / created_at)
3. Pass eval gates when templates/engine change

Key docs:

* `docs/contracts/state-machine.md`
* `docs/contracts/api.md`
* `docs/contracts/artifact-meta.md`

> 兼容性说明：若历史数据中存在损坏 JSON（如 legacy failure/artifact payload/meta），API 读取接口会尽量降级为“将损坏/非对象 failure 视为缺失 / 跳过损坏/非对象 payload 版本 / 将损坏 meta 降级为 {}”而非直接 500。

---

## Export formats

MVP export targets:

* Markdown + caption（已落地）
* PNG（优先尝试，失败可降级）

See `docs/contracts/schemas/card.schema.json` for `render_spec`.

> Export supports `formats: ["png","md","caption"]`.  
> 非法 `formats`（如 `pdf`）会直接返回 `400 VALIDATION_ERROR`，且不会把 item 写成 `FAILED_EXPORT`。  
> 可选 `card_version`（整数 >=1）可指定使用某一版本 card 导出；不存在返回 404，损坏版本返回 `DATA_CORRUPTION`。
> If png rendering fails and only png is requested, item will enter `FAILED_EXPORT`.
> Web Detail 的 Export Records 支持 `Copy Path` 与 `Open`（通过 `/exports/...` 直接预览文件）。
> 失败重试遵循上限策略（默认 3 次），达到上限后会返回 `RETRY_LIMIT_REACHED`。
> 对同一 item 重复使用同一 `export_key` 会命中幂等重放（不新增 export 版本）；若此前是 `FAILED_EXPORT`，重放命中后会回到 `SHIPPED` 并清理 failure。
> 当 `FAILED_EXPORT` 已达到重试上限时，新导出请求会被阻断；但若使用历史已存在的同一 `export_key`，仍可命中重放返回历史结果。

---

## API quick checks

```bash
# Worker queue/lease visibility
curl "http://localhost:8787/api/system/worker"

# Filter inbox by status and search keyword
curl "http://localhost:8787/api/items?status=READY&q=checklist"

# List non-retryable failed items
curl "http://localhost:8787/api/items?status=FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT&retryable=false"

# Batch retry retryable FAILED_EXTRACTION/FAILED_AI
curl -X POST "http://localhost:8787/api/items/retry-failed" \
  -H "content-type: application/json" \
  -d '{"limit":20}'

# Dry-run preview for batch retry (no state changes)
curl -X POST "http://localhost:8787/api/items/retry-failed" \
  -H "content-type: application/json" \
  -d '{"limit":20,"offset":0,"dry_run":true,"q":"Fail One"}'

# Dry-run preview for batch archive blocked failed items
curl -X POST "http://localhost:8787/api/items/archive-failed" \
  -H "content-type: application/json" \
  -d '{"limit":20,"offset":0,"dry_run":true,"retryable":false,"q":"Retryable Failure"}'

# Dry-run preview for batch unarchive
curl -X POST "http://localhost:8787/api/items/unarchive-batch" \
  -H "content-type: application/json" \
  -d '{"limit":20,"offset":0,"dry_run":true,"regenerate":false,"q":"AI-native"}'

# Process endpoint idempotent replay (same key can be safely retried)
curl -X POST "http://localhost:8787/api/items/<item_id>/process" \
  -H "content-type: application/json" \
  -H "Idempotency-Key: process-demo-001" \
  -d '{"mode":"REGENERATE"}'
```

---

## Roadmap

* More sources: YouTube transcript, newsletters, PDFs
* More templates: engineer/creator/manager cards
* More exports: Notion/Obsidian/Todoist/Linear
* Desktop shell (Tauri) as a replaceable experience layer

---

## License

TBD
