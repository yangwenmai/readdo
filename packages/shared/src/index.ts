export const ITEM_STATUSES = [
  "CAPTURED",
  "QUEUED",
  "PROCESSING",
  "READY",
  "FAILED_EXTRACTION",
  "FAILED_AI",
  "FAILED_EXPORT",
  "SHIPPED",
  "ARCHIVED",
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const PRIORITIES = ["READ_NEXT", "WORTH_IT", "IF_TIME", "SKIP"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const SOURCE_TYPES = ["web", "youtube", "newsletter", "other"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type FailurePayload = {
  failed_step?: string;
  error_code: string;
  message: string;
  retryable?: boolean;
};

export type ArtifactType = "extraction" | "summary" | "score" | "todos" | "card" | "export";

export type ArtifactMeta = {
  run_id: string;
  engine_version: string;
  template_version: string;
  created_at: string;
  created_by: "system" | "user";
  model_id?: string;
  prompt_hash?: string;
  input_hash?: string;
  upstream_versions?: Record<string, number>;
};

export {
  deriveCaptureKey,
  normalizeCaptureIdempotencyKey,
  normalizeIdempotencyHeaderKey,
  normalizeIdempotencyKey,
  normalizeIntentForCaptureKey,
} from "./idempotency.js";
