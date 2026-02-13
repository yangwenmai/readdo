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
