# Read→Do API 契约（MVP）
Location: docs/contracts/api.md  
Version: 0.1 (MVP)  
Last Updated: 2026-02-13

> 本文件定义 Read→Do 的 API 合约。  
> 目标：让 Capture / Orchestrator / Experience 可以独立演进，同时保持状态机一致性与可回归性。  
> 任何 API 变更必须同步更新：state-machine.md、schemas、evals。

---

## 0. 基本约定

### 0.1 Base URL
MVP 推荐本地服务：
- `http://localhost:<port>/api`

### 0.2 内容类型
- Request/Response: `application/json; charset=utf-8`

### 0.3 时间格式
- ISO 8601（UTC 或本地明确标识）

### 0.4 幂等
所有可重复提交的写操作支持幂等键：
- `Idempotency-Key: <uuid>`（header）
- 或在 body 中提供对应的 `*_id` 字段（见各接口）

服务端应对同一幂等键返回相同语义结果（至少 item_id 一致），避免重复写入与重复入队。

---

## 1. 领域对象（API 视角）

### 1.1 Item（API DTO）
```json
{
  "id": "itm_...",
  "url": "https://...",
  "title": "....",
  "domain": "example.com",
  "source_type": "web",
  "intent_text": "Because ...",
  "status": "READY",
  "priority": "WORTH_IT",
  "match_score": 72.5,
  "created_at": "2026-02-13T10:00:00Z",
  "updated_at": "2026-02-13T10:03:10Z"
}
````

### 1.2 Artifact（API DTO）

Artifacts payload 必须满足 `docs/contracts/schemas/*.schema.json`。

```json
{
  "artifact_type": "summary",
  "version": 2,
  "created_by": "system",
  "created_at": "2026-02-13T10:02:00Z",
  "meta": {
    "run_id": "run_...",
    "engine_version": "0.1.0",
    "template_version": "summary.engineer.v1",
    "model_id": "..."
  },
  "payload": { }
}
```

---

## 2. 错误响应规范

### 2.1 错误格式

```json
{
  "error": {
    "code": "PROCESSING_IN_PROGRESS",
    "message": "Item is currently processing. Try again later.",
    "details": {
      "item_id": "itm_..."
    }
  }
}
```

### 2.2 常用 HTTP 状态

* `400` 参数错误（VALIDATION_ERROR）
* `404` 资源不存在（NOT_FOUND）
* `409` 状态冲突（STATE_CONFLICT / PROCESSING_IN_PROGRESS）
* `429` 频率限制（RATE_LIMITED，可选）
* `500` 内部错误（INTERNAL_ERROR）

### 2.3 关键 error.code（MVP）

* VALIDATION_ERROR
* NOT_FOUND
* STATE_CONFLICT
* PROCESSING_IN_PROGRESS
* EXPORT_NOT_ALLOWED
* PROCESS_NOT_ALLOWED
* RETRY_LIMIT_REACHED
* ARCHIVE_NOT_ALLOWED
* INTERNAL_ERROR

> Pipeline 失败原因不通过 API 错误码表达，而通过 item.status=FAILED_* + failure 字段暴露。

---

## 3. API 列表（MVP）

* POST `/capture`
* GET  `/system/worker`（队列与状态统计）
* POST `/system/worker/run-once`（手动执行一次 worker）
* POST `/items/retry-failed`（批量重试 FAILED_EXTRACTION/FAILED_AI）
* POST `/items/archive-failed`（批量归档失败项）
* POST `/items/unarchive-batch`（批量取消归档）
* GET  `/items`
* GET  `/items/{id}`
* POST `/items/{id}/intent`（intent 编辑）
* POST `/items/{id}/artifacts/{artifact_type}`（user edit -> new version）
* GET  `/items/{id}/artifacts/{artifact_type}/compare`（版本差异）
* POST `/items/{id}/process`
* POST `/items/{id}/export`
* POST `/items/{id}/archive`
* POST `/items/{id}/unarchive`

---

## 4. POST /capture（Chrome Extension 使用）

### 4.1 目的

创建 Item（CAPTURED），写入 intent，触发后续 enqueue（系统自动）。

### 4.2 状态机

* 创建后状态：`CAPTURED`
* 后续：系统应尽快转入 `QUEUED`

### 4.3 Request

Headers:

* `Idempotency-Key: <uuid>`（推荐）
  Body:

```json
{
  "capture_id": "cap_9d3a... (optional, for idempotency)",
  "url": "https://...",
  "title": "Page title",
  "domain": "example.com",
  "source_type": "web",
  "intent_text": "Because I want to ..."
}
```

约束：

* url 必填
* intent_text 必填（MVP）
* source_type 枚举：`web | youtube | newsletter | other`（MVP 可先 web/youtube）
* 若同时提供 `Idempotency-Key` 与 `capture_id`，两者必须一致；不一致返回 `400 VALIDATION_ERROR`

### 4.4 Response 201

```json
{
  "item": {
    "id": "itm_...",
    "status": "CAPTURED",
    "created_at": "..."
  },
  "idempotent_replay": false
}
```

> 当重复使用同一 `Idempotency-Key`（或 `capture_id`）提交 capture 时，服务端返回既有 item，`idempotent_replay=true`，且不重复创建新 item。

### 4.5 错误

* 400 VALIDATION_ERROR

---

## 4.6 GET /system/worker（Worker/Queue 可观测）

### 4.6.1 目的

提供本地 worker 队列与 item 状态统计，便于 UI 显示“处理中/排队中”概览。

### 4.6.2 Response 200

```json
{
  "queue": {
    "QUEUED": 3,
    "LEASED": 1,
    "DONE": 20,
    "FAILED": 2
  },
  "items": {
    "CAPTURED": 1,
    "PROCESSING": 2,
    "READY": 7
  },
  "retry": {
    "max_attempts": 3,
    "retryable_items": 2,
    "non_retryable_items": 1
  },
  "failure_steps": {
    "extract": 1,
    "pipeline": 0,
    "export": 2
  },
  "worker": {
    "interval_ms": 1500,
    "active": true
  },
  "timestamp": "2026-02-13T12:00:00Z"
}
```

---

## 4.7 POST /system/worker/run-once（调试/本地手动推进）

### 4.7.1 目的

手动触发一次 worker 轮询（领取一个 QUEUED job 并执行），主要用于本地调试与演示。

### 4.7.2 Response 200

```json
{
  "ok": true,
  "queue": {
    "QUEUED": 0,
    "DONE": 12
  },
  "timestamp": "2026-02-13T12:00:00Z"
}
```

---

## 4.8 POST /items/retry-failed（批量重试失败项）

### 4.8.1 目的

批量扫描失败项并将 `FAILED_EXTRACTION/FAILED_AI` 中可重试（`failure.retryable !== false`）的条目重新入队为 `QUEUED`。

### 4.8.2 Request

```json
{
  "limit": 20,
  "offset": 0,
  "dry_run": false,
  "failure_step": "extract",
  "q": "optional keyword"
}
```

约束：

* `limit` 可选，范围建议 `1..200`，默认 20
* `offset` 可选，默认 0，用于分页扫描批量候选（负值按 0 处理）
* `dry_run=true` 时仅返回预估结果，不会修改 item 状态或创建新 job
* `failure_step` 可选：`extract | pipeline | export`（用于限制扫描范围）
* `q` 可选，按 `title/domain/intent_text/url` 模糊过滤失败候选
* `FAILED_EXPORT` 当前不会被该接口处理（计入 `skipped_unsupported_status`）
* 响应中的 `scanned_total` 为匹配筛选条件的总量（未截断前），`scan_truncated=true` 表示受到 `limit` 截断

### 4.8.3 Response 200

```json
{
  "requested_limit": 20,
  "requested_offset": 0,
  "dry_run": false,
  "failure_step_filter": "extract",
  "q_filter": "optional keyword",
  "scanned": 5,
  "scanned_total": 8,
  "scan_truncated": true,
  "next_offset": 5,
  "queued": 3,
  "queued_item_ids": ["itm_a", "itm_b", "itm_c"],
  "eligible_pipeline": 3,
  "eligible_pipeline_item_ids": ["itm_a", "itm_b", "itm_c"],
  "eligible_export": 1,
  "eligible_export_item_ids": ["itm_d"],
  "skipped_non_retryable": 1,
  "skipped_unsupported_status": 1,
  "timestamp": "2026-02-13T12:00:00Z"
}
```

---

## 4.9 POST /items/archive-failed（批量归档失败项）

### 4.9.1 目的

批量扫描失败项并执行归档，默认归档 **不可重试**（`retryable=false`）失败项，用于快速清理已达上限的噪音告警。

### 4.9.2 Request

```json
{
  "limit": 50,
  "offset": 0,
  "dry_run": false,
  "retryable": false,
  "failure_step": "extract",
  "q": "optional keyword"
}
```

约束：

* `limit` 可选，范围建议 `1..200`，默认 50
* `offset` 可选，默认 0，用于分页扫描批量候选（负值按 0 处理）
* `dry_run=true` 时仅返回预估结果，不会修改 item 状态
* `retryable` 可选：`true | false | null | "all"`（默认 `false`，即仅归档已达重试上限项）
* `failure_step` 可选：`extract | pipeline | export`
* `q` 可选，按 `title/domain/intent_text/url` 模糊过滤失败候选
* 响应中的 `scanned_total` 为匹配筛选条件的总量（未截断前），`scan_truncated=true` 表示受到 `limit` 截断

### 4.9.3 Response 200

```json
{
  "requested_limit": 50,
  "requested_offset": 0,
  "dry_run": false,
  "retryable_filter": false,
  "failure_step_filter": "extract",
  "q_filter": "optional keyword",
  "scanned": 8,
  "scanned_total": 12,
  "scan_truncated": true,
  "next_offset": 8,
  "eligible": 3,
  "eligible_item_ids": ["itm_a", "itm_b", "itm_c"],
  "archived": 3,
  "archived_item_ids": ["itm_a", "itm_b", "itm_c"],
  "skipped_retryable_mismatch": 5,
  "timestamp": "2026-02-13T12:00:00Z"
}
```

---

## 4.10 POST /items/unarchive-batch（批量取消归档）

### 4.10.1 目的

批量处理 `ARCHIVED` 项，恢复为 `READY` 或 `QUEUED`：

* `regenerate=false`（smart）：若 artifacts 已满足 READY gate，则恢复 `READY`；否则进入 `QUEUED`
* `regenerate=true`：一律恢复 `QUEUED` 并创建 process job

### 4.10.2 Request

```json
{
  "limit": 50,
  "offset": 0,
  "dry_run": false,
  "regenerate": false,
  "q": "optional keyword"
}
```

约束：

* `limit` 可选，范围建议 `1..200`，默认 50
* `offset` 可选，默认 0，用于分页扫描 archived 候选（负值按 0 处理）
* `dry_run=true` 时仅返回预估结果，不会修改 item 状态
* `regenerate=true` 时不走 READY 快速恢复，统一入队重跑
* `q` 可选，按 `title/domain/intent_text/url` 模糊过滤 archived 候选
* 响应中的 `scanned_total` 为匹配筛选条件的总量（未截断前），`scan_truncated=true` 表示受到 `limit` 截断

### 4.10.3 Response 200

```json
{
  "requested_limit": 50,
  "requested_offset": 0,
  "dry_run": false,
  "regenerate": false,
  "q_filter": "optional keyword",
  "scanned": 6,
  "scanned_total": 9,
  "scan_truncated": true,
  "next_offset": 6,
  "eligible": 6,
  "eligible_ready": 4,
  "eligible_ready_item_ids": ["itm_r1", "itm_r2"],
  "eligible_queued": 2,
  "eligible_queued_item_ids": ["itm_q1", "itm_q2"],
  "unarchived": 6,
  "unarchived_item_ids": ["itm_r1", "itm_r2", "itm_q1", "itm_q2"],
  "queued_jobs_created": 2,
  "timestamp": "2026-02-13T12:00:00Z"
}
```

---

## 5. GET /items（Inbox 列表）

### 5.1 目的

按“决策队列”列出 items，支持筛选/排序/分页。

### 5.2 Query Params

* `status`（可重复）：CAPTURED, QUEUED, PROCESSING, READY, FAILED_*, SHIPPED, ARCHIVED
* `priority`（可重复）：READ_NEXT, WORTH_IT, IF_TIME, SKIP
* `source_type`（可重复）：web, youtube, newsletter, other
* `retryable`：`true | false`（仅对 FAILED_* 生效；用于筛选可重试/不可重试失败项）
* `failure_step`：`extract | pipeline | export`（仅对 FAILED_* 生效；按失败阶段筛选）
* `q`：搜索（MVP 可仅 title/domain/intent_text）
* `sort`：`priority_score_desc | created_desc | updated_desc`

  * 默认：`priority_score_desc`
* `cursor`：分页游标（可选）
* `limit`：默认 20，范围 `1..100`；非法值回退为默认值 20

> `retryable` / `failure_step` 过滤在返回前生效（不会因为默认排序与 limit 截断而漏掉匹配项）。

### 5.3 Response 200

```json
{
  "items": [
    {
      "id": "itm_...",
      "url": "https://...",
      "title": "...",
      "domain": "example.com",
      "source_type": "web",
      "intent_text": "Because ...",
      "status": "READY",
      "priority": "READ_NEXT",
      "match_score": 88.8,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "next_cursor": "cur_... (optional)"
}
```

> 列表可不返回完整 artifacts，只返回用于队列决策的摘要字段（priority/match_score/intent/status）。

---

## 6. GET /items/{id}（详情）

### 6.1 目的

获取 item + 最新 artifacts（或指定版本）。

### 6.2 Query Params

* `artifact_versions`（可选，json 字符串）：指定要取的版本（按类型）
  - 示例：`?artifact_versions={"todos":1,"card":2}`（URL 编码后传输）
* `include_history`：true/false（MVP 默认 false）

### 6.3 Response 200

```json
{
  "item": {
    "id": "itm_...",
    "url": "https://...",
    "title": "...",
    "domain": "...",
    "source_type": "web",
    "intent_text": "Because ...",
    "status": "READY",
    "created_at": "...",
    "updated_at": "..."
  },
  "artifacts": {
    "summary": { "artifact_type": "summary", "version": 1, "created_by": "system", "meta": {}, "payload": {} },
    "score":   { "artifact_type": "score",   "version": 1, "created_by": "system", "meta": {}, "payload": {} },
    "todos":   { "artifact_type": "todos",   "version": 1, "created_by": "system", "meta": {}, "payload": {} },
    "card":    { "artifact_type": "card",    "version": 1, "created_by": "system", "meta": {}, "payload": {} },
    "export":  { "artifact_type": "export",  "version": 1, "created_by": "system", "meta": {}, "payload": {} }
  },
  "artifact_versions_selected": {
    "todos": 1
  },
  "artifact_history": {
    "summary": [
      { "artifact_type": "summary", "version": 2, "created_by": "user", "meta": {}, "payload": {} },
      { "artifact_type": "summary", "version": 1, "created_by": "system", "meta": {}, "payload": {} }
    ]
  },
  "failure": {
    "failed_step": "summarize",
    "error_code": "AI_TIMEOUT",
    "message": "Generation timed out. Please retry.",
    "retryable": true,
    "retry_attempts": 1,
    "retry_limit": 3
  }
}
```

约束：

* 当 status 非 FAILED_* 时 failure 可省略
* artifacts 缺失允许（例如 PROCESSING 中仅 extraction 已存在）
* `artifact_versions_selected` 回显被接受的版本选择（未提供或解析失败时为空对象）
* 仅当 `include_history=true` 时返回 `artifact_history`

### 6.4 错误

* 404 NOT_FOUND

---

## 6.5 POST /items/{id}/artifacts/{artifact_type}（人工编辑生成新版本）

### 6.5.1 目的

写入人工编辑后的 artifact 新版本（`created_by=user`），不覆盖 system 版本。

### 6.5.2 路径参数

* `artifact_type`：`summary | score | todos | card`（MVP）

### 6.5.3 Request

```json
{
  "payload": { },
  "template_version": "user.todos.edit.v1"
}
```

约束：

* payload 必须通过对应 schema 校验
* 未提供 template_version 时，服务端可自动生成默认值（如 `user.<type>.edit.v1`）

### 6.5.4 Response 201

```json
{
  "item": {
    "id": "itm_...",
    "status": "READY",
    "updated_at": "..."
  },
  "artifact": {
    "artifact_type": "todos",
    "version": 3,
    "created_by": "user",
    "meta": { },
    "payload": { }
  }
}
```

### 6.5.5 错误

* 400 VALIDATION_ERROR（artifact_type 非法或 payload 不合法）
* 404 NOT_FOUND

---

## 6.6 POST /items/{id}/intent（编辑 intent）

### 6.6.1 目的

更新 item.intent_text；可选触发 regenerate（入队）。

### 6.6.2 Request

```json
{
  "intent_text": "Because ...",
  "regenerate": false
}
```

约束：

* intent_text 必填，且长度 >= 3
* regenerate=true 时，item 应转入 QUEUED 并触发处理任务
* PROCESSING 状态下不允许更新（返回 409 PROCESSING_IN_PROGRESS）

### 6.6.3 Response 200

```json
{
  "item": {
    "id": "itm_...",
    "intent_text": "Because ...",
    "status": "QUEUED",
    "updated_at": "..."
  }
}
```

### 6.6.4 错误

* 400 VALIDATION_ERROR
* 404 NOT_FOUND
* 409 PROCESSING_IN_PROGRESS

---

## 6.7 GET /items/{id}/artifacts/{artifact_type}/compare（版本差异）

### 6.7.1 目的

对比同一 item 的同类型 artifact 两个版本，返回结构化差异摘要。

### 6.7.2 Query Params

* `base_version`（必填，int>=1）
* `target_version`（必填，int>=1）

### 6.7.3 Response 200

```json
{
  "item_id": "itm_...",
  "artifact_type": "todos",
  "base": { "version": 1, "created_by": "system", "payload": {} },
  "target": { "version": 2, "created_by": "user", "payload": {} },
  "summary": {
    "added_paths": [],
    "removed_paths": [],
    "changed_paths": ["todos[0].title"],
    "changed_line_count": 3,
    "compared_line_count": 22
  }
}
```

### 6.7.4 错误

* 400 VALIDATION_ERROR（版本参数非法）
* 404 NOT_FOUND（item 或版本不存在）

---

## 7. POST /items/{id}/process（处理 / 重试 / 再生成）

### 7.1 目的

触发 pipeline 执行（首次处理、失败重试、READY 再生成）。

### 7.2 状态机约束

允许 From：

* CAPTURED
* FAILED_*
* READY（regenerate）
* ARCHIVED（可选：unarchive_then_regenerate）

不允许 From：

* PROCESSING（返回 409 PROCESSING_IN_PROGRESS）

To：

* 一般进入 QUEUED（随后 worker → PROCESSING）

### 7.3 Request

Headers:

* `Idempotency-Key: <uuid>`（推荐）
  Body:

```json
{
  "process_request_id": "prc_... (optional, for idempotency)",
  "mode": "PROCESS",
  "options": {
    "template_profile": "engineer",
    "force_regenerate": false
  }
}
```

mode 枚举：

* `PROCESS`：正常处理（CAPTURED/FAILED_*）
* `RETRY`：失败重试（FAILED_*）
* `REGENERATE`：重新生成新版本 artifacts（READY/ARCHIVED）

> RETRY 会读取 item.failure.retryable；当达到重试上限时返回 `409 RETRY_LIMIT_REACHED`。
> 若同时提供 `Idempotency-Key` 与 `process_request_id`，两者必须一致；不一致返回 `400 VALIDATION_ERROR`。

options（MVP 可选）：

* template_profile：engineer/creator/manager
* force_regenerate：true/false（若 true 可忽略缓存）

### 7.4 Response 202

```json
{
  "item": {
    "id": "itm_...",
    "status": "QUEUED",
    "updated_at": "..."
  },
  "idempotent_replay": false
}
```

> 当使用相同 `Idempotency-Key`（或 `process_request_id`）重复提交同一 item+mode 请求时，服务端可返回 `202` 且 `idempotent_replay=true`，表示命中幂等重放而不是新建任务。

### 7.5 错误

* 404 NOT_FOUND
* 409 PROCESSING_IN_PROGRESS
* 409 STATE_CONFLICT（不允许的状态，或并发条件下状态在入队前发生变化）
* 409 RETRY_LIMIT_REACHED（失败重试已达上限）

---

## 8. POST /items/{id}/export（导出卡片）

### 8.1 目的

将 card.render_spec 渲染为 PNG/MD/caption，写入 export artifact，并进入 SHIPPED。

### 8.2 状态机约束

允许 From：READY, SHIPPED, FAILED_EXPORT
不允许 From：CAPTURED, QUEUED, PROCESSING, FAILED_EXTRACTION, FAILED_AI, ARCHIVED

成功 To：SHIPPED
失败：FAILED_EXPORT（或保持 READY 并记录 failure；MVP 推荐 FAILED_EXPORT）

> 当 `failure.retryable=false`（达到导出重试上限）时，再次调用 export 返回 `409 RETRY_LIMIT_REACHED`。
> 当重复使用同一 `export_key`（或同一幂等键语义）请求同一 item 导出时，应返回历史已存在的导出结果，不重复创建新版本 artifact。

### 8.3 Request

Headers:

* `Idempotency-Key: <uuid>`（必需，或提供 export_key）
  Body:

```json
{
  "export_key": "exp_... (recommended stable key)",
  "formats": ["png", "md", "caption"],
  "card_version": 1,
  "options": {
    "theme": "LIGHT"
  }
}
```

### 8.4 Response 200

```json
{
  "item": { "id": "itm_...", "status": "SHIPPED", "updated_at": "..." },
  "export": {
    "artifact_type": "export",
    "version": 1,
    "payload": {
      "files": [
        { "type": "png", "path": "exports/itm_.../card_v1.png" },
        { "type": "md", "path": "exports/itm_.../card_v1.md" },
        { "type": "caption", "path": "exports/itm_.../caption_v1.txt" }
      ]
    }
  },
  "idempotent_replay": false
}
```

> `path` 为本地文件路径（MVP）；未来可扩展为 blob/url。
> 若命中历史 `export_key` 重放，则 `idempotent_replay=true` 且返回历史导出 payload，不创建新版本。

### 8.5 错误

* 404 NOT_FOUND
* 409 EXPORT_NOT_ALLOWED
* 409 STATE_CONFLICT
* 409 RETRY_LIMIT_REACHED（导出失败重试已达上限）
* 500 EXPORT_RENDER_FAILED（例如仅请求 png 且渲染失败；item 将进入 FAILED_EXPORT）

---

## 9. POST /items/{id}/archive（归档）

### 9.1 状态机约束

允许 From：CAPTURED, QUEUED, READY, FAILED_*, SHIPPED
不允许 From：PROCESSING（MVP）

To：ARCHIVED

### 9.2 Request

Body:

```json
{
  "reason": "USER_ARCHIVE"
}
```

reason 枚举（MVP 建议）：

* USER_ARCHIVE
* SYSTEM_SKIP
* FAILURE_ARCHIVE

### 9.3 Response 200

```json
{
  "item": { "id": "itm_...", "status": "ARCHIVED", "updated_at": "..." }
}
```

### 9.4 错误

* 409 ARCHIVE_NOT_ALLOWED
* 409 STATE_CONFLICT（并发条件下状态在归档前发生变化）

---

## 10. POST /items/{id}/unarchive（恢复）

### 10.1 状态机约束

允许 From：ARCHIVED

默认 To：

* 若 artifacts 齐备 → READY
* 若 artifacts 不齐或请求 regenerate → QUEUED

### 10.2 Request

Body:

```json
{
  "regenerate": false
}
```

### 10.3 Response 200

```json
{
  "item": { "id": "itm_...", "status": "READY", "updated_at": "..." }
}
```

### 10.4 错误

* 404 NOT_FOUND
* 409 STATE_CONFLICT（非 ARCHIVED 状态，或并发条件下状态在恢复前发生变化）

---

## 11. 排序规则（priority_score_desc）

用于 Inbox 默认排序，目标是“决策队列”体验：

1. status 权重（建议）：

   * READY 优先显示
   * PROCESSING/QUEUED 次之
   * FAILED_* 需要可见但不抢占顶部（可单独筛选/提示）
2. 在 READY 内：

   * priority READ_NEXT > WORTH_IT > IF_TIME > SKIP
   * 同 priority 内按 match_score desc
   * 再按 created_at desc

---

## 12. 版本与兼容性策略

* 任何 artifact schema 破坏性变更必须升级 schema 版本与 template_version
* API 破坏性变更必须升级 `Version` 并提供迁移说明
* MVP 阶段优先保持快速迭代，但不得破坏：状态机一致性、schema 校验、eval 可运行

---
