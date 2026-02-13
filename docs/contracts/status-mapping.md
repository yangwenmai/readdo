# Read→Do Status → UI Mapping（契约）
Location: docs/contracts/status-mapping.md
Version: 0.1 (MVP)
Last Updated: 2026-02-13

本文件定义 Item 状态在 UI 层的呈现与可用动作矩阵。
目标：
- Inbox 是“决策队列”，不是书签列表
- 不同状态下按钮可用性一致，避免前后端各自解释
- 错误提示与 retry 规则一致

---

## 0. 状态列表（来自 item.schema.json / state machine）
- CAPTURED
- QUEUED
- PROCESSING
- READY
- FAILED_EXTRACTION
- FAILED_AI
- FAILED_EXPORT
- SHIPPED
- ARCHIVED

---

## 1. 顶层导航与默认筛选

### 1.1 Inbox（默认入口）
包含状态：
- READY
- PROCESSING
- QUEUED
- CAPTURED
- FAILED_EXTRACTION
- FAILED_AI
- FAILED_EXPORT

默认排序：
- READY 优先
- READY 内按 priority_score_desc（见 api.md）
- 失败项默认折叠在 “Needs attention”（但必须可见）

默认筛选建议：
- status=ALL
- retryable=ALL（可选切换 `true/false`，用于快速定位“可重试失败项”或“已达上限项”）
- failure_step=ALL（可选切换 `extract/pipeline/export`，用于按失败阶段聚焦处理）

可选全局动作：
- `Preview Retry`（dry-run）：调用 `/items/retry-failed` 且 `dry_run=true`，仅展示可重试规模与分类，不改状态。
- `Retry Failed`（批量）：调用 `/items/retry-failed` 批量重试 `FAILED_EXTRACTION/FAILED_AI` 的可重试项；
  `FAILED_EXPORT` 仍应单独走 export 重试。
  - 若 UI 已选择 `failure_step` 筛选，建议把该值透传给 `/items/retry-failed` 以保持“所见即所重试”。

### 1.2 Shipped
包含状态：
- SHIPPED

排序：
- updated_at desc

### 1.3 Archived
包含状态：
- ARCHIVED

排序：
- updated_at desc

---

## 2. Inbox 分组规则（强建议）

Inbox 视觉分组顺序（上→下）：
1) **Read Next**（priority=READ_NEXT 且 status=READY）
2) **Worth It**（priority=WORTH_IT 且 status=READY）
3) **If Time**（priority=IF_TIME 且 status=READY）
4) **In Progress**（PROCESSING/QUEUED/CAPTURED）
5) **Needs Attention**（FAILED_*）
6) **Skip**（priority=SKIP 且 status=READY）可折叠/隐藏

> 说明：READ_NEXT/WORTH_IT/IF_TIME/SKIP 只在 READY 时用于决策分组。非 READY 统一归入 In Progress。

---

## 3. 状态呈现规范（每条 item 行）

每条 item 在列表中应包含：
- Title（可为空则显示 url）
- Domain
- Intent（必须显示，且视觉权重高于 summary）
- Status badge
- 若 READY：显示 match_score + priority
- 若 FAILED_*：显示 failure.message（短版）+ Retry
- 若 PROCESSING：显示 “Processing…”（可选显示 step）

---

## 4. 动作矩阵（Actions Matrix）

> 动作为 UI 按钮或 menu item，Orchestrator/Backend 负责 enforce。

动作定义：
- Open Detail
- Process (首次/重试)
- Regenerate (READY 重新生成)
- Export (Ship)
- Re-export (已 ship 再导出)
- Archive
- Unarchive

### 4.1 Matrix

| Status | Primary CTA | Secondary | Disabled / Notes |
|---|---|---|---|
| CAPTURED | **Process**（开始处理） | Archive | 若已自动 enqueue，可显示 “Queued soon” 并禁用 Process |
| QUEUED | —（无主按钮） | Archive | 显示 “Queued” 与预计开始；禁用 Process/Regenerate |
| PROCESSING | —（无主按钮） | Archive(建议禁用) | 禁用所有生成类操作；显示进度；避免重复入队 |
| READY | **Export**（Ship 输出） | Regenerate, Archive | Export 失败会进入 FAILED_EXPORT |
| FAILED_EXTRACTION | **Retry**（Process） | Archive | 若 `failure.retryable=false`，主按钮置灰并提示已达重试上限 |
| FAILED_AI | **Retry**（Process） | Regenerate(同 Retry), Archive | 展示 failed_step + error_code；若超限则禁用 Retry |
| FAILED_EXPORT | **Retry Export**（Export） | Archive, Regenerate | 优先允许再次 export；也可 regenerate card |
| SHIPPED | **Re-export** | Archive | SHIPPED 仍可 regenerate（可选）；MVP 可只提供 re-export |
| ARCHIVED | **Unarchive** | Regenerate（可选） | Unarchive 后：若 artifacts 齐备→READY；否则→QUEUED |

---

## 5. Detail 页按钮策略（更细）

### 5.1 Header 区（右侧动作）
- READY：
  - Primary: Export
  - Secondary: Regenerate / Archive
- FAILED_*：
  - Primary: Retry（Process 或 Export）
  - Secondary: Archive
- SHIPPED：
  - Primary: Re-export
  - Secondary: Archive
- PROCESSING/QUEUED/CAPTURED：
  - Primary: Open progress / “Processing…”
  - Secondary: Archive（CAPTURED 可用；PROCESSING/QUEUED 建议禁用）

### 5.2 Tab 可用性
- Summary/Score/Todos/Card：
  - READY/SHIPPED：全部可见
  - PROCESSING：已生成的 artifact 可见，未生成显示 skeleton
  - FAILED_AI：显示已有 artifact + failure（定位失败 step）
- Export：
  - READY/SHIPPED：可见
  - FAILED_EXPORT：可见并提示重试
  - 其他状态：隐藏或禁用

---

## 6. 错误提示规范（User-facing）

### 6.1 FAILED_EXTRACTION
- 标题：“Couldn’t extract content”
- 正文：简短说明（网络/站点限制）
- CTA：Retry / Archive（若 retryable=false，显示“Retry limit reached”并禁用重试）
- （未来）提供 “Paste content” 入口

### 6.2 FAILED_AI
- 标题：”Generation failed”
- 正文：展示 failed_step（summarize/score/todos/card）
- CTA：Retry / Archive（若 retryable=false，提示先编辑 intent 或手动修订 artifact）

### 6.3 FAILED_EXPORT
- 标题：”Export failed”
- 正文：提示 fallback（md/caption 可用/或可重试 PNG）
- CTA：Retry Export / Export MD+Caption / Archive（若 retryable=false，禁用 Retry Export）
- 若前端启用自动降级，可在 PNG 失败后自动触发 md+caption 导出，并给用户明确提示

---

## 7. UI 与状态机的一致性约束（Non-negotiable）
- UI 不得隐藏 intent_text
- UI 不得在 PROCESSING 状态提供可点击的“再次处理”按钮（避免并发/漂移）
- READY gate 的 run_id 一致性由后端保证；UI 只展示“本次 run”的产物（最新一致集合）

---
