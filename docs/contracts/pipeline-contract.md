# Read→Do Pipeline Contract（流水线契约）
Location: docs/contracts/pipeline-contract.md
Version: 0.1 (MVP)
Last Updated: 2026-02-13

本契约定义 Orchestrator 的 pipeline 行为边界：
- step 顺序
- 每步输入输出（artifact）
- item 字段何时更新
- READY gate 判定（含 run_id 一致性）
- failure/重试/幂等

---

## 0. 名词

- Item：用户捕捉的一条内容 + intent + 状态
- Artifact：可版本化的结构化产物（extraction/summary/score/todos/card/export）
- Run：一次 pipeline 执行批次，用 run_id 标识

---

## 1. Step 顺序（MVP）

### 1.1 PROCESS pipeline（必选）
1) extraction
2) summary
3) score
4) todos
5) card
6) READY gate

### 1.2 EXPORT pipeline（可选单独 job）
- export（读取指定 card 版本）

---

## 2. Step 输入输出契约

### 2.1 extraction
输入：
- item.url (+ source_type/title/domain)

输出：
- artifact_type = extraction
- payload 必须满足 `docs/contracts/schemas/extraction.schema.json`
- 写入 meta（run_id/engine_version/template_version=extraction.v1）
  - 说明：extraction 无 prompt 模板文件，template_version 固定标识抽取器契约版本

副作用：
- 若 extraction 失败：item.status = FAILED_EXTRACTION，并写 failure（retryable=true）

### 2.2 summary
输入：
- item.intent_text
- extraction.normalized_text

输出：
- artifact_type = summary
- payload 校验 `summary.schema.json`
- template_version 按 profile 路由（template-governance.md）

失败：
- item.status = FAILED_AI
- error_code = AI_SCHEMA_INVALID / AI_PARSE_ERROR / AI_TIMEOUT 等
- retryable=true

### 2.3 score
输入：
- intent_text
- extraction.normalized_text
- summary payload（推荐）

输出：
- artifact_type = score
- payload 校验 `score.schema.json`
- template_version = score.v1

副作用（写回 item 字段）：
- item.priority = score.priority
- item.match_score = score.match_score
- item.updated_at 更新

### 2.4 todos
输入：
- intent_text
- summary payload
- score payload（推荐）

输出：
- artifact_type = todos
- payload 校验 `todos.schema.json`
- template_version = todos.v1

### 2.5 card
输入：
- intent_text
- summary/todos/score

输出：
- artifact_type = card
- payload 校验 `card.schema.json`
- template_version = card.v1

---

## 3. Artifact 写入规则（版本化）

### 3.1 system 生成
- created_by = system
- version 递增（同 item_id + artifact_type）
- meta 必填字段（artifact-meta.md）

### 3.2 user 编辑（MVP 可后置）
- created_by = user
- version 递增
- UI 默认展示 user 最新版本（不被 system 覆盖）

---

## 4. READY Gate（关键一致性规则）

### 4.1 READY 条件（MVP 强约束）
Item 进入 READY 需要：
- summary/score/todos/card 都存在
- 这四个 artifacts 的 meta.run_id 必须一致（同一 run）

若不一致：
- item 不进入 READY
- Orchestrator 应选择：
  - 重新生成缺失/不一致的 artifact（同 run_id）
  - 或失败进入 FAILED_AI（错误码=RUN_INCONSISTENT）

> 原因：避免“summary v3 + todos v1”这种不可解释的混合态。

### 4.2 READY 后的 regenerate
- `POST /items/{id}/process` mode=REGENERATE
- 产生新的 run_id
- 生成新 system versions
- 若存在 user versions，不覆盖默认展示

---

## 5. Failure 模型（对齐 API）

### 5.1 failure 字段写入
- item.failure.failed_step
- item.failure.error_code
- item.failure.message
- item.failure.retryable

### 5.2 错误到状态的映射
- extraction 失败 → FAILED_EXTRACTION
- summarize/score/todos/card 失败 → FAILED_AI
- export 失败 → FAILED_EXPORT

---

## 6. Retry 与幂等

### 6.1 Retry 允许的 From 状态
- FAILED_EXTRACTION
- FAILED_AI
- FAILED_EXPORT
- CAPTURED（首次）
- READY（regenerate）
- SHIPPED（re-export）

### 6.2 幂等策略（MVP）
- process_request_id / Idempotency-Key：
  - 防止重复 enqueue
- export_key：
  - 同 export_key 返回同一份导出（同 files）

---

## 7. Item 状态写入时机（对齐 state machine）

- capture 成功：CAPTURED
- enqueue 后：QUEUED
- worker lease 成功：PROCESSING
- READY gate 满足：READY
- export 成功：SHIPPED
- archive/unarchive：ARCHIVED ↔ READY/QUEUED（见 api.md）

---

## 8. 与 Evals 的关系

Evals 不跑 extraction/export（MVP），只跑生成侧：
- summary/score/todos/card 的 schema + rubric
- 变更模板/引擎必须通过门禁

---
