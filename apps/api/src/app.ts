import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { nanoid } from "nanoid";
import { ensureSchema } from "@readdo/contracts";
import { runEngine } from "@readdo/core";

type ApiError = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

type CreateAppOptions = {
  dbPath?: string;
  engineVersion?: string;
  workerIntervalMs?: number;
  startWorker?: boolean;
};

type DbItemRow = {
  id: string;
  url: string;
  title: string | null;
  domain: string | null;
  source_type: string;
  intent_text: string;
  status: string;
  priority: string | null;
  match_score: number | null;
  failure_json: string | null;
  created_at: string;
  updated_at: string;
};

type JobRow = {
  id: string;
  item_id: string;
  kind: "PROCESS";
  status: "QUEUED" | "LEASED" | "DONE" | "FAILED";
  run_id: string;
  attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  request_key: string | null;
};

type ArtifactDbRow = {
  artifact_type: string;
  version: number;
  created_by: string;
  created_at: string;
  meta_json: string;
  payload_json: string;
};

function repoRoot(): string {
  const current = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  return current;
}

function nowIso(): string {
  return new Date().toISOString();
}

function plusSeconds(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) + seconds * 1000).toISOString();
}

function failure(code: string, message: string, details?: Record<string, unknown>): ApiError {
  return details ? { error: { code, message, details } } : { error: { code, message } };
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function extractContentMeta(text: string): Record<string, unknown> {
  return {
    word_count: text.split(/\s+/u).filter(Boolean).length,
    language: /[\u4E00-\u9FFF]/u.test(text) ? "zh" : "en",
  };
}

function plainTextFromHtml(html: string): string {
  const withoutScript = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/giu, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/giu, " ");
  const stripped = withoutScript.replace(/<[^>]+>/g, " ");
  return normalizeText(stripped);
}

function isReadyFromArtifacts(artifacts: Record<string, unknown>): boolean {
  return Boolean(artifacts.summary && artifacts.score && artifacts.todos && artifacts.card);
}

function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT,
      domain TEXT,
      source_type TEXT NOT NULL,
      intent_text TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT,
      match_score REAL,
      failure_json TEXT,
      capture_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_status_updated ON items(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_items_priority_score ON items(priority, match_score);

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      run_id TEXT NOT NULL,
      UNIQUE(item_id, artifact_type, version)
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_item_type ON artifacts(item_id, artifact_type, version DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      run_id TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_expires_at TEXT,
      request_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_item_kind ON jobs(item_id, kind);
  `);
  return db;
}

function rowToItem(row: DbItemRow): Record<string, unknown> {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    domain: row.domain,
    source_type: row.source_type,
    intent_text: row.intent_text,
    status: row.status,
    priority: row.priority,
    match_score: row.match_score,
    failure: row.failure_json ? (JSON.parse(row.failure_json) as unknown) : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeQueryList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => String(entry).split(",")).map((x) => x.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function artifactToSchema(artifactType: string):
  | "extraction"
  | "summary"
  | "score"
  | "todos"
  | "card"
  | "export" {
  if (artifactType === "summary") return "summary";
  if (artifactType === "score") return "score";
  if (artifactType === "todos") return "todos";
  if (artifactType === "card") return "card";
  if (artifactType === "extraction") return "extraction";
  return "export";
}

async function extractFromUrl(url: string): Promise<{ normalized_text: string; content_meta: Record<string, unknown> }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  const text = contentType.includes("html") ? plainTextFromHtml(raw) : normalizeText(raw);
  if (text.length < 50) {
    throw new Error("Extracted text too short");
  }
  const normalized = text.slice(0, 20000);
  return {
    normalized_text: normalized,
    content_meta: extractContentMeta(normalized),
  };
}

async function tryRenderPngFromCard(
  rootDir: string,
  itemId: string,
  card: {
    headline: string;
    points: string[];
    insight: string;
    action: string;
    render_spec?: {
      width?: number;
      height?: number;
      theme?: string;
      payload?: {
        content?: {
          headline?: string;
          points?: string[];
          insight?: string;
          action?: string;
        };
      };
    };
  },
): Promise<{ path?: string; renderer: { name: string; version: string }; error_message?: string }> {
  try {
    const require = createRequire(import.meta.url);
    const playwright = require("playwright") as { chromium: { launch: (options: Record<string, unknown>) => Promise<unknown> } };
    const width = card.render_spec?.width ?? 1080;
    const height = card.render_spec?.height ?? 1350;
    const theme = card.render_spec?.theme ?? "LIGHT";
    const content = card.render_spec?.payload?.content;
    const headline = content?.headline ?? card.headline;
    const points = content?.points ?? card.points;
    const insight = content?.insight ?? card.insight;
    const action = content?.action ?? card.action;

    const pngRelativePath = `exports/${itemId}/card_${Date.now()}.png`;
    const pngAbsPath = resolve(rootDir, pngRelativePath);

    const browser = (await playwright.chromium.launch({ headless: true })) as {
      newPage: (options: { viewport: { width: number; height: number } }) => Promise<{
        setContent: (html: string, opts: { waitUntil: "networkidle" }) => Promise<void>;
        screenshot: (opts: { path: string; type: "png" }) => Promise<void>;
      }>;
      close: () => Promise<void>;
    };
    try {
      const page = await browser.newPage({ viewport: { width, height } });
      const html = `
        <!doctype html>
        <html><head>
          <meta charset="utf-8" />
          <style>
            body { margin:0; font-family: Inter, Arial, sans-serif; width:${width}px; height:${height}px; background:${theme === "DARK" ? "#0b1020" : "#f6f7fb"}; color:${theme === "DARK" ? "#f9fafb" : "#111827"}; }
            .card { box-sizing:border-box; margin: 40px; padding: 48px; border-radius: 24px; background:${theme === "DARK" ? "#111827" : "#ffffff"}; height: calc(100% - 80px); border: 1px solid ${theme === "DARK" ? "#1f2937" : "#e5e7eb"}; }
            h1 { font-size: 48px; margin: 0 0 24px; line-height: 1.2; }
            ul { margin: 0; padding-left: 20px; }
            li { margin: 10px 0; font-size: 32px; line-height: 1.35; }
            .insight { margin-top: 28px; font-size: 30px; opacity: 0.95; }
            .action { margin-top: 24px; font-size: 28px; font-weight: 700; }
            .watermark { position: absolute; right: 70px; bottom: 55px; font-size: 20px; opacity: 0.6; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>${headline}</h1>
            <ul>${points.map((point) => `<li>${point}</li>`).join("")}</ul>
            <div class="insight">${insight}</div>
            <div class="action">${action}</div>
          </div>
          <div class="watermark">Read→Do</div>
        </body>
        </html>
      `;
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.screenshot({ path: pngAbsPath, type: "png" });
      return {
        path: pngRelativePath,
        renderer: {
          name: "playwright-html-v1",
          version: "0.1.0",
        },
      };
    } finally {
      await browser.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      renderer: {
        name: "markdown-caption-fallback",
        version: "0.1.0",
      },
      error_message: message,
    };
  }
}

function artifactRowsByItem(db: DatabaseSync, itemId: string): ArtifactDbRow[] {
  return db
    .prepare(
      `
      SELECT artifact_type, version, created_by, created_at, meta_json, payload_json
      FROM artifacts
      WHERE item_id = ?
      ORDER BY artifact_type ASC, version DESC
      `,
    )
    .all(itemId) as ArtifactDbRow[];
}

function latestArtifacts(db: DatabaseSync, itemId: string): Record<string, unknown> {
  const rows = artifactRowsByItem(db, itemId);
  const seen = new Set<string>();
  const latestRows: ArtifactDbRow[] = [];
  for (const row of rows) {
    if (seen.has(row.artifact_type)) continue;
    seen.add(row.artifact_type);
    latestRows.push(row);
  }

  return latestRows.reduce<Record<string, unknown>>((acc, row) => {
    acc[row.artifact_type] = {
      artifact_type: row.artifact_type,
      version: row.version,
      created_by: row.created_by,
      created_at: row.created_at,
      meta: JSON.parse(row.meta_json),
      payload: JSON.parse(row.payload_json),
    };
    return acc;
  }, {});
}

function allArtifactsHistory(db: DatabaseSync, itemId: string): Record<string, unknown[]> {
  const rows = artifactRowsByItem(db, itemId);

  return rows.reduce<Record<string, unknown[]>>((acc, row) => {
    const current = acc[row.artifact_type] ?? [];
    current.push({
      artifact_type: row.artifact_type,
      version: row.version,
      created_by: row.created_by,
      created_at: row.created_at,
      meta: JSON.parse(row.meta_json),
      payload: JSON.parse(row.payload_json),
    });
    acc[row.artifact_type] = current;
    return acc;
  }, {});
}

function parseArtifactVersions(value: unknown): Record<string, number> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const output: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 1) {
        output[k] = n;
      }
    }
    return output;
  } catch {
    return {};
  }
}

function selectedArtifacts(db: DatabaseSync, itemId: string, versionOverrides: Record<string, number>): Record<string, unknown> {
  const rows = artifactRowsByItem(db, itemId);
  const selected: Record<string, ArtifactDbRow> = {};
  for (const row of rows) {
    const targetVersion = versionOverrides[row.artifact_type];
    if (selected[row.artifact_type]) {
      continue;
    }
    if (targetVersion) {
      if (row.version === targetVersion) {
        selected[row.artifact_type] = row;
      }
      continue;
    }
    selected[row.artifact_type] = row;
  }

  return Object.values(selected).reduce<Record<string, unknown>>((acc, row) => {
    acc[row.artifact_type] = {
      artifact_type: row.artifact_type,
      version: row.version,
      created_by: row.created_by,
      created_at: row.created_at,
      meta: JSON.parse(row.meta_json),
      payload: JSON.parse(row.payload_json),
    };
    return acc;
  }, {});
}

function writeArtifact(
  db: DatabaseSync,
  params: {
    itemId: string;
    artifactType: string;
    payload: Record<string, unknown>;
    runId: string;
    engineVersion: string;
    templateVersion: string;
    createdBy?: "system" | "user";
  },
): void {
  ensureSchema(artifactToSchema(params.artifactType), params.payload);
  const createdAt = nowIso();
  const versionRow = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM artifacts WHERE item_id = ? AND artifact_type = ?")
    .get(params.itemId, params.artifactType) as { version: number };

  const version = versionRow.version + 1;
  const meta = {
    run_id: params.runId,
    engine_version: params.engineVersion,
    template_version: params.templateVersion,
    created_at: createdAt,
    created_by: params.createdBy ?? "system",
  };

  db.prepare(
    `
      INSERT INTO artifacts(id, item_id, artifact_type, version, created_by, created_at, meta_json, payload_json, run_id)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    `art_${nanoid(10)}`,
    params.itemId,
    params.artifactType,
    version,
    params.createdBy ?? "system",
    createdAt,
    JSON.stringify(meta),
    JSON.stringify(params.payload),
    params.runId,
  );
}

function createProcessJob(db: DatabaseSync, itemId: string, requestKey: string): void {
  const exists = db
    .prepare("SELECT id FROM jobs WHERE request_key = ?")
    .get(requestKey) as { id: string } | undefined;
  if (exists) {
    return;
  }

  const ts = nowIso();
  db.prepare(
    `
      INSERT INTO jobs(id, item_id, kind, status, run_id, attempts, request_key, created_at, updated_at)
      VALUES(?, ?, 'PROCESS', 'QUEUED', ?, 0, ?, ?, ?)
    `,
  ).run(`job_${nanoid(10)}`, itemId, `run_${nanoid(10)}`, requestKey, ts, ts);
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const root = repoRoot();
  const dbPath = resolve(root, options.dbPath ?? process.env.DB_PATH ?? "apps/api/data/readdo.db");
  const engineVersion = options.engineVersion ?? process.env.ENGINE_VERSION ?? "0.1.0";
  const defaultProfile = (process.env.DEFAULT_PROFILE as "engineer" | "creator" | "manager" | undefined) ?? "engineer";
  const workerIntervalMs = options.workerIntervalMs ?? 1500;
  const startWorker = options.startWorker ?? true;

  const db = openDatabase(dbPath);
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/system/worker", async () => {
    const jobRows = db
      .prepare("SELECT status, COUNT(1) AS count FROM jobs GROUP BY status")
      .all() as Array<{ status: string; count: number }>;
    const itemRows = db
      .prepare("SELECT status, COUNT(1) AS count FROM items GROUP BY status")
      .all() as Array<{ status: string; count: number }>;

    const queue = jobRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});
    const items = itemRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});

    return {
      queue,
      items,
      worker: {
        interval_ms: workerIntervalMs,
        active: startWorker,
      },
      timestamp: nowIso(),
    };
  });

  app.post("/api/capture", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const idempotencyKey = String(request.headers["idempotency-key"] ?? body.capture_id ?? "");
    const url = String(body.url ?? "").trim();
    const intentText = String(body.intent_text ?? "").trim();
    const title = String(body.title ?? "").trim();
    const sourceType = String(body.source_type ?? "web").trim();
    const domain = String(body.domain ?? "").trim();

    if (!url || !intentText) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "url and intent_text are required"));
    }

    if (idempotencyKey) {
      const existing = db
        .prepare("SELECT * FROM items WHERE capture_key = ?")
        .get(idempotencyKey) as DbItemRow | undefined;
      if (existing) {
        return reply.status(201).send({
          item: {
            id: existing.id,
            status: existing.status,
            created_at: existing.created_at,
          },
        });
      }
    }

    const id = `itm_${nanoid(10)}`;
    const ts = nowIso();
    db.prepare(
      `
      INSERT INTO items(id, url, title, domain, source_type, intent_text, status, created_at, updated_at, capture_key)
      VALUES(?, ?, ?, ?, ?, ?, 'CAPTURED', ?, ?, ?)
      `,
    ).run(id, url, title, domain, sourceType, intentText, ts, ts, idempotencyKey || null);

    createProcessJob(db, id, `capture:${id}:${idempotencyKey || "default"}`);

    return reply.status(201).send({
      item: {
        id,
        status: "CAPTURED",
        created_at: ts,
      },
    });
  });

  app.get("/api/items", async (request) => {
    const query = request.query as Record<string, unknown>;
    const statuses = normalizeQueryList(query.status);
    const priorities = normalizeQueryList(query.priority);
    const sourceTypes = normalizeQueryList(query.source_type);
    const q = typeof query.q === "string" ? query.q.trim() : "";
    const sort = typeof query.sort === "string" ? query.sort : "priority_score_desc";
    const limit = Math.min(Number(query.limit ?? 20), 100);
    const whereParts: string[] = [];
    const params: Array<string | number | null> = [];
    if (statuses.length) {
      whereParts.push(`status IN (${statuses.map(() => "?").join(",")})`);
      params.push(...statuses);
    }
    if (priorities.length) {
      whereParts.push(`priority IN (${priorities.map(() => "?").join(",")})`);
      params.push(...priorities);
    }
    if (sourceTypes.length) {
      whereParts.push(`source_type IN (${sourceTypes.map(() => "?").join(",")})`);
      params.push(...sourceTypes);
    }
    if (q) {
      whereParts.push("(title LIKE ? OR domain LIKE ? OR intent_text LIKE ? OR url LIKE ?)");
      const token = `%${q}%`;
      params.push(token, token, token, token);
    }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const orderBy =
      sort === "created_desc"
        ? "created_at DESC"
        : sort === "updated_desc"
          ? "updated_at DESC"
          : `
            CASE status
              WHEN 'READY' THEN 0
              WHEN 'PROCESSING' THEN 1
              WHEN 'QUEUED' THEN 2
              WHEN 'CAPTURED' THEN 3
              WHEN 'FAILED_EXTRACTION' THEN 4
              WHEN 'FAILED_AI' THEN 5
              WHEN 'FAILED_EXPORT' THEN 6
              WHEN 'SHIPPED' THEN 7
              ELSE 8
            END,
            CASE priority
              WHEN 'READ_NEXT' THEN 0
              WHEN 'WORTH_IT' THEN 1
              WHEN 'IF_TIME' THEN 2
              WHEN 'SKIP' THEN 3
              ELSE 4
            END,
            COALESCE(match_score, -1) DESC,
            created_at DESC
          `;

    const rows = db
      .prepare(
        `
          SELECT id, url, title, domain, source_type, intent_text, status, priority, match_score, failure_json, created_at, updated_at
          FROM items
          ${whereClause}
          ORDER BY ${orderBy}
          LIMIT ?
        `,
      )
      .all(...params, limit) as DbItemRow[];

    return {
      items: rows.map((row) => rowToItem(row)),
      next_cursor: null,
    };
  });

  app.get("/api/items/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const query = request.query as Record<string, unknown>;
    const includeHistory = String(query?.include_history ?? "false") === "true";
    const versionOverrides = parseArtifactVersions(query?.artifact_versions);
    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as DbItemRow | undefined;
    if (!item) {
      return reply.status(404).send(failure("NOT_FOUND", "Item not found", { item_id: id }));
    }

    const response = {
      item: rowToItem(item),
      artifacts: selectedArtifacts(db, id, versionOverrides),
      failure: item.failure_json ? JSON.parse(item.failure_json) : undefined,
      artifact_versions_selected: versionOverrides,
    };
    if (includeHistory) {
      return {
        ...response,
        artifact_history: allArtifactsHistory(db, id),
      };
    }
    return response;
  });

  app.post("/api/items/:id/intent", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as DbItemRow | undefined;
    if (!item) {
      return reply.status(404).send(failure("NOT_FOUND", "Item not found"));
    }
    if (item.status === "PROCESSING") {
      return reply.status(409).send(failure("PROCESSING_IN_PROGRESS", "Item is currently processing"));
    }

    const body = (request.body ?? {}) as { intent_text?: unknown; regenerate?: unknown };
    const intentText = String(body.intent_text ?? "").trim();
    const regenerate = Boolean(body.regenerate);
    if (intentText.length < 3) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "intent_text must be at least 3 characters"));
    }

    const ts = nowIso();
    let nextStatus = item.status;
    if (regenerate) {
      nextStatus = "QUEUED";
      createProcessJob(db, id, `intent-regenerate:${id}:${nanoid(8)}`);
    }

    db.prepare("UPDATE items SET intent_text = ?, status = ?, updated_at = ? WHERE id = ?").run(intentText, nextStatus, ts, id);

    return {
      item: {
        ...rowToItem({
          ...item,
          intent_text: intentText,
          status: nextStatus,
          updated_at: ts,
        }),
      },
    };
  });

  app.post("/api/items/:id/artifacts/:artifactType", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const artifactType = (request.params as { artifactType: string }).artifactType;
    const editableTypes = ["summary", "score", "todos", "card"] as const;
    if (!editableTypes.includes(artifactType as (typeof editableTypes)[number])) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "artifactType must be summary|score|todos|card"));
    }

    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as DbItemRow | undefined;
    if (!item) {
      return reply.status(404).send(failure("NOT_FOUND", "Item not found"));
    }

    const body = (request.body ?? {}) as { payload?: unknown; template_version?: unknown };
    if (!body.payload || typeof body.payload !== "object") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "payload must be a JSON object"));
    }

    const templateVersion =
      typeof body.template_version === "string" && body.template_version.trim()
        ? body.template_version.trim()
        : `user.${artifactType}.edit.v1`;
    const runId = `run_user_${nanoid(10)}`;

    try {
      writeArtifact(db, {
        itemId: id,
        artifactType,
        payload: body.payload as Record<string, unknown>,
        runId,
        engineVersion,
        templateVersion,
        createdBy: "user",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send(failure("VALIDATION_ERROR", message));
    }

    const ts = nowIso();
    db.prepare("UPDATE items SET updated_at = ?, failure_json = NULL WHERE id = ?").run(ts, id);

    const latest = latestArtifacts(db, id)[artifactType];
    return reply.status(201).send({
      item: {
        id,
        status: item.status,
        updated_at: ts,
      },
      artifact: latest,
    });
  });

  app.post("/api/items/:id/process", async (request, reply) => {
    type ProcessMode = "PROCESS" | "RETRY" | "REGENERATE";

    const id = (request.params as { id: string }).id;
    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as DbItemRow | undefined;
    if (!item) {
      return reply.status(404).send(failure("NOT_FOUND", "Item not found"));
    }
    if (item.status === "PROCESSING") {
      return reply.status(409).send(failure("PROCESSING_IN_PROGRESS", "Item is currently processing"));
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const modeRaw = String(body.mode ?? "PROCESS").toUpperCase();
    const allowedModes = ["PROCESS", "RETRY", "REGENERATE"] as const;
    const mode = allowedModes.includes(modeRaw as ProcessMode) ? (modeRaw as ProcessMode) : null;
    if (!mode) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "mode must be PROCESS | RETRY | REGENERATE"));
    }

    const allowedStatuses: Record<ProcessMode, string[]> = {
      PROCESS: ["CAPTURED", "FAILED_EXTRACTION", "FAILED_AI", "FAILED_EXPORT"],
      RETRY: ["FAILED_EXTRACTION", "FAILED_AI", "FAILED_EXPORT"],
      REGENERATE: ["READY", "ARCHIVED"],
    };

    if (!allowedStatuses[mode].includes(item.status)) {
      return reply.status(409).send(
        failure("PROCESS_NOT_ALLOWED", `mode=${mode} is not allowed from status=${item.status}`, {
          item_id: id,
          status: item.status,
          mode,
        }),
      );
    }

    const processKey = String(request.headers["idempotency-key"] ?? body.process_request_id ?? `manual_${nanoid(8)}`);
    createProcessJob(db, id, `process:${id}:${mode}:${processKey}`);

    const ts = nowIso();
    db.prepare("UPDATE items SET status = 'QUEUED', updated_at = ?, failure_json = NULL WHERE id = ?").run(ts, id);

    return reply.status(202).send({
      item: {
        id,
        status: "QUEUED",
        updated_at: ts,
      },
      mode,
    });
  });

  app.post("/api/items/:id/export", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const exportKey = String(body.export_key ?? request.headers["idempotency-key"] ?? `exp_${nanoid(8)}`);
    const formats = normalizeQueryList(body.formats).length ? normalizeQueryList(body.formats) : ["png", "md", "caption"];

    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as DbItemRow | undefined;
    if (!item) {
      return reply.status(404).send(failure("NOT_FOUND", "Item not found"));
    }

    if (!["READY", "SHIPPED", "FAILED_EXPORT"].includes(item.status)) {
      return reply.status(409).send(failure("EXPORT_NOT_ALLOWED", "Export is only allowed for READY/SHIPPED/FAILED_EXPORT states"));
    }

    const artifacts = latestArtifacts(db, id);
    const cardArtifact = artifacts.card as { payload?: Record<string, unknown> } | undefined;
    if (!cardArtifact?.payload) {
      return reply.status(409).send(failure("STATE_CONFLICT", "Card artifact is missing"));
    }

    const existingExports = db
      .prepare("SELECT payload_json FROM artifacts WHERE item_id = ? AND artifact_type = 'export' ORDER BY version DESC LIMIT 5")
      .all(id) as Array<{ payload_json: string }>;
    for (const row of existingExports) {
      const payload = JSON.parse(row.payload_json) as { export_key?: string };
      if (payload.export_key === exportKey) {
        const ts = nowIso();
        db.prepare("UPDATE items SET status = 'SHIPPED', updated_at = ? WHERE id = ?").run(ts, id);
        return {
          item: { id, status: "SHIPPED", updated_at: ts },
          export: {
            artifact_type: "export",
            payload,
          },
        };
      }
    }

    const exportDir = resolve(root, "exports", id);
    mkdirSync(exportDir, { recursive: true });

    const card = cardArtifact.payload as {
      headline: string;
      points: string[];
      insight: string;
      action: string;
      caption?: string;
      render_spec?: {
        width?: number;
        height?: number;
        theme?: string;
        payload?: {
          content?: {
            headline?: string;
            points?: string[];
            insight?: string;
            action?: string;
          };
        };
      };
    };
    const files: Array<{ type: "png" | "md" | "caption"; path: string; created_at: string }> = [];
    let pngErrorMessage: string | undefined;

    if (formats.includes("png")) {
      const pngResult = await tryRenderPngFromCard(root, id, card);
      if (pngResult.path) {
        files.push({ type: "png", path: pngResult.path, created_at: nowIso() });
      } else {
        pngErrorMessage = pngResult.error_message ?? "PNG rendering failed";
      }
    }

    if (formats.includes("md")) {
      const mdRelativePath = `exports/${id}/card_${Date.now()}.md`;
      writeFileSync(
        resolve(root, mdRelativePath),
        `# ${card.headline}\n\n${card.points.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nInsight: ${card.insight}\n\nAction: ${card.action}\n`,
        "utf-8",
      );
      files.push({ type: "md", path: mdRelativePath, created_at: nowIso() });
    }

    if (formats.includes("caption")) {
      const captionRelativePath = `exports/${id}/caption_${Date.now()}.txt`;
      writeFileSync(resolve(root, captionRelativePath), card.caption ?? `${card.headline}\n${card.action}`, "utf-8");
      files.push({ type: "caption", path: captionRelativePath, created_at: nowIso() });
    }

    if (files.length === 0) {
      const ts = nowIso();
      const failurePayload = {
        failed_step: "export",
        error_code: "EXPORT_RENDER_FAILED",
        message: pngErrorMessage ?? "No export files generated",
        retryable: true,
      };
      db.prepare("UPDATE items SET status = 'FAILED_EXPORT', failure_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(failurePayload),
        ts,
        id,
      );
      if (formats.includes("png")) {
        return reply.status(500).send(failure("EXPORT_RENDER_FAILED", pngErrorMessage ?? "PNG render failed"));
      }
      return reply.status(400).send(failure("VALIDATION_ERROR", "formats must include at least one of png|md|caption"));
    }

    const exportPayload = {
      files,
      export_key: exportKey,
      renderer: {
        name: files.some((x) => x.type === "png") ? "playwright-html-v1" : "markdown-caption-fallback",
        version: "0.1.0",
      },
    };
    ensureSchema("export", exportPayload);
    const runId = `run_${nanoid(10)}`;
    writeArtifact(db, {
      itemId: id,
      artifactType: "export",
      payload: exportPayload,
      runId,
      engineVersion,
      templateVersion: "export.v1",
    });

    const ts = nowIso();
    db.prepare("UPDATE items SET status = 'SHIPPED', updated_at = ?, failure_json = NULL WHERE id = ?").run(ts, id);

    return {
      item: { id, status: "SHIPPED", updated_at: ts },
      export: {
        artifact_type: "export",
        payload: exportPayload,
      },
    };
  });

  app.post("/api/items/:id/archive", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as DbItemRow | undefined;
    if (!item) {
      return reply.status(404).send(failure("NOT_FOUND", "Item not found"));
    }
    if (item.status === "PROCESSING") {
      return reply.status(409).send(failure("ARCHIVE_NOT_ALLOWED", "Cannot archive processing item"));
    }
    const ts = nowIso();
    db.prepare("UPDATE items SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(ts, id);
    return {
      item: { id, status: "ARCHIVED", updated_at: ts },
    };
  });

  app.post("/api/items/:id/unarchive", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as DbItemRow | undefined;
    if (!item) {
      return reply.status(404).send(failure("NOT_FOUND", "Item not found"));
    }
    if (item.status !== "ARCHIVED") {
      return reply.status(409).send(failure("STATE_CONFLICT", "Only archived items can be unarchived"));
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const regenerate = Boolean(body.regenerate);
    const artifacts = latestArtifacts(db, id);
    const ready = isReadyFromArtifacts(artifacts);
    const targetStatus = regenerate || !ready ? "QUEUED" : "READY";
    const ts = nowIso();
    db.prepare("UPDATE items SET status = ?, updated_at = ? WHERE id = ?").run(targetStatus, ts, id);

    if (targetStatus === "QUEUED") {
      createProcessJob(db, id, `unarchive:${id}:${nanoid(8)}`);
    }

    return {
      item: { id, status: targetStatus, updated_at: ts },
    };
  });

  async function processJob(job: JobRow): Promise<void> {
    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(job.item_id) as DbItemRow | undefined;
    if (!item) {
      db.prepare("UPDATE jobs SET status = 'FAILED', updated_at = ?, last_error = ? WHERE id = ?").run(nowIso(), "item_not_found", job.id);
      return;
    }

    const runId = `run_${nanoid(10)}`;
    db.prepare("UPDATE jobs SET run_id = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?").run(runId, nowIso(), job.id);
    db.prepare("UPDATE items SET status = 'PROCESSING', updated_at = ?, failure_json = NULL WHERE id = ?").run(nowIso(), item.id);

    try {
      const extraction = await extractFromUrl(item.url);
      const extractionPayload = {
        normalized_text: extraction.normalized_text,
        extraction_hash: createHash("sha256").update(`${item.url}|${extraction.normalized_text}`).digest("hex").slice(0, 32),
        content_meta: extraction.content_meta,
      };

      writeArtifact(db, {
        itemId: item.id,
        artifactType: "extraction",
        payload: extractionPayload,
        runId,
        engineVersion,
        templateVersion: "extraction.v1",
      });

      const engineInputBase = {
        intent_text: item.intent_text,
        extracted_text: extraction.normalized_text,
        profile: defaultProfile,
        source_type: item.source_type as "web" | "youtube" | "newsletter" | "other",
        engine_version: engineVersion,
        run_id: runId,
      };
      const output = await runEngine(
        item.title || item.domain
          ? {
              ...engineInputBase,
              ...(item.title ? { title: item.title } : {}),
              ...(item.domain ? { domain: item.domain } : {}),
            }
          : engineInputBase,
      );

      writeArtifact(db, {
        itemId: item.id,
        artifactType: "summary",
        payload: output.artifacts.summary as Record<string, unknown>,
        runId,
        engineVersion,
        templateVersion: output.meta.template_versions.summary,
      });
      writeArtifact(db, {
        itemId: item.id,
        artifactType: "score",
        payload: output.artifacts.score as Record<string, unknown>,
        runId,
        engineVersion,
        templateVersion: output.meta.template_versions.score,
      });
      writeArtifact(db, {
        itemId: item.id,
        artifactType: "todos",
        payload: output.artifacts.todos as Record<string, unknown>,
        runId,
        engineVersion,
        templateVersion: output.meta.template_versions.todos,
      });
      writeArtifact(db, {
        itemId: item.id,
        artifactType: "card",
        payload: output.artifacts.card as Record<string, unknown>,
        runId,
        engineVersion,
        templateVersion: output.meta.template_versions.card,
      });

      const scorePayload = output.artifacts.score as { match_score: number; priority: string };
      db.prepare(
        "UPDATE items SET status = 'READY', priority = ?, match_score = ?, failure_json = NULL, updated_at = ? WHERE id = ?",
      ).run(scorePayload.priority, scorePayload.match_score, nowIso(), item.id);
      db.prepare("UPDATE jobs SET status = 'DONE', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?").run(
        nowIso(),
        job.id,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isExtractionFailure = /(Fetch failed|Extracted text too short|network|timeout)/i.test(message);
      const failedStatus = isExtractionFailure ? "FAILED_EXTRACTION" : "FAILED_AI";
      const failurePayload = {
        failed_step: isExtractionFailure ? "extract" : "pipeline",
        error_code: isExtractionFailure ? "EXTRACTION_FETCH_FAILED" : "AI_PROVIDER_ERROR",
        message,
        retryable: true,
      };

      db.prepare("UPDATE items SET status = ?, failure_json = ?, updated_at = ? WHERE id = ?").run(
        failedStatus,
        JSON.stringify(failurePayload),
        nowIso(),
        item.id,
      );
      db.prepare("UPDATE jobs SET status = 'FAILED', last_error = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?").run(
        message,
        nowIso(),
        job.id,
      );
    }
  }

  async function runWorkerOnce(): Promise<void> {
    const now = nowIso();
    db.prepare("UPDATE jobs SET status = 'QUEUED', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE status = 'LEASED' AND lease_expires_at < ?").run(
      now,
      now,
    );

    const candidate = db
      .prepare("SELECT * FROM jobs WHERE status = 'QUEUED' AND kind = 'PROCESS' ORDER BY created_at ASC LIMIT 1")
      .get() as JobRow | undefined;
    if (!candidate) {
      return;
    }

    const leaseUntil = plusSeconds(now, 60);
    const leaseResult = db
      .prepare("UPDATE jobs SET status = 'LEASED', lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'QUEUED'")
      .run("worker_local", leaseUntil, nowIso(), candidate.id);
    if (leaseResult.changes === 0) {
      return;
    }

    await processJob({
      ...candidate,
      status: "LEASED",
      lease_owner: "worker_local",
      lease_expires_at: leaseUntil,
    });
  }

  let workerTimer: NodeJS.Timeout | undefined;
  let workerBusy = false;
  if (startWorker) {
    workerTimer = setInterval(() => {
      if (workerBusy) return;
      workerBusy = true;
      void runWorkerOnce()
        .catch((err) => app.log.error({ err }, "worker_tick_failed"))
        .finally(() => {
          workerBusy = false;
        });
    }, workerIntervalMs);
  }

  app.decorate("runWorkerOnce", runWorkerOnce);

  app.addHook("onClose", async () => {
    if (workerTimer) {
      clearInterval(workerTimer);
    }
    db.close();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    runWorkerOnce: () => Promise<void>;
  }
}
