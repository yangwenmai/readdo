# Read→Do（readdo）产品需求文档（PRD）
Version: 0.4
Owner: Mai Yang
Last Updated: 2026-02-17

---

## 1. 背景与要解决的问题

浏览 YouTube、博客、Newsletter、聚合站时，最常见的行为是：在 Chrome 里打开大量 Tab，打算"稍后阅读"。这导致：

1. Tab 不断堆积，形成"未读债务"（心理压力 + 注意力占用）
2. 阅读被碎片化：切回浏览器看到未读内容，反复打断当前任务

**Read→Do 的目标**：把"兴趣捕捉"变成"可执行行动"，让用户安心关闭 Tab，把阅读从"负担"变成"可控的队列"。

---

## 2. 产品定位

Read→Do 是一个 AI-native 的"从读到做"系统：
**Capture（捕捉）→ Decide（取舍）→ Do（行动）**

Slogan：Save less. Do more.

核心理念：
- "收藏"不是终点；每条内容必须沉淀为**可执行的行动建议（TODO）**
- 系统必须能解释它的建议（为什么值得读/不值得读），让用户建立信任

---

## 3. 非目标

- 不做 RSS/订阅管理、阅读高亮批注、多端同步
- 不做团队协作
- 不做导出卡片 / PNG 渲染
- 不做浏览器侧全文抓取（抓取放在后台）
- 不追求"全自动完美判断"，但要求"可解释 + 可编辑"

---

## 4. 目标用户与核心场景

**目标用户**：知识工作者、内容输出者——内容输入多、输出要求高、希望减少注意力碎片化。

**核心场景**：
1. 网页上看到内容 → 一键 Capture + 写一句"为什么存它" → 关闭 Tab
2. 打开 Inbox → 搜索/筛选 → 按优先级快速取舍
3. 对值得的内容 → 查看 AI 生成的摘要和 TODO → 逐条执行
4. 批量归档或删除不需要的条目

---

## 5. 成功标准

- 用户能在 3 秒内完成一次 Capture
- Inbox 清楚呈现：匹配分（0-100）、优先级、建议理由（≥3 条）
- 对每条 READY 内容可查看摘要和 TODO，且支持编辑
- 失败时有可见状态与重试
- 搜索结果即时响应（<300ms）
- 批量操作支持多选 + 一键归档/删除

---

## 6. 功能范围

### 6.1 Chrome Extension
一键捕捉当前页面（URL/title/domain/source_type）+ 意图输入（Why save this?）→ POST 到后端 → 显示 Captured。
Extension 不做正文抓取、不调用 AI。同一 URL 重复捕捉自动合并 Intent。

### 6.2 Backend
接收 capture 请求 → 调度处理（提取/总结/评分/生成 TODO）→ 更新状态 → 提供 API 给前端。
支持多种 LLM 后端（OpenAI / Claude / Gemini / Ollama）。

### 6.3 Core Engine（AI 产物）
- **Summary**：3 bullets + 1 insight
- **Score**：match_score（0-100）+ priority（Read next / Worth it / If time / Skip）+ reasons（≥3）
- **Todos**：3–7 条可执行任务（动词开头，含 ETA，至少 1 条输出型）

AI 产物必须可编辑，用户可修改 Summary 和 Todos。

### 6.4 Web App
- **Inbox**（默认）：搜索、筛选、按 priority/score 排序，支持多选 + 批量归档/删除
- **Item Detail**：展示 Summary / TODO，支持编辑、删除
- **Archive**：已归档的内容，支持搜索、恢复

---

## 7. 用户旅程

1. **Capture**：用户看到内容 → 点击插件 → 输入 intent → Save → 关闭 Tab
2. **Decide**：打开 Inbox → 搜索/筛选 → 按优先级查看 → 进入详情做决定
3. **Do**：详情页查看/编辑 TODO → 逐条执行/标记完成 → 全部完成后归档
4. **Clean up**：多选不需要的条目 → 批量归档或删除

---

## 8. 状态机

| 状态 | 含义 |
|------|------|
| CAPTURED | 已入库，等待处理 |
| PROCESSING | 处理中 |
| READY | 产物齐全，可消费 |
| FAILED | 处理失败，可重试 |
| ARCHIVED | 用户归档（完成或跳过） |

---

## 9. API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/capture` | 创建 item（重复 URL 自动合并） |
| `GET` | `/api/items` | 列表 + 筛选（status / priority / 全文搜索 q） |
| `GET` | `/api/items/:id` | 详情 + 产物 |
| `DELETE` | `/api/items/:id` | 删除 item（级联） |
| `POST` | `/api/items/:id/retry` | 重试 |
| `POST` | `/api/items/:id/reprocess` | 重新处理 |
| `PATCH` | `/api/items/:id/status` | 状态变更（归档/恢复） |
| `PUT` | `/api/items/:id/artifacts/:type` | 编辑 artifact |
| `POST` | `/api/items/batch/status` | 批量更新状态 |
| `POST` | `/api/items/batch/delete` | 批量删除 |

---

## 10. 安全与隐私

- 默认本地优先（SQLite），不强制上传第三方
- 用户内容与 intent 为私密数据
- 外部模型调用需有明确开关（可切换 Ollama 本地模型实现完全离线）

---

## 11. 里程碑

- ~~M1：Extension capture → 后端入库（CAPTURED）~~
- ~~M2：最小 pipeline：extract + summary + score（READY partial）~~
- ~~M3：todos（READY full）~~
- ~~M4：Web Inbox + Detail（展示 + 编辑）~~
- ~~M5：搜索 + 删除 + 批量操作~~
- ~~M6：多模型支持（Claude / Gemini / Ollama）~~
- ~~M7：测试覆盖 + GitHub Actions CI~~
- M8：更多来源（YouTube 字幕 / Newsletter / PDF）
- M9：SSE 实时推送 / 导出集成
