import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ErrorObject, ValidateFunction } from "ajv";

type ValidateResult =
  | { ok: true }
  | { ok: false; errors: Array<{ path: string; message: string }> };

const SCHEMA_FILES = {
  item: "item.schema.json",
  artifactEnvelope: "artifact-envelope.schema.json",
  extraction: "extraction.schema.json",
  summary: "summary.schema.json",
  score: "score.schema.json",
  todos: "todos.schema.json",
  card: "card.schema.json",
  export: "export.schema.json",
} as const;

export type SchemaName = keyof typeof SCHEMA_FILES;

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default as new (options: Record<string, unknown>) => {
  compile: (schema: unknown) => ValidateFunction;
};
const addFormats = require("ajv-formats").default as (ajvInstance: unknown) => void;

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
addFormats(ajv);

const validatorCache = new Map<SchemaName, ValidateFunction>();

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(resolve(current, "docs/contracts/schemas"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Unable to locate repo root from: ${startDir}`);
    }
    current = parent;
  }
}

function schemaDirectory(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const root = findRepoRoot(moduleDir);
  return resolve(root, "docs/contracts/schemas");
}

function compileSchema(name: SchemaName): ValidateFunction {
  const schemaPath = resolve(schemaDirectory(), SCHEMA_FILES[name]);
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  return ajv.compile(schema);
}

function getValidator(name: SchemaName): ValidateFunction {
  const cached = validatorCache.get(name);
  if (cached) {
    return cached;
  }
  const validator = compileSchema(name);
  validatorCache.set(name, validator);
  return validator;
}

function toErrors(errors: ErrorObject[] | null | undefined): Array<{ path: string; message: string }> {
  if (!errors) {
    return [];
  }
  return errors.map((e) => ({
    path: e.instancePath || e.schemaPath,
    message: e.message || "Invalid value",
  }));
}

export function validateSchema(name: SchemaName, payload: unknown): ValidateResult {
  const validator = getValidator(name);
  const valid = validator(payload);

  if (valid) {
    return { ok: true };
  }

  return { ok: false, errors: toErrors(validator.errors) };
}

export function ensureSchema(name: SchemaName, payload: unknown): void {
  const result = validateSchema(name, payload);
  if (!result.ok) {
    throw new Error(`Schema validation failed for ${name}: ${JSON.stringify(result.errors)}`);
  }
}
