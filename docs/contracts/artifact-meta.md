# Read→Do Artifact Meta 契约（Governance）
Location: docs/contracts/artifact-meta.md
Version: 0.1 (MVP)
Last Updated: 2026-02-13

---

## 0. 目的

Read→Do 的核心资产是 Artifacts（summary/score/todos/card/export）。  
为了实现 **可复现、可回归、可解释、可演进**，每个 artifact 必须携带统一的 meta 信息，以便：

- 追踪生成来源（system/user）
- 复现实验（同输入、同模板、同引擎版本）
- 做回归（变更后知道是模板坏了还是引擎坏了）
- 支持多版本并存（regenerate/人工编辑）

---

## 1. Meta 字段规范（Artifact-level）

每个 artifact 必须包含一个 `meta` 对象，字段如下。

### 1.1 必填字段（MVP 必须）
- `run_id` (string)
  - 一次 pipeline 运行的唯一 ID（例如 `run_...`）
  - 同一次运行产生的 summary/score/todos/card 应共享同一个 run_id
- `engine_version` (string)
  - Core Engine 语义版本（例如 `0.1.0`）
  - 引擎逻辑变更必须 bump（至少 minor）
- `template_version` (string)
  - 模板标识（例如 `summary.engineer.v1` / `todos.v1` / `card.v1`）
  - 模板内容破坏性变更必须 bump（v1→v2）
- `created_at` (string, ISO8601)
- `created_by` (enum): `system | user`
  - system：pipeline/AI 生成
  - user：人工编辑生成（或 UI 直接创建）

### 1.2 推荐字段（强烈建议）
- `model_id` (string)
  - 若使用外部模型，记录模型标识（如 provider+model）
- `prompt_hash` (string)
  - 将最终 prompt（含模板渲染后）做 hash，便于定位漂移（可选）
- `input_hash` (string)
  - 对关键输入（例如 extraction normalized_text）做 hash
  - 用于缓存/复现/判断是否需要 regenerate
- `upstream_versions` (object)
  - 记录上游 artifact 版本（用于追踪依赖）
  - 例：`{"extraction":1,"summary":2}`

### 1.3 禁止字段/规则
- 不得在 meta 中存放原文全文（privacy）
- 不得存放敏感 token/密钥
- model_id/prompt_hash 可为空，但字段名必须一致，避免多种命名

---

## 2. 版本策略（Artifact-level Versioning）

### 2.1 version 的定义
- `version` 是同一 item_id + artifact_type 下的递增整数，从 1 开始
- 每次 system regenerate 都必须创建新 version（不覆盖旧 version）
- 每次 user edit 也必须创建新 version（created_by=user）

### 2.2 显示策略（UI 使用）
- 默认展示最新版本（按 created_at）
- 若存在 user 版本，UI 默认优先展示 user 版本（避免被 system 覆盖）
- regenerate 产生的 system 版本不会自动覆盖 user 版本，除非用户明确选择“覆盖”

---

## 3. run_id 规则（Pipeline-level）

### 3.1 run_id 的语义
- run_id 表示一次完整或部分 pipeline 执行的“批次”
- 一次 run_id 可能只跑到某一步（失败则停止），但应记录已生成的 artifacts

### 3.2 READY gate 与 run_id
- 进入 READY 的 artifacts（summary/score/todos/card）应尽量来自同一 run_id
- 若出现混合 run_id（例如 summary v3 但 todos v2），必须由 Orchestrator 决定是否允许：
  - MVP 推荐：READY 只接受同 run_id 的必需 artifacts 集合，减少不一致

---

## 4. 与评估（Evals）的关系

Evals 需要使用 meta 定位漂移来源：
- engine_version 变化 → 引擎回归
- template_version 变化 → 模板回归
- model_id 变化 → 模型回归

因此：任何变更都必须被 meta 记录，否则 eval 结果不可解释。

---
