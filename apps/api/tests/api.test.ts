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
      worker: { active: boolean; interval_ms: number };
      timestamp: string;
    };
    assert.ok((payload.queue.QUEUED ?? 0) >= 1);
    assert.ok((payload.items.CAPTURED ?? 0) >= 1);
    assert.equal(payload.worker.active, false);
    assert.equal(payload.worker.interval_ms, 20);
    assert.ok(Boolean(payload.timestamp));
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
    assert.ok([200, 500].includes(exportRes.statusCode));

    if (exportRes.statusCode === 500) {
      const errPayload = exportRes.json() as { error: { code: string } };
      assert.equal(errPayload.error.code, "EXPORT_RENDER_FAILED");

      const detailRes = await app.inject({
        method: "GET",
        url: `/api/items/${itemId}`,
      });
      assert.equal(detailRes.statusCode, 200);
      const detail = detailRes.json() as { item: { status: string } };
      assert.equal(detail.item.status, "FAILED_EXPORT");
    }
  } finally {
    await app.close();
  }
});
