# Read→Do (readdo)

**Save less. Do more.**

Read→Do 是一个 AI-native 的"从读到做"系统，把浏览器里堆积的 Tab 变成可执行的行动队列。

**Capture（捕捉）→ Decide（取舍）→ Do（行动）**

- 一键捕捉链接 + 写一句"为什么存它"
- AI 自动生成摘要、评分、行动建议（Todos）
- 本地优先（Go + SQLite），零运维

---

## 项目结构

```
cmd/server/          Go 后端入口（API + Worker）
internal/
  api/               REST API 路由 & 处理器
  engine/            Core Engine（Pipeline + AI Steps）
  model/             领域模型（Item / Artifact / Error）
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
```

---

## 快速开始

### 前提条件

- Go 1.21+
- Node.js 18+
- Chrome 浏览器

### 1) 启动后端

```bash
# Stub 模式（无需 OpenAI key，返回模拟数据，适合开发调试）
go run ./cmd/server/

# 真实 AI 模式
OPENAI_API_KEY=sk-xxx go run ./cmd/server/
```

看到 `readdo server listening on http://localhost:8080` 即启动成功。

可选环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8080` | HTTP 监听端口 |
| `DB_PATH` | `readdo.db` | SQLite 数据库文件路径 |
| `OPENAI_API_KEY` | (空) | 设置后启用真实 AI pipeline |

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

也可以直接用 curl 测试：

```bash
curl -X POST http://localhost:8080/api/capture \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://go.dev/blog/context","title":"Go Context","intent_text":"学习 context 用法"}'
```

### Decide（取舍）

打开 Inbox，AI 会自动处理捕捉的链接（约 3-5 秒），生成：

- **匹配分**（0-100）
- **优先级**（Read next / Worth it / If time / Skip）
- **推荐理由**（≥3 条）

卡片按优先级自动分组排列。

### Do（行动）

点击卡片进入详情页：

- **Summary**：3 条核心要点 + 1 条洞察
- **Todos**：3-7 条可执行任务（含预计时间）

Summary 和 Todos 均支持编辑。勾选完所有 Todos 后会提示归档。

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/capture` | 捕捉链接 |
| `GET` | `/api/items` | 列表（支持 `?status=` 筛选） |
| `GET` | `/api/items/:id` | 详情（含 artifacts） |
| `POST` | `/api/items/:id/retry` | 重试失败项 |
| `PATCH` | `/api/items/:id/status` | 更新状态（归档/恢复） |
| `PUT` | `/api/items/:id/artifacts/:type` | 编辑 artifact（summary/todos） |

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

React Web App ──GET/PATCH/PUT──→ Go Backend (API)
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

---

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Go, net/http (stdlib), SQLite (modernc.org/sqlite) |
| AI | OpenAI API (可替换) |
| 内容提取 | go-readability |
| 前端 | React 19, Vite, TypeScript, React Router, CSS Modules |
| 扩展 | Chrome Manifest V3, Vanilla JS |
| 数据库 | SQLite (WAL mode) |

---

## 开发说明

### 构建后端

```bash
go build -o readdo ./cmd/server/
./readdo
```

### 构建前端

```bash
cd web
npm run build    # 产出到 web/dist/
```

### 代码检查

```bash
# Go
go vet ./...

# TypeScript
cd web && npx tsc --noEmit
```

---

## Roadmap

- 更多来源：YouTube 字幕、Newsletter、PDF
- 更多模型：支持 Claude / Gemini / 本地模型
- 桌面应用（Tauri）
- 导出：Notion / Obsidian / Todoist 集成
- 团队协作

---

## License

TBD
