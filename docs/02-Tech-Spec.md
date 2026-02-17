# Read→Do 系统与技术规格（System & Tech Spec）
Version: 0.2 (MVP)
Last Updated: 2026-02-14

---

## 1. 设计目标与约束

### 设计目标
- **可解释**：score/priority 必须有 reasons，可指向 intent 与内容特征
- **可编辑**：AI 产物支持用户修改
- **可迁移**：Core Engine 与 UI/框架解耦，未来可替换前端（如 Tauri）

### MVP 约束
- Capture 仅在 Extension 端完成（提交 url/title/domain/intent）
- 抓取/摘要/评分/TODO 均在后台执行
- 本地优先：SQLite 存储，单进程部署
- 不依赖外部队列或消息中间件
- 不做导出卡片 / PNG 渲染

---

## 2. 系统架构

### 2.1 分层结构

```
Chrome Extension ──POST /capture──→ Backend API ──→ SQLite
                                      ↕
Web App ←──GET/PATCH/POST──→ Backend API ──→ Core Engine
```

| 层 | 职责 | 不做 |
|---|---|---|
| **Capture**（Extension） | 收集 url/title/domain/intent，POST /capture | 不做抓取、AI、评分 |
| **Backend**（API + Worker） | 状态管理、调度 pipeline、写入 artifacts、对外 API | 不做 UI |
| **Core Engine**（纯逻辑） | pipeline steps（extract/summarize/score/todo） | 不依赖 Web 框架、数据库 |
| **Web App** | 展示 Inbox、详情、编辑 | 不内置评分/pipeline 逻辑 |

### 2.2 部署形态（MVP）
- 本地后台服务（localhost:PORT）+ SQLite file
- Web App 通过 API 访问 local backend
- Extension 通过 fetch 调用 local API

---

## 3. 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| Backend | Go | 单二进制、部署简单、并发原生 |
| 数据库 | SQLite（go-sqlite3 / modernc） | 本地优先，零运维 |
| Core Engine | Go package | 纯接口，不依赖框架 |
| 抓取 | HTTP fetch + go-readability | 轻量提取正文 |
| LLM | ModelClient 接口 | 可接 OpenAI / 本地模型 |
| Web App | React（Vite） | 轻量 SPA，调用 Backend API |
| Extension | Chrome Manifest V3 | Popup + fetch |

---

## 4. 项目结构

```
readdo/
├── cmd/
│   └── server/         # 入口，启动 API + Worker
├── internal/
│   ├── api/            # HTTP handlers（路由、请求/响应）
│   ├── engine/         # Core Engine（pipeline steps）
│   │   ├── extract.go
│   │   ├── summarize.go
│   │   ├── score.go
│   │   └── todo.go
│   ├── model/          # 领域模型（Item, Artifact 结构体）
│   ├── store/          # SQLite 数据访问
│   └── worker/         # 后台 worker（消费任务）
├── web/                # Web App（React）
├── extension/          # Chrome Extension
└── docs/
    ├── 00-PRD.md
    ├── 01-UX-Spec.md
    └── 02-Tech-Spec.md
```

---

## 5. 数据模型

### 5.1 items 表

```sql
CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  title       TEXT,
  domain      TEXT,
  source_type TEXT NOT NULL,       -- web / youtube / newsletter / other
  intent_text TEXT,
  status      TEXT NOT NULL,       -- CAPTURED / PROCESSING / READY / FAILED / ARCHIVED
  priority    TEXT,                -- READ_NEXT / WORTH_IT / IF_TIME / SKIP（AI 填入）
  match_score REAL,               -- 0-100（AI 填入）
  error_info  TEXT,               -- 失败时的 JSON 信息
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_items_status ON items(status, updated_at);
CREATE INDEX idx_items_priority ON items(priority, match_score DESC);
```

### 5.2 artifacts 表

```sql
CREATE TABLE artifacts (
  id            TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES items(id),
  artifact_type TEXT NOT NULL,     -- extraction / summary / score / todos
  payload       TEXT NOT NULL,     -- JSON 内容
  created_by    TEXT NOT NULL,     -- system / user
  created_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_artifacts_unique ON artifacts(item_id, artifact_type);
```

> MVP 简化：每种 artifact_type 每个 item 只保留一条。Regenerate 或用户编辑直接 upsert。

### 5.3 error_info 结构

```json
{
  "failed_step": "summarize",
  "message": "LLM request timeout",
  "retryable": true,
  "failed_at": "2026-02-14T10:00:00Z"
}
```

---

## 6. 状态机

### 状态定义

| 状态 | 含义 |
|------|------|
| CAPTURED | 已入库，等待处理 |
| PROCESSING | pipeline 执行中 |
| READY | 产物齐全，可消费 |
| FAILED | 处理失败，可重试 |
| ARCHIVED | 用户归档（完成或跳过） |

### 状态转移

```
CAPTURED → PROCESSING → READY ↔ ARCHIVED
                ↓
              FAILED
                ↓
         (retry) → CAPTURED
```

| 转移 | 触发条件 |
|------|---------|
| CAPTURED → PROCESSING | Worker 取到任务 |
| PROCESSING → READY | 所有产物生成成功 |
| PROCESSING → FAILED | 任一步失败 |
| FAILED → CAPTURED | 用户点击 Retry |
| READY → ARCHIVED | 用户归档（完成或跳过） |
| ARCHIVED → READY | 用户恢复 |

### 并发保护
- 同一 item 不会被多个 goroutine 同时处理（Worker 通过 status=CAPTURED 原子更新为 PROCESSING 作为锁）
- 服务重启时，将残留的 PROCESSING 状态重置为 CAPTURED

---

## 7. Pipeline

### 7.1 处理流程

Worker 取到 CAPTURED item 后，依次执行：

| Step | 输入 | 输出 Artifact |
|------|------|---------------|
| **ExtractStep** | url, source_type | extraction：normalized_text + content_meta |
| **SummarizeStep** | normalized_text + intent | summary：bullets[3] + insight |
| **ScoreStep** | intent + summary + content_meta | score：match_score + priority + reasons[≥3] |
| **TodoStep** | intent + summary + priority | todos：tasks[3-7]（含 ETA） |

- 全部成功 → `status=READY`，同步更新 `items.priority` 和 `items.match_score`
- 任一步失败 → `status=FAILED`，写入 `error_info`（含 failed_step）

### 7.2 Core Engine 接口

```go
// 每个 Step 实现此接口
type PipelineStep interface {
    Name() string
    Run(ctx context.Context, input StepInput) (StepOutput, error)
}

// 外部依赖通过接口注入
type ModelClient interface {
    Complete(ctx context.Context, prompt string) (string, error)
}

type ContentExtractor interface {
    Extract(ctx context.Context, url string) (*ExtractedContent, error)
}
```

### 7.3 Worker 实现

```
loop:
  1. SELECT item WHERE status='CAPTURED' ORDER BY created_at LIMIT 1
  2. UPDATE status='PROCESSING'（原子，作为隐式锁）
  3. 依次执行 pipeline steps
  4. 成功 → READY；失败 → FAILED
  5. sleep，回到 1
```

MVP 使用轮询模式，间隔 2-5 秒。后续可优化为事件驱动。

---

## 8. API 设计

| Method | Path | 说明 | 状态约束 |
|--------|------|------|---------|
| POST | /api/capture | 创建 item（→CAPTURED） | — |
| GET | /api/items | 列表 + 筛选（status/priority） | — |
| GET | /api/items/:id | 详情 + 全部 artifacts | — |
| POST | /api/items/:id/retry | 重试（→CAPTURED 重新入队） | 仅 FAILED |
| PATCH | /api/items/:id/status | 状态变更（archive/restore） | 非 PROCESSING |
| PUT | /api/items/:id/artifacts/:type | 用户编辑 artifact | 仅 READY |

### 关键行为
- `/capture` 立即返回 item_id + status=CAPTURED，不等待处理
- `/retry` 清除 error_info，状态回到 CAPTURED
- 编辑 artifact 时 `created_by` 标记为 `user`

---

## 9. 抓取策略（ExtractStep）

### 主路径
1. HTTP GET 获取 HTML
2. Readability 提取正文
3. 规范化：去多余空白、保留段落、限制 ~15k 字符

### 降级
- fetch 失败 → FAILED（retryable=true）
- Readability 解析失败 → FAILED（后续可补"用户手动粘贴"能力）

---

## 10. Chrome Extension

- Manifest V3，Popup 页面
- `chrome.tabs` 获取当前 tab url/title
- 用户输入 intent → POST /api/capture
- 成功："Captured! Safe to close this tab." + "Open Inbox" 链接
- 本地服务不可达：提示"Please start readdo server first"
- Backend 配置 CORS 允许 Extension origin

---

## 11. 安全与隐私

- LLM API Key 仅存于 backend（环境变量 / 本地配置文件），不进入 Extension
- SQLite 文件在用户本地，数据不上传第三方
- 外部模型调用可通过配置开关关闭

---

## 12. MVP 验收清单

| 项目 | 验收标准 |
|------|---------|
| Capture | Extension 一键 capture + intent，3 秒内完成 |
| Pipeline | CAPTURED → READY，产物齐全（summary/score/todos） |
| Inbox | 列表展示 intent / priority / score / reasons |
| Detail | 展示全部产物，Summary 和 Todos 可编辑 |
| Archive | 归档/恢复可用 |
| 失败处理 | FAILED 状态可见 + Retry 可用 |
