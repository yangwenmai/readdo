# Read→Do Template Governance（模板治理契约）
Location: docs/contracts/template-governance.md
Version: 0.1 (MVP)
Last Updated: 2026-02-13

---

## 0. 目的

模板是 Read→Do 的“软逻辑层”。为了防止输出漂移、保证可回归与可解释：
- 模板必须可版本化
- 版本 bump 有统一规则
- profile 选择（engineer/creator/manager）必须可控
- 任何模板变更必须通过 eval gates

---

## 1. 模板命名规范

### 1.1 文件路径
- `docs/templates/<artifact>.<profile>.vN.md` 或 `docs/templates/<artifact>.vN.md`

示例：
- `docs/templates/summary.engineer.v1.md`
- `docs/templates/summary.creator.v1.md`
- `docs/templates/score.v1.md`
- `docs/templates/todos.v1.md`
- `docs/templates/card.v1.md`

### 1.2 template_version（meta 写入）
template_version 以文件名（不含扩展名）为准，例如：
- `summary.engineer.v1`
- `summary.creator.v1`
- `score.v1`
- `todos.v1`
- `card.v1`

> 禁止出现多种命名来源（例如模板头部写 v1、文件名写 v2）。以文件名为单一真相。

---

## 2. Profile 选择策略（MVP）

### 2.1 目标
不同 profile 输出风格不同，但结构与治理一致（schema+eval 不变）。

### 2.2 MVP 支持的 profile
- `engineer`（默认）：偏结构化、可落地、偏系统性
- `creator`：偏传播、角度更鲜明、易做卡片内容
- `manager`（预留）：偏决策与对齐（MVP 可不实现模板）

### 2.3 profile 如何影响模板选择
- summary：
  - engineer → `summary.engineer.v1`
  - creator → `summary.creator.v1`
  - manager → `summary.engineer.v1`（MVP fallback）
- score：
  - 全 profile 共用 `score.v1`
- todos：
  - 全 profile 共用 `todos.v1`（后续可分）
- card：
  - 全 profile 共用 `card.v1`（后续可分）

---

## 3. 模板版本 bump 规则

### 3.1 什么时候 bump（必须）
满足任一条件即 bump vN → vN+1：
- 输出字段语义发生变化（即便 schema 未变）
- 输出风格变化会影响 eval（例如 reasons 更长/更短、todo 结构变化）
- 约束策略变化（例如从“3~5 bullets”改成“5~7 bullets”）
- 重要提示/规则变化（例如 priority 桶策略、反泛化策略）

### 3.2 什么时候不需要 bump（允许）
- 仅修正错别字/语法，不改变指令语义
- 不影响输出结构与质量门槛的微调

> 判断原则：如果你无法肯定“不影响输出”，就 bump。

---

## 4. 变更流程（Non-negotiable）

### 4.1 模板变更必须做的事
1) bump template_version（如需要）
2) 运行：
   - `pnpm eval`
3) 确保 gates：
   - P0 100% 通过
   - P1 100% 通过（默认）

### 4.2 若 gates 失败
- 首选：修模板
- 次选：扩充 eval cases（真实覆盖）
- 最后才考虑：临时放宽 gate（必须记录原因与期限）

---

## 5. 未来扩展（非 MVP）
- 每个 artifact 分 profile（todos.creator/card.creator）
- 多模板路由（按 source_type 或 intent 分类）
- prompt_hash 与 input_hash 做缓存命中与回归定位

---
