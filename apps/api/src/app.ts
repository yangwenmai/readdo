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
import {
  deriveCaptureKey,
  normalizeCaptureIdempotencyKey,
  normalizeIdempotencyHeaderKey,
  normalizeIdempotencyKey,
} from "@readdo/shared";

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
  disablePngRender?: boolean;
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
  options_json: string | null;
};

type ProcessTemplateProfile = "engineer" | "creator" | "manager";

type ProcessJobOptions = {
  template_profile?: ProcessTemplateProfile;
  force_regenerate?: boolean;
};

type ExtractionArtifactPayload = {
  normalized_text: string;
  content_meta: Record<string, unknown>;
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

const MAX_ITEM_RETRY_ATTEMPTS = 3;

function failure(code: string, message: string, details?: Record<string, unknown>): ApiError {
  return details ? { error: { code, message, details } } : { error: { code, message } };
}

function safeParseJson(rawValue: string | null): unknown {
  if (!rawValue) return undefined;
  try {
    return JSON.parse(rawValue) as unknown;
  } catch {
    return undefined;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseFailurePayload(rawValue: string | null): Record<string, unknown> | undefined {
  const parsed = safeParseJson(rawValue);
  return isObjectRecord(parsed) ? parsed : undefined;
}

function parseProcessJobOptions(rawValue: string | null): ProcessJobOptions | undefined {
  const parsed = safeParseJson(rawValue);
  if (!isObjectRecord(parsed)) {
    return undefined;
  }
  const templateProfileValue = parsed.template_profile;
  const forceRegenerateValue = parsed.force_regenerate;
  const normalizedTemplateProfile =
    typeof templateProfileValue === "string" ? templateProfileValue.trim().toLowerCase() : undefined;
  const templateProfile =
    typeof normalizedTemplateProfile === "string" && ["engineer", "creator", "manager"].includes(normalizedTemplateProfile)
      ? (normalizedTemplateProfile as ProcessTemplateProfile)
      : undefined;
  const forceRegenerate = typeof forceRegenerateValue === "boolean" ? forceRegenerateValue : undefined;
  if (!templateProfile && forceRegenerate === undefined) {
    return undefined;
  }
  return {
    ...(templateProfile ? { template_profile: templateProfile } : {}),
    ...(forceRegenerate !== undefined ? { force_regenerate: forceRegenerate } : {}),
  };
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

function parseReusableExtractionPayload(payload: unknown): ExtractionArtifactPayload | undefined {
  if (!isObjectRecord(payload)) {
    return undefined;
  }
  const normalizedTextRaw = typeof payload.normalized_text === "string" ? normalizeText(payload.normalized_text) : "";
  if (!normalizedTextRaw) {
    return undefined;
  }
  const normalizedText = normalizedTextRaw.slice(0, 20000);
  const contentMeta = isObjectRecord(payload.content_meta) ? payload.content_meta : extractContentMeta(normalizedText);
  return {
    normalized_text: normalizedText,
    content_meta: contentMeta,
  };
}

function latestReusableExtractionPayload(db: DatabaseSync, itemId: string): ExtractionArtifactPayload | undefined {
  const artifacts = latestArtifacts(db, itemId);
  const extractionArtifact = artifacts.extraction;
  if (!isObjectRecord(extractionArtifact)) {
    return undefined;
  }
  return parseReusableExtractionPayload(extractionArtifact.payload);
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
      options_json TEXT,
      request_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_item_kind ON jobs(item_id, kind);
  `);
  const jobsColumns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
  const hasOptionsJsonColumn = jobsColumns.some((column) => column.name === "options_json");
  if (!hasOptionsJsonColumn) {
    db.exec("ALTER TABLE jobs ADD COLUMN options_json TEXT");
  }
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
    failure: parseFailurePayload(row.failure_json),
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

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/\.+$/u, "");
}

function shouldStripTrackingQueryKey(queryKey: string): boolean {
  const normalizedKey = queryKey.trim().toLowerCase();
  if (normalizedKey.startsWith("utm_")) return true;
  return ["fbclid", "gclid", "mc_eid", "mkt_tok"].includes(normalizedKey);
}

function sanitizeUrlForStorage(parsedUrl: URL): string {
  parsedUrl.username = "";
  parsedUrl.password = "";
  parsedUrl.hash = "";
  const isWebLike = parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  if (isWebLike && ((parsedUrl.protocol === "https:" && parsedUrl.port === "443") || (parsedUrl.protocol === "http:" && parsedUrl.port === "80"))) {
    parsedUrl.port = "";
  }
  if (isWebLike) {
    parsedUrl.hostname = normalizeHostname(parsedUrl.hostname);
    for (const key of Array.from(parsedUrl.searchParams.keys())) {
      if (shouldStripTrackingQueryKey(key)) {
        parsedUrl.searchParams.delete(key);
      }
    }
    const sortedEntries = Array.from(parsedUrl.searchParams.entries()).sort(([aKey, aValue], [bKey, bValue]) => {
      const keyCmp = aKey.localeCompare(bKey);
      if (keyCmp !== 0) return keyCmp;
      return aValue.localeCompare(bValue);
    });
    parsedUrl.search = "";
    for (const [key, value] of sortedEntries) {
      parsedUrl.searchParams.append(key, value);
    }
  }
  return parsedUrl.toString();
}

function isCaptureKeyUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const errorWithMeta = error as { code?: unknown; message?: unknown };
  const code = String(errorWithMeta.code ?? "");
  const message = String(errorWithMeta.message ?? "");
  return code.includes("SQLITE_CONSTRAINT") && message.includes("items.capture_key");
}

function hostMatchesDomain(host: string, domain: string): boolean {
  const normalizedHost = normalizeHostname(host);
  const normalizedDomain = normalizeHostname(domain);
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function isNewsletterLikeHost(host: string): boolean {
  const normalizedHost = normalizeHostname(host);
  if (hostMatchesDomain(normalizedHost, "substack.com")) return true;
  return /(^|[.-])newsletter([.-]|$)/u.test(normalizedHost);
}

function inferSourceTypeFromUrl(url: string): "web" | "youtube" | "newsletter" | "other" {
  try {
    const parsed = new URL(url);
    const host = normalizeHostname(parsed.hostname);
    if (hostMatchesDomain(host, "youtube.com") || hostMatchesDomain(host, "youtu.be")) return "youtube";
    if (isNewsletterLikeHost(host)) return "newsletter";
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return "web";
    return "other";
  } catch {
    return "web";
  }
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
  options?: { disabled?: boolean },
): Promise<{ path?: string; renderer: { name: string; version: string }; error_message?: string }> {
  if (options?.disabled) {
    return {
      renderer: {
        name: "markdown-caption-fallback",
        version: "0.1.0",
      },
      error_message: "PNG rendering disabled by configuration",
    };
  }
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

function parseArtifactRow(row: ArtifactDbRow): {
  artifact_type: string;
  version: number;
  created_by: string;
  created_at: string;
  meta: Record<string, unknown>;
  payload: Record<string, unknown>;
} | null {
  const parsedMeta = safeParseJson(row.meta_json);
  const payload = safeParseJson(row.payload_json);
  if (!isObjectRecord(payload)) {
    return null;
  }
  const meta = isObjectRecord(parsedMeta) ? parsedMeta : {};
  return {
    artifact_type: row.artifact_type,
    version: row.version,
    created_by: row.created_by,
    created_at: row.created_at,
    meta,
    payload,
  };
}

function latestArtifacts(db: DatabaseSync, itemId: string): Record<string, unknown> {
  const rows = artifactRowsByItem(db, itemId);
  const seen = new Set<string>();
  const latestRows: Array<{
    artifact_type: string;
    version: number;
    created_by: string;
    created_at: string;
    meta: unknown;
    payload: unknown;
  }> = [];
  for (const row of rows) {
    if (seen.has(row.artifact_type)) continue;
    const parsed = parseArtifactRow(row);
    if (!parsed) continue;
    seen.add(row.artifact_type);
    latestRows.push(parsed);
  }

  return latestRows.reduce<Record<string, unknown>>((acc, row) => {
    acc[row.artifact_type] = row;
    return acc;
  }, {});
}

function allArtifactsHistory(db: DatabaseSync, itemId: string): Record<string, unknown[]> {
  const rows = artifactRowsByItem(db, itemId);

  return rows.reduce<Record<string, unknown[]>>((acc, row) => {
    const parsed = parseArtifactRow(row);
    if (!parsed) return acc;
    const current = acc[row.artifact_type] ?? [];
    current.push(parsed);
    acc[row.artifact_type] = current;
    return acc;
  }, {});
}

function parseArtifactVersions(value: unknown): Record<string, number> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  const parsed = safeParseJson(value);
  if (!isObjectRecord(parsed)) {
    return {};
  }
  const output: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1) {
      output[k] = n;
    }
  }
  return output;
}

function selectedArtifacts(db: DatabaseSync, itemId: string, versionOverrides: Record<string, number>): Record<string, unknown> {
  const rows = artifactRowsByItem(db, itemId);
  const selected: Record<string, {
    artifact_type: string;
    version: number;
    created_by: string;
    created_at: string;
    meta: unknown;
    payload: unknown;
  }> = {};
  for (const row of rows) {
    const targetVersion = versionOverrides[row.artifact_type];
    if (selected[row.artifact_type]) {
      continue;
    }
    if (targetVersion) {
      if (row.version === targetVersion) {
        const parsed = parseArtifactRow(row);
        if (parsed) {
          selected[row.artifact_type] = parsed;
        }
      }
      continue;
    }
    const parsed = parseArtifactRow(row);
    if (!parsed) continue;
    selected[row.artifact_type] = parsed;
  }

  return Object.values(selected).reduce<Record<string, unknown>>((acc, row) => {
    acc[row.artifact_type] = row;
    return acc;
  }, {});
}

function artifactVersionRow(
  db: DatabaseSync,
  itemId: string,
  artifactType: string,
  version: number,
): ArtifactDbRow | undefined {
  return db
    .prepare(
      `
      SELECT artifact_type, version, created_by, created_at, meta_json, payload_json
      FROM artifacts
      WHERE item_id = ? AND artifact_type = ? AND version = ?
      LIMIT 1
      `,
    )
    .get(itemId, artifactType, version) as ArtifactDbRow | undefined;
}

function flattenPayload(
  value: unknown,
  path: string,
  output: Map<string, string>,
): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      output.set(path, "[]");
      return;
    }
    value.forEach((entry, index) => {
      const nextPath = path ? `${path}[${index}]` : `[${index}]`;
      flattenPayload(entry, nextPath, output);
    });
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      output.set(path, "{}");
      return;
    }
    for (const [key, entry] of entries) {
      const nextPath = path ? `${path}.${key}` : key;
      flattenPayload(entry, nextPath, output);
    }
    return;
  }
  output.set(path || "$", JSON.stringify(value));
}

function comparePayloads(basePayload: unknown, targetPayload: unknown): {
  added_paths: string[];
  removed_paths: string[];
  changed_paths: string[];
  changed_line_count: number;
  compared_line_count: number;
} {
  const baseMap = new Map<string, string>();
  const targetMap = new Map<string, string>();
  flattenPayload(basePayload, "", baseMap);
  flattenPayload(targetPayload, "", targetMap);

  const addedPaths = Array.from(targetMap.keys()).filter((path) => !baseMap.has(path)).sort();
  const removedPaths = Array.from(baseMap.keys()).filter((path) => !targetMap.has(path)).sort();
  const changedPaths = Array.from(baseMap.keys())
    .filter((path) => targetMap.has(path) && baseMap.get(path) !== targetMap.get(path))
    .sort();

  const baseLines = JSON.stringify(basePayload, null, 2).split("\n");
  const targetLines = JSON.stringify(targetPayload, null, 2).split("\n");
  const comparedLineCount = Math.max(baseLines.length, targetLines.length);
  let changedLineCount = 0;
  for (let i = 0; i < comparedLineCount; i += 1) {
    if ((baseLines[i] ?? "") !== (targetLines[i] ?? "")) {
      changedLineCount += 1;
    }
  }

  return {
    added_paths: addedPaths,
    removed_paths: removedPaths,
    changed_paths: changedPaths,
    changed_line_count: changedLineCount,
    compared_line_count: comparedLineCount,
  };
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

function createProcessJob(db: DatabaseSync, itemId: string, requestKey: string, processOptions?: ProcessJobOptions): void {
  const exists = db
    .prepare("SELECT id FROM jobs WHERE request_key = ?")
    .get(requestKey) as { id: string } | undefined;
  if (exists) {
    return;
  }

  const ts = nowIso();
  db.prepare(
    `
      INSERT INTO jobs(id, item_id, kind, status, run_id, attempts, options_json, request_key, created_at, updated_at)
      VALUES(?, ?, 'PROCESS', 'QUEUED', ?, 0, ?, ?, ?, ?)
    `,
  ).run(`job_${nanoid(10)}`, itemId, `run_${nanoid(10)}`, processOptions ? JSON.stringify(processOptions) : null, requestKey, ts, ts);
}

function findExportPayloadByKey(db: DatabaseSync, itemId: string, exportKey: string): Record<string, unknown> | null {
  const existingExports = db
    .prepare("SELECT payload_json FROM artifacts WHERE item_id = ? AND artifact_type = 'export' ORDER BY version DESC")
    .all(itemId) as Array<{ payload_json: string }>;
  for (const row of existingExports) {
    try {
      const parsed = JSON.parse(row.payload_json) as unknown;
      if (!parsed || typeof parsed !== "object") continue;
      const payload = parsed as Record<string, unknown>;
      if (payload.export_key === exportKey) {
        return payload;
      }
    } catch {
      // ignore malformed legacy payloads
    }
  }
  return null;
}

function countFailedJobsForItem(db: DatabaseSync, itemId: string): number {
  const row = db
    .prepare("SELECT COUNT(1) AS count FROM jobs WHERE item_id = ? AND status = 'FAILED'")
    .get(itemId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const root = repoRoot();
  const dbPath = resolve(root, options.dbPath ?? process.env.DB_PATH ?? "apps/api/data/readdo.db");
  const engineVersion = options.engineVersion ?? process.env.ENGINE_VERSION ?? "0.1.0";
  const defaultProfile = (process.env.DEFAULT_PROFILE as "engineer" | "creator" | "manager" | undefined) ?? "engineer";
  const workerIntervalMs = options.workerIntervalMs ?? 1500;
  const startWorker = options.startWorker ?? true;
  const disablePngRender = options.disablePngRender ?? process.env.DISABLE_PNG_RENDER === "1";

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
    const failedItemRows = db
      .prepare("SELECT failure_json FROM items WHERE status IN ('FAILED_EXTRACTION', 'FAILED_AI', 'FAILED_EXPORT') AND failure_json IS NOT NULL")
      .all() as Array<{ failure_json: string }>;
    const nonRetryableItems = failedItemRows.filter((row) => {
      const payload = parseFailurePayload(row.failure_json);
      return payload?.retryable === false;
    }).length;
    const retryableItems = failedItemRows.filter((row) => {
      const payload = parseFailurePayload(row.failure_json);
      return payload?.retryable !== false;
    }).length;
    const failureStepRows = db
      .prepare(
        `
        SELECT failure_json
        FROM items
        WHERE status IN ('FAILED_EXTRACTION', 'FAILED_AI', 'FAILED_EXPORT') AND failure_json IS NOT NULL
      `,
      )
      .all() as Array<{ failure_json: string }>;
    const failureSteps = failureStepRows.reduce<Record<string, number>>((acc, row) => {
      const payload = parseFailurePayload(row.failure_json);
      const step = String(payload?.failed_step ?? "").toLowerCase();
      if (["extract", "pipeline", "export"].includes(step)) {
        acc[step] = (acc[step] ?? 0) + 1;
      }
      return acc;
    }, {});

    return {
      queue,
      items,
      retry: {
        max_attempts: MAX_ITEM_RETRY_ATTEMPTS,
        retryable_items: retryableItems,
        non_retryable_items: nonRetryableItems,
      },
      failure_steps: {
        extract: failureSteps.extract ?? 0,
        pipeline: failureSteps.pipeline ?? 0,
        export: failureSteps.export ?? 0,
      },
      worker: {
        interval_ms: workerIntervalMs,
        active: startWorker,
      },
      timestamp: nowIso(),
    };
  });

  app.post("/api/system/worker/run-once", async (request, reply) => {
    if (request.body !== undefined && !isObjectRecord(request.body)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "request body must be an object when provided"));
    }
    const body = (isObjectRecord(request.body) ? request.body : {}) as Record<string, unknown>;
    if (Object.keys(body).length > 0) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "run-once does not accept request body fields"));
    }
    await runWorkerOnce();
    const queueRows = db
      .prepare("SELECT status, COUNT(1) AS count FROM jobs GROUP BY status")
      .all() as Array<{ status: string; count: number }>;
    const queue = queueRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});
    return {
      ok: true,
      queue,
      timestamp: nowIso(),
    };
  });

  app.post("/api/items/retry-failed", async (request, reply) => {
    if (request.body !== undefined && !isObjectRecord(request.body)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "request body must be an object when provided"));
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const unknownRetryFailedKey = Object.keys(body).find((key) => !["limit", "offset", "dry_run", "failure_step", "q"].includes(key));
    if (unknownRetryFailedKey) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "retry-failed body supports only limit|offset|dry_run|failure_step|q"));
    }
    if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "dry_run must be a boolean when provided"));
    }
    if (body.q !== undefined && typeof body.q !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "q must be a string when provided"));
    }
    if (body.failure_step !== undefined && typeof body.failure_step !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "failure_step must be a string when provided"));
    }
    if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isInteger(body.limit))) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "limit must be an integer when provided"));
    }
    if (body.offset !== undefined && (typeof body.offset !== "number" || !Number.isInteger(body.offset))) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "offset must be an integer when provided"));
    }
    const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 200) : 20;
    const offset = typeof body.offset === "number" ? Math.max(body.offset, 0) : 0;
    const dryRun = (body.dry_run as boolean | undefined) ?? false;
    const q = typeof body.q === "string" ? body.q.trim() : "";
    if (body.q !== undefined && !q) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "q must be a non-empty string when provided"));
    }
    const failureStepRaw = typeof body.failure_step === "string" ? body.failure_step.trim().toLowerCase() : "";
    if (body.failure_step !== undefined && !failureStepRaw) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "failure_step must be extract|pipeline|export"));
    }
    if (failureStepRaw && !["extract", "pipeline", "export"].includes(failureStepRaw)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "failure_step must be extract|pipeline|export"));
    }
    const failureStepFilter =
      ["extract", "pipeline", "export"].includes(failureStepRaw) ? (failureStepRaw as "extract" | "pipeline" | "export") : null;
    const targetStatuses =
      failureStepFilter === "extract"
        ? ["FAILED_EXTRACTION"]
        : failureStepFilter === "pipeline"
          ? ["FAILED_AI"]
          : failureStepFilter === "export"
            ? ["FAILED_EXPORT"]
            : ["FAILED_EXTRACTION", "FAILED_AI", "FAILED_EXPORT"];
    const statusPlaceholders = targetStatuses.map(() => "?").join(",");
    const whereParts = [`status IN (${statusPlaceholders})`];
    const params: Array<string | number> = [...targetStatuses];
    if (q) {
      whereParts.push("(title LIKE ? OR domain LIKE ? OR intent_text LIKE ? OR url LIKE ?)");
      const token = `%${q}%`;
      params.push(token, token, token, token);
    }
    const scanCountRow = db
      .prepare(
        `
        SELECT COUNT(1) AS count
        FROM items
        WHERE ${whereParts.join(" AND ")}
      `,
      )
      .get(...params) as { count: number } | undefined;
    const scannedTotal = Number(scanCountRow?.count ?? 0);
    const failedItems = db
      .prepare(
        `
        SELECT * FROM items
        WHERE ${whereParts.join(" AND ")}
        ORDER BY updated_at ASC
        LIMIT ?
        OFFSET ?
      `,
      )
      .all(...params, limit, offset) as DbItemRow[];

    let queued = 0;
    let skippedNonRetryable = 0;
    let skippedUnsupported = 0;
    let eligiblePipeline = 0;
    let eligibleExport = 0;
    const eligiblePipelineItemIds: string[] = [];
    const eligibleExportItemIds: string[] = [];
    const queuedItemIds: string[] = [];
    const ts = nowIso();

    for (const item of failedItems) {
      const failurePayload = parseFailurePayload(item.failure_json);
      const retryable = failurePayload?.retryable !== false;
      if (!retryable) {
        skippedNonRetryable += 1;
        continue;
      }
      if (!["FAILED_EXTRACTION", "FAILED_AI"].includes(item.status)) {
        if (item.status === "FAILED_EXPORT") {
          eligibleExport += 1;
          eligibleExportItemIds.push(item.id);
        } else {
          skippedUnsupported += 1;
        }
        continue;
      }
      eligiblePipeline += 1;
      eligiblePipelineItemIds.push(item.id);

      if (dryRun) {
        continue;
      }
      const updateRes = db
        .prepare("UPDATE items SET status = 'QUEUED', updated_at = ?, failure_json = NULL WHERE id = ? AND status = ?")
        .run(ts, item.id, item.status);
      if (updateRes.changes > 0) {
        createProcessJob(db, item.id, `batch-retry:${item.id}:${nanoid(8)}`);
        queued += 1;
        queuedItemIds.push(item.id);
      }
    }

    return {
      requested_limit: limit,
      requested_offset: offset,
      dry_run: dryRun,
      failure_step_filter: failureStepFilter,
      q_filter: q || null,
      scanned: failedItems.length,
      scanned_total: scannedTotal,
      scan_truncated: offset + failedItems.length < scannedTotal,
      next_offset: offset + failedItems.length < scannedTotal ? offset + failedItems.length : null,
      queued,
      queued_item_ids: queuedItemIds,
      eligible_pipeline: eligiblePipeline,
      eligible_pipeline_item_ids: eligiblePipelineItemIds,
      eligible_export: eligibleExport,
      eligible_export_item_ids: eligibleExportItemIds,
      skipped_non_retryable: skippedNonRetryable,
      skipped_unsupported_status: skippedUnsupported,
      timestamp: nowIso(),
    };
  });

  app.post("/api/items/archive-failed", async (request, reply) => {
    if (request.body !== undefined && !isObjectRecord(request.body)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "request body must be an object when provided"));
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const unknownArchiveFailedKey = Object.keys(body).find(
      (key) => !["limit", "offset", "dry_run", "retryable", "failure_step", "q"].includes(key),
    );
    if (unknownArchiveFailedKey) {
      return reply
        .status(400)
        .send(failure("VALIDATION_ERROR", "archive-failed body supports only limit|offset|dry_run|retryable|failure_step|q"));
    }
    if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "dry_run must be a boolean when provided"));
    }
    if (body.q !== undefined && typeof body.q !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "q must be a string when provided"));
    }
    if (body.failure_step !== undefined && typeof body.failure_step !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "failure_step must be a string when provided"));
    }
    if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isInteger(body.limit))) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "limit must be an integer when provided"));
    }
    if (body.offset !== undefined && (typeof body.offset !== "number" || !Number.isInteger(body.offset))) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "offset must be an integer when provided"));
    }
    const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 200) : 50;
    const offset = typeof body.offset === "number" ? Math.max(body.offset, 0) : 0;
    const dryRun = (body.dry_run as boolean | undefined) ?? false;
    const q = typeof body.q === "string" ? body.q.trim() : "";
    if (body.q !== undefined && !q) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "q must be a non-empty string when provided"));
    }
    const failureStepRaw = typeof body.failure_step === "string" ? body.failure_step.trim().toLowerCase() : "";
    if (body.failure_step !== undefined && !failureStepRaw) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "failure_step must be extract|pipeline|export"));
    }
    if (failureStepRaw && !["extract", "pipeline", "export"].includes(failureStepRaw)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "failure_step must be extract|pipeline|export"));
    }
    const failureStepFilter =
      ["extract", "pipeline", "export"].includes(failureStepRaw) ? (failureStepRaw as "extract" | "pipeline" | "export") : null;
    const retryableRaw = body.retryable;
    let retryableFilter: boolean | null = false;
    if (retryableRaw !== undefined) {
      if (retryableRaw === null) {
        retryableFilter = null;
      } else if (typeof retryableRaw === "boolean") {
        retryableFilter = retryableRaw;
      } else if (typeof retryableRaw === "string") {
        const normalized = retryableRaw.trim().toLowerCase();
        if (normalized === "all") {
          retryableFilter = null;
        } else {
          return reply.status(400).send(failure("VALIDATION_ERROR", "retryable must be true|false|null|all"));
        }
      } else {
        return reply.status(400).send(failure("VALIDATION_ERROR", "retryable must be boolean|null|string"));
      }
    }

    const targetStatuses =
      failureStepFilter === "extract"
        ? ["FAILED_EXTRACTION"]
        : failureStepFilter === "pipeline"
          ? ["FAILED_AI"]
          : failureStepFilter === "export"
            ? ["FAILED_EXPORT"]
            : ["FAILED_EXTRACTION", "FAILED_AI", "FAILED_EXPORT"];
    const statusPlaceholders = targetStatuses.map(() => "?").join(",");
    const whereParts = [`status IN (${statusPlaceholders})`];
    const params: Array<string | number> = [...targetStatuses];
    if (q) {
      whereParts.push("(title LIKE ? OR domain LIKE ? OR intent_text LIKE ? OR url LIKE ?)");
      const token = `%${q}%`;
      params.push(token, token, token, token);
    }
    const scanCountRow = db
      .prepare(
        `
        SELECT COUNT(1) AS count
        FROM items
        WHERE ${whereParts.join(" AND ")}
      `,
      )
      .get(...params) as { count: number } | undefined;
    const scannedTotal = Number(scanCountRow?.count ?? 0);
    const failedItems = db
      .prepare(
        `
        SELECT * FROM items
        WHERE ${whereParts.join(" AND ")}
        ORDER BY updated_at ASC
        LIMIT ?
        OFFSET ?
      `,
      )
      .all(...params, limit, offset) as DbItemRow[];

    let eligible = 0;
    let archived = 0;
    let skippedRetryableMismatch = 0;
    const eligibleItemIds: string[] = [];
    const archivedItemIds: string[] = [];
    const ts = nowIso();

    for (const item of failedItems) {
      const failurePayload = parseFailurePayload(item.failure_json);
      const isRetryable = failurePayload?.retryable !== false;
      if (retryableFilter !== null && isRetryable !== retryableFilter) {
        skippedRetryableMismatch += 1;
        continue;
      }
      eligible += 1;
      eligibleItemIds.push(item.id);
      if (dryRun) {
        continue;
      }
      const updateRes = db.prepare("UPDATE items SET status = 'ARCHIVED', updated_at = ? WHERE id = ? AND status = ?").run(ts, item.id, item.status);
      if (updateRes.changes > 0) {
        archived += 1;
        archivedItemIds.push(item.id);
      }
    }

    return {
      requested_limit: limit,
      requested_offset: offset,
      dry_run: dryRun,
      retryable_filter: retryableFilter,
      failure_step_filter: failureStepFilter,
      q_filter: q || null,
      scanned: failedItems.length,
      scanned_total: scannedTotal,
      scan_truncated: offset + failedItems.length < scannedTotal,
      next_offset: offset + failedItems.length < scannedTotal ? offset + failedItems.length : null,
      eligible,
      eligible_item_ids: eligibleItemIds,
      archived,
      archived_item_ids: archivedItemIds,
      skipped_retryable_mismatch: skippedRetryableMismatch,
      timestamp: nowIso(),
    };
  });

  app.post("/api/items/unarchive-batch", async (request, reply) => {
    if (request.body !== undefined && !isObjectRecord(request.body)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "request body must be an object when provided"));
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const unknownUnarchiveBatchKey = Object.keys(body).find((key) => !["limit", "offset", "dry_run", "regenerate", "q"].includes(key));
    if (unknownUnarchiveBatchKey) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "unarchive-batch body supports only limit|offset|dry_run|regenerate|q"));
    }
    if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "dry_run must be a boolean when provided"));
    }
    if (body.regenerate !== undefined && typeof body.regenerate !== "boolean") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "regenerate must be a boolean when provided"));
    }
    if (body.q !== undefined && typeof body.q !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "q must be a string when provided"));
    }
    if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isInteger(body.limit))) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "limit must be an integer when provided"));
    }
    if (body.offset !== undefined && (typeof body.offset !== "number" || !Number.isInteger(body.offset))) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "offset must be an integer when provided"));
    }
    const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 200) : 50;
    const offset = typeof body.offset === "number" ? Math.max(body.offset, 0) : 0;
    const dryRun = (body.dry_run as boolean | undefined) ?? false;
    const regenerate = (body.regenerate as boolean | undefined) ?? false;
    const q = typeof body.q === "string" ? body.q.trim() : "";
    if (body.q !== undefined && !q) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "q must be a non-empty string when provided"));
    }

    const whereParts = ["status = 'ARCHIVED'"];
    const params: Array<string | number> = [];
    if (q) {
      whereParts.push("(title LIKE ? OR domain LIKE ? OR intent_text LIKE ? OR url LIKE ?)");
      const token = `%${q}%`;
      params.push(token, token, token, token);
    }
    const scanCountRow = db
      .prepare(
        `
        SELECT COUNT(1) AS count
        FROM items
        WHERE ${whereParts.join(" AND ")}
      `,
      )
      .get(...params) as { count: number } | undefined;
    const scannedTotal = Number(scanCountRow?.count ?? 0);
    const archivedItems = db
      .prepare(
        `
        SELECT * FROM items
        WHERE ${whereParts.join(" AND ")}
        ORDER BY updated_at ASC
        LIMIT ?
        OFFSET ?
      `,
      )
      .all(...params, limit, offset) as DbItemRow[];

    let eligibleReady = 0;
    let eligibleQueued = 0;
    let unarchived = 0;
    let queuedJobsCreated = 0;
    const eligibleReadyItemIds: string[] = [];
    const eligibleQueuedItemIds: string[] = [];
    const unarchivedItemIds: string[] = [];
    const ts = nowIso();

    for (const item of archivedItems) {
      const artifacts = latestArtifacts(db, item.id);
      const ready = isReadyFromArtifacts(artifacts);
      const targetStatus = regenerate || !ready ? "QUEUED" : "READY";

      if (targetStatus === "READY") {
        eligibleReady += 1;
        eligibleReadyItemIds.push(item.id);
      } else {
        eligibleQueued += 1;
        eligibleQueuedItemIds.push(item.id);
      }

      if (dryRun) {
        continue;
      }

      const updateRes = db.prepare("UPDATE items SET status = ?, updated_at = ? WHERE id = ? AND status = 'ARCHIVED'").run(targetStatus, ts, item.id);
      if (updateRes.changes > 0) {
        unarchived += 1;
        unarchivedItemIds.push(item.id);
        if (targetStatus === "QUEUED") {
          createProcessJob(db, item.id, `batch-unarchive:${item.id}:${nanoid(8)}`);
          queuedJobsCreated += 1;
        }
      }
    }

    return {
      requested_limit: limit,
      requested_offset: offset,
      dry_run: dryRun,
      regenerate,
      q_filter: q || null,
      scanned: archivedItems.length,
      scanned_total: scannedTotal,
      scan_truncated: offset + archivedItems.length < scannedTotal,
      next_offset: offset + archivedItems.length < scannedTotal ? offset + archivedItems.length : null,
      eligible: eligibleReady + eligibleQueued,
      eligible_ready: eligibleReady,
      eligible_ready_item_ids: eligibleReadyItemIds,
      eligible_queued: eligibleQueued,
      eligible_queued_item_ids: eligibleQueuedItemIds,
      unarchived,
      unarchived_item_ids: unarchivedItemIds,
      queued_jobs_created: queuedJobsCreated,
      timestamp: nowIso(),
    };
  });

  app.post("/api/capture", async (request, reply) => {
    if (request.body !== undefined && !isObjectRecord(request.body)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "request body must be an object when provided"));
    }
    const body = (isObjectRecord(request.body) ? request.body : {}) as Record<string, unknown>;
    const unknownCaptureKey = Object.keys(body).find(
      (key) => !["capture_id", "url", "title", "domain", "source_type", "intent_text"].includes(key),
    );
    if (unknownCaptureKey) {
      return reply
        .status(400)
        .send(failure("VALIDATION_ERROR", "capture body supports only capture_id|url|title|domain|source_type|intent_text"));
    }
    if (body.capture_id != null && typeof body.capture_id !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "capture_id must be a string when provided"));
    }
    if (typeof body.capture_id === "string" && !body.capture_id.trim()) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "capture_id must be a non-empty string when provided"));
    }
    if (body.url != null && typeof body.url !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "url must be a string"));
    }
    if (body.intent_text != null && typeof body.intent_text !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "intent_text must be a string"));
    }
    if (body.title != null && typeof body.title !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "title must be a string when provided"));
    }
    if (body.domain != null && typeof body.domain !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "domain must be a string when provided"));
    }
    if (body.source_type != null && typeof body.source_type !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "source_type must be a string when provided"));
    }
    const headerKey = normalizeCaptureIdempotencyKey(request.headers["idempotency-key"], true);
    const captureId = normalizeCaptureIdempotencyKey(body.capture_id);
    if (headerKey && captureId && headerKey !== captureId) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "Idempotency-Key and capture_id must match when both are provided"));
    }
    const idempotencyKey = headerKey || captureId;
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const intentText = typeof body.intent_text === "string" ? body.intent_text.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const sourceTypeInput = (typeof body.source_type === "string" ? body.source_type : "")
      .trim()
      .toLowerCase();
    const sourceType = sourceTypeInput || inferSourceTypeFromUrl(url);
    const providedDomain = typeof body.domain === "string" ? body.domain.trim() : "";

    if (!url || !intentText) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "url and intent_text are required"));
    }
    if (body.source_type !== undefined && !sourceTypeInput) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "source_type must be web|youtube|newsletter|other"));
    }
    if (!["web", "youtube", "newsletter", "other"].includes(sourceType)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "source_type must be web|youtube|newsletter|other"));
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!["http:", "https:", "data:"].includes(parsedUrl.protocol)) {
        return reply.status(400).send(failure("VALIDATION_ERROR", "url protocol must be http/https/data"));
      }
    } catch {
      return reply.status(400).send(failure("VALIDATION_ERROR", "url is invalid"));
    }
    const isWebLikeUrl = ["http:", "https:"].includes(parsedUrl.protocol);
    const inferredDomain = isWebLikeUrl ? normalizeHostname(parsedUrl.hostname) : "";
    const normalizedProvidedDomain = normalizeHostname(providedDomain);
    const domain = isWebLikeUrl ? inferredDomain : normalizedProvidedDomain;
    const sanitizedUrl = sanitizeUrlForStorage(parsedUrl);
    const requestCaptureKey = idempotencyKey || deriveCaptureKey(sanitizedUrl, intentText);

    const existing = db
      .prepare("SELECT * FROM items WHERE capture_key = ?")
      .get(requestCaptureKey) as DbItemRow | undefined;
    if (existing) {
      return reply.status(201).send({
        item: {
          id: existing.id,
          status: existing.status,
          created_at: existing.created_at,
        },
        idempotent_replay: true,
      });
    }

    const id = `itm_${nanoid(10)}`;
    const ts = nowIso();
    try {
      db.prepare(
        `
        INSERT INTO items(id, url, title, domain, source_type, intent_text, status, created_at, updated_at, capture_key)
        VALUES(?, ?, ?, ?, ?, ?, 'CAPTURED', ?, ?, ?)
        `,
      ).run(id, sanitizedUrl, title, domain, sourceType, intentText, ts, ts, requestCaptureKey);
    } catch (error) {
      if (!isCaptureKeyUniqueConstraintError(error)) {
        throw error;
      }
      const concurrentExisting = db
        .prepare("SELECT * FROM items WHERE capture_key = ?")
        .get(requestCaptureKey) as DbItemRow | undefined;
      if (!concurrentExisting) {
        throw error;
      }
      return reply.status(201).send({
        item: {
          id: concurrentExisting.id,
          status: concurrentExisting.status,
          created_at: concurrentExisting.created_at,
        },
        idempotent_replay: true,
      });
    }

    createProcessJob(db, id, `capture:${id}:${requestCaptureKey}`);

    return reply.status(201).send({
      item: {
        id,
        status: "CAPTURED",
        created_at: ts,
      },
      idempotent_replay: false,
    });
  });

  app.get("/api/items", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const unknownItemsQueryKey = Object.keys(query).find(
      (key) => !["status", "priority", "source_type", "retryable", "failure_step", "q", "sort", "offset", "cursor", "limit"].includes(key),
    );
    if (unknownItemsQueryKey) {
      return reply.status(400).send(
        failure(
          "VALIDATION_ERROR",
          "items query supports only status|priority|source_type|retryable|failure_step|q|sort|offset|cursor|limit",
        ),
      );
    }
    const rawStatuses = normalizeQueryList(query.status).map((x) => x.toUpperCase());
    if (query.status !== undefined && rawStatuses.length === 0) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "status must contain valid item statuses"));
    }
    const statuses = Array.from(
      new Set(
        rawStatuses.flatMap((status) =>
          status === "FAILED_*" ? ["FAILED_EXTRACTION", "FAILED_AI", "FAILED_EXPORT"] : [status],
        ),
      ),
    );
    const priorities = normalizeQueryList(query.priority).map((x) => x.toUpperCase());
    if (query.priority !== undefined && priorities.length === 0) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "priority must contain READ_NEXT|WORTH_IT|IF_TIME|SKIP"));
    }
    const sourceTypes = normalizeQueryList(query.source_type).map((x) => x.toLowerCase());
    if (query.source_type !== undefined && sourceTypes.length === 0) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "source_type must contain web|youtube|newsletter|other"));
    }
    const allowedStatuses = new Set([
      "CAPTURED",
      "QUEUED",
      "PROCESSING",
      "READY",
      "FAILED_EXTRACTION",
      "FAILED_AI",
      "FAILED_EXPORT",
      "FAILED_*",
      "SHIPPED",
      "ARCHIVED",
    ]);
    const allowedPriorities = new Set(["READ_NEXT", "WORTH_IT", "IF_TIME", "SKIP"]);
    const allowedSourceTypes = new Set(["web", "youtube", "newsletter", "other"]);
    const invalidStatus = rawStatuses.find((status) => !allowedStatuses.has(status));
    if (invalidStatus) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "status must contain valid item statuses"));
    }
    const invalidPriority = priorities.find((priority) => !allowedPriorities.has(priority));
    if (invalidPriority) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "priority must contain READ_NEXT|WORTH_IT|IF_TIME|SKIP"));
    }
    const invalidSourceType = sourceTypes.find((sourceType) => !allowedSourceTypes.has(sourceType));
    if (invalidSourceType) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "source_type must contain web|youtube|newsletter|other"));
    }
    if (query.retryable !== undefined && typeof query.retryable !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "retryable must be true|false"));
    }
    if (query.failure_step !== undefined && typeof query.failure_step !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "failure_step must be extract|pipeline|export"));
    }
    const retryableQuery = typeof query.retryable === "string" ? query.retryable.trim().toLowerCase() : "";
    if (query.retryable !== undefined && !retryableQuery) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "retryable must be true|false"));
    }
    if (retryableQuery && retryableQuery !== "true" && retryableQuery !== "false") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "retryable must be true|false"));
    }
    const retryableFilter = retryableQuery === "true" ? true : retryableQuery === "false" ? false : null;
    const failureStepQuery = typeof query.failure_step === "string" ? query.failure_step.trim().toLowerCase() : "";
    if (query.failure_step !== undefined && !failureStepQuery) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "failure_step must be extract|pipeline|export"));
    }
    if (failureStepQuery && !["extract", "pipeline", "export"].includes(failureStepQuery)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "failure_step must be extract|pipeline|export"));
    }
    const failureStepFilter =
      ["extract", "pipeline", "export"].includes(failureStepQuery) ? (failureStepQuery as "extract" | "pipeline" | "export") : null;
    if (query.q !== undefined && typeof query.q !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "q must be a non-empty string when provided"));
    }
    const q = typeof query.q === "string" ? query.q.trim() : "";
    if (query.q !== undefined && !q) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "q must be a non-empty string when provided"));
    }
    if (query.sort !== undefined && typeof query.sort !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "sort must be priority_score_desc|created_desc|updated_desc"));
    }
    const sortRaw = typeof query.sort === "string" ? query.sort.trim() : "";
    if (query.sort !== undefined && !sortRaw) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "sort must be priority_score_desc|created_desc|updated_desc"));
    }
    const sort = sortRaw || "priority_score_desc";
    if (!["priority_score_desc", "created_desc", "updated_desc"].includes(sort)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "sort must be priority_score_desc|created_desc|updated_desc"));
    }
    if (query.cursor !== undefined && typeof query.cursor !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "cursor must be a non-empty string when provided"));
    }
    const cursorRaw = typeof query.cursor === "string" ? query.cursor.trim() : "";
    if (query.cursor !== undefined && !cursorRaw) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "cursor must be a non-empty string when provided"));
    }
    const limitRaw =
      typeof query.limit === "string" ? (query.limit.trim() ? Number(query.limit.trim()) : Number.NaN) : Number(query.limit ?? 20);
    const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const offsetRaw =
      typeof query.offset === "string" ? (query.offset.trim() ? Number(query.offset.trim()) : Number.NaN) : Number(query.offset ?? 0);
    const requestedOffset = Number.isInteger(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
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
    if (failureStepFilter === "extract") {
      whereParts.push("status = 'FAILED_EXTRACTION'");
    } else if (failureStepFilter === "pipeline") {
      whereParts.push("status = 'FAILED_AI'");
    } else if (failureStepFilter === "export") {
      whereParts.push("status = 'FAILED_EXPORT'");
    } else if (retryableFilter !== null) {
      whereParts.push("status IN ('FAILED_EXTRACTION', 'FAILED_AI', 'FAILED_EXPORT')");
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

    const selectSql = `
      SELECT id, url, title, domain, source_type, intent_text, status, priority, match_score, failure_json, created_at, updated_at
      FROM items
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ?
      OFFSET ?
    `;

    const rowMatchesRetryable = (row: DbItemRow): boolean => {
      if (retryableFilter === null) return true;
      if (!String(row.status || "").startsWith("FAILED_")) return false;
      if (!row.failure_json) return retryableFilter;
      const payload = parseFailurePayload(row.failure_json);
      const isRetryable = payload?.retryable !== false;
      return retryableFilter ? isRetryable : !isRetryable;
    };

    const rows: DbItemRow[] = [];
    if (retryableFilter === null) {
      const selected = db.prepare(selectSql).all(...params, limit, requestedOffset) as DbItemRow[];
      rows.push(...selected);
    } else {
      const batchSize = Math.max(limit, 100);
      let scanOffset = 0;
      let matchedOffset = 0;
      while (rows.length < limit) {
        const chunk = db.prepare(selectSql).all(...params, batchSize, scanOffset) as DbItemRow[];
        if (!chunk.length) break;
        for (const row of chunk) {
          if (rowMatchesRetryable(row)) {
            if (matchedOffset < requestedOffset) {
              matchedOffset += 1;
              continue;
            }
            rows.push(row);
            if (rows.length >= limit) break;
          }
        }
        if (chunk.length < batchSize) break;
        scanOffset += chunk.length;
      }
    }

    const mappedItems = rows.map((row) => rowToItem(row));

    return {
      items: mappedItems,
      requested_offset: requestedOffset,
      next_cursor: null,
    };
  });

  app.get("/api/items/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const query = request.query as Record<string, unknown>;
    const unknownItemDetailQueryKey = Object.keys(query).find((key) => !["include_history", "artifact_versions"].includes(key));
    if (unknownItemDetailQueryKey) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "item detail query supports only include_history|artifact_versions"));
    }
    if (query.include_history !== undefined && typeof query.include_history !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "include_history must be true|false when provided"));
    }
    const includeHistoryRaw = typeof query.include_history === "string" ? query.include_history.trim().toLowerCase() : "";
    if (query.include_history !== undefined && !includeHistoryRaw) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "include_history must be true|false when provided"));
    }
    if (includeHistoryRaw && includeHistoryRaw !== "true" && includeHistoryRaw !== "false") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "include_history must be true|false when provided"));
    }
    const includeHistory = includeHistoryRaw === "true";
    const versionOverrides = parseArtifactVersions(query?.artifact_versions);
    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as DbItemRow | undefined;
    if (!item) {
      return reply.status(404).send(failure("NOT_FOUND", "Item not found", { item_id: id }));
    }

    const response = {
      item: rowToItem(item),
      artifacts: selectedArtifacts(db, id, versionOverrides),
      failure: parseFailurePayload(item.failure_json),
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

    if (request.body !== undefined && !isObjectRecord(request.body)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "request body must be an object when provided"));
    }
    const body = (isObjectRecord(request.body) ? request.body : {}) as { intent_text?: unknown; regenerate?: unknown };
    const unknownIntentKey = Object.keys(body).find((key) => !["intent_text", "regenerate"].includes(key));
    if (unknownIntentKey) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "intent body supports only intent_text|regenerate"));
    }
    if (typeof body.intent_text !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "intent_text must be a string"));
    }
    if (body.regenerate !== undefined && typeof body.regenerate !== "boolean") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "regenerate must be a boolean when provided"));
    }
    const intentText = body.intent_text.trim();
    const regenerate = (body.regenerate as boolean | undefined) ?? false;
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

    if (request.body !== undefined && !isObjectRecord(request.body)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "request body must be an object when provided"));
    }
    const body = (isObjectRecord(request.body) ? request.body : {}) as { payload?: unknown; template_version?: unknown };
    const unknownArtifactEditKey = Object.keys(body).find((key) => !["payload", "template_version"].includes(key));
    if (unknownArtifactEditKey) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "artifact edit body supports only payload|template_version"));
    }
    if (!isObjectRecord(body.payload)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "payload must be a JSON object"));
    }
    if (body.template_version !== undefined && typeof body.template_version !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "template_version must be a string when provided"));
    }

    const templateVersionRaw = typeof body.template_version === "string" ? body.template_version.trim() : "";
    if (body.template_version !== undefined && !templateVersionRaw) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "template_version must be a non-empty string when provided"));
    }
    const templateVersion = templateVersionRaw || `user.${artifactType}.edit.v1`;
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

  app.get("/api/items/:id/artifacts/:artifactType/compare", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const artifactType = (request.params as { artifactType: string }).artifactType;
    const item = db.prepare("SELECT id FROM items WHERE id = ?").get(id) as { id: string } | undefined;
    if (!item) {
      return reply.status(404).send(failure("NOT_FOUND", "Item not found"));
    }

    const query = request.query as Record<string, unknown>;
    const baseVersion = Number(query.base_version);
    const targetVersion = Number(query.target_version);
    if (!Number.isInteger(baseVersion) || baseVersion < 1 || !Number.isInteger(targetVersion) || targetVersion < 1) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "base_version and target_version must be integers >= 1"));
    }

    const baseRow = artifactVersionRow(db, id, artifactType, baseVersion);
    const targetRow = artifactVersionRow(db, id, artifactType, targetVersion);
    if (!baseRow || !targetRow) {
      return reply.status(404).send(failure("NOT_FOUND", "Artifact version not found", { artifact_type: artifactType }));
    }

    const basePayload = safeParseJson(baseRow.payload_json);
    const targetPayload = safeParseJson(targetRow.payload_json);
    if (!isObjectRecord(basePayload) || !isObjectRecord(targetPayload)) {
      return reply.status(500).send(
        failure("DATA_CORRUPTION", "Artifact payload is malformed", {
          item_id: id,
          artifact_type: artifactType,
          base_version: baseVersion,
          target_version: targetVersion,
        }),
      );
    }
    const summary = comparePayloads(basePayload, targetPayload);

    return {
      item_id: id,
      artifact_type: artifactType,
      base: {
        version: baseRow.version,
        created_by: baseRow.created_by,
        created_at: baseRow.created_at,
        payload: basePayload,
      },
      target: {
        version: targetRow.version,
        created_by: targetRow.created_by,
        created_at: targetRow.created_at,
        payload: targetPayload,
      },
      summary,
    };
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

    if (request.body !== undefined && !isObjectRecord(request.body)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "request body must be an object when provided"));
    }
    const body = (isObjectRecord(request.body) ? request.body : {}) as Record<string, unknown>;
    const unknownProcessKey = Object.keys(body).find((key) => !["mode", "process_request_id", "options"].includes(key));
    if (unknownProcessKey) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "process body supports only mode|process_request_id|options"));
    }
    if (body.mode !== undefined && typeof body.mode !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "mode must be PROCESS | RETRY | REGENERATE"));
    }
    if (body.options !== undefined && !isObjectRecord(body.options)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "options must be an object when provided"));
    }
    const optionsPayload = isObjectRecord(body.options) ? body.options : undefined;
    if (optionsPayload) {
      const unknownOptionKey = Object.keys(optionsPayload).find((key) => !["template_profile", "force_regenerate"].includes(key));
      if (unknownOptionKey) {
        return reply.status(400).send(
          failure("VALIDATION_ERROR", "options supports only template_profile|force_regenerate"),
        );
      }
    }
    if (optionsPayload?.template_profile !== undefined && typeof optionsPayload.template_profile !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "options.template_profile must be engineer|creator|manager"));
    }
    const templateProfileRaw =
      typeof optionsPayload?.template_profile === "string" ? optionsPayload.template_profile.trim().toLowerCase() : undefined;
    if (optionsPayload?.template_profile !== undefined && !templateProfileRaw) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "options.template_profile must be engineer|creator|manager"));
    }
    if (templateProfileRaw && !["engineer", "creator", "manager"].includes(templateProfileRaw)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "options.template_profile must be engineer|creator|manager"));
    }
    if (optionsPayload?.force_regenerate !== undefined && typeof optionsPayload.force_regenerate !== "boolean") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "options.force_regenerate must be a boolean when provided"));
    }
    const processOptions: ProcessJobOptions | undefined = optionsPayload
      ? {
          ...(templateProfileRaw ? { template_profile: templateProfileRaw as ProcessTemplateProfile } : {}),
          ...(optionsPayload.force_regenerate !== undefined
            ? { force_regenerate: optionsPayload.force_regenerate as boolean }
            : {}),
        }
      : undefined;

    const modeRaw = (typeof body.mode === "string" ? body.mode : "PROCESS").trim().toUpperCase();
    const allowedModes = ["PROCESS", "RETRY", "REGENERATE"] as const;
    const mode = allowedModes.includes(modeRaw as ProcessMode) ? (modeRaw as ProcessMode) : null;
    if (!mode) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "mode must be PROCESS | RETRY | REGENERATE"));
    }
    const headerProcessRaw = request.headers["idempotency-key"];
    if (body.process_request_id != null && typeof body.process_request_id !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "process_request_id must be a string when provided"));
    }
    if (typeof body.process_request_id === "string" && !body.process_request_id.trim()) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "process_request_id must be a non-empty string when provided"));
    }
    const headerProcessKey = normalizeIdempotencyHeaderKey(headerProcessRaw);
    const bodyProcessKey = normalizeIdempotencyKey(body.process_request_id);
    if (headerProcessKey && bodyProcessKey && headerProcessKey !== bodyProcessKey) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "Idempotency-Key and process_request_id must match when both are provided"));
    }
    const explicitProcessKey = headerProcessKey || bodyProcessKey;
    const processKey = explicitProcessKey || `manual_${nanoid(8)}`;
    const requestKey = `process:${id}:${mode}:${processKey}`;
    if (explicitProcessKey) {
      const existingJob = db.prepare("SELECT id FROM jobs WHERE request_key = ?").get(requestKey) as { id: string } | undefined;
      if (existingJob) {
        return reply.status(202).send({
          item: {
            id,
            status: item.status,
            updated_at: item.updated_at,
          },
          mode,
          idempotent_replay: true,
        });
      }
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

    if (mode === "RETRY" && item.failure_json) {
      const failurePayload = parseFailurePayload(item.failure_json);
      if (failurePayload?.retryable === false) {
        return reply.status(409).send(
          failure("RETRY_LIMIT_REACHED", "Retry limit reached for this item", {
            item_id: id,
            retry_attempts: failurePayload.retry_attempts ?? null,
            retry_limit: failurePayload.retry_limit ?? MAX_ITEM_RETRY_ATTEMPTS,
          }),
        );
      }
    }

    const ts = nowIso();
    const updateRes = db
      .prepare("UPDATE items SET status = 'QUEUED', updated_at = ?, failure_json = NULL WHERE id = ? AND status = ?")
      .run(ts, id, item.status);
    if (updateRes.changes === 0) {
      if (explicitProcessKey) {
        const replayJob = db.prepare("SELECT id FROM jobs WHERE request_key = ?").get(requestKey) as { id: string } | undefined;
        if (replayJob) {
          const latestItem = db.prepare("SELECT id, status, updated_at FROM items WHERE id = ?").get(id) as
            | { id: string; status: string; updated_at: string }
            | undefined;
          return reply.status(202).send({
            item: {
              id,
              status: latestItem?.status ?? item.status,
              updated_at: latestItem?.updated_at ?? item.updated_at,
            },
            mode,
            idempotent_replay: true,
          });
        }
      }
      return reply.status(409).send(
        failure("STATE_CONFLICT", "Item status changed before queueing, please retry", {
          item_id: id,
          status: item.status,
          mode,
        }),
      );
    }
    createProcessJob(db, id, requestKey, processOptions);

    return reply.status(202).send({
      item: {
        id,
        status: "QUEUED",
        updated_at: ts,
      },
      mode,
      idempotent_replay: false,
    });
  });

  app.post("/api/items/:id/export", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (request.body !== undefined && !isObjectRecord(request.body)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "request body must be an object when provided"));
    }
    const body = (isObjectRecord(request.body) ? request.body : {}) as Record<string, unknown>;
    const unknownExportKey = Object.keys(body).find((key) => !["export_key", "formats", "card_version", "options"].includes(key));
    if (unknownExportKey) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "export body supports only export_key|formats|card_version|options"));
    }
    if (body.export_key != null && typeof body.export_key !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "export_key must be a string when provided"));
    }
    if (typeof body.export_key === "string" && !body.export_key.trim()) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "export_key must be a non-empty string when provided"));
    }
    if (body.card_version != null && (!Number.isInteger(body.card_version) || Number(body.card_version) < 1)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "card_version must be an integer >= 1 when provided"));
    }
    const formatsInput = body.formats;
    if (
      formatsInput !== undefined &&
      typeof formatsInput !== "string" &&
      (!Array.isArray(formatsInput) || formatsInput.some((entry) => typeof entry !== "string"))
    ) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "formats must be a string or an array of strings when provided"));
    }
    if (body.options !== undefined && !isObjectRecord(body.options)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "options must be an object when provided"));
    }
    const exportOptionsPayload = isObjectRecord(body.options) ? body.options : undefined;
    if (exportOptionsPayload) {
      const unknownOptionKey = Object.keys(exportOptionsPayload).find((key) => !["theme"].includes(key));
      if (unknownOptionKey) {
        return reply.status(400).send(failure("VALIDATION_ERROR", "options supports only theme"));
      }
    }
    if (exportOptionsPayload?.theme !== undefined && typeof exportOptionsPayload.theme !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "options.theme must be LIGHT|DARK"));
    }
    const exportThemeRaw = typeof exportOptionsPayload?.theme === "string" ? exportOptionsPayload.theme.trim().toUpperCase() : undefined;
    if (exportOptionsPayload?.theme !== undefined && !exportThemeRaw) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "options.theme must be LIGHT|DARK"));
    }
    if (exportThemeRaw && !["LIGHT", "DARK"].includes(exportThemeRaw)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "options.theme must be LIGHT|DARK"));
    }
    const exportTheme = exportThemeRaw as "LIGHT" | "DARK" | undefined;
    const requestedCardVersion = typeof body.card_version === "number" ? body.card_version : undefined;
    const headerExportRaw = request.headers["idempotency-key"];
    const headerExportKey = normalizeIdempotencyHeaderKey(headerExportRaw);
    const bodyExportKey = normalizeIdempotencyKey(body.export_key);
    if (headerExportKey && bodyExportKey && headerExportKey !== bodyExportKey) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "Idempotency-Key and export_key must match when both are provided"));
    }
    const exportKey = bodyExportKey || headerExportKey || `exp_${nanoid(8)}`;
    const requestedFormats = normalizeQueryList(formatsInput).map((x) => x.toLowerCase());
    if (body.formats !== undefined && requestedFormats.length === 0) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "formats must include at least one of png|md|caption"));
    }
    const allowedFormats = new Set(["png", "md", "caption"]);
    const hasUnsupportedFormat = requestedFormats.some((format) => !allowedFormats.has(format));
    if (hasUnsupportedFormat) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "formats must include only png|md|caption"));
    }
    const formats = (requestedFormats.length ? Array.from(new Set(requestedFormats)) : ["png", "md", "caption"]) as Array<
      "png" | "md" | "caption"
    >;

    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as DbItemRow | undefined;
    if (!item) {
      return reply.status(404).send(failure("NOT_FOUND", "Item not found"));
    }

    if (!["READY", "SHIPPED", "FAILED_EXPORT"].includes(item.status)) {
      return reply.status(409).send(failure("EXPORT_NOT_ALLOWED", "Export is only allowed for READY/SHIPPED/FAILED_EXPORT states"));
    }
    const existingExportPayload = findExportPayloadByKey(db, id, exportKey);
    if (existingExportPayload) {
      const ts = nowIso();
      db.prepare("UPDATE items SET status = 'SHIPPED', updated_at = ?, failure_json = NULL WHERE id = ?").run(ts, id);
      return {
        item: { id, status: "SHIPPED", updated_at: ts },
        export: {
          artifact_type: "export",
          payload: existingExportPayload,
        },
        idempotent_replay: true,
      };
    }

    if (item.status === "FAILED_EXPORT" && item.failure_json) {
      const failurePayload = parseFailurePayload(item.failure_json);
      if (failurePayload?.retryable === false) {
        return reply.status(409).send(
          failure("RETRY_LIMIT_REACHED", "Retry limit reached for this item", {
            item_id: id,
            retry_attempts: failurePayload.retry_attempts ?? null,
            retry_limit: failurePayload.retry_limit ?? MAX_ITEM_RETRY_ATTEMPTS,
          }),
        );
      }
    }

    let cardPayload: Record<string, unknown> | undefined;
    let usedCardVersion: number | undefined;
    if (requestedCardVersion) {
      const requestedCardRow = artifactVersionRow(db, id, "card", requestedCardVersion);
      if (!requestedCardRow) {
        return reply.status(404).send(
          failure("NOT_FOUND", "Card artifact version not found", {
            item_id: id,
            artifact_type: "card",
            version: requestedCardVersion,
          }),
        );
      }
      const parsedRequestedCard = parseArtifactRow(requestedCardRow);
      if (!parsedRequestedCard) {
        return reply.status(500).send(
          failure("DATA_CORRUPTION", "Card artifact payload is malformed", {
            item_id: id,
            artifact_type: "card",
            version: requestedCardVersion,
          }),
        );
      }
      cardPayload = parsedRequestedCard.payload;
      usedCardVersion = parsedRequestedCard.version;
    } else {
      const artifacts = latestArtifacts(db, id);
      const cardArtifact = artifacts.card as { payload?: Record<string, unknown>; version?: number } | undefined;
      if (!cardArtifact?.payload) {
        return reply.status(409).send(failure("STATE_CONFLICT", "Card artifact is missing"));
      }
      cardPayload = cardArtifact.payload;
      usedCardVersion = Number.isInteger(cardArtifact.version) ? cardArtifact.version : undefined;
    }

    const exportDir = resolve(root, "exports", id);
    mkdirSync(exportDir, { recursive: true });

    const card = cardPayload as {
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
    const cardForRender = exportTheme
      ? {
          ...card,
          render_spec: {
            ...(card.render_spec ?? {}),
            theme: exportTheme,
          },
        }
      : card;

    if (formats.includes("png")) {
      const pngResult = await tryRenderPngFromCard(root, id, cardForRender, { disabled: disablePngRender });
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
      let previousAttempts = 0;
      if (item.failure_json) {
        const previousFailure = parseFailurePayload(item.failure_json);
        if (previousFailure?.failed_step === "export") {
          previousAttempts = Number(previousFailure.retry_attempts ?? 0);
        }
      }
      const retryAttempts = previousAttempts + 1;
      const retryable = retryAttempts < MAX_ITEM_RETRY_ATTEMPTS;
      const failurePayload = {
        failed_step: "export",
        error_code: "EXPORT_RENDER_FAILED",
        message: pngErrorMessage ?? "No export files generated",
        retryable,
        retry_attempts: retryAttempts,
        retry_limit: MAX_ITEM_RETRY_ATTEMPTS,
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

    const concurrentReplayPayload = findExportPayloadByKey(db, id, exportKey);
    if (concurrentReplayPayload) {
      const ts = nowIso();
      db.prepare("UPDATE items SET status = 'SHIPPED', updated_at = ?, failure_json = NULL WHERE id = ?").run(ts, id);
      return {
        item: { id, status: "SHIPPED", updated_at: ts },
        export: {
          artifact_type: "export",
          payload: concurrentReplayPayload,
        },
        idempotent_replay: true,
      };
    }

    const exportPayload = {
      files,
      export_key: exportKey,
      ...(usedCardVersion ? { card_version: usedCardVersion } : {}),
      ...(exportTheme ? { options: { theme: exportTheme } } : {}),
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
      idempotent_replay: false,
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
    if (request.body !== undefined && !isObjectRecord(request.body)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "request body must be an object when provided"));
    }
    const body = isObjectRecord(request.body) ? request.body : {};
    const unknownArchiveKey = Object.keys(body).find((key) => key !== "reason");
    if (unknownArchiveKey) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "archive body supports only reason"));
    }
    if (body.reason !== undefined && typeof body.reason !== "string") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "reason must be a string when provided"));
    }
    const archiveReason = typeof body.reason === "string" ? body.reason.trim() : undefined;
    if (body.reason !== undefined && !archiveReason) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "reason must be a non-empty string when provided"));
    }
    const ts = nowIso();
    const updateRes = db.prepare("UPDATE items SET status = 'ARCHIVED', updated_at = ? WHERE id = ? AND status = ?").run(ts, id, item.status);
    if (updateRes.changes === 0) {
      return reply.status(409).send(failure("STATE_CONFLICT", "Item status changed before archive, please retry", { item_id: id, status: item.status }));
    }
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

    if (request.body !== undefined && !isObjectRecord(request.body)) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "request body must be an object when provided"));
    }
    const body = (isObjectRecord(request.body) ? request.body : {}) as Record<string, unknown>;
    const unknownUnarchiveKey = Object.keys(body).find((key) => key !== "regenerate");
    if (unknownUnarchiveKey) {
      return reply.status(400).send(failure("VALIDATION_ERROR", "unarchive body supports only regenerate"));
    }
    if (body.regenerate !== undefined && typeof body.regenerate !== "boolean") {
      return reply.status(400).send(failure("VALIDATION_ERROR", "regenerate must be a boolean when provided"));
    }
    const regenerate = body.regenerate ?? false;
    const artifacts = latestArtifacts(db, id);
    const ready = isReadyFromArtifacts(artifacts);
    const targetStatus = regenerate || !ready ? "QUEUED" : "READY";
    const ts = nowIso();
    const updateRes = db.prepare("UPDATE items SET status = ?, updated_at = ? WHERE id = ? AND status = 'ARCHIVED'").run(targetStatus, ts, id);
    if (updateRes.changes === 0) {
      return reply.status(409).send(failure("STATE_CONFLICT", "Item status changed before unarchive, please retry", { item_id: id, status: item.status }));
    }

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

    const jobOptions = parseProcessJobOptions(job.options_json);
    const profile = jobOptions?.template_profile ?? defaultProfile;

    try {
      const cachedExtraction = jobOptions?.force_regenerate === true ? undefined : latestReusableExtractionPayload(db, item.id);
      const extraction = cachedExtraction ?? (await extractFromUrl(item.url));
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
        profile,
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
      const failedAttempts = countFailedJobsForItem(db, item.id) + 1;
      const retryable = failedAttempts < MAX_ITEM_RETRY_ATTEMPTS;
      const failurePayload = {
        failed_step: isExtractionFailure ? "extract" : "pipeline",
        error_code: isExtractionFailure ? "EXTRACTION_FETCH_FAILED" : "AI_PROVIDER_ERROR",
        message,
        retryable,
        retry_attempts: failedAttempts,
        retry_limit: MAX_ITEM_RETRY_ATTEMPTS,
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
