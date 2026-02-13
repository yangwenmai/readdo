# Read→Do 设计组件规范（Design Components）
Location: docs/08-design-components.md
Version: 0.1 (MVP)
Last Updated: 2026-02-13

本文件定义 MVP 的核心 UI 组件规范（可用于 Web 或 Tauri）。
目标：让“从读到做”的 Aha Moment 可被稳定复现：
- Intent 是第一性信息（不是标题）
- Inbox 是决策队列（不是收藏夹）
- Reasons 是信任构建器（不是总结）
- Todos 是行动引擎（不是建议）
- Card/Export 是交付瞬间（不是截图）

---

## 0. 视觉原则（Non-negotiable）

1) **Intent Above Content**
- 在任何列表/详情里：intent_text 的视觉权重 ≥ title
- 让用户先看到“我为什么要看”，再看到“它是什么”

2) **Explainability First**
- Score 永远伴随 reasons（至少可一眼展开）
- 不允许只显示一个分数而无解释

3) **Queue, Not Library**
- Inbox 的默认布局与交互行为要像“待办队列”，而不是“阅读列表”
- 快速决策（10 秒）优先于深度阅读

4) **Ship An Output**
- 每个 READY item 的主动作是 Export/Ship（输出）
- “读完”不是终点，“产出”才是

---

## 1. 核心组件列表（MVP）

- C1: InboxSection（分组容器）
- C2: ItemRowCard（队列条目卡）
- C3: IntentHeader（意图头）
- C4: ScoreBadge（优先级/分数徽标）
- C5: ReasonsPeek（理由预览）
- C6: StatusPill（状态标签）
- C7: TodoSnippet（行动预览）
- C8: PrimaryShipCTA（Ship 主按钮）
- C9: DetailLayout（详情页框架）
- C10: ArtifactPanel（Summary/Score/Todos/Card 面板）
- C11: ExportPanel（导出面板）
- C12: VersionSwitcher（版本切换/标记 user vs system）

---

## 2. C2: ItemRowCard（最关键组件）

### 2.1 目标
在 10 秒内让用户完成：
- “我为什么存它？”（Intent）
- “值不值得读？”（Score + Reasons）
- “下一步做什么？”（Todo snippet）
- “能不能直接 ship？”（Export）

### 2.2 布局（推荐结构）
```

┌─────────────────────────────────────────────┐
│ [StatusPill]      [ScoreBadge]       [CTA]  │
│ IntentHeader (1–2 lines, strong)             │
│ Title + Domain (1 line, secondary)           │
│ ReasonsPeek (1 line preview + expand)        │
│ TodoSnippet (optional, 1–2 items)            │
└─────────────────────────────────────────────┘

```

### 2.3 排版权重（强约束）
- IntentHeader：字体/对比度最高（“第一眼”）
- ScoreBadge：次高（用于队列排序与快速判断）
- Title/Domain：弱化（避免把它当书签）
- ReasonsPeek：比 summary 更重要（信任）
- TodoSnippet：只展示 1–2 条（引导进入详情）

### 2.4 信息密度控制
- IntentHeader 默认最多 2 行，超出用省略号
- ReasonsPeek 默认显示第一条 reasons 的前半句 + “+2”
- TodoSnippet 默认显示 top 1–2 条（按 ETA 小/输出型优先）

### 2.5 微交互（Aha 的触发点）
- hover/聚焦时：
  - ReasonsPeek 展开（显示全部 reasons）
  - CTA 文案从 “Ship” 变成 “Ship output”
- 点击 IntentHeader：
  - 直接进入 Detail 并定位到 Intent 编辑（强调意图）

---

## 3. C3: IntentHeader（Aha Moment Component）

### 3.1 结构
- label（可选）：`Because…` / `Why I saved this`
- content：intent_text

### 3.2 行为
- 可编辑（Detail 中）
- 编辑后立即影响：
  - 下一次 score reasons 的对齐
  - Inbox 的“解释”优先级（reasons 重新对齐）

### 3.3 视觉
- 使用“高对比 + 大字号 + 紧凑行距”
- 建议用淡色背景块（让它像一个“承诺/注释”，而不是正文）

---

## 4. C4: ScoreBadge（决策压缩器）

### 4.1 显示内容
- Priority label（READ_NEXT / WORTH_IT / IF_TIME / SKIP）
- match_score（0–100，保留 1 位小数）

### 4.2 显示规则
- READY 才显示完整 score
- PROCESSING/QUEUED：显示 skeleton 或 “—”
- FAILED_*：显示 “Needs fix” 替代 score（避免误导）

### 4.3 信息映射
- priority 文案应更人类可读：
  - READ_NEXT → “Read next”
  - WORTH_IT → “Worth it”
  - IF_TIME → “If time”
  - SKIP → “Skip”

---

## 5. C5: ReasonsPeek（信任构建器）

### 5.1 默认状态
- 显示 reasons[0] 的前 60–80 字符（或 1 行）
- 右侧显示 “+2” / “+3”

### 5.2 展开状态
- 展示 3–6 条 reasons
- 每条 reasons 前有小圆点（轻视觉，不要喧宾夺主）

### 5.3 内容约束（与 rubric 一致）
- 至少 2 条 reasons 必须“具体线索”
- 禁止纯泛化夸赞

---

## 6. C7: TodoSnippet（行动预览）

### 6.1 默认展示
- 展示 1–2 条 todo（优先：ETA 最短 + 输出型）
- 格式：`[eta] Title`

示例：
- `[20m] Extract 5-step pipeline contract for MVP`
- `[1h] Draft a v1 README that enforces eval gates`

### 6.2 展示规则
- 仅 READY/SHIPPED 展示
- FAILED_AI/PROCESSING：隐藏或显示 “Generating actions…”

---

## 7. C8: PrimaryShipCTA（Ship 主按钮）

### 7.1 文案策略
- READY：主按钮 “Ship”
- hover：变为 “Ship output”
- SHIPPED：主按钮 “Re-ship”
- FAILED_EXPORT：主按钮 “Retry export”

### 7.2 行为策略
- READY：触发 /export
- SHIPPED：触发 /export（带 export_key）
- FAILED_EXPORT：触发 /export 重试（同 export_key）

---

## 8. C9: DetailLayout（详情页框架）

### 8.1 结构（三段式）
1) Intent Zone（置顶）
2) Explain Zone（Summary + Score）
3) Act & Ship Zone（Todos + Card + Export）

### 8.2 面板顺序（强建议）
- Summary（先给事实）
- Score（再解释为什么）
- Todos（给行动）
- Card（给输出）
- Export（给交付）

### 8.3 版本显示
- 每个 artifact 面板右上角显示：
  - `system v3` / `user v2`
- user 版本默认高亮（表示“你已做决定”）

---

## 9. C11: ExportPanel（交付瞬间）

### 9.1 必含内容
- Card preview（来自 render_spec.payload.content）
- 导出按钮（PNG/MD/Caption）
- 最近一次导出记录（路径 + 时间）

### 9.2 降级体验
- 若 PNG 失败：
  - 明确提示 “PNG failed, shipped MD+Caption”
  - 仍允许 “Retry PNG”

---

## 10. 状态相关的骨架与空状态

### 10.1 In Progress
- 列表中每条 item 的 ReasonsPeek 用 skeleton
- Detail 显示 step list（Extract/Summary/Score/Todos/Card）
- 失败时直接定位到失败 step，并展示 retry

### 10.2 Empty Inbox
空状态文案（MVP 推荐）：
- 标题：`Your queue is clear.`
- 副文案：`Capture something with a one-line intent. Close the tabs.`
- CTA：`How to capture`（指向 extension 使用说明）

---

## 11. 可访问性与可用性（MVP）
- 所有 primary CTA 可用键盘触达
- Reasons 展开不依赖 hover（必须可点击）
- Intent 编辑支持快捷保存（Cmd+Enter）

---

## 12. 设计验收（Design QA Checklist）
- [ ] 列表第一眼看到的是 Intent，不是 Title
- [ ] READY item 一眼能看到 Score + Reasons
- [ ] 10 秒内能做决策（读/跳过/归档/ship）
- [ ] Detail 的结构顺序符合 Read→Do（Explain → Act → Ship）
- [ ] 导出失败仍能 ship（md/caption）
- [ ] user 版本不会被 system 覆盖

---
