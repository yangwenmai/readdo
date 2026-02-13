# Read→Do（readdo）产品需求文档（PRD）
Version: 0.1 (MVP)
Owner: Mai Yang
Last Updated: 2026-02-13

---

## 1. 背景与要解决的问题

当我在浏览 YouTube、博客、Newsletter、聚合站文章时，最常见的行为是：在 Chrome 里打开大量 Tab，打算“稍后阅读”。这会导致：

1) Tab 不断堆积，形成“未读债务”（心理压力 + 注意力占用）。
2) 阅读被碎片化：每次切回浏览器看到一堆未读内容，就会想读一点，反复打断当前任务，整体效率下降。

**Read→Do 的目标**不是让用户读更多，而是把“兴趣捕捉”变成“可执行行动与可交付产物”，让用户可以安心关闭 Tab，把阅读从“负担”变成“可控的队列”。

---

## 2. 产品定位与核心主张

### 产品定位
Read→Do 是一个 AI-native 的“从读到做”系统：  
**Capture（捕捉）→ Decide（取舍）→ Do（行动）→ Ship（交付）**。

### Slogan
Save links less. Ship outputs more.

### 核心理念
- “收藏”不是终点；每条内容必须能沉淀为**行动建议（TODO）**或**输出物（内容卡片）**。
- 系统必须能解释它的建议（为什么值得读/不值得读），否则用户无法建立信任。

---

## 3. 非目标（MVP 不做什么）

MVP 版本不追求完整阅读器或复杂协作能力：

- 不做 RSS/订阅管理、不做阅读高亮批注、不做多端同步
- 不做团队协作与共享空间
- 不做语音输入（用户可用 Typeless 完成语音转文字后粘贴）
- 不做浏览器侧抓取全文（抓取与处理放在后台系统）
- 不追求“全自动完美判断”，但要求“可解释 + 可编辑 + 可回归”

---

## 4. 目标用户与使用场景

### 目标用户
- 知识工作者：产品/工程/管理者，内容输入多、输出要求高
- 内容输出者：需要快速提炼要点、形成可分享卡片
- 自我管理者：希望减少注意力碎片化，降低“未读债务”

### 核心场景
- 在网页上看到感兴趣内容 → 一键 Capture + 写一句“为什么存它” → 关闭 Tab，回到当前任务
- 稍后打开 Read→Do Inbox → 按匹配度/优先级快速取舍 → 读/不读/排队
- 对值得的内容：自动生成 TODO + 导出内容卡片，形成输出

---

## 5. 北极星指标与 MVP 成功标准

### 北极星指标（North Star）
- Capture → Action Rate：被捕捉内容中，进入 Do/Ship 的比例（生成 TODO 或导出卡片）
- Tab Debt Reduction（主观）：用户对“未读压力/Tab 堆积”的主观下降评分

### MVP 成功标准（定性 + 可验收）
- 用户能在 3 秒内完成一次 Capture（点击插件 → 输入 intent → 保存）
- Read→Do Inbox 能清楚呈现：
  - 匹配分（0-100）
  - 优先级（Read next / Worth it / If time / Skip）
  - 为什么（至少 3 条 reasons）
- 对每条 READY 内容：
  - 生成 TODO（3–7 条，含 ETA，至少 1 条“输出型任务”）
  - 生成内容卡片并可导出（PNG 或可替代的 HTML/Markdown）
- 系统能够处理失败（抓取/AI/导出失败时有可见状态与重试）

---

## 6. 产品范围（MVP 功能列表）

### 6.1 Chrome Extension（必须）
**目标：一键捕捉 + 最小意图输入**

功能：
1) 一键捕捉当前页面：
- 自动获取 URL、title、domain、source_type（粗分：web/youtube/newsletter/other）
2) 意图输入（文本）：
- 弹窗询问：Why save this?
- 用户输入一句“为什么要存它”
3) 提交：
- POST 到本地/私有 API：创建 Item（CAPTURED）
4) 即时反馈：
- 显示“Captured”并可一键打开 Read→Do Inbox

约束：
- Extension 不做正文抓取、不调用 AI、不做评分。

### 6.2 Backend Orchestrator（必须）
**目标：状态机 + pipeline 调度 + artifacts 版本化存储**

功能：
- 接收 capture 请求，写入 Item 与 intent
- 触发异步 pipeline（extract → summarize → score → todos → card）
- 写回状态机（PROCESSING/READY/FAILED_xxx）
- 提供 API 给 UI：列表、详情、触发重试/再生成、导出

### 6.3 Core Engine（必须，且可迁移）
**目标：将 AI 能力产品化为可治理的产物（Artifacts）**

产物（Artifacts）：
1) Summary：3 bullets + 1 insight
2) Score：match_score（0-100）+ priority + reasons（≥3）
3) Todos：3–7 条可执行任务（含 ETA、动词开头、至少 1 条输出型）
4) Card：可分享内容卡片数据（headline + 3 points + insight + action + hashtags?）

约束：
- 所有产物必须通过 schema 校验才能落库
- 每次生成都记录 meta（template_version / engine_version / created_at）

### 6.4 Read→Do Web App（必须）
**目标：决策队列 + 详情解释 + 编辑 + 导出**

页面：
- Inbox（默认）：按 priority/score 排序
- Item Detail：Decision Panel + Summary/TODO/Card tabs
- Shipped / Skip（可作为筛选或二级页）

核心交互：
- Inbox 每条都展示 intent（用户那句“为什么要存”）
- 详情展示 reasons（系统为什么建议读/跳过）
- Summary/TODO/Card 支持用户编辑（AI 产物必须可编辑）
- 一键导出 Card（PNG 优先；MVP 可先 HTML→PNG 或 HTML/MD）

---

## 7. 用户旅程与关键交互（MVP）

### 7.1 Capture（Extension）
步骤：
1) 用户在网页看到内容 → 点击插件
2) 弹窗展示：Why save this?
3) 用户输入 intent → Save
4) 系统提示：Captured（可关闭 Tab）

关键设计点：
- 输入框默认聚焦
- 文案强调“写一句理由”，而不是“收藏”
- 成功反馈鼓励用户关闭 Tab（降低未读债务）

### 7.2 Decide（Inbox）
步骤：
1) 用户打开 Inbox
2) 按优先级看到队列：Read next / Worth it / If time / Skip
3) 看到每条的 intent + score + 一句“建议理由摘要”
4) 点击进入详情做最终决定

### 7.3 Do（Todos）
步骤：
1) 在详情页看到 TODO（可编辑）
2) 用户选择执行/标记完成
3) 当关键 TODO 完成，内容进入“可交付状态”

### 7.4 Ship（Export Card）
步骤：
1) 用户点击 Export
2) 系统生成卡片文件（png/md/caption）
3) Item 状态标记为 SHIPPED（可撤回）

---

## 8. 信息架构（IA）

建议的导航结构（MVP 可做最小版）：
- Inbox（默认，处理 CAPTURED/PROCESSING/READY）
- Today（可选：只显示 Read next）
- Queue（Worth it / If time）
- Skip（系统判定 skip 或用户归档）
- Shipped（已导出/已完成）

Inbox 的核心不是“收藏列表”，而是“决策队列”。

---

## 9. 输出结构定义（Artifacts 契约，PRD 级别）

> 具体 schema 在 `docs/contracts/schemas/` 落地，本节只定义“必须包含什么”。

### 9.1 Summary（必须）
- bullets: string[3..5]
- insight: string（1 句）

### 9.2 Score（必须）
- match_score: number（0..100）
- priority: enum（READ_NEXT | WORTH_IT | IF_TIME | SKIP）
- reasons: string[>=3]
- (optional) confidence: 0..1

### 9.3 Todos（必须）
每条 TODO：
- title（动词开头）
- eta（10m/20m/30m/45m/1h/2h/3h+）
- why（可选：与 intent 对齐说明）
- type（READ | WRITE | BUILD | SHARE 等，MVP 可选）

约束：
- 数量 3..7
- 至少 1 条输出型任务（WRITE/SHARE/BUILD 类）

### 9.4 Card（必须）
- headline
- points（3条）
- insight（1句）
- action（1句）
- (optional) hashtags（0..5）

---

## 10. 匹配分与优先级规则（MVP 可解释模型）

MVP 采用可解释加权思路（不追求“最准确”，追求“可控 + 可解释”）：
- Intent Match（与 intent 对齐）40%
- Content Signal（信息密度/可操作性）25%
- Novelty（与近期保存的内容重复度低）20%
- Effort Fit（投入/时长与收益匹配）15%

优先级映射：
- READ_NEXT: score ≥ 80
- WORTH_IT: 60–79
- IF_TIME: 40–59
- SKIP: < 40（默认进 Skip，可手动恢复）

系统必须输出 reasons（≥3），理由要能指向 intent 或内容特征。

---

## 11. 状态机（MVP 级别）

- CAPTURED：已入库（事实+intent）
- QUEUED：等待处理
- PROCESSING：pipeline 执行中
- READY：产物齐全可消费
- FAILED_EXTRACTION / FAILED_AI / FAILED_EXPORT：失败可重试
- SHIPPED：已导出或完成闭环
- ARCHIVED：用户归档（含从 SKIP 转入）

所有状态转移由 Orchestrator 统一管理。

---

## 12. API 需求（PRD 级别）

最小 API：
- POST /capture
- GET /items (list, filters)
- GET /items/:id (detail + artifacts)
- POST /items/:id/process (retry/regenerate)
- POST /items/:id/export
- POST /items/:id/archive / unarchive

API 合约在 `docs/contracts/api.md` 或 openapi.yaml 落地。

---

## 13. 编辑能力（产品级要求）

AI 产物必须可编辑：
- 用户可改 Summary、Todos、Card 文案
- 编辑后记录为新 artifact 版本（human_edit = true）
- 再生成（regenerate）不会覆盖人工编辑版本，除非用户明确选择“覆盖”

---

## 14. 质量与评估（MVP 必须具备最小回归）

在 `docs/05-Quality-Evals.md` 与 `docs/evals/` 落地。MVP 最小要求：

- Schema 校验：所有 artifacts 必须通过
- 用例集：至少 10 条固定输入（extracted_text + intent）
- 断言规则示例：
  - reasons ≥ 3
  - todos 3..7 且含输出型任务
  - priority 与 score 区间一致
  - summary bullets 数量在范围内

目标：防止改模板/改引擎后质量漂移无法发现。

---

## 15. 安全与隐私（MVP）

- 默认本地优先（SQLite/本地服务），不强制上传第三方
- 明确告知：保存的内容、intent 属于用户私密数据
- 若引入外部模型调用，需明确开关与说明（MVP 可先用本地/私有环境）

---

## 16. MVP 里程碑（建议）

M0：Repo + docs 基座（PRD/System/Contracts/Evals 骨架）
M1：Extension capture → backend 入库（CAPTURED）
M2：pipeline 最小可跑：extract + summary（READY partial）
M3：score + todos + card（READY full）
M4：Web Inbox + Detail（展示 reasons、可编辑）
M5：Export card（png 或 html/md）+ shipped 状态

---

## 17. 风险与降级策略（MVP）

- 抓取失败：允许用户粘贴正文作为输入（manual content）
- AI 失败：保留 extraction，允许重试；UI 显示失败原因
- 导出失败：先提供 Markdown 导出作为降级
- 质量漂移：通过 evals 回归门槛拦截

---

## 18. 开放性与演进（产品长期方向）

Read→Do 的长期方向是“可插拔内容处理系统”：
- 更多 source_type（YouTube transcript、newsletter 邮件、PDF）
- 更多 templates（工程复盘卡、产品洞察卡、视频脚本卡）
- 更多 export targets（Notion/Obsidian/Todoist/Linear）
- 桌面化（Tauri）作为 Experience Layer 替换，不破坏 Core/Contracts/Evals

---
