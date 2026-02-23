# Read→Do 系统与技术规格（System & Tech Spec）
Version: 0.4
Last Updated: 2026-02-17

---

## 1. 设计目标与约束

### 设计目标
- **可解释**：score 提供双维度评分（intent_score + quality_score），synthesis 提供结合解答
- **可编辑**：AI 产物支持用户修改
- **可迁移**：Core Engine 与 UI/框架解耦，未来可替换前端
- **可测试**：核心逻辑接口驱动，覆盖单元测试与集成测试

### 约束
- Capture 仅在 Extension 端完成（url/title/domain/intent）
- 抓取/摘要/评分/TODO 均在后台执行
- 本地优先：SQLite 存储，单进程部署
- 不依赖外部队列或消息中间件

---

## 2. 系统架构

### 2.1 分层结构

```
Chrome Extension ──POST /capture──→ Backend API ──→ SQLite
                                      ↕
Web App ←──GET/PATCH/POST/DELETE──→ Backend API ──→ Core Engine
```

| 层 | 职责 | 不做 |
|---|---|---|
| **Capture**（Extension） | 收集 url/title/domain/intent，POST /capture | 不做抓取、AI |
| **Backend**（API + Worker） | 状态管理、调度 pipeline、写入 artifacts | 不做 UI |
| **Core Engine**（纯逻辑） | pipeline steps + 多模型抽象 | 不依赖框架/数据库 |
| **Web App** | 展示 Inbox/Detail/Archive、搜索、批量操作 | 不做 pipeline 逻辑 |

### 2.2 部署形态
- 本地后台服务（localhost:PORT）+ SQLite file
- Web App 通过 API 访问 local backend
- Extension 通过 fetch 调用 local API

---

## 3. 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| Backend | Go（net/http stdlib） | 单二进制、零依赖框架 |
| 数据库 | SQLite（modernc.org/sqlite） | 本地优先，WAL mode |
| Core Engine | Go package | 纯接口，不依赖框架 |
| 抓取 | HTTP fetch + go-readability | 轻量提取正文 |
| LLM | ModelClient 接口 | OpenAI / Claude / Gemini / Ollama |
| Web App | React 19 + Vite + TypeScript | CSS Modules + React Router |
| Extension | Chrome Manifest V3 | Popup + fetch |
| CI | GitHub Actions | go test + go vet + tsc --noEmit |

---

## 4. 项目结构

```
readdo/
├── cmd/server/            # 入口，启动 API + Worker
├── internal/
│   ├── api/               # HTTP handlers + 路由
│   │   ├── server.go      # 路由注册 + 中间件
│   │   ├── handlers.go    # 全部 handler 实现
│   │   └── handlers_test.go
│   ├── config/            # 环境变量 → Config 结构体
│   ├── engine/            # Core Engine
│   │   ├── interfaces.go  # ModelClient / PipelineStep 接口
│   │   ├── pipeline.go    # Pipeline 编排
│   │   ├── steps.go       # 4 个 Step 实现
│   │   ├── prompts.go     # Prompt 模板
│   │   ├── openai.go      # OpenAI 客户端
│   │   ├── claude.go      # Claude 客户端
│   │   ├── gemini.go      # Gemini 客户端
│   │   ├── ollama.go      # Ollama 客户端
│   │   └── pipeline_test.go
│   ├── model/             # 领域模型
│   │   ├── item.go        # Item / Artifact / Intent / ItemFilter
│   │   └── item_test.go
│   ├── store/             # SQLite 数据访问
│   │   ├── interfaces.go  # ItemReader / ItemWriter 接口
│   │   ├── store.go       # 实现 + Migration
│   │   └── store_test.go
│   └── worker/            # 后台 Worker
├── web/                   # React Web App
├── extension/             # Chrome Extension
├── docs/                  # PRD / UX Spec / Tech Spec
└── .github/workflows/     # CI（ci.yml）
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
  source_type TEXT NOT NULL,
  intent_text TEXT,
  status      TEXT NOT NULL,       -- CAPTURED / PROCESSING / READY / FAILED / ARCHIVED
  priority    TEXT,                -- DO_FIRST / PLAN_IT / SKIM_IT / LET_GO
  match_score REAL,
  error_info  TEXT,
  save_count  INTEGER DEFAULT 1,  -- 同 URL 重复捕捉计数
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
  artifact_type TEXT NOT NULL,     -- extraction / synthesis / score / todos
  payload       TEXT NOT NULL,     -- JSON
  created_by    TEXT NOT NULL,     -- system / user
  created_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_artifacts_unique ON artifacts(item_id, artifact_type);
```

### 5.3 intents 表

```sql
CREATE TABLE intents (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id),
  intent_text TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_intents_item ON intents(item_id);
```

> 同 URL 多次 capture 时，每次 intent 追加到 intents 表，items.intent_text 合并为最新。

### 5.4 error_info 结构

```json
{
  "failed_step": "synthesize",
  "message": "LLM request timeout",
  "retryable": true,
  "failed_at": "2026-02-14T10:00:00Z"
}
```

### 5.5 Migration

采用版本号递增迁移：`migrateV1`（items + artifacts）→ `migrateV2`（save_count）→ `migrateV3`（intents）。
`schema_version` 存储在 SQLite `user_version` pragma 中。

---

## 6. 状态机

### 状态转移

```
CAPTURED → PROCESSING → READY ↔ ARCHIVED
                ↓
              FAILED
                ↓
         (retry) → CAPTURED
```

| 转移 | 触发 |
|------|------|
| CAPTURED → PROCESSING | Worker 取到任务（原子 UPDATE 作为隐式锁） |
| PROCESSING → READY | 所有产物成功生成 |
| PROCESSING → FAILED | 任一步失败 |
| FAILED → CAPTURED | 用户 Retry |
| READY → ARCHIVED | 用户归档 |
| ARCHIVED → READY | 用户恢复 |

### 并发保护
- Worker 通过 `status=CAPTURED` → `PROCESSING` 原子更新作为锁
- 服务重启时 `ResetStaleProcessing` 将残留 PROCESSING 重置为 CAPTURED

### 用户可设置状态
`ValidateTransition` 限制用户只能设置 ARCHIVED 和 READY（恢复），其他状态由系统管理。

---

## 7. Pipeline

### 7.1 处理流程

| Step | 输入 | 输出 Artifact |
|------|------|---------------|
| **ExtractStep** | url, source_type | extraction：normalized_text + content_meta |
| **SynthesizeStep** | normalized_text + intent | synthesis：points[3] + insight |
| **ScoreStep** | intent + synthesis + content_meta | score：intent_score + quality_score + final_score + priority |
| **TodoStep** | intent + synthesis + priority | todos：tasks[3-7]（含 ETA） |

- 全部成功 → `status=READY`，同步更新 `items.priority` 和 `items.match_score`
- 任一步失败 → `status=FAILED`，写入 `error_info`（含 `failed_step`）
- Step 错误包装为 `StepError{Step, Err}` 便于定位

### 7.2 Core Engine 接口

```go
type PipelineStep interface {
    Name() string
    Run(ctx context.Context, input StepInput) (StepOutput, error)
}

type ModelClient interface {
    Complete(ctx context.Context, prompt string) (string, error)
}

type ContentExtractor interface {
    Extract(ctx context.Context, url string) (*ExtractedContent, error)
}
```

### 7.3 多模型支持

通过 `ModelClient` 接口抽象，`LLM_PROVIDER` 配置决定使用哪个实现：

| Provider | 实现 | API 端点 | 默认模型 |
|----------|------|---------|---------|
| `openai` | `OpenAIClient` | `api.openai.com/v1/chat/completions` | gpt-4o-mini |
| `claude` | `ClaudeClient` | `api.anthropic.com/v1/messages` | claude-sonnet-4-20250514 |
| `gemini` | `GeminiClient` | `generativelanguage.googleapis.com` | gemini-2.0-flash |
| `ollama` | `OllamaClient` | `localhost:11434/api/generate` | llama3 |

无 API key 时自动降级为 `StubModelClient`（返回模拟数据），Ollama 无需 key。

### 7.4 Worker 实现

```
loop:
  1. ClaimNextCaptured（原子 SELECT + UPDATE）
  2. 依次执行 pipeline steps
  3. 成功 → READY；失败 → FAILED
  4. sleep 3s，回到 1
```

---

## 8. API 设计

| Method | Path | 说明 | 约束 |
|--------|------|------|------|
| POST | /api/capture | 创建 item / 合并重复 URL | — |
| GET | /api/items | 列表 + 筛选（status/priority/q） | — |
| GET | /api/items/:id | 详情 + artifacts + intents | — |
| DELETE | /api/items/:id | 级联删除（intents + artifacts + item） | 非 PROCESSING |
| POST | /api/items/:id/retry | 重试（→CAPTURED） | 仅 FAILED |
| POST | /api/items/:id/reprocess | 重新处理（→CAPTURED） | — |
| PATCH | /api/items/:id/status | 状态变更 | ValidateTransition |
| PUT | /api/items/:id/artifacts/:type | 编辑 artifact | 仅 READY |
| POST | /api/items/batch/status | 批量状态变更 | 返回 affected count |
| POST | /api/items/batch/delete | 批量删除 | 返回 deleted count |

### 搜索

`GET /api/items?q=keyword` 对 `title`、`domain`、`intent_text` 执行 `LIKE %keyword%` 匹配。

### 批量操作请求格式

```json
// POST /api/items/batch/status
{ "ids": ["id1", "id2"], "status": "ARCHIVED" }

// POST /api/items/batch/delete
{ "ids": ["id1", "id2"] }
```

### 关键行为
- `/capture` 立即返回 item_id + status=CAPTURED，不等待处理
- `/capture` 同 URL 重复提交：合并 intent，save_count++，若非 PROCESSING 则重新入队
- `/retry` 清除 error_info，状态回到 CAPTURED
- 编辑 artifact 时 `created_by` 标记为 `user`
- DELETE 操作事务内级联删除 intents → artifacts → item

---

## 9. Store 层

### 接口设计

```go
type ItemReader interface {
    GetItem(ctx, id) (*Item, error)
    ListItems(ctx, ItemFilter) ([]Item, error)
    FindItemByURL(ctx, url) (*Item, error)
}

type ItemWriter interface {
    CreateItem(ctx, Item) error
    UpdateItemStatus(ctx, id, status, errorInfo) error
    UpdateItemScoreAndPriority(ctx, id, score, priority) error
    UpdateItemForReprocess(ctx, id, intentText, saveCount) error
    DeleteItem(ctx, id) error
    BatchUpdateStatus(ctx, ids, status) (int64, error)
    BatchDeleteItems(ctx, ids) (int64, error)
}

type ItemClaimer interface {
    ClaimNextCaptured(ctx) (*Item, error)
    ResetStaleProcessing(ctx) (int, error)
}
```

### ListItems 搜索实现

```sql
WHERE (title LIKE ? OR domain LIKE ? OR intent_text LIKE ?)
```

### DeleteItem 事务

```sql
BEGIN;
DELETE FROM intents WHERE item_id = ?;
DELETE FROM artifacts WHERE item_id = ?;
DELETE FROM items WHERE id = ?;
COMMIT;
```

---

## 10. Chrome Extension

- Manifest V3，Popup 页面
- `chrome.tabs` 获取当前 tab url/title
- 用户输入 intent → POST /api/capture
- 成功："Captured! Safe to close this tab."
- Backend 配置 CORS 允许 Extension origin

---

## 11. 测试策略

### 测试覆盖

| 包 | 测试类型 | 说明 |
|----|---------|------|
| `model` | 单元测试 | NewItem / MergeIntent / ValidateTransition |
| `store` | 集成测试 | 临时文件 SQLite，覆盖全部 CRUD + 批量 + Migration |
| `engine` | 单元测试 | StubModelClient，验证 Pipeline 编排和错误处理 |
| `api` | 集成测试 | httptest + 真实 Store，覆盖全部 handler |

### 测试工具
- `testing.T` + `t.TempDir()`（SQLite 临时文件）
- `net/http/httptest`（API 层）
- `StubModelClient`（替代真实 LLM）
- `-race` 竞态检测

---

## 12. CI / CD

### GitHub Actions（`.github/workflows/ci.yml`）

| Job | Steps |
|-----|-------|
| `go` | checkout → setup-go → `go vet ./...` → `go test -race -coverprofile` → `go build` |
| `frontend` | checkout → setup-node → `npm ci` → `npx tsc --noEmit` |

触发条件：push / PR to `master` / `main`。

---

## 13. 安全与隐私

- LLM API Key 仅存于 backend 环境变量，不进入 Extension
- SQLite 文件在用户本地，数据不上传第三方
- 可通过 Ollama 实现完全离线（无需外部 API key）

---

## 14. 验收清单

| 项目 | 验收标准 |
|------|---------|
| Capture | Extension 一键 capture + intent，3 秒内完成 |
| Pipeline | CAPTURED → READY，产物齐全 |
| 多模型 | 4 种 LLM provider 可切换 |
| Inbox | 搜索 + 筛选 + 批量操作 |
| Detail | 展示全部产物，可编辑、可删除 |
| Archive | 归档/恢复/搜索可用 |
| 失败处理 | FAILED 可见 + Retry 可用 |
| 测试 | model/store/engine/api 测试通过 |
| CI | GitHub Actions 绿色 |
