# Read→Do Core Engine API Spec（MVP）
Location: docs/07-core-engine-api-spec.md
Version: 0.1
Last Updated: 2026-02-13

本文件定义 Core Engine 的最小可落地接口与边界。
目标：让 Orchestrator / Engine / Store / UI 解耦，并支持未来替换 UI（Web→Tauri）而不动核心逻辑。

---

## 0. Engine 的职责边界

### Engine 做什么
- 给定稳定输入（intent + extracted_text + profile），生成结构化 artifacts：
  - summary / score / todos / card
- 生成结果必须可被 schema 校验
- 返回 meta：run_id/engine_version/template_version/model_id 等（用于治理）

### Engine 不做什么
- 不做 Item 状态机
- 不做队列/worker lease
- 不直接写 DB（通过 Store 接口由 Orchestrator 负责持久化）
- 不直接处理 Chrome Extension / Web UI

---

## 1. Orchestrator ↔ Engine 的调用契约

### 1.1 Engine 输入（MVP）
```ts
type EngineProfile = "engineer" | "creator" | "manager"

type EngineInput = {
  // required
  intent_text: string
  extracted_text: string
  profile: EngineProfile

  // optional context
  title?: string
  domain?: string
  source_type?: "web" | "youtube" | "newsletter" | "other"

  // governance
  engine_version: string
  run_id: string
}
````

### 1.2 Engine 输出（payload + meta）

```ts
type EngineOutput = {
  meta: {
    run_id: string
    engine_version: string
    model_id?: string
    template_versions: {
      summary: string
      score: string
      todos: string
      card: string
    }
  }

  artifacts: {
    summary: any
    score: any
    todos: any
    card: any
  }

  // optional debug (not persisted by default)
  debug?: {
    raw_text?: Record<string, string>
    warnings?: string[]
  }
}
```

---

## 2. Step Registry（Pipeline Step 设计）

### 2.1 Steps（MVP）

* `summarize`
* `score`
* `todos`
* `card`

> extraction/export 可能在 engine 内也可做，但 MVP 建议由 Orchestrator 控制（尤其 extraction 涉及网络）。

### 2.2 Step 标准接口

```ts
type StepName = "summarize" | "score" | "todos" | "card"

type StepContext = {
  run_id: string
  engine_version: string
  profile: EngineProfile
  model: ModelClient
  templates: TemplateStore
  validate: SchemaValidator
  clock: Clock
  log: Logger
}

type StepInput = {
  intent_text: string
  extracted_text: string
  title?: string
  domain?: string
  source_type?: string

  // upstream artifacts (after created)
  summary?: any
  score?: any
  todos?: any
}

type StepResult = {
  payload: any
  template_version: string
  model_id?: string
  warnings?: string[]
}

type Step = {
  name: StepName
  template_key: string
  run: (ctx: StepContext, input: StepInput) => Promise<StepResult>
}
```

### 2.3 Registry

```ts
type StepRegistry = Record<StepName, Step>
```

Orchestrator 按顺序执行 steps，并在每步后进行 schema 校验与持久化。

---

## 3. 依赖接口（Dependency Interfaces）

### 3.1 ModelClient（LLM Provider 抽象）

```ts
type ModelClient = {
  id: () => string // e.g. "openai:gpt-4.1-mini"
  generateText: (args: {
    prompt: string
    maxTokens?: number
    temperature?: number
  }) => Promise<{ text: string }>
}
```

约束：

* Engine 不持有 key
* key 由 Orchestrator/backend 提供的 ModelClient 实现负责

### 3.2 TemplateStore（模板存储与渲染）

```ts
type TemplateStore = {
  get: (templateKey: string) => Promise<{
    template_version: string   // e.g. "summary.engineer.v1"
    content: string            // markdown prompt template
  }>
  render: (content: string, vars: Record<string, any>) => string
}
```

约束：

* template_version 必须来自模板文件名约定（不含扩展名），且稳定可追踪
* render 必须是纯函数（不访问网络）

### 3.3 SchemaValidator（JSON schema 校验）

```ts
type SchemaValidator = {
  validate: (schemaIdOrPath: string, payload: any) => {
    ok: boolean
    errors?: Array<{ path: string; message: string }>
  }
}
```

约束：

* 每步生成 payload 后必须 validate
* validate 失败必须作为 StepError 返回给 Orchestrator（见错误模型）

### 3.4 Store（由 Orchestrator 实现）

Engine 不直接依赖 store，但 Orchestrator 会把 StepResult 写入 artifacts 表。
建议 Store 接口（Orchestrator 内部）：

```ts
type ArtifactWrite = {
  item_id: string
  artifact_type: "summary"|"score"|"todos"|"card"|"extraction"|"export"
  created_by: "system"|"user"
  version: number
  run_id: string
  meta: object
  payload: any
}

type Store = {
  writeArtifact: (a: ArtifactWrite) => Promise<void>
  updateItemStatus: (item_id: string, status: string, patch?: any) => Promise<void>
}
```

---

## 4. 错误模型（Engine → Orchestrator）

### 4.1 StepError（结构化）

```ts
type StepError = {
  failed_step: StepName
  error_code:
    | "AI_TIMEOUT"
    | "AI_PROVIDER_ERROR"
    | "AI_SCHEMA_INVALID"
    | "AI_PARSE_ERROR"
    | "TEMPLATE_MISSING"
  message: string            // user-friendly
  debug?: string             // dev-friendly
  retryable: boolean
}
```

### 4.2 错误映射到 Item 状态

* summarize/score/todos/card 任一步失败 → Orchestrator 置 item.status = FAILED_AI
* failed_step / error_code 写入 item.failure

---

## 5. 与治理（Meta）对齐

每个 artifact 的 meta 必须包含：

* run_id
* engine_version
* template_version（对应 step 用的模板）
* created_by / created_at
* model_id（若可得）

Orchestrator 负责将 EngineOutput.meta 与 artifact-meta.md 统一封装到 artifacts 表。

---

## 6. 与 Evals 对齐

Eval Runner 直接调用 Engine（或调用 Orchestrator 的“纯生成模式”），并强制：

* schema validation
* rubric assertions
* 输出 meta 用于定位漂移来源（engine/template/model）

---
