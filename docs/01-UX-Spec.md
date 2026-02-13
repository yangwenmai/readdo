# Read→Do UX 规格（MVP）
Location: docs/01-UX-Spec.md
Version: 0.1
Last Updated: 2026-02-13

---

## 0. UX North Star
**从“Tab 堆积的注意力债”到“输出交付的行动系统”。**

Aha moment 不来自“更强的总结”，而来自：
- 你保存时写下的那句 intent，后面被系统反复拿来“解释与驱动行动”
- Inbox 不再是书签列表，而是一个“决策队列”
- 每条内容最终都会变成可分享的“卡片输出”，而不是被遗忘

---

## 1. 核心用户旅程（MVP）
Capture（1 秒） → Decide（10 秒） → Do（10~30 分钟） → Ship（1 次点击）

### 1.1 Capture（Chrome Extension）
- 用户点击插件
- 弹窗只问 1 个问题：**“Why save this?”**
- 保存成功后给 2 个 CTA：
  - `Open Inbox`
  - `Save another`（不打断）

**MVP 不做语音**（你已确认），intent 纯文字。

### 1.2 Decide（Inbox）
Inbox 是“队列”不是“列表”。每条 item 的默认卡片展示必须包含：
- title + domain
- intent_text（高优先级展示）
- priority + match_score
- reasons（默认折叠，hover/展开 1 秒看懂）

**决策动作（最小）**
- `Read Next`（保持 READY，标记为 READ_NEXT）
- `Queue`（如果需要：可选，MVP 可不做）
- `Skip`（archive，原因=SYSTEM_SKIP 或 USER_ARCHIVE）

> 设计原则：让用户用 10 秒做决定，而不是继续“打开 tab”。

### 1.3 Do（Detail）
Detail 页面结构（建议三段式）：
1) **Intent Header**
   - intent_text 置顶，允许编辑（编辑会生成 item-level intent version；MVP 可先直接改写 items.intent_text）
2) **Explain**
   - Summary（bullets + insight）
   - Score（priority/score + reasons）
3) **Act**
   - Todos（可编辑，生成 user version）
   - Card Preview（从 card artifact 渲染）
   - Export（ship）

### 1.4 Ship（Export）
Export 是一个“交付瞬间”：
- 默认导出 PNG + caption
- 若 PNG 失败，必须仍能导出 caption + md（保证 ship）

导出完成后：
- item 进入 SHIPPED
- 显示最近导出记录（路径/时间）

---

## 2. 信息架构（IA）

### 2.1 顶层导航（MVP）
- Inbox（默认）
- Shipped
- Archived
- Settings（可后置）

### 2.2 Inbox 默认分组（按 priority）
- READ_NEXT
- WORTH_IT
- IF_TIME
- SKIP（可隐藏或折叠）

---

## 3. 关键交互规格（Interaction Contracts）

### 3.1 Reasons 展示规则
- reasons 默认只展示前 1 条 + “+2 more”
- 展开后显示全部 reasons（3~6）
- 每条 reasons 必须是“具体线索”，禁止泛化（与 rubric 对齐）

### 3.2 编辑行为与版本化
- 编辑 Todos/Card：写入 artifacts 新版本（created_by=user）
- regenerate：生成新 system 版本，不覆盖 user 版本
- UI 默认展示 user 版本（如存在）

### 3.3 Loading/Processing 反馈
- item PROCESSING 时：
  - Inbox 行内展示 step（可选）或“Processing…”
  - Detail 展示 progress list（Extract / Summary / Score / Todos / Card）
- 失败：
  - 展示 message + Retry
  - Retry 不新增重复 job（幂等）

---

## 4. 视觉与排版（Design System for MVP）
- 强层级：Intent > Priority/Score > Reasons > Todos > Card
- Intent 使用“高对比、可扫描”的样式（这就是 Aha 的开关）
- 卡片导出采用固定画布：
  - 4:5（1080x1350）为默认
  - LIGHT/DARK 主题（MVP 先 LIGHT）

---

## 5. MVP 可用性验收（UX）
- Capture ≤ 2 步完成（点击 + 输入 + 保存）
- Inbox 每条 item 10 秒内可做决策（信息齐备）
- Detail 里“为什么建议读”可被快速解释（reasons）
- 至少 1 个输出型 todo（WRITE/SHARE/BUILD/DECIDE）
- 一键导出（失败也能 ship）

---
