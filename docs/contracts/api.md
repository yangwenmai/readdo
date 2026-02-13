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
* ARCHIVE_NOT_ALLOWED
* INTERNAL_ERROR

> Pipeline 失败原因不通过 API 错误码表达，而通过 item.status=FAILED_* + failure 字段暴露。

---

## 3. API 列表（MVP）

* POST `/capture`
* GET  `/items`
* GET  `/items/{id}`
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

### 4.4 Response 201

```json
{
  "item": {
    "id": "itm_...",
    "status": "CAPTURED",
    "created_at": "..."
  }
}
```

### 4.5 错误

* 400 VALIDATION_ERROR

---

## 5. GET /items（Inbox 列表）

### 5.1 目的

按“决策队列”列出 items，支持筛选/排序/分页。

### 5.2 Query Params

* `status`（可重复）：CAPTURED, QUEUED, PROCESSING, READY, FAILED_*, SHIPPED, ARCHIVED
* `priority`（可重复）：READ_NEXT, WORTH_IT, IF_TIME, SKIP
* `source_type`（可重复）：web, youtube, newsletter, other
* `q`：搜索（MVP 可仅 title/domain/intent_text）
* `sort`：`priority_score_desc | created_desc | updated_desc`

  * 默认：`priority_score_desc`
* `cursor`：分页游标（可选）
* `limit`：默认 20，最大 100

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

* `artifact_versions`（可选，json 字符串或多参数）：指定要取的版本
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
  "failure": {
    "failed_step": "summarize",
    "error_code": "AI_TIMEOUT",
    "message": "Generation timed out. Please retry."
  }
}
```

约束：

* 当 status 非 FAILED_* 时 failure 可省略
* artifacts 缺失允许（例如 PROCESSING 中仅 extraction 已存在）

### 6.4 错误

* 404 NOT_FOUND

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
  }
}
```

### 7.5 错误

* 404 NOT_FOUND
* 409 PROCESSING_IN_PROGRESS
* 409 STATE_CONFLICT（不允许的状态）

---

## 8. POST /items/{id}/export（导出卡片）

### 8.1 目的

将 card.render_spec 渲染为 PNG/MD/caption，写入 export artifact，并进入 SHIPPED。

### 8.2 状态机约束

允许 From：READY, SHIPPED, FAILED_EXPORT
不允许 From：CAPTURED, QUEUED, PROCESSING, FAILED_EXTRACTION, FAILED_AI, ARCHIVED

成功 To：SHIPPED
失败：FAILED_EXPORT（或保持 READY 并记录 failure；MVP 推荐 FAILED_EXPORT）

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
  }
}
```

> `path` 为本地文件路径（MVP）；未来可扩展为 blob/url。

### 8.5 错误

* 404 NOT_FOUND
* 409 EXPORT_NOT_ALLOWED
* 409 STATE_CONFLICT

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
* 409 PROCESSING_IN_PROGRESS

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
