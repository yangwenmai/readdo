import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

test("capture -> worker -> ready -> export", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "idempotency-key": "test-key-1" },
      payload: {
        url: "data:text/plain,This%20guide%20provides%20a%20step-by-step%20checklist%20for%20building%20an%20AI-native%20MVP%20with%20clear%20contracts%20and%20evaluation%20gates.",
        title: "Example Domain",
        domain: "example.com",
        source_type: "web",
        intent_text: "I want to decide whether this article gives concrete steps.",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const captureBody = captureRes.json() as { item: { id: string } };
    assert.ok(captureBody.item.id);

    await app.runWorkerOnce();

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${captureBody.item.id}`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detailBody = detailRes.json() as {
      item: { status: string };
      artifacts: Record<string, unknown>;
    };
    assert.equal(detailBody.item.status, "READY");
    assert.ok(detailBody.artifacts.summary);
    assert.ok(detailBody.artifacts.score);
    assert.ok(detailBody.artifacts.todos);
    assert.ok(detailBody.artifacts.card);

    const exportRes = await app.inject({
      method: "POST",
      url: `/api/items/${captureBody.item.id}/export`,
      payload: { export_key: "exp-key-1", formats: ["png", "md", "caption"] },
    });
    assert.equal(exportRes.statusCode, 200);
    const exportBody = exportRes.json() as {
      item: { status: string };
      export: { payload: { files: Array<{ type: string }> } };
    };
    assert.equal(exportBody.item.status, "SHIPPED");
    assert.ok(exportBody.export.payload.files.some((x) => x.type === "md"));
    assert.ok(exportBody.export.payload.files.some((x) => x.type === "caption"));
  } finally {
    await app.close();
  }
});

test("process mode must match current status", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20article%20provides%20clear%20steps%20for%20orchestrating%20an%20AI%20pipeline%20with%20schema%20validation.",
        title: "Process Mode Test",
        domain: "example.test",
        source_type: "web",
        intent_text: "I need to test process mode transitions.",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    const invalidModeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "REGENERATE" },
    });
    assert.equal(invalidModeRes.statusCode, 409);
    assert.equal((invalidModeRes.json() as { error: { code: string } }).error.code, "PROCESS_NOT_ALLOWED");

    await app.runWorkerOnce();

    const regenerateRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "REGENERATE" },
      headers: { "Idempotency-Key": "regen-key-1" },
    });
    assert.equal(regenerateRes.statusCode, 202);
    assert.equal((regenerateRes.json() as { mode: string }).mode, "REGENERATE");
  } finally {
    await app.close();
  }
});

test("items endpoint supports status and query filtering", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-list-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const firstCapture = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20is%20a%20high-signal%20engineering%20checklist%20with%20concrete%20steps%20for%20AI%20pipeline%20delivery.",
        title: "Engineering Checklist",
        domain: "example.one",
        source_type: "web",
        intent_text: "Build an execution checklist",
      },
    });
    assert.equal(firstCapture.statusCode, 201);

    const secondCapture = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20article%20covers%20creator%20storytelling%20angles%20for%20short%20social%20content.",
        title: "Creator Angles",
        domain: "example.two",
        source_type: "web",
        intent_text: "Collect creator hooks",
      },
    });
    assert.equal(secondCapture.statusCode, 201);

    await app.runWorkerOnce();

    const readyItemsRes = await app.inject({
      method: "GET",
      url: "/api/items?status=READY",
    });
    assert.equal(readyItemsRes.statusCode, 200);
    const readyItems = (readyItemsRes.json() as { items: Array<{ status: string }> }).items;
    assert.ok(readyItems.length >= 1);
    assert.ok(readyItems.every((x) => x.status === "READY"));

    const searchRes = await app.inject({
      method: "GET",
      url: "/api/items?q=creator",
    });
    assert.equal(searchRes.statusCode, 200);
    const searchItems = (searchRes.json() as { items: Array<{ title?: string }> }).items;
    assert.ok(searchItems.some((x) => (x.title ?? "").toLowerCase().includes("creator")));
  } finally {
    await app.close();
  }
});

test("user edit creates new artifact version and exposes history", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-edit-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20post%20explains%20how%20to%20convert%20reading%20into%20action%20with%20priority%2C%20tasks%20and%20delivery.",
        title: "Artifact Editing",
        domain: "example.edit",
        source_type: "web",
        intent_text: "I need editable TODO actions.",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const beforeRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(beforeRes.statusCode, 200);
    const before = beforeRes.json() as {
      artifacts: {
        todos: {
          payload: {
            todos: Array<{ title: string; eta: string; type?: string; why?: string }>;
          };
          version: number;
        };
      };
    };
    const editedTodos = structuredClone(before.artifacts.todos.payload);
    editedTodos.todos[0].title = "Draft a concrete action checklist for this item";

    const editRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/todos`,
      payload: {
        payload: editedTodos,
      },
    });
    assert.equal(editRes.statusCode, 201);

    const afterRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(afterRes.statusCode, 200);
    const after = afterRes.json() as {
      artifacts: {
        todos: {
          version: number;
          created_by: string;
          payload: {
            todos: Array<{ title: string }>;
          };
        };
      };
      artifact_history: {
        todos: Array<{ version: number; created_by: string }>;
      };
    };

    assert.equal(after.artifacts.todos.created_by, "user");
    assert.ok(after.artifacts.todos.version > before.artifacts.todos.version);
    assert.equal(after.artifacts.todos.payload.todos[0].title, "Draft a concrete action checklist for this item");
    assert.ok(after.artifact_history.todos.length >= 2);
    assert.equal(after.artifact_history.todos[0].created_by, "user");

    const pinnedRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?artifact_versions=${encodeURIComponent(JSON.stringify({ todos: before.artifacts.todos.version }))}`,
    });
    assert.equal(pinnedRes.statusCode, 200);
    const pinned = pinnedRes.json() as {
      artifacts: {
        todos: {
          version: number;
          created_by: string;
        };
      };
      artifact_versions_selected: {
        todos: number;
      };
    };
    assert.equal(pinned.artifacts.todos.version, before.artifacts.todos.version);
    assert.equal(pinned.artifacts.todos.created_by, "system");
    assert.equal(pinned.artifact_versions_selected.todos, before.artifacts.todos.version);
  } finally {
    await app.close();
  }
});

test("intent can be updated and optionally trigger regenerate", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-intent-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20article%20contains%20practical%20guidance%20for%20building%20a%20focus%20workflow.",
        title: "Intent Update",
        domain: "example.intent",
        source_type: "web",
        intent_text: "Initial intent for this item.",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    const updateOnlyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/intent`,
      payload: {
        intent_text: "Updated intent without regeneration.",
        regenerate: false,
      },
    });
    assert.equal(updateOnlyRes.statusCode, 200);
    const updatedItem = (updateOnlyRes.json() as { item: { intent_text: string; status: string } }).item;
    assert.equal(updatedItem.intent_text, "Updated intent without regeneration.");
    assert.equal(updatedItem.status, "CAPTURED");

    const regenerateRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/intent`,
      payload: {
        intent_text: "Updated intent and regenerate.",
        regenerate: true,
      },
    });
    assert.equal(regenerateRes.statusCode, 200);
    const regenerateItem = (regenerateRes.json() as { item: { status: string; intent_text: string } }).item;
    assert.equal(regenerateItem.status, "QUEUED");
    assert.equal(regenerateItem.intent_text, "Updated intent and regenerate.");
  } finally {
    await app.close();
  }
});

test("worker status endpoint returns queue and item counters", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-worker-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,Queue%20status%20check%20for%20worker%20endpoint%20and%20item%20counters.",
        title: "Worker Status",
        domain: "example.worker",
        source_type: "web",
        intent_text: "Check worker counters",
      },
    });
    assert.equal(captureRes.statusCode, 201);

    const workerRes = await app.inject({
      method: "GET",
      url: "/api/system/worker",
    });
    assert.equal(workerRes.statusCode, 200);
    const payload = workerRes.json() as {
      queue: Record<string, number>;
      items: Record<string, number>;
      retry: { max_attempts: number; retryable_items: number; non_retryable_items: number };
      failure_steps: { extract: number; pipeline: number; export: number };
      worker: { active: boolean; interval_ms: number };
      timestamp: string;
    };
    assert.ok((payload.queue.QUEUED ?? 0) >= 1);
    assert.ok((payload.items.CAPTURED ?? 0) >= 1);
    assert.equal(payload.retry.max_attempts, 3);
    assert.equal(payload.retry.retryable_items, 0);
    assert.equal(payload.retry.non_retryable_items, 0);
    assert.equal(payload.failure_steps.extract, 0);
    assert.equal(payload.failure_steps.pipeline, 0);
    assert.equal(payload.failure_steps.export, 0);
    assert.equal(payload.worker.active, false);
    assert.equal(payload.worker.interval_ms, 20);
    assert.ok(Boolean(payload.timestamp));
  } finally {
    await app.close();
  }
});

test("retry-failed endpoint queues retryable pipeline failures only", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-retry-failed-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
    disablePngRender: true,
  });

  try {
    const failOne = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,short",
        title: "Fail One",
        domain: "example.fail.one",
        source_type: "web",
        intent_text: "force extraction failure one",
      },
    });
    assert.equal(failOne.statusCode, 201);
    const failOneId = (failOne.json() as { item: { id: string } }).item.id;

    const failTwo = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,tiny",
        title: "Fail Two",
        domain: "example.fail.two",
        source_type: "web",
        intent_text: "force extraction failure two",
      },
    });
    assert.equal(failTwo.statusCode, 201);
    const failTwoId = (failTwo.json() as { item: { id: string } }).item.id;

    const exportFail = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20content%20is%20long%20enough%20to%20allow%20pipeline%20to%20reach%20ready%20before%20png%20export%20fails%20deterministically.",
        title: "Export Fail",
        domain: "example.export.failed",
        source_type: "web",
        intent_text: "create export failure item",
      },
    });
    assert.equal(exportFail.statusCode, 201);
    const exportFailId = (exportFail.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();
    await app.runWorkerOnce();
    await app.runWorkerOnce();

    const exportRes = await app.inject({
      method: "POST",
      url: `/api/items/${exportFailId}/export`,
      payload: { export_key: "retry-failed-export-case", formats: ["png"] },
    });
    assert.equal(exportRes.statusCode, 500);

    const workerStatsRes = await app.inject({
      method: "GET",
      url: "/api/system/worker",
    });
    assert.equal(workerStatsRes.statusCode, 200);
    const workerStats = workerStatsRes.json() as {
      retry: { retryable_items: number; non_retryable_items: number };
      failure_steps: { extract: number; pipeline: number; export: number };
    };
    assert.ok(workerStats.retry.retryable_items >= 3);
    assert.equal(workerStats.retry.non_retryable_items, 0);
    assert.ok(workerStats.failure_steps.extract >= 2);
    assert.ok(workerStats.failure_steps.export >= 1);

    const retryFailedRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { limit: 10, dry_run: true },
    });
    assert.equal(retryFailedRes.statusCode, 200);
    const dryRunPayload = retryFailedRes.json() as {
      dry_run: boolean;
      scanned: number;
      scanned_total: number;
      scan_truncated: boolean;
      queued: number;
      eligible_pipeline: number;
      eligible_export: number;
      eligible_pipeline_item_ids: string[];
      eligible_export_item_ids: string[];
    };
    assert.equal(dryRunPayload.dry_run, true);
    assert.equal(dryRunPayload.queued, 0);
    assert.ok(dryRunPayload.scanned_total >= dryRunPayload.scanned);
    assert.equal(dryRunPayload.scan_truncated, false);
    assert.equal(dryRunPayload.eligible_pipeline, 2);
    assert.equal(dryRunPayload.eligible_export, 1);
    assert.ok(dryRunPayload.eligible_pipeline_item_ids.includes(failOneId));
    assert.ok(dryRunPayload.eligible_pipeline_item_ids.includes(failTwoId));
    assert.ok(dryRunPayload.eligible_export_item_ids.includes(exportFailId));

    const queryDryRunRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { limit: 10, dry_run: true, q: "Fail One" },
    });
    assert.equal(queryDryRunRes.statusCode, 200);
    const queryDryRun = queryDryRunRes.json() as {
      q_filter: string | null;
      scanned: number;
      scan_truncated: boolean;
      eligible_pipeline: number;
      eligible_export: number;
      eligible_pipeline_item_ids: string[];
    };
    assert.equal(queryDryRun.q_filter, "Fail One");
    assert.equal(queryDryRun.scanned, 1);
    assert.equal(queryDryRun.scan_truncated, false);
    assert.equal(queryDryRun.eligible_pipeline, 1);
    assert.equal(queryDryRun.eligible_export, 0);
    assert.ok(queryDryRun.eligible_pipeline_item_ids.includes(failOneId));

    const limitedDryRunRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { limit: 1, dry_run: true },
    });
    assert.equal(limitedDryRunRes.statusCode, 200);
    const limitedDryRun = limitedDryRunRes.json() as { scanned: number; scanned_total: number; scan_truncated: boolean };
    assert.equal(limitedDryRun.scanned, 1);
    assert.ok(limitedDryRun.scanned_total >= 3);
    assert.equal(limitedDryRun.scan_truncated, true);

    const pagedDryRunRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { limit: 1, offset: 1, dry_run: true },
    });
    assert.equal(pagedDryRunRes.statusCode, 200);
    const pagedDryRun = pagedDryRunRes.json() as {
      requested_offset: number;
      scanned: number;
      scanned_total: number;
      scan_truncated: boolean;
      next_offset: number | null;
    };
    assert.equal(pagedDryRun.requested_offset, 1);
    assert.equal(pagedDryRun.scanned, 1);
    assert.ok(pagedDryRun.scanned_total >= 3);
    assert.equal(pagedDryRun.scan_truncated, true);
    assert.equal(pagedDryRun.next_offset, 2);

    const negativeOffsetDryRunRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { limit: 1, offset: -5, dry_run: true },
    });
    assert.equal(negativeOffsetDryRunRes.statusCode, 200);
    const negativeOffsetDryRun = negativeOffsetDryRunRes.json() as { requested_offset: number; scanned: number };
    assert.equal(negativeOffsetDryRun.requested_offset, 0);
    assert.equal(negativeOffsetDryRun.scanned, 1);

    const exportOnlyDryRunRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { limit: 10, dry_run: true, failure_step: "export" },
    });
    assert.equal(exportOnlyDryRunRes.statusCode, 200);
    const exportOnlyDryRun = exportOnlyDryRunRes.json() as {
      failure_step_filter: string | null;
      scanned: number;
      eligible_pipeline: number;
      eligible_export: number;
      eligible_export_item_ids: string[];
    };
    assert.equal(exportOnlyDryRun.failure_step_filter, "export");
    assert.equal(exportOnlyDryRun.scanned, 1);
    assert.equal(exportOnlyDryRun.eligible_pipeline, 0);
    assert.equal(exportOnlyDryRun.eligible_export, 1);
    assert.ok(exportOnlyDryRun.eligible_export_item_ids.includes(exportFailId));

    const dryRunFailOne = await app.inject({ method: "GET", url: `/api/items/${failOneId}` });
    const dryRunFailTwo = await app.inject({ method: "GET", url: `/api/items/${failTwoId}` });
    assert.equal((dryRunFailOne.json() as { item: { status: string } }).item.status, "FAILED_EXTRACTION");
    assert.equal((dryRunFailTwo.json() as { item: { status: string } }).item.status, "FAILED_EXTRACTION");

    const extractFailedRes = await app.inject({
      method: "GET",
      url: "/api/items?status=FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT&failure_step=extract",
    });
    assert.equal(extractFailedRes.statusCode, 200);
    const extractFailedItems = (extractFailedRes.json() as { items: Array<{ id: string }> }).items;
    assert.ok(extractFailedItems.some((x) => x.id === failOneId));
    assert.ok(extractFailedItems.some((x) => x.id === failTwoId));
    assert.ok(extractFailedItems.every((x) => x.id !== exportFailId));

    const exportFailedRes = await app.inject({
      method: "GET",
      url: "/api/items?status=FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT&failure_step=export",
    });
    assert.equal(exportFailedRes.statusCode, 200);
    const exportFailedItems = (exportFailedRes.json() as { items: Array<{ id: string }> }).items;
    assert.ok(exportFailedItems.some((x) => x.id === exportFailId));
    assert.ok(exportFailedItems.every((x) => x.id !== failOneId));
    assert.ok(exportFailedItems.every((x) => x.id !== failTwoId));

    const retryRunRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { limit: 10 },
    });
    assert.equal(retryRunRes.statusCode, 200);
    const retryPayload = retryRunRes.json() as {
      dry_run: boolean;
      scanned: number;
      queued: number;
      queued_item_ids: string[];
      eligible_pipeline: number;
      eligible_export: number;
      skipped_non_retryable: number;
      skipped_unsupported_status: number;
    };
    assert.equal(retryPayload.dry_run, false);
    assert.equal(retryPayload.queued, 2);
    assert.equal(retryPayload.eligible_pipeline, 2);
    assert.equal(retryPayload.eligible_export, 1);
    assert.ok(retryPayload.scanned >= 3);
    assert.ok(retryPayload.queued_item_ids.includes(failOneId));
    assert.ok(retryPayload.queued_item_ids.includes(failTwoId));
    assert.equal(retryPayload.skipped_non_retryable, 0);
    assert.equal(retryPayload.skipped_unsupported_status, 0);

    const failOneDetail = await app.inject({ method: "GET", url: `/api/items/${failOneId}` });
    const failTwoDetail = await app.inject({ method: "GET", url: `/api/items/${failTwoId}` });
    const exportFailDetail = await app.inject({ method: "GET", url: `/api/items/${exportFailId}` });
    assert.equal((failOneDetail.json() as { item: { status: string } }).item.status, "QUEUED");
    assert.equal((failTwoDetail.json() as { item: { status: string } }).item.status, "QUEUED");
    assert.equal((exportFailDetail.json() as { item: { status: string } }).item.status, "FAILED_EXPORT");
  } finally {
    await app.close();
  }
});

test("archive-failed endpoint archives blocked failures with dry-run support", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-archive-failed-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const blockedCapture = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,short",
        title: "Blocked Failure",
        domain: "example.blocked.fail",
        source_type: "web",
        intent_text: "force blocked retry case",
      },
    });
    assert.equal(blockedCapture.statusCode, 201);
    const blockedId = (blockedCapture.json() as { item: { id: string } }).item.id;

    const retryableCapture = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,tiny",
        title: "Retryable Failure",
        domain: "example.retryable.fail",
        source_type: "web",
        intent_text: "force retryable failure case",
      },
    });
    assert.equal(retryableCapture.statusCode, 201);
    const retryableId = (retryableCapture.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();
    await app.runWorkerOnce();

    for (let i = 0; i < 2; i += 1) {
      const retryRes = await app.inject({
        method: "POST",
        url: `/api/items/${blockedId}/process`,
        payload: {
          mode: "RETRY",
          process_request_id: `archive-failed-retry-${i}`,
        },
      });
      assert.equal(retryRes.statusCode, 202);
      await app.runWorkerOnce();
    }

    const blockedDetail = await app.inject({ method: "GET", url: `/api/items/${blockedId}` });
    assert.equal(blockedDetail.statusCode, 200);
    const blockedItem = blockedDetail.json() as { item: { status: string }; failure: { retryable?: boolean; retry_attempts?: number } };
    assert.equal(blockedItem.item.status, "FAILED_EXTRACTION");
    assert.equal(blockedItem.failure.retryable, false);
    assert.equal(blockedItem.failure.retry_attempts, 3);

    const retryableDetail = await app.inject({ method: "GET", url: `/api/items/${retryableId}` });
    assert.equal(retryableDetail.statusCode, 200);
    const retryableItem = retryableDetail.json() as { item: { status: string }; failure: { retryable?: boolean } };
    assert.equal(retryableItem.item.status, "FAILED_EXTRACTION");
    assert.equal(retryableItem.failure.retryable, true);

    const previewRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { limit: 10, dry_run: true, retryable: false, failure_step: "extract" },
    });
    assert.equal(previewRes.statusCode, 200);
    const previewPayload = previewRes.json() as {
      dry_run: boolean;
      retryable_filter: boolean | null;
      failure_step_filter: string | null;
      scanned: number;
      scanned_total: number;
      scan_truncated: boolean;
      eligible: number;
      archived: number;
      eligible_item_ids: string[];
      skipped_retryable_mismatch: number;
    };
    assert.equal(previewPayload.dry_run, true);
    assert.equal(previewPayload.retryable_filter, false);
    assert.equal(previewPayload.failure_step_filter, "extract");
    assert.equal(previewPayload.scanned, 2);
    assert.equal(previewPayload.scanned_total, 2);
    assert.equal(previewPayload.scan_truncated, false);
    assert.equal(previewPayload.eligible, 1);
    assert.equal(previewPayload.archived, 0);
    assert.ok(previewPayload.eligible_item_ids.includes(blockedId));
    assert.equal(previewPayload.skipped_retryable_mismatch, 1);

    const previewAllRetryableRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { limit: 10, dry_run: true, retryable: "all", failure_step: "extract" },
    });
    assert.equal(previewAllRetryableRes.statusCode, 200);
    const previewAllRetryable = previewAllRetryableRes.json() as {
      retryable_filter: boolean | null;
      eligible: number;
      eligible_item_ids: string[];
    };
    assert.equal(previewAllRetryable.retryable_filter, null);
    assert.equal(previewAllRetryable.eligible, 2);
    assert.ok(previewAllRetryable.eligible_item_ids.includes(blockedId));
    assert.ok(previewAllRetryable.eligible_item_ids.includes(retryableId));

    const previewWithQueryRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { limit: 10, dry_run: true, retryable: "all", failure_step: "extract", q: "Retryable Failure" },
    });
    assert.equal(previewWithQueryRes.statusCode, 200);
    const previewWithQuery = previewWithQueryRes.json() as {
      q_filter: string | null;
      scanned: number;
      scan_truncated: boolean;
      eligible: number;
      eligible_item_ids: string[];
    };
    assert.equal(previewWithQuery.q_filter, "Retryable Failure");
    assert.equal(previewWithQuery.scanned, 1);
    assert.equal(previewWithQuery.scan_truncated, false);
    assert.equal(previewWithQuery.eligible, 1);
    assert.ok(previewWithQuery.eligible_item_ids.includes(retryableId));

    const limitedArchivePreviewRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { limit: 1, dry_run: true, retryable: "all", failure_step: "extract" },
    });
    assert.equal(limitedArchivePreviewRes.statusCode, 200);
    const limitedArchivePreview = limitedArchivePreviewRes.json() as {
      scanned: number;
      scanned_total: number;
      scan_truncated: boolean;
      next_offset: number | null;
    };
    assert.equal(limitedArchivePreview.scanned, 1);
    assert.equal(limitedArchivePreview.scanned_total, 2);
    assert.equal(limitedArchivePreview.scan_truncated, true);
    assert.equal(limitedArchivePreview.next_offset, 1);

    const negativeOffsetArchivePreviewRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { limit: 1, offset: -9, dry_run: true, retryable: "all", failure_step: "extract" },
    });
    assert.equal(negativeOffsetArchivePreviewRes.statusCode, 200);
    const negativeOffsetArchivePreview = negativeOffsetArchivePreviewRes.json() as { requested_offset: number; scanned: number };
    assert.equal(negativeOffsetArchivePreview.requested_offset, 0);
    assert.equal(negativeOffsetArchivePreview.scanned, 1);

    const invalidRetryableRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { retryable: "bad-value" },
    });
    assert.equal(invalidRetryableRes.statusCode, 400);
    assert.equal((invalidRetryableRes.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");

    const archiveRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { limit: 10, retryable: false, failure_step: "extract" },
    });
    assert.equal(archiveRes.statusCode, 200);
    const archivePayload = archiveRes.json() as {
      dry_run: boolean;
      eligible: number;
      archived: number;
      archived_item_ids: string[];
    };
    assert.equal(archivePayload.dry_run, false);
    assert.equal(archivePayload.eligible, 1);
    assert.equal(archivePayload.archived, 1);
    assert.ok(archivePayload.archived_item_ids.includes(blockedId));

    const blockedAfterArchive = await app.inject({ method: "GET", url: `/api/items/${blockedId}` });
    const retryableAfterArchive = await app.inject({ method: "GET", url: `/api/items/${retryableId}` });
    assert.equal((blockedAfterArchive.json() as { item: { status: string } }).item.status, "ARCHIVED");
    assert.equal((retryableAfterArchive.json() as { item: { status: string } }).item.status, "FAILED_EXTRACTION");
  } finally {
    await app.close();
  }
});

test("unarchive-batch endpoint supports dry-run and regenerate mode", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-unarchive-batch-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const readyCapture = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20content%20is%20ready%20for%20processing%20and%20later%20batch%20unarchive%20verification.",
        title: "Ready Archive Candidate",
        domain: "example.unarchive.ready",
        source_type: "web",
        intent_text: "validate unarchive batch ready behavior",
      },
    });
    assert.equal(readyCapture.statusCode, 201);
    const readyId = (readyCapture.json() as { item: { id: string } }).item.id;
    await app.runWorkerOnce();

    const capturedOnly = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,short",
        title: "Captured Archive Candidate",
        domain: "example.unarchive.captured",
        source_type: "web",
        intent_text: "keep as captured before archive",
      },
    });
    assert.equal(capturedOnly.statusCode, 201);
    const capturedId = (capturedOnly.json() as { item: { id: string } }).item.id;

    const archiveReadyRes = await app.inject({ method: "POST", url: `/api/items/${readyId}/archive`, payload: { reason: "batch-test" } });
    const archiveCapturedRes = await app.inject({ method: "POST", url: `/api/items/${capturedId}/archive`, payload: { reason: "batch-test" } });
    assert.equal(archiveReadyRes.statusCode, 200);
    assert.equal(archiveCapturedRes.statusCode, 200);

    const previewRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { limit: 10, dry_run: true, regenerate: false },
    });
    assert.equal(previewRes.statusCode, 200);
    const preview = previewRes.json() as {
      dry_run: boolean;
      q_filter?: string | null;
      scanned: number;
      scanned_total: number;
      scan_truncated: boolean;
      eligible: number;
      eligible_ready: number;
      eligible_queued: number;
      eligible_ready_item_ids: string[];
      eligible_queued_item_ids: string[];
      unarchived: number;
      queued_jobs_created: number;
    };
    assert.equal(preview.dry_run, true);
    assert.equal(preview.scanned, 2);
    assert.equal(preview.scanned_total, 2);
    assert.equal(preview.scan_truncated, false);
    assert.equal(preview.eligible, 2);
    assert.equal(preview.eligible_ready, 1);
    assert.equal(preview.eligible_queued, 1);
    assert.ok(preview.eligible_ready_item_ids.includes(readyId));
    assert.ok(preview.eligible_queued_item_ids.includes(capturedId));
    assert.equal(preview.unarchived, 0);
    assert.equal(preview.queued_jobs_created, 0);
    assert.equal(preview.q_filter ?? null, null);

    const previewWithQueryRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { limit: 10, dry_run: true, regenerate: false, q: "Ready Archive Candidate" },
    });
    assert.equal(previewWithQueryRes.statusCode, 200);
    const previewWithQuery = previewWithQueryRes.json() as {
      q_filter: string | null;
      scanned: number;
      scan_truncated: boolean;
      eligible_ready: number;
      eligible_queued: number;
      eligible_ready_item_ids: string[];
    };
    assert.equal(previewWithQuery.q_filter, "Ready Archive Candidate");
    assert.equal(previewWithQuery.scanned, 1);
    assert.equal(previewWithQuery.scan_truncated, false);
    assert.equal(previewWithQuery.eligible_ready, 1);
    assert.equal(previewWithQuery.eligible_queued, 0);
    assert.ok(previewWithQuery.eligible_ready_item_ids.includes(readyId));

    const limitedUnarchivePreviewRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { limit: 1, dry_run: true, regenerate: false },
    });
    assert.equal(limitedUnarchivePreviewRes.statusCode, 200);
    const limitedUnarchivePreview = limitedUnarchivePreviewRes.json() as {
      scanned: number;
      scanned_total: number;
      scan_truncated: boolean;
      next_offset: number | null;
    };
    assert.equal(limitedUnarchivePreview.scanned, 1);
    assert.equal(limitedUnarchivePreview.scanned_total, 2);
    assert.equal(limitedUnarchivePreview.scan_truncated, true);
    assert.equal(limitedUnarchivePreview.next_offset, 1);

    const negativeOffsetUnarchivePreviewRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { limit: 1, offset: -3, dry_run: true, regenerate: false },
    });
    assert.equal(negativeOffsetUnarchivePreviewRes.statusCode, 200);
    const negativeOffsetUnarchivePreview = negativeOffsetUnarchivePreviewRes.json() as { requested_offset: number; scanned: number };
    assert.equal(negativeOffsetUnarchivePreview.requested_offset, 0);
    assert.equal(negativeOffsetUnarchivePreview.scanned, 1);

    const runRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { limit: 10, regenerate: false },
    });
    assert.equal(runRes.statusCode, 200);
    const runPayload = runRes.json() as { unarchived: number; queued_jobs_created: number; unarchived_item_ids: string[] };
    assert.equal(runPayload.unarchived, 2);
    assert.equal(runPayload.queued_jobs_created, 1);
    assert.ok(runPayload.unarchived_item_ids.includes(readyId));
    assert.ok(runPayload.unarchived_item_ids.includes(capturedId));

    const readyDetail = await app.inject({ method: "GET", url: `/api/items/${readyId}` });
    const capturedDetail = await app.inject({ method: "GET", url: `/api/items/${capturedId}` });
    assert.equal((readyDetail.json() as { item: { status: string } }).item.status, "READY");
    assert.equal((capturedDetail.json() as { item: { status: string } }).item.status, "QUEUED");

    const archiveReadyAgainRes = await app.inject({ method: "POST", url: `/api/items/${readyId}/archive`, payload: { reason: "regenerate-test" } });
    assert.equal(archiveReadyAgainRes.statusCode, 200);
    const regenerateUnarchiveRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { limit: 10, regenerate: true },
    });
    assert.equal(regenerateUnarchiveRes.statusCode, 200);
    const regeneratePayload = regenerateUnarchiveRes.json() as { eligible_queued: number; unarchived: number; queued_jobs_created: number };
    assert.ok(regeneratePayload.eligible_queued >= 1);
    assert.ok(regeneratePayload.unarchived >= 1);
    assert.ok(regeneratePayload.queued_jobs_created >= 1);
  } finally {
    await app.close();
  }
});

test("png-only export failure moves item to FAILED_EXPORT", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-fail-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
    disablePngRender: true,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20content%20will%20be%20used%20to%20verify%20png-only%20export%20failure%20path.",
        title: "PNG Export Failure",
        domain: "example.export.fail",
        source_type: "web",
        intent_text: "Check failed export behavior.",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const exportRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: {
        export_key: "png-only-fail",
        formats: ["png"],
      },
    });
    assert.equal(exportRes.statusCode, 500);
    const errPayload = exportRes.json() as { error: { code: string } };
    assert.equal(errPayload.error.code, "EXPORT_RENDER_FAILED");

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detail = detailRes.json() as {
      item: { status: string };
      failure: { retryable: boolean; retry_attempts: number; retry_limit: number };
    };
    assert.equal(detail.item.status, "FAILED_EXPORT");
    assert.equal(detail.failure.retryable, true);
    assert.equal(detail.failure.retry_attempts, 1);
    assert.equal(detail.failure.retry_limit, 3);
  } finally {
    await app.close();
  }
});

test("manual worker run endpoint drains one queued job", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-run-once-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 1000,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20entry%20is%20used%20to%20verify%20manual%20worker%20run-once%20endpoint.",
        title: "Run Once",
        domain: "example.runonce",
        source_type: "web",
        intent_text: "test run once endpoint",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    const runOnceRes = await app.inject({
      method: "POST",
      url: "/api/system/worker/run-once",
    });
    assert.equal(runOnceRes.statusCode, 200);
    const runOncePayload = runOnceRes.json() as { ok: boolean; queue: Record<string, number> };
    assert.equal(runOncePayload.ok, true);

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detail = detailRes.json() as { item: { status: string } };
    assert.ok(["READY", "FAILED_EXTRACTION", "FAILED_AI"].includes(detail.item.status));
  } finally {
    await app.close();
  }
});

test("capture validates url and source_type", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-validate-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const invalidSourceRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com",
        source_type: "blog",
        intent_text: "invalid source type",
      },
    });
    assert.equal(invalidSourceRes.statusCode, 400);
    assert.equal((invalidSourceRes.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");

    const invalidUrlRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "not-a-url",
        source_type: "web",
        intent_text: "invalid url",
      },
    });
    assert.equal(invalidUrlRes.statusCode, 400);

    const validRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com",
        source_type: "web",
        intent_text: "valid url/source type",
      },
    });
    assert.equal(validRes.statusCode, 201);
  } finally {
    await app.close();
  }
});

test("retry mode is blocked after retry limit reached", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-retry-limit-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,too short",
        title: "Retry Limit",
        domain: "example.retry",
        source_type: "web",
        intent_text: "check retry strategy",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    for (let i = 0; i < 2; i += 1) {
      const retryRes = await app.inject({
        method: "POST",
        url: `/api/items/${itemId}/process`,
        payload: { mode: "RETRY" },
      });
      assert.equal(retryRes.statusCode, 202);
      await app.runWorkerOnce();
    }

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detail = detailRes.json() as {
      item: { status: string };
      failure: { retryable: boolean; retry_attempts: number; retry_limit: number };
    };
    assert.equal(detail.item.status, "FAILED_EXTRACTION");
    assert.equal(detail.failure.retryable, false);
    assert.equal(detail.failure.retry_attempts, 3);
    assert.equal(detail.failure.retry_limit, 3);

    const retryableFalseRes = await app.inject({
      method: "GET",
      url: "/api/items?status=FAILED_EXTRACTION&retryable=false",
    });
    assert.equal(retryableFalseRes.statusCode, 200);
    const retryableFalseItems = (retryableFalseRes.json() as { items: Array<{ id: string }> }).items;
    assert.ok(retryableFalseItems.some((x) => x.id === itemId));

    const retryableTrueRes = await app.inject({
      method: "GET",
      url: "/api/items?status=FAILED_EXTRACTION&retryable=true",
    });
    assert.equal(retryableTrueRes.statusCode, 200);
    const retryableTrueItems = (retryableTrueRes.json() as { items: Array<{ id: string }> }).items;
    assert.ok(retryableTrueItems.every((x) => x.id !== itemId));

    const blockedRetryRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "RETRY" },
    });
    assert.equal(blockedRetryRes.statusCode, 409);
    assert.equal((blockedRetryRes.json() as { error: { code: string } }).error.code, "RETRY_LIMIT_REACHED");
  } finally {
    await app.close();
  }
});

test("export retry is blocked after retry limit reached", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-retry-limit-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
    disablePngRender: true,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20content%20is%20used%20to%20test%20export%20retry%20limit%20handling.",
        title: "Export Retry Limit",
        domain: "example.export.retry",
        source_type: "web",
        intent_text: "check export retry limit",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    for (let i = 1; i <= 3; i += 1) {
      const exportRes = await app.inject({
        method: "POST",
        url: `/api/items/${itemId}/export`,
        payload: { export_key: `png-fail-${i}`, formats: ["png"] },
      });
      assert.equal(exportRes.statusCode, 500);
    }

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detail = detailRes.json() as {
      item: { status: string };
      failure: { retryable: boolean; retry_attempts: number; retry_limit: number };
    };
    assert.equal(detail.item.status, "FAILED_EXPORT");
    assert.equal(detail.failure.retryable, false);
    assert.equal(detail.failure.retry_attempts, 3);
    assert.equal(detail.failure.retry_limit, 3);

    const blockedRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "png-fail-blocked", formats: ["png"] },
    });
    assert.equal(blockedRes.statusCode, 409);
    assert.equal((blockedRes.json() as { error: { code: string } }).error.code, "RETRY_LIMIT_REACHED");
  } finally {
    await app.close();
  }
});

test("artifact compare endpoint returns structured diff summary", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-compare-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20entry%20is%20for%20testing%20artifact%20compare%20endpoint%20and%20diff%20summary.",
        title: "Artifact Compare",
        domain: "example.compare",
        source_type: "web",
        intent_text: "Need to compare versions",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detail = detailRes.json() as {
      artifacts: {
        todos: {
          version: number;
          payload: {
            todos: Array<{ title: string; eta: string; type?: string; why?: string }>;
          };
        };
      };
    };

    const editedPayload = structuredClone(detail.artifacts.todos.payload);
    editedPayload.todos[0].title = "Draft a changed action title for compare endpoint";
    const editRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/todos`,
      payload: { payload: editedPayload },
    });
    assert.equal(editRes.statusCode, 201);

    const compareRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}/artifacts/todos/compare?base_version=1&target_version=2`,
    });
    assert.equal(compareRes.statusCode, 200);
    const compare = compareRes.json() as {
      artifact_type: string;
      base: { version: number };
      target: { version: number };
      summary: {
        changed_paths: string[];
        changed_line_count: number;
        compared_line_count: number;
      };
    };
    assert.equal(compare.artifact_type, "todos");
    assert.equal(compare.base.version, 1);
    assert.equal(compare.target.version, 2);
    assert.ok(compare.summary.changed_paths.length >= 1);
    assert.ok(compare.summary.changed_line_count >= 1);
    assert.ok(compare.summary.compared_line_count >= compare.summary.changed_line_count);
  } finally {
    await app.close();
  }
});
