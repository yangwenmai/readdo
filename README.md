# Read→Do (readdo)

**Save less. Do more.**

Read→Do 是一个 AI-native 的"从读到做"系统，把浏览器里堆积的 Tab 变成可执行的行动队列。

**Capture（捕捉）→ Decide（取舍）→ Do（行动）**

- 一键捕捉链接 + 写一句"为什么存它"
- AI 自动生成摘要、评分、行动建议（Todos）
- 多模型支持（OpenAI / Claude / Gemini / Ollama）
- 本地优先（Go + SQLite），零运维

---

## 项目结构

```
cmd/server/          Go 后端入口（API + Worker）
internal/
  api/               REST API 路由 & 处理器
  config/            配置（环境变量 → 结构体）
  engine/            Core Engine（Pipeline + AI Steps + 多模型客户端）
  model/             领域模型（Item / Artifact / Intent / Error）
  store/             SQLite 数据访问层
  worker/            后台处理 Worker
extension/           Chrome Extension（Manifest V3）
web/                 React + Vite Web 应用
  src/
    api/             API 客户端
    components/      通用组件（Layout / ItemCard / Toast / PriorityBadge）
    pages/           页面（Inbox / Detail / Archive）
    styles/          设计体系 CSS 变量 & 全局样式
docs/                PRD / UX Spec / Tech Spec
.github/workflows/   CI（Go test + vet + TS typecheck）
```

---

## 快速开始

### 前提条件

- Go 1.25+
- Node.js 18+
- Chrome 浏览器

### 1) 启动后端

```bash
# Stub 模式（无需 API key，返回模拟数据，适合开发调试）
go run ./cmd/server/

# OpenAI 模式
OPENAI_API_KEY=sk-xxx go run ./cmd/server/

# Claude 模式
LLM_PROVIDER=claude ANTHROPIC_API_KEY=sk-ant-xxx go run ./cmd/server/

# Ollama 本地模型
LLM_PROVIDER=ollama go run ./cmd/server/
```

看到 `readdo server listening on http://localhost:8080` 即启动成功。

**环境变量：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8080` | HTTP 监听端口 |
| `DB_PATH` | `readdo.db` | SQLite 数据库文件路径 |
| `LLM_PROVIDER` | `openai` | LLM 提供商：`openai` / `claude` / `gemini` / `ollama` |
| `OPENAI_API_KEY` | (空) | OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI 模型名 |
| `ANTHROPIC_API_KEY` | (空) | Anthropic Claude API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Claude 模型名 |
| `GEMINI_API_KEY` | (空) | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini 模型名 |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama 服务地址 |
| `OLLAMA_MODEL` | `llama3` | Ollama 模型名 |

### 2) 启动前端

```bash
cd web
npm install   # 首次需要
npm run dev
```

浏览器打开 **http://localhost:5173**。

> Vite 已配置 `/api` 代理到后端 `localhost:8080`，开发时无需额外配置。

### 3) 加载 Chrome Extension

1. Chrome 地址栏输入 `chrome://extensions/`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择项目根目录下的 `extension/` 文件夹
4. 将扩展固定到工具栏

---

## 使用流程

### Capture（捕捉）

打开任意网页 → 点击扩展图标 → 输入一句「为什么存这个？」→ 点 Save → 关闭 Tab。

同一 URL 多次捕捉会自动合并 Intent 并重新处理，save_count 递增。

### Decide（取舍）

打开 Inbox，AI 会自动处理捕捉的链接（约 3-5 秒），生成：

- **匹配分**（0-100）
- **优先级**（Read next / Worth it / If time / Skip）
- **推荐理由**（≥3 条）

卡片按优先级自动分组排列。支持**搜索**（标题/域名/意图）和**批量操作**（归档/删除）。

### Do（行动）

点击卡片进入详情页：

- **Summary**：3 条核心要点 + 1 条洞察
- **Todos**：3-7 条可执行任务（含预计时间）

Summary 和 Todos 均支持编辑。勾选完所有 Todos 后会提示归档。可删除不需要的条目。

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/capture` | 捕捉链接（重复 URL 自动合并） |
| `GET` | `/api/items` | 列表（`?status=` / `?priority=` / `?q=`） |
| `GET` | `/api/items/:id` | 详情（含 artifacts + intents） |
| `DELETE` | `/api/items/:id` | 删除（级联删除关联数据） |
| `POST` | `/api/items/:id/retry` | 重试失败项 |
| `POST` | `/api/items/:id/reprocess` | 重新处理已完成项 |
| `PATCH` | `/api/items/:id/status` | 更新状态（归档/恢复） |
| `PUT` | `/api/items/:id/artifacts/:type` | 编辑 artifact（summary/todos） |
| `POST` | `/api/items/batch/status` | 批量更新状态 |
| `POST` | `/api/items/batch/delete` | 批量删除 |

---

## 核心架构

```
Chrome Extension ──POST /capture──→ Go Backend (API)
                                       │
                                       ├── Store (SQLite)
                                       │
                                       └── Worker (goroutine, 3s 轮询)
                                              │
                                              └── Pipeline
                                                   ├── Extract (HTTP + go-readability)
                                                   ├── Summarize (LLM)
                                                   ├── Score (LLM)
                                                   └── Todos (LLM)

React Web App ──GET/PATCH/PUT/DELETE──→ Go Backend (API)
```

### 状态机

```
CAPTURED → PROCESSING → READY → ARCHIVED
                ↓
              FAILED (可重试 → CAPTURED)
```

### AI Pipeline（4 步）

1. **Extract**：HTTP 抓取 + go-readability 提取正文
2. **Summarize**：生成 3 bullets + 1 insight
3. **Score**：匹配分（0-100）+ 优先级 + 理由
4. **Todos**：生成 3-7 条可执行任务

每步产物存入 `artifacts` 表，类型为 `extraction` / `summary` / `score` / `todos`。

### 多模型支持

通过 `ModelClient` 接口抽象，支持四种 LLM 后端：

| Provider | 实现 | API |
|----------|------|-----|
| OpenAI | `OpenAIClient` | Chat Completions |
| Claude | `ClaudeClient` | Anthropic Messages |
| Gemini | `GeminiClient` | Google Generative AI |
| Ollama | `OllamaClient` | 本地 Ollama Generate |

---

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Go, net/http (stdlib), SQLite (modernc.org/sqlite) |
| AI | OpenAI / Claude / Gemini / Ollama（可切换） |
| 内容提取 | go-readability |
| 前端 | React 19, Vite, TypeScript, React Router, CSS Modules |
| 扩展 | Chrome Manifest V3, Vanilla JS |
| 数据库 | SQLite (WAL mode) |
| CI | GitHub Actions |

---

## 开发说明

### 构建

```bash
# 后端
go build -o readdo ./cmd/server/

# 前端
cd web && npm run build    # 产出到 web/dist/
```

### 测试

```bash
# Go 全量测试（含竞态检测）
go test -race ./...

# TypeScript 类型检查
cd web && npx tsc --noEmit
```

### 代码检查

```bash
go vet ./...
```

---

## Roadmap

- [ ] 更多来源：YouTube 字幕、Newsletter、PDF
- [x] ~~多模型支持：Claude / Gemini / 本地模型~~
- [x] ~~搜索 / 删除 / 批量操作~~
- [x] ~~测试覆盖 + CI~~
- [ ] Markdown 导出 / 剪贴板复制
- [ ] SSE 实时推送（替代轮询）
- [ ] 桌面应用（Tauri）
- [ ] 导出：Notion / Obsidian / Todoist 集成
- [ ] 团队协作

---

## License

TBD
