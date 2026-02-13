# Read→Do 状态机契约（State Machine Contract）

Location: docs/contracts/state-machine.md  
Version: 0.1 (MVP)  
Last Updated: 2026-02-13

---

## 0. 目的与范围

本文件定义 Read→Do 的 **Item 状态机**，用于约束：
- Orchestrator 如何驱动 pipeline
- API 在不同状态下的允许操作
- 失败、重试、幂等、并发控制
- UI 如何展示与引导用户决策

**原则**：所有状态变更必须由 Orchestrator 统一执行（Single Source of Truth）。

---

## 1. 状态定义（MVP）

| 状态 | 含义 | 进入条件 | 退出条件 |
|---|---|---|---|
| `CAPTURED` | 已捕捉并入库（事实 + intent） | POST /capture 成功入库 | 自动或手动进入 QUEUED |
| `QUEUED` | 等待处理 | Orchestrator 将 item 放入处理队列 | worker 领取进入 PROCESSING |
| `PROCESSING` | pipeline 执行中 | worker 获得租约/锁开始处理 | 成功→READY；失败→FAILED_* |
| `READY` | 必需产物齐备，可决策/可行动/可导出 | summary + score + todos + card 均写入成功 | export→SHIPPED 或 archive→ARCHIVED |
| `FAILED_EXTRACTION` | 抽取正文失败 | ExtractStep 失败 | 重试→QUEUED；归档→ARCHIVED |
| `FAILED_AI` | AI 生成失败（任一 AI step） | Summarize/Score/Todo/Card 任一步失败 | 重试→QUEUED；归档→ARCHIVED |
| `FAILED_EXPORT` | 导出失败 | ExportStep 失败 | 重试导出成功→SHIPPED；重试处理→QUEUED；归档→ARCHIVED |
| `SHIPPED` | 已导出交付物（卡片）或用户显式标记完成 | export 成功 或 user mark shipped | 可再次导出（仍为 SHIPPED）或归档 |
| `ARCHIVED` | 用户归档（含 Skip 区） | user archive 或系统策略 | unarchive→READY 或 QUEUED（按规则） |

---

## 2. 状态转移图（逻辑）

```
CAPTURED -> QUEUED -> PROCESSING -> READY -> SHIPPED
|            |
v            v
FAILED_*         ARCHIVED
|
v
QUEUED
```

---

## 3. 允许的状态转移（Transition Table）

> 任何未列出的转移均为 **禁止**（必须返回 409 Conflict + 明确错误码）。

| From | To | 触发源 | 触发方式 | 约束 |
|---|---|---|---|---|
| CAPTURED | QUEUED | system | auto-enqueue | 入库后应尽快 enqueue（可批处理） |
| QUEUED | PROCESSING | system | worker lease-acquire | 必须获取租约/锁，避免并发处理 |
| PROCESSING | READY | system | pipeline success | 必需 artifacts 全部写入且通过 schema |
| PROCESSING | FAILED_EXTRACTION | system | step failure | 记录 failed_step=extract 与可重试信息 |
| PROCESSING | FAILED_AI | system | step failure | 记录 failed_step 与 error_code |
| READY | SHIPPED | system/user | export success 或 user mark | export 成功默认进入 SHIPPED |
| FAILED_EXPORT | SHIPPED | user/system | POST /export（retry export） | 允许同 export_key 幂等重试 |
| READY | ARCHIVED | user | POST /archive | READY 可被归档 |
| FAILED_* | QUEUED | user/system | POST /process（retry）或 auto-retry | 重试前需清理/记录 run_id |
| FAILED_* | ARCHIVED | user | POST /archive | 允许用户将失败项归档 |
| ARCHIVED | READY | user | POST /unarchive | 恢复为 READY（保留 artifacts） |
| ARCHIVED | QUEUED | user | POST /unarchive + regenerate | 若选择重新处理可入 QUEUED |
| SHIPPED | ARCHIVED | user | POST /archive | 允许归档已交付 |
| SHIPPED | SHIPPED | user/system | re-export | 允许重复导出（幂等） |

---

## 4. API 操作与状态约束（Routing Rules）

### 4.1 POST /capture
- 允许状态：无（创建新 item）
- 成功后状态：CAPTURED
- 后续：系统应自动 enqueue → QUEUED

### 4.2 POST /items/:id/process（process / retry / regenerate）
- 允许 From：
  - CAPTURED（手动触发处理）
  - FAILED_*（重试）
  - READY（regenerate：生成新版本 artifacts，不改变旧版本）
  - ARCHIVED（可选择 unarchive 并 regenerate）
- 不允许 From：
  - PROCESSING（避免重复并发；返回 409 PROCESSING_IN_PROGRESS）
- To：
  - 一般进入 QUEUED（由 worker 拉起 → PROCESSING）

### 4.3 POST /items/:id/export
- 允许 From：READY、SHIPPED、FAILED_EXPORT
- 不允许 From：CAPTURED/QUEUED/PROCESSING/FAILED_EXTRACTION/FAILED_AI/ARCHIVED
- 成功 To：SHIPPED
- 失败 To：FAILED_EXPORT（或保持 READY 并记录 export_failure；MVP 推荐进入 FAILED_EXPORT 以便清晰重试）

### 4.4 POST /items/:id/archive
- 允许 From：CAPTURED、QUEUED、READY、FAILED_*、SHIPPED
- 不允许 From：PROCESSING（MVP 禁止，减少复杂性；可后续支持“取消并归档”）
- To：ARCHIVED

### 4.5 POST /items/:id/unarchive
- 允许 From：ARCHIVED
- 默认 To：READY（若 artifacts 齐备）
- 若 artifacts 不齐或用户选择 regenerate：To QUEUED

---

## 5. 并发控制与幂等性（必须遵守）

### 5.1 单 item 单 worker（Processing Lease）
- 在 QUEUED → PROCESSING 转移时必须获取租约（lease），例如：
  - lease_owner（worker_id）
  - lease_expires_at
- PROCESSING 状态下，其他 worker 不得处理同一 item
- lease 超时可被回收 → QUEUED（防止 worker 崩溃导致卡死）

### 5.2 幂等键（Idempotency Keys）
为避免重复请求造成重复 artifacts 或重复导出：

- /capture：客户端可提供 `capture_id`（UUID），服务端对同一 capture_id 返回相同 item_id
- /process：可提供 `process_request_id`，同一请求不重复入队
- /export：必须提供 `export_key`（如 hash(item_id + card_version + template_version)）
  - 同一 export_key 重复调用应返回相同导出结果，不重复生成文件

### 5.3 Artifacts 版本化写入
- 每次 pipeline run 生成 artifacts 新版本（version++）
- 在 READY 判定前，必须保证必需 artifacts 的版本集合一致（同一 run_id）
  - 推荐在 meta 中记录 `run_id`

---

## 6. 失败模型（Failure Model）

### 6.1 失败信息字段（与 item.schema.json 对齐）
核心字段（FAILED_* 必须携带）：
- failed_step: string（extract/summarize/score/todos/card/export）
- error_code: string（枚举，见下）
- message: string（对用户友好，可展示）
- retryable: boolean

推荐扩展字段（可选）：
- debug_message: string（开发调试）
- attempts: int（累计）
- last_attempt_at: timestamp

### 6.2 推荐错误码（MVP）
- EXTRACTION_FETCH_FAILED
- EXTRACTION_PARSE_FAILED
- AI_TIMEOUT
- AI_SCHEMA_INVALID
- AI_RATE_LIMITED
- AI_PROVIDER_ERROR
- EXPORT_RENDER_FAILED
- EXPORT_WRITE_FAILED

---

## 7. READY 的判定规则（Gate Conditions）

进入 READY 必须满足：
- 最新一次 run_id 对应的必需 artifacts 都存在且 schema 校验通过：
  - summary
  - score（含 reasons>=3）
  - todos（3..7 且含输出型任务）
  - card（含 render_spec）
- 如果缺少任何必需 artifacts，则不得进入 READY，应保持 PROCESSING 或 FAILED_AI

---

## 8. ARCHIVED / SKIP 的语义（产品层映射）

`ARCHIVED` 是系统层状态。产品层可展示为：
- Skip（系统推荐不读或用户选择不读）
- Archived（用户归档）

MVP 阶段不区分子状态，但建议记录 `archive_reason`：
- USER_ARCHIVE
- SYSTEM_SKIP (score<40)
- FAILURE_ARCHIVE

以便后续分析与个性化。

---

## 9. UI 映射建议（最小必需）

> 本节不规定 UI 设计，仅规定状态需可见、可操作。

- CAPTURED/QUEUED：显示 “Queued / Processing soon”
- PROCESSING：显示进度（可选：当前 step）+ 预计耗时（可选）
- FAILED_*：显示失败原因 + “Retry” 操作
- READY：显示 score/priority + reasons + “Export / Edit / Regenerate”
- SHIPPED：显示导出记录 + 允许再次导出
- ARCHIVED：允许恢复（unarchive）

---

## 10. 变更流程（治理规则）

任何对以下内容的修改，都必须同步更新：
- 状态集合/转移规则（本文件）
- API 契约（docs/contracts/api.md）
- Eval 断言（docs/evals/rubric.md）
并在 CI 中通过回归检查后合并。

---