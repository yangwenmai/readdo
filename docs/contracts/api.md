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

* body 若提供，必须是对象
* body 当前仅支持键：`capture_id`、`url`、`title`、`domain`、`source_type`、`intent_text`
* url 必填
* url / intent_text 必须为字符串；intent_text 必填（MVP）
* title / domain / source_type 若提供，必须为字符串
* 服务端会在入库前移除 URL 中的 `username/password` 与 `#hash`（若有）；对 `http/https` 还会移除 hostname 尾随 `.` 与默认端口（80/443），并移除常见跟踪参数（`utm_* / fbclid / gclid / mc_eid / mkt_tok`），随后对 query 参数按 key/value 稳定排序；非 `http/https`（如 `data:`）不会清理 query 参数，仅移除凭据与 hash
* domain 可选；当 url 为 `http/https` 时，服务端总是以 URL 的 `hostname` 作为 domain（忽略 body 中传入值），并归一化为小写且移除尾随 `.`；非 http/https（如 data）可使用 body domain（同样归一化为小写，移除尾随 `.`）
* source_type 枚举：`web | youtube | newsletter | other`（大小写不敏感，服务端会归一化为小写）；若缺省则服务端会基于 URL `hostname` 推断（hostname 会先做小写归一化并移除尾随 `.`；`youtube.com|youtu.be` 域名命中 -> youtube；`substack.com` 或 newsletter 形态子域命中 -> newsletter；其余 http(s) -> web）
* url 协议白名单：`http | https | data`（如 `ftp://`、`chrome://`、`file://` 应返回 `400 VALIDATION_ERROR`）
* `capture_id` 若提供，必须是非空字符串
* 若同时提供 `Idempotency-Key` 与 `capture_id`，两者必须一致；不一致返回 `400 VALIDATION_ERROR`
* 若 `Idempotency-Key` 被代理合并为逗号分隔值，服务端按“首个非空片段”解析
* `extcap_` 形态的 capture 幂等键会做大小写归一化（视为大小写不敏感），再参与一致性校验与重放匹配
* 若未提供 `Idempotency-Key/capture_id`，服务端会基于“规范化后的 url + 规范化 intent_text（合并空白）”推导稳定 capture key（格式与 extension `stableCaptureKey` 对齐：`extcap_` + 32 位十六进制），用于避免重复创建

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
> 未显式提供幂等键时，若规范化后的 `url + intent_text` 命中服务端推导 key，也会返回 `idempotent_replay=true`。

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

### 4.7.2 Request

约束：

* body 若提供，必须是对象
* 不接受任何 body 字段（传入任意字段返回 `400 VALIDATION_ERROR`）

### 4.7.3 Response 200

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

### 4.7.4 错误

* 400 VALIDATION_ERROR

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

* body 若提供，必须是对象
* body 当前仅支持键：`limit`、`offset`、`dry_run`、`failure_step`、`q`
* `limit` 可选，必须为整数，范围建议 `1..200`，默认 20
* `offset` 可选，必须为整数，默认 0，用于分页扫描批量候选（负值按 0 处理）
* `dry_run` 若提供，必须为 boolean
* `dry_run=true` 时仅返回预估结果，不会修改 item 状态或创建新 job
* `failure_step` 若提供，必须为**非空字符串**，且可选值：`extract | pipeline | export`（用于限制扫描范围；其他值返回 `400 VALIDATION_ERROR`）
* `q` 若提供，必须为字符串；按 `title/domain/intent_text/url` 模糊过滤失败候选
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

* body 若提供，必须是对象
* body 当前仅支持键：`limit`、`offset`、`dry_run`、`retryable`、`failure_step`、`q`
* `limit` 可选，必须为整数，范围建议 `1..200`，默认 50
* `offset` 可选，必须为整数，默认 0，用于分页扫描批量候选（负值按 0 处理）
* `dry_run` 若提供，必须为 boolean
* `dry_run=true` 时仅返回预估结果，不会修改 item 状态
* `retryable` 可选：`true | false | null | "all"`（默认 `false`，即仅归档已达重试上限项；`true/false` 仅接受布尔值，字符串仅允许 `"all"`，空字符串会被拒绝）
* `failure_step` 若提供，必须为**非空字符串**，且可选值：`extract | pipeline | export`（其他值返回 `400 VALIDATION_ERROR`）
* `q` 若提供，必须为字符串；按 `title/domain/intent_text/url` 模糊过滤失败候选
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

* body 若提供，必须是对象
* body 当前仅支持键：`limit`、`offset`、`dry_run`、`regenerate`、`q`
* `limit` 可选，必须为整数，范围建议 `1..200`，默认 50
* `offset` 可选，必须为整数，默认 0，用于分页扫描 archived 候选（负值按 0 处理）
* `dry_run` 若提供，必须为 boolean
* `regenerate` 若提供，必须为 boolean
* `dry_run=true` 时仅返回预估结果，不会修改 item 状态
* `regenerate=true` 时不走 READY 快速恢复，统一入队重跑
* `q` 若提供，必须为字符串；按 `title/domain/intent_text/url` 模糊过滤 archived 候选
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

* `status`（可重复）：CAPTURED, QUEUED, PROCESSING, READY, FAILED_*, SHIPPED, ARCHIVED（大小写不敏感；`FAILED_*` 会展开为全部失败态；包含非法值返回 `400 VALIDATION_ERROR`）
* `priority`（可重复）：READ_NEXT, WORTH_IT, IF_TIME, SKIP（大小写不敏感；包含非法值返回 `400 VALIDATION_ERROR`）
* `source_type`（可重复）：web, youtube, newsletter, other（大小写不敏感；包含非法值返回 `400 VALIDATION_ERROR`）
* `retryable`：`true | false`（仅对 FAILED_* 生效；用于筛选可重试/不可重试失败项；必须为非空字符串；其他值返回 `400 VALIDATION_ERROR`）
* `failure_step`：`extract | pipeline | export`（仅对 FAILED_* 生效；按失败阶段筛选；必须为非空字符串；其他值返回 `400 VALIDATION_ERROR`）
* `q`：搜索（MVP 可仅 title/domain/intent_text）
* `sort`：`priority_score_desc | created_desc | updated_desc`（必须为非空字符串）

  * 默认：`priority_score_desc`
  * 非法值返回 `400 VALIDATION_ERROR`
* `offset`：可选，默认 0；负值或非法值按 0 处理
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
  "requested_offset": 0,
  "next_cursor": "cur_... (optional)"
}
```

> 列表可不返回完整 artifacts，只返回用于队列决策的摘要字段（priority/match_score/intent/status）。

### 5.4 错误

* 400 VALIDATION_ERROR（如 status / priority / source_type / retryable / failure_step / sort 参数非法）

---

## 6. GET /items/{id}（详情）

### 6.1 目的

获取 item + 最新 artifacts（或指定版本）。

### 6.2 Query Params

* `artifact_versions`（可选，json 字符串）：指定要取的版本（按类型）
  - 示例：`?artifact_versions={"todos":1,"card":2}`（URL 编码后传输）
* `include_history`：`true/false`（大小写不敏感，MVP 默认 false；必须为非空字符串；非法值返回 `400 VALIDATION_ERROR`）

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
* 若历史 `failure_json` 非法（含非对象形态），服务端按“无 failure”降级处理
* 若历史 artifact 行存在损坏 JSON：
  - `payload` 非法（含非对象形态）：服务端会跳过该损坏版本
  - `meta` 非法：服务端会降级为 `{}`，保留可用 payload
* `artifact_versions_selected` 回显被接受的版本选择（未提供、解析失败或非对象输入时为空对象）
* 仅当 `include_history=true` 时返回 `artifact_history`

### 6.4 错误

* 400 VALIDATION_ERROR（如 include_history 参数非法）
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

* body 若提供，必须是对象
* body 当前仅支持键：`payload`、`template_version`
* payload 必须是 JSON 对象，且通过对应 schema 校验
* `template_version` 若提供，必须是非空字符串
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

* body 若提供，必须是对象，且当前仅支持键：`intent_text`、`regenerate`
* intent_text 必填，必须为字符串，且长度 >= 3
* regenerate 若提供，必须为 boolean
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
* 500 DATA_CORRUPTION（目标版本 payload 非法或非对象）

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
> body 若提供，必须是对象，且当前仅支持键：`mode`、`process_request_id`、`options`。
> `mode` 若提供，必须是字符串；服务端会先做 `trim + upper-case` 后再按枚举校验。
> `process_request_id` 若提供，必须是非空字符串。
> 若同时提供 `Idempotency-Key` 与 `process_request_id`，两者必须一致；不一致返回 `400 VALIDATION_ERROR`。
> 若 `Idempotency-Key` 被代理合并为逗号分隔值，服务端按“首个非空片段”解析。

options（MVP 可选）：

* template_profile：engineer/creator/manager
* force_regenerate：true/false（若 true 可忽略缓存）
* `options` 若提供，必须是对象；否则返回 `400 VALIDATION_ERROR`。
* `options` 当前仅支持键：`template_profile`、`force_regenerate`；出现其他键返回 `400 VALIDATION_ERROR`。
* `options.template_profile` 若提供，必须为字符串，服务端按 `trim + lower-case` 后校验 `engineer|creator|manager`。
* `options.force_regenerate` 若提供，必须为布尔值。
* 当 `template_profile` 提供且合法时，worker 将按该 profile 驱动本次处理任务（影响 summary 模板版本选择）。
* 当 `force_regenerate !== true` 时，worker 会优先复用该 item 最近一条有效 extraction artifact；仅在不可复用时重新抓取 URL。

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
> 服务端在写入 export artifact 前会再次检查同 `export_key` 历史记录，以降低并发同 key 请求下的重复版本风险。
> 即使 item 处于 `FAILED_EXPORT` 且 `retryable=false`，若命中历史 `export_key` 重放，仍应返回历史导出结果（`idempotent_replay=true`）。

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

约束：

* body 若提供，必须是对象，且当前仅支持键：`export_key`、`formats`、`card_version`、`options`
* `export_key` 若提供，必须是非空字符串
* `formats` 若提供，必须是逗号分隔字符串，或“全部元素均为字符串”的数组；并且值仅能为 `png | md | caption`，为空或包含其他值返回 `400 VALIDATION_ERROR`
* `card_version` 若提供，必须为整数且 `>=1`；若指定版本不存在返回 `404 NOT_FOUND`
* `options` 若提供，必须是对象；当前仅支持 `theme` 键
* `options.theme` 若提供，必须是字符串；服务端按 `trim + upper-case` 后校验 `LIGHT|DARK`
* 若指定 `card_version` 对应 payload 损坏（非法或非对象），返回 `500 DATA_CORRUPTION`
* 若同时提供 `Idempotency-Key` 与 `export_key`，两者必须一致；不一致返回 `400 VALIDATION_ERROR`
* 若 `Idempotency-Key` 被代理合并为逗号分隔值，服务端按“首个非空片段”解析

### 8.4 Response 200

```json
{
  "item": { "id": "itm_...", "status": "SHIPPED", "updated_at": "..." },
  "export": {
    "artifact_type": "export",
    "version": 1,
    "payload": {
      "card_version": 1,
      "options": { "theme": "DARK" },
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
> 命中历史重放时，item 状态会置为 `SHIPPED`，并清理历史 `FAILED_EXPORT` 残留 failure 信息。

### 8.5 错误

* 400 VALIDATION_ERROR（例如 `formats` 非法）
* 404 NOT_FOUND
* 409 EXPORT_NOT_ALLOWED
* 409 STATE_CONFLICT
* 409 RETRY_LIMIT_REACHED（导出失败重试已达上限）
* 500 DATA_CORRUPTION（指定 `card_version` 对应 payload 损坏）
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

约束：

* body 若提供，必须是对象
* body 当前仅支持 `reason` 键
* `reason` 若提供，必须是非空字符串

### 9.3 Response 200

```json
{
  "item": { "id": "itm_...", "status": "ARCHIVED", "updated_at": "..." }
}
```

### 9.4 错误

* 400 VALIDATION_ERROR
* 409 ARCHIVE_NOT_ALLOWED
* 409 STATE_CONFLICT（并发条件下状态在归档前发生变化）

---

## 10. POST /items/{id}/unarchive（恢复）

### 10.1 状态机约束

允许 From：ARCHIVED

默认 To：

* 若 artifacts 齐备 → READY
* 若 artifacts 不齐或请求 regenerate → QUEUED

约束：

* `regenerate` 若提供，必须为 boolean
* body 若提供，必须是对象，且当前仅支持 `regenerate` 键

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

* 400 VALIDATION_ERROR
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
