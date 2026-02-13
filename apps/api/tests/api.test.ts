import { mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
      idempotent_replay: boolean;
    };
    assert.equal(exportBody.item.status, "SHIPPED");
    assert.equal(exportBody.idempotent_replay, false);
    assert.ok(exportBody.export.payload.files.some((x) => x.type === "md"));
    assert.ok(exportBody.export.payload.files.some((x) => x.type === "caption"));

    const historyBeforeReplayRes = await app.inject({
      method: "GET",
      url: `/api/items/${captureBody.item.id}?include_history=true`,
    });
    assert.equal(historyBeforeReplayRes.statusCode, 200);
    const historyBeforeReplay = historyBeforeReplayRes.json() as {
      artifact_history: {
        export: Array<{ version: number }>;
      };
    };
    const exportVersionCountBeforeReplay = historyBeforeReplay.artifact_history.export.length;

    const replayRes = await app.inject({
      method: "POST",
      url: `/api/items/${captureBody.item.id}/export`,
      payload: { export_key: "exp-key-1", formats: ["png", "md", "caption"] },
    });
    assert.equal(replayRes.statusCode, 200);
    const replayBody = replayRes.json() as {
      idempotent_replay: boolean;
      export: { payload: { export_key: string } };
    };
    assert.equal(replayBody.idempotent_replay, true);
    assert.equal(replayBody.export.payload.export_key, "exp-key-1");

    const historyAfterReplayRes = await app.inject({
      method: "GET",
      url: `/api/items/${captureBody.item.id}?include_history=true`,
    });
    assert.equal(historyAfterReplayRes.statusCode, 200);
    const historyAfterReplay = historyAfterReplayRes.json() as {
      artifact_history: {
        export: Array<{ version: number }>;
      };
    };
    assert.equal(historyAfterReplay.artifact_history.export.length, exportVersionCountBeforeReplay);
  } finally {
    await app.close();
  }
});

test("capture endpoint replays idempotent request with same key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-idempotent-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const firstCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": "capture-idempotent-key-1" },
      payload: {
        url: "data:text/plain,This%20capture%20validates%20idempotent%20replay%20behavior%20for%20capture%20endpoint.",
        title: "Capture Idempotency",
        domain: "example.capture.idempotent",
        source_type: "web",
        intent_text: "verify capture idempotency replay",
      },
    });
    assert.equal(firstCaptureRes.statusCode, 201);
    const firstPayload = firstCaptureRes.json() as {
      item: { id: string; status: string };
      idempotent_replay: boolean;
    };
    assert.equal(firstPayload.idempotent_replay, false);
    assert.equal(firstPayload.item.status, "CAPTURED");

    const replayCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": "capture-idempotent-key-1" },
      payload: {
        url: "data:text/plain,This%20payload%20should%20replay%20the%20same%20captured%20item.",
        title: "Capture Idempotency Replay",
        domain: "example.capture.idempotent.replay",
        source_type: "web",
        intent_text: "replay capture",
      },
    });
    assert.equal(replayCaptureRes.statusCode, 201);
    const replayPayload = replayCaptureRes.json() as {
      item: { id: string; status: string };
      idempotent_replay: boolean;
    };
    assert.equal(replayPayload.idempotent_replay, true);
    assert.equal(replayPayload.item.id, firstPayload.item.id);
  } finally {
    await app.close();
  }
});

test("capture handles concurrent same-key requests with idempotent replay", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-idempotent-concurrent-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const requestPayload = {
      capture_id: "capture-concurrent-key-1",
      url: "https://example.com/concurrent-capture?utm_source=parallel",
      title: "Capture Concurrent Replay",
      source_type: "web",
      intent_text: "validate concurrent capture idempotency replay",
    };

    const [firstRes, secondRes] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/capture",
        headers: { "Idempotency-Key": "capture-concurrent-key-1" },
        payload: requestPayload,
      }),
      app.inject({
        method: "POST",
        url: "/api/capture",
        headers: { "Idempotency-Key": "capture-concurrent-key-1" },
        payload: requestPayload,
      }),
    ]);

    assert.equal(firstRes.statusCode, 201);
    assert.equal(secondRes.statusCode, 201);

    const payloads = [firstRes.json(), secondRes.json()] as Array<{ item: { id: string }; idempotent_replay: boolean }>;
    assert.equal(payloads.some((x) => x.idempotent_replay === true), true);
    assert.equal(payloads.some((x) => x.idempotent_replay === false), true);
    assert.equal(payloads[0].item.id, payloads[1].item.id);
  } finally {
    await app.close();
  }
});

test("capture endpoint supports idempotency via capture_id body field", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-body-idempotent-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const firstCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        capture_id: "cap-body-idempotent-1",
        url: "data:text/plain,This%20capture%20uses%20capture_id%20body%20for%20idempotency%20validation.",
        title: "Capture Body Idempotency",
        domain: "example.capture.body.idempotent",
        source_type: "web",
        intent_text: "validate capture_id idempotency",
      },
    });
    assert.equal(firstCaptureRes.statusCode, 201);
    const firstPayload = firstCaptureRes.json() as {
      item: { id: string };
      idempotent_replay: boolean;
    };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        capture_id: "cap-body-idempotent-1",
        url: "data:text/plain,This%20second%20capture%20should%20replay%20the%20same%20item.",
        title: "Capture Body Replay",
        domain: "example.capture.body.idempotent.replay",
        source_type: "web",
        intent_text: "replay by capture_id",
      },
    });
    assert.equal(replayCaptureRes.statusCode, 201);
    const replayPayload = replayCaptureRes.json() as {
      item: { id: string };
      idempotent_replay: boolean;
    };
    assert.equal(replayPayload.idempotent_replay, true);
    assert.equal(replayPayload.item.id, firstPayload.item.id);
  } finally {
    await app.close();
  }
});

test("capture endpoint replays without explicit key using canonical url plus intent", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-derived-idempotent-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const firstCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://Example.com.:443/path?b=2&utm_source=x&a=1#section",
        title: "Derived Idempotency First",
        source_type: "web",
        intent_text: "  keep   this focused  ",
      },
    });
    assert.equal(firstCaptureRes.statusCode, 201);
    const firstPayload = firstCaptureRes.json() as {
      item: { id: string };
      idempotent_replay: boolean;
    };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com/path?a=1&b=2",
        title: "Derived Idempotency Replay",
        source_type: "web",
        intent_text: "keep this focused",
      },
    });
    assert.equal(replayCaptureRes.statusCode, 201);
    const replayPayload = replayCaptureRes.json() as {
      item: { id: string };
      idempotent_replay: boolean;
    };
    assert.equal(replayPayload.idempotent_replay, true);
    assert.equal(replayPayload.item.id, firstPayload.item.id);

    const changedIntentRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com/path?a=1&b=2",
        title: "Derived Idempotency Different Intent",
        source_type: "web",
        intent_text: "keep this as a different action",
      },
    });
    assert.equal(changedIntentRes.statusCode, 201);
    const changedIntentPayload = changedIntentRes.json() as {
      item: { id: string };
      idempotent_replay: boolean;
    };
    assert.equal(changedIntentPayload.idempotent_replay, false);
    assert.notEqual(changedIntentPayload.item.id, firstPayload.item.id);
  } finally {
    await app.close();
  }
});

test("capture endpoint derived key is compatible with extension extcap format", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-derived-extcap-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const canonicalUrl = "https://example.com/path?a=1&b=2";
    const normalizedIntent = "keep this focused";
    const extensionStyleKey = `extcap_${createHash("sha256").update(`${canonicalUrl}\n${normalizedIntent}`).digest("hex").slice(0, 32)}`;

    const firstCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://Example.com.:443/path?b=2&utm_source=x&a=1#section",
        source_type: "web",
        intent_text: "  keep   this focused  ",
      },
    });
    assert.equal(firstCaptureRes.statusCode, 201);
    const firstPayload = firstCaptureRes.json() as { item: { id: string }; idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const explicitReplayRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": extensionStyleKey },
      payload: {
        capture_id: extensionStyleKey,
        url: canonicalUrl,
        source_type: "web",
        intent_text: normalizedIntent,
      },
    });
    assert.equal(explicitReplayRes.statusCode, 201);
    const explicitReplayPayload = explicitReplayRes.json() as { item: { id: string }; idempotent_replay: boolean };
    assert.equal(explicitReplayPayload.idempotent_replay, true);
    assert.equal(explicitReplayPayload.item.id, firstPayload.item.id);
  } finally {
    await app.close();
  }
});

test("capture rejects mismatched header idempotency key and capture_id", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-mismatch-idempotent-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": "cap-header-key-1" },
      payload: {
        capture_id: "cap-body-key-2",
        url: "data:text/plain,This%20request%20must%20fail%20when%20header%20and%20body%20idempotency%20keys%20differ.",
        title: "Capture Mismatch",
        domain: "example.capture.mismatch",
        source_type: "web",
        intent_text: "validate key mismatch behavior",
      },
    });
    assert.equal(captureRes.statusCode, 400);
    const errPayload = captureRes.json() as { error: { code: string; message: string } };
    assert.equal(errPayload.error.code, "VALIDATION_ERROR");
    assert.match(errPayload.error.message, /Idempotency-Key and capture_id must match/i);
  } finally {
    await app.close();
  }
});

test("capture rejects non-string capture_id", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-invalid-capture-id-type-"));
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
        capture_id: ["cap-key-array"],
        url: "https://example.com/invalid-capture-id-type",
        source_type: "web",
        intent_text: "invalid capture_id type should fail",
      },
    });
    assert.equal(captureRes.statusCode, 400);
    const errPayload = captureRes.json() as { error: { code: string; message: string } };
    assert.equal(errPayload.error.code, "VALIDATION_ERROR");
    assert.match(errPayload.error.message, /capture_id must be a string/i);

    const blankCaptureIdRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        capture_id: "   ",
        url: "https://example.com/invalid-capture-id-empty",
        source_type: "web",
        intent_text: "blank capture_id should fail",
      },
    });
    assert.equal(blankCaptureIdRes.statusCode, 400);
    const blankErrPayload = blankCaptureIdRes.json() as { error: { code: string; message: string } };
    assert.equal(blankErrPayload.error.code, "VALIDATION_ERROR");
    assert.match(blankErrPayload.error.message, /capture_id must be a non-empty string/i);
  } finally {
    await app.close();
  }
});

test("capture validates request body shape and allowed keys", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-body-validation-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const nonObjectBodyRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: [],
    });
    assert.equal(nonObjectBodyRes.statusCode, 400);
    const nonObjectBodyPayload = nonObjectBodyRes.json() as { error: { code: string; message: string } };
    assert.equal(nonObjectBodyPayload.error.code, "VALIDATION_ERROR");
    assert.match(nonObjectBodyPayload.error.message, /request body must be an object/i);

    const unknownKeyRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com/capture-unknown-key",
        source_type: "web",
        intent_text: "unknown key should fail",
        unknown_key: true,
      },
    });
    assert.equal(unknownKeyRes.statusCode, 400);
    const unknownKeyPayload = unknownKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(unknownKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(unknownKeyPayload.error.message, /capture body supports only capture_id\|url\|title\|domain\|source_type\|intent_text/i);
  } finally {
    await app.close();
  }
});

test("capture rejects non-string core text fields", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-invalid-core-field-types-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const invalidIntentTypeRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com/invalid-intent-type",
        source_type: "web",
        intent_text: { bad: true },
      },
    });
    assert.equal(invalidIntentTypeRes.statusCode, 400);
    const invalidIntentTypePayload = invalidIntentTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidIntentTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidIntentTypePayload.error.message, /intent_text must be a string/i);

    const invalidUrlTypeRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: { href: "https://example.com/invalid-url-type" },
        source_type: "web",
        intent_text: "valid intent",
      },
    });
    assert.equal(invalidUrlTypeRes.statusCode, 400);
    const invalidUrlTypePayload = invalidUrlTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidUrlTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidUrlTypePayload.error.message, /url must be a string/i);

    const invalidSourceTypeRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com/invalid-source-type-field",
        source_type: ["web"],
        intent_text: "valid intent",
      },
    });
    assert.equal(invalidSourceTypeRes.statusCode, 400);
    const invalidSourceTypePayload = invalidSourceTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidSourceTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidSourceTypePayload.error.message, /source_type must be a string/i);

    const invalidSourceTypeEnumRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com/invalid-source-type-enum",
        source_type: "podcast",
        intent_text: "valid intent",
      },
    });
    assert.equal(invalidSourceTypeEnumRes.statusCode, 400);
    const invalidSourceTypeEnumPayload = invalidSourceTypeEnumRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidSourceTypeEnumPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidSourceTypeEnumPayload.error.message, /source_type must be web\|youtube\|newsletter\|other/i);

    const blankSourceTypeRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com/invalid-source-type-blank",
        source_type: "   ",
        intent_text: "valid intent",
      },
    });
    assert.equal(blankSourceTypeRes.statusCode, 400);
    const blankSourceTypePayload = blankSourceTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(blankSourceTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(blankSourceTypePayload.error.message, /source_type must be web\|youtube\|newsletter\|other/i);
  } finally {
    await app.close();
  }
});

test("capture mismatch check uses first non-empty parsed header key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-mismatch-idempotent-header-parsed-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": ", cap-header-first-key, cap-body-key" },
      payload: {
        capture_id: "cap-body-key",
        url: "https://example.com/capture-header-parse-mismatch",
        source_type: "web",
        intent_text: "validate capture mismatch uses parsed first header key",
      },
    });
    assert.equal(captureRes.statusCode, 400);
    const errPayload = captureRes.json() as { error: { code: string; message: string } };
    assert.equal(errPayload.error.code, "VALIDATION_ERROR");
    assert.match(errPayload.error.message, /Idempotency-Key and capture_id must match/i);
  } finally {
    await app.close();
  }
});

test("capture normalizes extcap idempotency keys case-insensitively", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-extcap-case-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const canonicalUrl = "https://example.com/path?a=1&b=2";
    const normalizedIntent = "keep this focused";
    const lowerExtcapKey = `extcap_${createHash("sha256").update(`${canonicalUrl}\n${normalizedIntent}`).digest("hex").slice(0, 32)}`;
    const upperExtcapKey = lowerExtcapKey.toUpperCase();

    const firstCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": upperExtcapKey },
      payload: {
        capture_id: lowerExtcapKey,
        url: canonicalUrl,
        source_type: "web",
        intent_text: normalizedIntent,
      },
    });
    assert.equal(firstCaptureRes.statusCode, 201);
    const firstPayload = firstCaptureRes.json() as { item: { id: string }; idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": lowerExtcapKey },
      payload: {
        capture_id: upperExtcapKey,
        url: canonicalUrl,
        source_type: "web",
        intent_text: normalizedIntent,
      },
    });
    assert.equal(replayCaptureRes.statusCode, 201);
    const replayPayload = replayCaptureRes.json() as { item: { id: string }; idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
    assert.equal(replayPayload.item.id, firstPayload.item.id);
  } finally {
    await app.close();
  }
});

test("capture accepts repeated idempotency header values by using first key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-idempotent-header-array-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureKey = "extcap_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const firstCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": [captureKey, captureKey] },
      payload: {
        capture_id: captureKey,
        url: "https://example.com/repeated-header",
        source_type: "web",
        intent_text: "capture with repeated header values",
      },
    });
    assert.equal(firstCaptureRes.statusCode, 201);
    const firstPayload = firstCaptureRes.json() as { item: { id: string }; idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": captureKey },
      payload: {
        capture_id: captureKey,
        url: "https://example.com/repeated-header?utm_source=x",
        source_type: "web",
        intent_text: "capture with repeated header values",
      },
    });
    assert.equal(replayCaptureRes.statusCode, 201);
    const replayPayload = replayCaptureRes.json() as { item: { id: string }; idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
    assert.equal(replayPayload.item.id, firstPayload.item.id);
  } finally {
    await app.close();
  }
});

test("capture accepts comma-joined idempotency header values by using first key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-idempotent-header-comma-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureKey = "extcap_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const firstCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": `, ${captureKey}, ${captureKey}` },
      payload: {
        capture_id: captureKey,
        url: "https://example.com/comma-header",
        source_type: "web",
        intent_text: "capture with comma-joined header values",
      },
    });
    assert.equal(firstCaptureRes.statusCode, 201);
    const firstPayload = firstCaptureRes.json() as { item: { id: string }; idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": captureKey },
      payload: {
        capture_id: captureKey,
        url: "https://example.com/comma-header?utm_source=x",
        source_type: "web",
        intent_text: "capture with comma-joined header values",
      },
    });
    assert.equal(replayCaptureRes.statusCode, 201);
    const replayPayload = replayCaptureRes.json() as { item: { id: string }; idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
    assert.equal(replayPayload.item.id, firstPayload.item.id);
  } finally {
    await app.close();
  }
});

test("capture uses first non-empty key from idempotency header array entries", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-capture-idempotent-header-array-fallback-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureKey = "capture-header-array-fallback-key-1";

    const firstCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": [",", captureKey] },
      payload: {
        url: "https://example.com/header-array-fallback",
        source_type: "web",
        intent_text: "capture using non-empty header fallback",
      },
    });
    assert.equal(firstCaptureRes.statusCode, 201);
    const firstPayload = firstCaptureRes.json() as { item: { id: string }; idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      headers: { "Idempotency-Key": captureKey },
      payload: {
        url: "https://example.com/header-array-fallback?utm_source=changed",
        source_type: "web",
        intent_text: "a different intent should still replay because header key is explicit",
      },
    });
    assert.equal(replayCaptureRes.statusCode, 201);
    const replayPayload = replayCaptureRes.json() as { item: { id: string }; idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
    assert.equal(replayPayload.item.id, firstPayload.item.id);
  } finally {
    await app.close();
  }
});

test("export idempotency replays old export_key beyond recent window", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-idempotent-"));
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
        url: "data:text/plain,This%20content%20verifies%20export%20idempotency%20for%20older%20export%20keys%20across%20many%20versions.",
        title: "Export Idempotency",
        domain: "example.export.idempotent",
        source_type: "web",
        intent_text: "verify old export key replay",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    for (let i = 0; i < 6; i += 1) {
      const exportRes = await app.inject({
        method: "POST",
        url: `/api/items/${itemId}/export`,
        payload: { export_key: `exp-history-${i}`, formats: ["md"] },
      });
      assert.equal(exportRes.statusCode, 200);
    }

    const beforeReplayDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(beforeReplayDetailRes.statusCode, 200);
    const beforeReplayDetail = beforeReplayDetailRes.json() as {
      artifact_history: {
        export: Array<{ version: number }>;
      };
    };
    const exportHistoryCountBeforeReplay = beforeReplayDetail.artifact_history.export.length;
    assert.ok(exportHistoryCountBeforeReplay >= 6);

    const replayRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "exp-history-0", formats: ["md"] },
    });
    assert.equal(replayRes.statusCode, 200);
    const replayPayload = replayRes.json() as {
      export: {
        payload: {
          export_key: string;
        };
      };
    };
    assert.equal(replayPayload.export.payload.export_key, "exp-history-0");

    const afterReplayDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(afterReplayDetailRes.statusCode, 200);
    const afterReplayDetail = afterReplayDetailRes.json() as {
      artifact_history: {
        export: Array<{ version: number }>;
      };
    };
    assert.equal(afterReplayDetail.artifact_history.export.length, exportHistoryCountBeforeReplay);
  } finally {
    await app.close();
  }
});

test("export idempotent replay clears stale failed_export failure payload", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-replay-clears-failure-"));
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
        url: "data:text/plain,This%20content%20verifies%20that%20export%20replay%20clears%20stale%20failure%20payloads.",
        title: "Export Replay Clears Failure",
        domain: "example.export.replay.clear.failure",
        source_type: "web",
        intent_text: "verify export replay clears stale failure payload",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const firstExportKey = "exp-replay-clear-failure-1";
    const firstExportRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: firstExportKey, formats: ["md"] },
    });
    assert.equal(firstExportRes.statusCode, 200);

    const failedExportRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "exp-replay-clear-failure-2", formats: ["png"] },
    });
    assert.equal(failedExportRes.statusCode, 500);

    const failedDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(failedDetailRes.statusCode, 200);
    const failedDetail = failedDetailRes.json() as { item: { status: string }; failure?: unknown };
    assert.equal(failedDetail.item.status, "FAILED_EXPORT");
    assert.notEqual(failedDetail.failure, undefined);

    const replayRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: firstExportKey, formats: ["md"] },
    });
    assert.equal(replayRes.statusCode, 200);
    const replayPayload = replayRes.json() as {
      idempotent_replay: boolean;
      export: { payload: { export_key: string } };
    };
    assert.equal(replayPayload.idempotent_replay, true);
    assert.equal(replayPayload.export.payload.export_key, firstExportKey);

    const replayDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(replayDetailRes.statusCode, 200);
    const replayDetail = replayDetailRes.json() as { item: { status: string }; failure?: unknown };
    assert.equal(replayDetail.item.status, "SHIPPED");
    assert.equal(replayDetail.failure, undefined);
  } finally {
    await app.close();
  }
});

test("export endpoint supports idempotency via header key only", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-idempotent-header-"));
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
        url: "data:text/plain,This%20content%20verifies%20header-only%20export%20idempotency%20replay%20behavior.",
        title: "Export Header Replay",
        domain: "example.export.header.idempotent",
        source_type: "web",
        intent_text: "verify export replay by header idempotency key",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;
    await app.runWorkerOnce();

    const firstRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      headers: { "Idempotency-Key": "export-header-only-key-1" },
      payload: { formats: ["md"] },
    });
    assert.equal(firstRes.statusCode, 200);
    const firstPayload = firstRes.json() as { idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      headers: { "Idempotency-Key": "export-header-only-key-1" },
      payload: { formats: ["md"] },
    });
    assert.equal(replayRes.statusCode, 200);
    const replayPayload = replayRes.json() as { idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
  } finally {
    await app.close();
  }
});

test("export accepts repeated idempotency header values by using first key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-idempotent-header-array-"));
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
        url: "data:text/plain,This%20content%20verifies%20repeated%20header%20values%20for%20export%20idempotency.",
        title: "Export Header Array Replay",
        domain: "example.export.header.array",
        source_type: "web",
        intent_text: "verify repeated export idempotency header",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;
    await app.runWorkerOnce();

    const firstRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      headers: { "Idempotency-Key": ["export-header-array-key-1", "export-header-array-key-1"] },
      payload: { export_key: "export-header-array-key-1", formats: ["md"] },
    });
    assert.equal(firstRes.statusCode, 200);
    const firstPayload = firstRes.json() as { idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      headers: { "Idempotency-Key": "export-header-array-key-1" },
      payload: { export_key: "export-header-array-key-1", formats: ["md"] },
    });
    assert.equal(replayRes.statusCode, 200);
    const replayPayload = replayRes.json() as { idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
  } finally {
    await app.close();
  }
});

test("export accepts comma-joined idempotency header values by using first key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-idempotent-header-comma-"));
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
        url: "data:text/plain,This%20content%20verifies%20comma-joined%20header%20values%20for%20export%20idempotency.",
        title: "Export Header Comma Replay",
        domain: "example.export.header.comma",
        source_type: "web",
        intent_text: "verify comma-joined export idempotency header",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;
    await app.runWorkerOnce();

    const firstRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      headers: { "Idempotency-Key": ", export-header-comma-key-1, export-header-comma-key-1" },
      payload: { export_key: "export-header-comma-key-1", formats: ["md"] },
    });
    assert.equal(firstRes.statusCode, 200);
    const firstPayload = firstRes.json() as { idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      headers: { "Idempotency-Key": "export-header-comma-key-1" },
      payload: { export_key: "export-header-comma-key-1", formats: ["md"] },
    });
    assert.equal(replayRes.statusCode, 200);
    const replayPayload = replayRes.json() as { idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
  } finally {
    await app.close();
  }
});

test("export uses first non-empty key from idempotency header array entries", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-idempotent-header-array-fallback-"));
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
        url: "data:text/plain,This%20content%20verifies%20header-array%20fallback%20for%20export%20idempotency.",
        title: "Export Header Array Fallback",
        domain: "example.export.header.array.fallback",
        source_type: "web",
        intent_text: "verify export header array fallback behavior",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;
    await app.runWorkerOnce();

    const exportKey = "export-header-array-fallback-key-1";
    const firstRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      headers: { "Idempotency-Key": [",", exportKey] },
      payload: { formats: ["md"] },
    });
    assert.equal(firstRes.statusCode, 200);
    const firstPayload = firstRes.json() as { idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      headers: { "Idempotency-Key": exportKey },
      payload: { formats: ["md"] },
    });
    assert.equal(replayRes.statusCode, 200);
    const replayPayload = replayRes.json() as { idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
  } finally {
    await app.close();
  }
});

test("export handles concurrent same-key requests with idempotent replay", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-idempotent-concurrent-"));
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
        url: "data:text/plain,This%20content%20verifies%20concurrent%20same-key%20export%20idempotency%20behavior.",
        title: "Export Concurrent Replay",
        domain: "example.export.concurrent",
        source_type: "web",
        intent_text: "verify concurrent export idempotency replay",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;
    await app.runWorkerOnce();

    const exportKey = "export-concurrent-key-1";
    const [firstRes, secondRes] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/items/${itemId}/export`,
        headers: { "Idempotency-Key": exportKey },
        payload: { export_key: exportKey, formats: ["png", "md"] },
      }),
      app.inject({
        method: "POST",
        url: `/api/items/${itemId}/export`,
        headers: { "Idempotency-Key": exportKey },
        payload: { export_key: exportKey, formats: ["png", "md"] },
      }),
    ]);

    assert.equal(firstRes.statusCode, 200);
    assert.equal(secondRes.statusCode, 200);

    const payloads = [firstRes.json(), secondRes.json()] as Array<{ idempotent_replay: boolean }>;
    assert.equal(payloads.some((x) => x.idempotent_replay === true), true);
    assert.equal(payloads.some((x) => x.idempotent_replay === false), true);

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detailPayload = detailRes.json() as {
      artifact_history?: {
        export?: Array<{ payload: { export_key?: string } }>;
      };
    };
    const exportHistory = detailPayload.artifact_history?.export ?? [];
    assert.equal(exportHistory.filter((x) => x.payload?.export_key === exportKey).length, 1);
  } finally {
    await app.close();
  }
});

test("export rejects mismatched header idempotency key and export_key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-mismatch-idempotent-"));
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
        url: "data:text/plain,This%20request%20validates%20export%20idempotency%20key%20mismatch%20rejection.",
        title: "Export Mismatch",
        domain: "example.export.mismatch",
        source_type: "web",
        intent_text: "validate export key mismatch",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const exportRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      headers: { "Idempotency-Key": "export-header-key-1" },
      payload: { export_key: "export-body-key-2", formats: ["md"] },
    });
    assert.equal(exportRes.statusCode, 400);
    const errPayload = exportRes.json() as { error: { code: string; message: string } };
    assert.equal(errPayload.error.code, "VALIDATION_ERROR");
    assert.match(errPayload.error.message, /Idempotency-Key and export_key must match/i);
  } finally {
    await app.close();
  }
});

test("export rejects non-string export_key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-invalid-export-key-type-"));
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
        url: "data:text/plain,This%20request%20validates%20non-string%20export_key%20validation.",
        title: "Export Invalid Key Type",
        domain: "example.export.invalid.key",
        source_type: "web",
        intent_text: "invalid export_key type should fail",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const exportRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: ["export-key-array"], formats: ["md"] },
    });
    assert.equal(exportRes.statusCode, 400);
    const errPayload = exportRes.json() as { error: { code: string; message: string } };
    assert.equal(errPayload.error.code, "VALIDATION_ERROR");
    assert.match(errPayload.error.message, /export_key must be a string/i);

    const blankExportKeyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "   ", formats: ["md"] },
    });
    assert.equal(blankExportKeyRes.statusCode, 400);
    const blankExportErrPayload = blankExportKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(blankExportErrPayload.error.code, "VALIDATION_ERROR");
    assert.match(blankExportErrPayload.error.message, /export_key must be a non-empty string/i);
  } finally {
    await app.close();
  }
});

test("export rejects unsupported formats without mutating item status", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-invalid-formats-"));
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
        url: "data:text/plain,This%20request%20validates%20unsupported%20export%20formats%20do%20not%20mutate%20item%20state.",
        title: "Export Invalid Formats",
        domain: "example.export.invalid.formats",
        source_type: "web",
        intent_text: "invalid export formats should be rejected as validation",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const nonObjectExportBodyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: [],
    });
    assert.equal(nonObjectExportBodyRes.statusCode, 400);
    const nonObjectExportBodyPayload = nonObjectExportBodyRes.json() as { error: { code: string; message: string } };
    assert.equal(nonObjectExportBodyPayload.error.code, "VALIDATION_ERROR");
    assert.match(nonObjectExportBodyPayload.error.message, /request body must be an object/i);

    const unknownExportKeyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "invalid-export-body-key-unknown", unknown_key: true },
    });
    assert.equal(unknownExportKeyRes.statusCode, 400);
    const unknownExportKeyPayload = unknownExportKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(unknownExportKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(unknownExportKeyPayload.error.message, /export body supports only export_key\|formats\|card_version\|options/i);

    const invalidOptionsShapeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "invalid-export-options-key-1", options: [] },
    });
    assert.equal(invalidOptionsShapeRes.statusCode, 400);
    const invalidOptionsShapePayload = invalidOptionsShapeRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidOptionsShapePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidOptionsShapePayload.error.message, /options must be an object when provided/i);

    const invalidOptionsUnknownKeyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "invalid-export-options-key-2", options: { palette: "dark" } },
    });
    assert.equal(invalidOptionsUnknownKeyRes.statusCode, 400);
    const invalidOptionsUnknownKeyPayload = invalidOptionsUnknownKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidOptionsUnknownKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidOptionsUnknownKeyPayload.error.message, /options supports only theme/i);

    const invalidThemeTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "invalid-export-options-key-3", options: { theme: 1234 } },
    });
    assert.equal(invalidThemeTypeRes.statusCode, 400);
    const invalidThemeTypePayload = invalidThemeTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidThemeTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidThemeTypePayload.error.message, /options.theme must be LIGHT\|DARK/i);

    const invalidThemeValueRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "invalid-export-options-key-4", options: { theme: "blue" } },
    });
    assert.equal(invalidThemeValueRes.statusCode, 400);
    const invalidThemeValuePayload = invalidThemeValueRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidThemeValuePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidThemeValuePayload.error.message, /options.theme must be LIGHT\|DARK/i);

    const invalidFormatsTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "invalid-format-type-key-1", formats: 1234 },
    });
    assert.equal(invalidFormatsTypeRes.statusCode, 400);
    const invalidFormatsTypePayload = invalidFormatsTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidFormatsTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidFormatsTypePayload.error.message, /formats must be a string or an array of strings/i);

    const invalidFormatsElementTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "invalid-format-type-key-2", formats: ["md", 1234] },
    });
    assert.equal(invalidFormatsElementTypeRes.statusCode, 400);
    const invalidFormatsElementTypePayload = invalidFormatsElementTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidFormatsElementTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidFormatsElementTypePayload.error.message, /formats must be a string or an array of strings/i);

    const invalidFormatRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "invalid-format-key-1", formats: ["pdf"] },
    });
    assert.equal(invalidFormatRes.statusCode, 400);
    const invalidFormatPayload = invalidFormatRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidFormatPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidFormatPayload.error.message, /formats must include only png\|md\|caption/i);

    const invalidJsonFormatRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "invalid-format-key-2", formats: ["json"] },
    });
    assert.equal(invalidJsonFormatRes.statusCode, 400);
    const invalidJsonFormatPayload = invalidJsonFormatRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidJsonFormatPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidJsonFormatPayload.error.message, /formats must include only png\|md\|caption/i);

    const detailAfterInvalid = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailAfterInvalid.statusCode, 200);
    const itemAfterInvalid = detailAfterInvalid.json() as {
      item: { status: string };
      failure?: unknown;
    };
    assert.equal(itemAfterInvalid.item.status, "READY");
    assert.equal(itemAfterInvalid.failure, undefined);
  } finally {
    await app.close();
  }
});

test("export accepts options.theme and persists normalized value", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-theme-options-"));
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
        url: "data:text/plain,This%20request%20verifies%20export%20theme%20options%20normalization%20and%20persistence.",
        title: "Export Theme Option",
        domain: "example.export.theme.options",
        source_type: "web",
        intent_text: "verify export theme options are validated and persisted",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const exportRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: {
        export_key: "export-theme-options-key-1",
        formats: ["md"],
        options: { theme: " dark " },
      },
    });
    assert.equal(exportRes.statusCode, 200);
    const exportPayload = exportRes.json() as {
      export: {
        payload: {
          options?: { theme?: string };
          files: Array<{ type: string }>;
        };
      };
      idempotent_replay: boolean;
    };
    assert.equal(exportPayload.idempotent_replay, false);
    assert.equal(exportPayload.export.payload.options?.theme, "DARK");
    assert.deepEqual(
      exportPayload.export.payload.files.map((x) => x.type),
      ["md"],
    );
  } finally {
    await app.close();
  }
});

test("export supports explicit card_version and validates version availability", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-card-version-"));
  const dbPath = join(dbDir, "readdo.db");
  const app = await createApp({
    dbPath,
    workerIntervalMs: 20,
    startWorker: false,
    disablePngRender: true,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20request%20verifies%20export%20card_version%20selection%20and%20validation%20behavior.",
        title: "Export Card Version",
        domain: "example.export.card.version",
        source_type: "web",
        intent_text: "validate explicit card_version behavior for export",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const detailBeforeEditRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailBeforeEditRes.statusCode, 200);
    const detailBeforeEdit = detailBeforeEditRes.json() as {
      artifacts: { card: { payload: Record<string, unknown>; version: number } };
    };
    const cardV1Version = detailBeforeEdit.artifacts.card.version;

    const duplicateCardRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/card`,
      payload: { payload: detailBeforeEdit.artifacts.card.payload },
    });
    assert.equal(duplicateCardRes.statusCode, 201);
    const cardV2Version = (duplicateCardRes.json() as { artifact: { version: number } }).artifact.version;

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("UPDATE artifacts SET payload_json = ? WHERE item_id = ? AND artifact_type = 'card' AND version = ?").run(
        "{bad-json",
        itemId,
        cardV2Version,
      );
    } finally {
      db.close();
    }

    const fallbackExportRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "exp-card-version-fallback", formats: ["md"] },
    });
    assert.equal(fallbackExportRes.statusCode, 200);
    const fallbackExportPayload = fallbackExportRes.json() as {
      export: { payload: { card_version?: number } };
    };
    assert.equal(fallbackExportPayload.export.payload.card_version, cardV1Version);

    const explicitCorruptedVersionRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "exp-card-version-corrupted", formats: ["md"], card_version: cardV2Version },
    });
    assert.equal(explicitCorruptedVersionRes.statusCode, 500);
    const explicitCorruptedVersionPayload = explicitCorruptedVersionRes.json() as { error: { code: string; message: string } };
    assert.equal(explicitCorruptedVersionPayload.error.code, "DATA_CORRUPTION");
    assert.match(explicitCorruptedVersionPayload.error.message, /card artifact payload is malformed/i);

    const explicitValidVersionRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "exp-card-version-v1", formats: ["md"], card_version: cardV1Version },
    });
    assert.equal(explicitValidVersionRes.statusCode, 200);
    const explicitValidVersionPayload = explicitValidVersionRes.json() as {
      export: { payload: { card_version?: number } };
    };
    assert.equal(explicitValidVersionPayload.export.payload.card_version, cardV1Version);

    const missingVersionRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "exp-card-version-missing", formats: ["md"], card_version: 9999 },
    });
    assert.equal(missingVersionRes.statusCode, 404);
    const missingVersionPayload = missingVersionRes.json() as { error: { code: string } };
    assert.equal(missingVersionPayload.error.code, "NOT_FOUND");

    const invalidVersionTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "exp-card-version-invalid", formats: ["md"], card_version: "2" },
    });
    assert.equal(invalidVersionTypeRes.statusCode, 400);
    const invalidVersionTypePayload = invalidVersionTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidVersionTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidVersionTypePayload.error.message, /card_version must be an integer >= 1/i);
  } finally {
    await app.close();
  }
});

test("export mismatch check uses first non-empty parsed header key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-mismatch-idempotent-header-parsed-"));
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
        url: "data:text/plain,This%20request%20validates%20export%20header%20parsing%20for%20mismatch%20checks.",
        title: "Export Parsed Header Mismatch",
        domain: "example.export.header.parsed",
        source_type: "web",
        intent_text: "validate export mismatch uses parsed first header key",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const exportRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      headers: { "Idempotency-Key": ", export-header-first-key, export-body-key" },
      payload: { export_key: "export-body-key", formats: ["md"] },
    });
    assert.equal(exportRes.statusCode, 400);
    const errPayload = exportRes.json() as { error: { code: string; message: string } };
    assert.equal(errPayload.error.code, "VALIDATION_ERROR");
    assert.match(errPayload.error.message, /Idempotency-Key and export_key must match/i);
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

    const invalidModeTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: ["PROCESS"] },
    });
    assert.equal(invalidModeTypeRes.statusCode, 400);
    assert.equal((invalidModeTypeRes.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");

    await app.runWorkerOnce();

    const regenerateRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: " regenerate " },
      headers: { "Idempotency-Key": "regen-key-1" },
    });
    assert.equal(regenerateRes.statusCode, 202);
    const regeneratePayload = regenerateRes.json() as { mode: string; idempotent_replay: boolean };
    assert.equal(regeneratePayload.mode, "REGENERATE");
    assert.equal(regeneratePayload.idempotent_replay, false);
  } finally {
    await app.close();
  }
});

test("process endpoint validates request body shape and allowed keys", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-body-validation-"));
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
        url: "data:text/plain,This%20item%20is%20used%20to%20validate%20process%20request%20body%20shape%20constraints.",
        title: "Process Body Validation",
        domain: "example.process.body.validation",
        source_type: "web",
        intent_text: "validate process body object and keys",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    const nonObjectBodyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: [],
    });
    assert.equal(nonObjectBodyRes.statusCode, 400);
    const nonObjectBodyPayload = nonObjectBodyRes.json() as { error: { code: string; message: string } };
    assert.equal(nonObjectBodyPayload.error.code, "VALIDATION_ERROR");
    assert.match(nonObjectBodyPayload.error.message, /request body must be an object/i);

    const unknownKeyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "PROCESS", unknown_key: true },
    });
    assert.equal(unknownKeyRes.statusCode, 400);
    const unknownKeyPayload = unknownKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(unknownKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(unknownKeyPayload.error.message, /process body supports only mode\|process_request_id\|options/i);

    const blankProcessRequestIdRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "PROCESS", process_request_id: "   " },
    });
    assert.equal(blankProcessRequestIdRes.statusCode, 400);
    const blankProcessRequestIdPayload = blankProcessRequestIdRes.json() as { error: { code: string; message: string } };
    assert.equal(blankProcessRequestIdPayload.error.code, "VALIDATION_ERROR");
    assert.match(blankProcessRequestIdPayload.error.message, /process_request_id must be a non-empty string/i);
  } finally {
    await app.close();
  }
});

test("process endpoint validates options payload shapes", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-options-validation-"));
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
        url: "data:text/plain,This%20item%20is%20used%20to%20validate%20process%20options%20input%20validation.",
        title: "Process Options Validation",
        domain: "example.process.options.validation",
        source_type: "web",
        intent_text: "validate process options payload validation behavior",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    const invalidOptionsShapeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "PROCESS", options: [] },
    });
    assert.equal(invalidOptionsShapeRes.statusCode, 400);
    assert.equal((invalidOptionsShapeRes.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");

    const invalidTemplateProfileTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "PROCESS", options: { template_profile: 123 } },
    });
    assert.equal(invalidTemplateProfileTypeRes.statusCode, 400);
    assert.equal((invalidTemplateProfileTypeRes.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");

    const invalidTemplateProfileValueRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "PROCESS", options: { template_profile: "unknown-profile" } },
    });
    assert.equal(invalidTemplateProfileValueRes.statusCode, 400);
    assert.equal((invalidTemplateProfileValueRes.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");

    const invalidTemplateProfileBlankRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "PROCESS", options: { template_profile: "   " } },
    });
    assert.equal(invalidTemplateProfileBlankRes.statusCode, 400);
    assert.equal((invalidTemplateProfileBlankRes.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");

    const invalidForceRegenerateTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "PROCESS", options: { force_regenerate: "true" } },
    });
    assert.equal(invalidForceRegenerateTypeRes.statusCode, 400);
    assert.equal((invalidForceRegenerateTypeRes.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");

    const invalidOptionsUnknownKeyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "PROCESS", options: { template_profile: "engineer", unknown_flag: true } },
    });
    assert.equal(invalidOptionsUnknownKeyRes.statusCode, 400);
    const invalidOptionsUnknownKeyPayload = invalidOptionsUnknownKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidOptionsUnknownKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidOptionsUnknownKeyPayload.error.message, /options supports only template_profile\|force_regenerate/i);

    const validOptionsRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: {
        mode: "PROCESS",
        options: { template_profile: " Creator ", force_regenerate: false },
      },
    });
    assert.equal(validOptionsRes.statusCode, 202);
    const validOptionsPayload = validOptionsRes.json() as { mode: string; idempotent_replay: boolean; item: { status: string } };
    assert.equal(validOptionsPayload.mode, "PROCESS");
    assert.equal(validOptionsPayload.idempotent_replay, false);
    assert.equal(validOptionsPayload.item.status, "QUEUED");
  } finally {
    await app.close();
  }
});

test("process options template_profile overrides engine profile for regeneration", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-options-template-profile-"));
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
        url: "data:text/plain,This%20item%20is%20used%20to%20verify%20template_profile%20override%20for%20regenerate%20jobs.",
        title: "Process Template Profile Override",
        domain: "example.process.template.profile.override",
        source_type: "web",
        intent_text: "validate template_profile option is applied during regenerate",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const regenerateEngineerRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": "process-template-profile-engineer-1" },
      payload: {
        mode: "REGENERATE",
        options: {
          template_profile: "engineer",
          force_regenerate: true,
        },
      },
    });
    assert.equal(regenerateEngineerRes.statusCode, 202);
    await app.runWorkerOnce();

    const detailAfterEngineerRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(detailAfterEngineerRes.statusCode, 200);
    const detailAfterEngineerPayload = detailAfterEngineerRes.json() as {
      artifacts: {
        summary: {
          meta: { template_version: string };
        };
      };
    };
    assert.equal(detailAfterEngineerPayload.artifacts.summary.meta.template_version, "summary.engineer.v1");

    const regenerateCreatorRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": "process-template-profile-creator-1" },
      payload: {
        mode: "REGENERATE",
        options: {
          template_profile: "creator",
        },
      },
    });
    assert.equal(regenerateCreatorRes.statusCode, 202);
    await app.runWorkerOnce();

    const detailAfterCreatorRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(detailAfterCreatorRes.statusCode, 200);
    const detailAfterCreatorPayload = detailAfterCreatorRes.json() as {
      artifacts: {
        summary: {
          version: number;
          meta: { template_version: string };
        };
      };
      artifact_history: {
        summary: Array<{ version: number; meta: { template_version: string } }>;
      };
    };
    assert.equal(detailAfterCreatorPayload.artifacts.summary.meta.template_version, "summary.creator.v1");
    assert.ok(detailAfterCreatorPayload.artifact_history.summary.length >= 3);
    assert.equal(detailAfterCreatorPayload.artifact_history.summary[0]?.meta.template_version, "summary.creator.v1");
  } finally {
    await app.close();
  }
});

test("worker normalizes legacy template_profile in queued job options_json", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-options-legacy-normalize-"));
  const dbPath = join(dbDir, "readdo.db");
  const app = await createApp({
    dbPath,
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20item%20is%20used%20to%20verify%20legacy%20job%20options%20template_profile%20normalization%20behavior%20in%20the%20worker.",
        title: "Process Legacy Options Normalize",
        domain: "example.process.legacy.options.normalize",
        source_type: "web",
        intent_text: "validate legacy job options template_profile normalization",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const queueRegenerateRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: {
        mode: "REGENERATE",
        options: {
          template_profile: "engineer",
        },
      },
    });
    assert.equal(queueRegenerateRes.statusCode, 202);

    const db = new DatabaseSync(dbPath);
    try {
      const rewriteResult = db
        .prepare("UPDATE jobs SET options_json = ? WHERE item_id = ? AND status = 'QUEUED' AND kind = 'PROCESS'")
        .run(JSON.stringify({ template_profile: " Creator " }), itemId) as { changes: number };
      assert.equal(rewriteResult.changes, 1);
    } finally {
      db.close();
    }

    await app.runWorkerOnce();

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detailPayload = detailRes.json() as {
      artifacts: {
        summary: {
          meta: { template_version: string };
        };
      };
    };
    assert.equal(detailPayload.artifacts.summary.meta.template_version, "summary.creator.v1");
  } finally {
    await app.close();
  }
});

test("process retry reuses cached extraction unless force_regenerate is true", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-force-regenerate-"));
  const dbPath = join(dbDir, "readdo.db");
  const app = await createApp({
    dbPath,
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20item%20contains%20enough%20text%20to%20produce%20a%20stable%20extraction%20artifact%20for%20retry%20cache%20verification%20in%20the%20worker%20pipeline.",
        title: "Process Force Regenerate",
        domain: "example.process.force.regenerate",
        source_type: "web",
        intent_text: "verify retry can reuse cached extraction unless force regenerate is requested",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("UPDATE items SET url = ?, status = 'FAILED_AI', failure_json = ? WHERE id = ?").run(
        "http://127.0.0.1:9/unreachable",
        JSON.stringify({
          failed_step: "pipeline",
          error_code: "AI_PROVIDER_ERROR",
          message: "simulated pipeline failure for retry",
          retryable: true,
          retry_attempts: 1,
          retry_limit: 3,
        }),
        itemId,
      );
    } finally {
      db.close();
    }

    const retryWithCacheRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: {
        mode: "RETRY",
        options: {
          force_regenerate: false,
        },
      },
    });
    assert.equal(retryWithCacheRes.statusCode, 202);
    await app.runWorkerOnce();

    const detailAfterCacheRetryRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailAfterCacheRetryRes.statusCode, 200);
    const detailAfterCacheRetry = detailAfterCacheRetryRes.json() as { item: { status: string } };
    assert.equal(detailAfterCacheRetry.item.status, "READY");

    const db2 = new DatabaseSync(dbPath);
    try {
      db2.prepare("UPDATE items SET status = 'FAILED_AI', failure_json = ? WHERE id = ?").run(
        JSON.stringify({
          failed_step: "pipeline",
          error_code: "AI_PROVIDER_ERROR",
          message: "simulate another retry attempt",
          retryable: true,
          retry_attempts: 1,
          retry_limit: 3,
        }),
        itemId,
      );
    } finally {
      db2.close();
    }

    const retryForceRegenerateRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: {
        mode: "RETRY",
        options: {
          force_regenerate: true,
        },
      },
    });
    assert.equal(retryForceRegenerateRes.statusCode, 202);
    await app.runWorkerOnce();

    const detailAfterForceRegenerateRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailAfterForceRegenerateRes.statusCode, 200);
    const detailAfterForceRegenerate = detailAfterForceRegenerateRes.json() as {
      item: { status: string };
      failure?: { failed_step?: string };
    };
    assert.equal(detailAfterForceRegenerate.item.status, "FAILED_EXTRACTION");
    assert.equal(detailAfterForceRegenerate.failure?.failed_step, "extract");
  } finally {
    await app.close();
  }
});

test("process endpoint replays idempotent request with same key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-idempotent-"));
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
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20idempotent%20process%20replay%20behavior.",
        title: "Process Idempotency",
        domain: "example.process.idempotent",
        source_type: "web",
        intent_text: "validate process idempotency replay",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const firstProcessRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": "process-idempotent-key-1" },
      payload: { mode: "REGENERATE" },
    });
    assert.equal(firstProcessRes.statusCode, 202);
    const firstProcessPayload = firstProcessRes.json() as { mode: string; idempotent_replay: boolean; item: { status: string } };
    assert.equal(firstProcessPayload.mode, "REGENERATE");
    assert.equal(firstProcessPayload.idempotent_replay, false);
    assert.equal(firstProcessPayload.item.status, "QUEUED");

    const replayProcessRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": "process-idempotent-key-1" },
      payload: { mode: "REGENERATE" },
    });
    assert.equal(replayProcessRes.statusCode, 202);
    const replayPayload = replayProcessRes.json() as { mode: string; idempotent_replay?: boolean; item: { status: string } };
    assert.equal(replayPayload.mode, "REGENERATE");
    assert.equal(replayPayload.idempotent_replay, true);
    assert.equal(replayPayload.item.status, "QUEUED");
  } finally {
    await app.close();
  }
});

test("process handles concurrent same-key requests with idempotent replay", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-idempotent-concurrent-"));
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
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20concurrent%20process%20idempotency%20replay%20behavior.",
        title: "Process Concurrent Replay",
        domain: "example.process.concurrent",
        source_type: "web",
        intent_text: "validate concurrent process idempotency replay",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const requestKey = "process-concurrent-key-1";
    const [firstRes, secondRes] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/items/${itemId}/process`,
        headers: { "Idempotency-Key": requestKey },
        payload: { mode: "REGENERATE" },
      }),
      app.inject({
        method: "POST",
        url: `/api/items/${itemId}/process`,
        headers: { "Idempotency-Key": requestKey },
        payload: { mode: "REGENERATE" },
      }),
    ]);

    assert.equal(firstRes.statusCode, 202);
    assert.equal(secondRes.statusCode, 202);

    const payloads = [firstRes.json(), secondRes.json()] as Array<{ idempotent_replay: boolean }>;
    assert.equal(payloads.some((x) => x.idempotent_replay === true), true);
    assert.equal(payloads.some((x) => x.idempotent_replay === false), true);
  } finally {
    await app.close();
  }
});

test("process accepts repeated idempotency header values by using first key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-idempotent-header-array-"));
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
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20repeated%20header%20values%20for%20process%20idempotency.",
        title: "Process Header Array Replay",
        domain: "example.process.header.array",
        source_type: "web",
        intent_text: "validate repeated process idempotency header",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const firstProcessRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": ["process-header-array-key-1", "process-header-array-key-1"] },
      payload: { mode: "REGENERATE", process_request_id: "process-header-array-key-1" },
    });
    assert.equal(firstProcessRes.statusCode, 202);
    const firstPayload = firstProcessRes.json() as { idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayProcessRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": "process-header-array-key-1" },
      payload: { mode: "REGENERATE", process_request_id: "process-header-array-key-1" },
    });
    assert.equal(replayProcessRes.statusCode, 202);
    const replayPayload = replayProcessRes.json() as { idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
  } finally {
    await app.close();
  }
});

test("process accepts comma-joined idempotency header values by using first key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-idempotent-header-comma-"));
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
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20comma-joined%20header%20values%20for%20process%20idempotency.",
        title: "Process Header Comma Replay",
        domain: "example.process.header.comma",
        source_type: "web",
        intent_text: "validate comma-joined process idempotency header",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const firstProcessRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": ", process-header-comma-key-1, process-header-comma-key-1" },
      payload: { mode: "REGENERATE", process_request_id: "process-header-comma-key-1" },
    });
    assert.equal(firstProcessRes.statusCode, 202);
    const firstPayload = firstProcessRes.json() as { idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayProcessRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": "process-header-comma-key-1" },
      payload: { mode: "REGENERATE", process_request_id: "process-header-comma-key-1" },
    });
    assert.equal(replayProcessRes.statusCode, 202);
    const replayPayload = replayProcessRes.json() as { idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
  } finally {
    await app.close();
  }
});

test("process uses first non-empty key from idempotency header array entries", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-idempotent-header-array-fallback-"));
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
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20header-array%20fallback%20for%20process%20idempotency.",
        title: "Process Header Array Fallback",
        domain: "example.process.header.array.fallback",
        source_type: "web",
        intent_text: "validate process header array fallback behavior",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const processKey = "process-header-array-fallback-key-1";
    const firstProcessRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": [",", processKey] },
      payload: { mode: "REGENERATE" },
    });
    assert.equal(firstProcessRes.statusCode, 202);
    const firstPayload = firstProcessRes.json() as { idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayProcessRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": processKey },
      payload: { mode: "REGENERATE" },
    });
    assert.equal(replayProcessRes.statusCode, 202);
    const replayPayload = replayProcessRes.json() as { idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
  } finally {
    await app.close();
  }
});

test("process endpoint supports idempotency via process_request_id body field", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-idempotent-body-"));
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
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20body-only%20process%20idempotency%20replay%20behavior.",
        title: "Process Body Replay",
        domain: "example.process.body.idempotent",
        source_type: "web",
        intent_text: "validate process idempotency replay by process_request_id",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;
    await app.runWorkerOnce();

    const firstProcessRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "REGENERATE", process_request_id: "process-body-only-key-1" },
    });
    assert.equal(firstProcessRes.statusCode, 202);
    const firstPayload = firstProcessRes.json() as { idempotent_replay: boolean };
    assert.equal(firstPayload.idempotent_replay, false);

    const replayRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "REGENERATE", process_request_id: "process-body-only-key-1" },
    });
    assert.equal(replayRes.statusCode, 202);
    const replayPayload = replayRes.json() as { idempotent_replay: boolean };
    assert.equal(replayPayload.idempotent_replay, true);
  } finally {
    await app.close();
  }
});

test("process rejects mismatched header idempotency key and process_request_id", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-mismatch-idempotent-"));
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
        url: "data:text/plain,This%20request%20validates%20process%20idempotency%20key%20mismatch%20rejection.",
        title: "Process Mismatch",
        domain: "example.process.mismatch",
        source_type: "web",
        intent_text: "validate process key mismatch",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const processRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": "process-header-key-1" },
      payload: { mode: "REGENERATE", process_request_id: "process-body-key-2" },
    });
    assert.equal(processRes.statusCode, 400);
    const errPayload = processRes.json() as { error: { code: string; message: string } };
    assert.equal(errPayload.error.code, "VALIDATION_ERROR");
    assert.match(errPayload.error.message, /Idempotency-Key and process_request_id must match/i);
  } finally {
    await app.close();
  }
});

test("process rejects non-string process_request_id", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-invalid-request-id-type-"));
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
        url: "data:text/plain,This%20request%20validates%20non-string%20process_request_id%20validation.",
        title: "Process Invalid Request Id Type",
        domain: "example.process.invalid.request-id",
        source_type: "web",
        intent_text: "invalid process_request_id type should fail",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    const processRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      payload: { mode: "PROCESS", process_request_id: ["process-key-array"] },
    });
    assert.equal(processRes.statusCode, 400);
    const errPayload = processRes.json() as { error: { code: string; message: string } };
    assert.equal(errPayload.error.code, "VALIDATION_ERROR");
    assert.match(errPayload.error.message, /process_request_id must be a string/i);
  } finally {
    await app.close();
  }
});

test("process mismatch check uses first non-empty parsed header key", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-process-mismatch-idempotent-header-parsed-"));
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
        url: "data:text/plain,This%20request%20validates%20process%20header%20parsing%20for%20mismatch%20checks.",
        title: "Process Parsed Header Mismatch",
        domain: "example.process.header.parsed",
        source_type: "web",
        intent_text: "validate process mismatch uses parsed first header key",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const processRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/process`,
      headers: { "Idempotency-Key": ", process-header-first-key, process-body-key" },
      payload: { mode: "REGENERATE", process_request_id: "process-body-key" },
    });
    assert.equal(processRes.statusCode, 400);
    const errPayload = processRes.json() as { error: { code: string; message: string } };
    assert.equal(errPayload.error.code, "VALIDATION_ERROR");
    assert.match(errPayload.error.message, /Idempotency-Key and process_request_id must match/i);
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

    const thirdCapture = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20is%20a%20video%20note%20for%20testing%20source%20type%20query%20normalization.",
        title: "Video Source",
        domain: "example.video",
        source_type: "YouTube",
        intent_text: "Collect video workflow ideas",
      },
    });
    assert.equal(thirdCapture.statusCode, 201);

    await app.runWorkerOnce();

    const readyItemsRes = await app.inject({
      method: "GET",
      url: "/api/items?status=READY",
    });
    assert.equal(readyItemsRes.statusCode, 200);
    const readyItemsPayload = readyItemsRes.json() as { items: Array<{ status: string; priority?: string | null }> };
    const readyItems = readyItemsPayload.items;
    assert.ok(readyItems.length >= 1);
    assert.ok(readyItems.every((x) => x.status === "READY"));

    const readyPriority = readyItemsPayload.items[0]?.priority;
    assert.ok(typeof readyPriority === "string" && readyPriority.length > 0);
    const readyPriorityLower = readyPriority.toLowerCase();
    const priorityLowercaseRes = await app.inject({
      method: "GET",
      url: `/api/items?priority=${encodeURIComponent(readyPriorityLower)}`,
    });
    assert.equal(priorityLowercaseRes.statusCode, 200);
    const priorityLowercaseItems = (priorityLowercaseRes.json() as { items: Array<{ priority?: string | null }> }).items;
    assert.ok(priorityLowercaseItems.length >= 1);
    assert.ok(priorityLowercaseItems.every((x) => x.priority === readyPriority));

    const priorityMultiRes = await app.inject({
      method: "GET",
      url: `/api/items?priority=${encodeURIComponent(` ${readyPriorityLower} , ${readyPriority} `)}`,
    });
    assert.equal(priorityMultiRes.statusCode, 200);
    const priorityMultiItems = (priorityMultiRes.json() as { items: Array<{ priority?: string | null }> }).items;
    assert.ok(priorityMultiItems.length >= 1);
    assert.ok(priorityMultiItems.every((x) => x.priority === readyPriority));

    const readyItemsLowercaseRes = await app.inject({
      method: "GET",
      url: "/api/items?status=ready",
    });
    assert.equal(readyItemsLowercaseRes.statusCode, 200);
    const readyItemsLowercase = (readyItemsLowercaseRes.json() as { items: Array<{ status: string }> }).items;
    assert.ok(readyItemsLowercase.length >= 1);
    assert.ok(readyItemsLowercase.every((x) => x.status === "READY"));

    const statusMultiRes = await app.inject({
      method: "GET",
      url: "/api/items?status= ready , captured ",
    });
    assert.equal(statusMultiRes.statusCode, 200);
    const statusMultiItems = (statusMultiRes.json() as { items: Array<{ status: string }> }).items;
    assert.ok(statusMultiItems.length >= 2);
    assert.ok(statusMultiItems.some((x) => x.status === "READY"));
    assert.ok(statusMultiItems.some((x) => x.status === "CAPTURED"));
    assert.ok(statusMultiItems.every((x) => ["READY", "CAPTURED"].includes(x.status)));

    const invalidStatusRes = await app.inject({
      method: "GET",
      url: "/api/items?status=READY,NOT_A_STATUS",
    });
    assert.equal(invalidStatusRes.statusCode, 400);
    const invalidStatusPayload = invalidStatusRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidStatusPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidStatusPayload.error.message, /status must contain valid item statuses/i);

    const unknownItemsQueryRes = await app.inject({
      method: "GET",
      url: "/api/items?unknown_filter=1",
    });
    assert.equal(unknownItemsQueryRes.statusCode, 400);
    const unknownItemsQueryPayload = unknownItemsQueryRes.json() as { error: { code: string; message: string } };
    assert.equal(unknownItemsQueryPayload.error.code, "VALIDATION_ERROR");
    assert.match(unknownItemsQueryPayload.error.message, /items query supports only status\|priority\|source_type\|retryable\|failure_step\|q\|sort\|offset\|cursor\|limit/i);

    const blankStatusRes = await app.inject({
      method: "GET",
      url: "/api/items?status=%20%20%20",
    });
    assert.equal(blankStatusRes.statusCode, 400);
    const blankStatusPayload = blankStatusRes.json() as { error: { code: string; message: string } };
    assert.equal(blankStatusPayload.error.code, "VALIDATION_ERROR");
    assert.match(blankStatusPayload.error.message, /status must contain valid item statuses/i);

    const searchRes = await app.inject({
      method: "GET",
      url: "/api/items?q=creator",
    });
    assert.equal(searchRes.statusCode, 200);
    const searchItems = (searchRes.json() as { items: Array<{ title?: string }> }).items;
    assert.ok(searchItems.some((x) => (x.title ?? "").toLowerCase().includes("creator")));

    const blankSearchRes = await app.inject({
      method: "GET",
      url: "/api/items?q=%20%20%20",
    });
    assert.equal(blankSearchRes.statusCode, 400);
    const blankSearchPayload = blankSearchRes.json() as { error: { code: string; message: string } };
    assert.equal(blankSearchPayload.error.code, "VALIDATION_ERROR");
    assert.match(blankSearchPayload.error.message, /q must be a non-empty string when provided/i);

    const sourceTypeRes = await app.inject({
      method: "GET",
      url: "/api/items?source_type=YOUTUBE",
    });
    assert.equal(sourceTypeRes.statusCode, 200);
    const sourceTypeItems = (sourceTypeRes.json() as { items: Array<{ source_type: string }> }).items;
    assert.ok(sourceTypeItems.length >= 1);
    assert.ok(sourceTypeItems.every((x) => x.source_type === "youtube"));

    const multiSourceTypeRes = await app.inject({
      method: "GET",
      url: "/api/items?source_type= YouTube , WEB ",
    });
    assert.equal(multiSourceTypeRes.statusCode, 200);
    const multiSourceTypeItems = (multiSourceTypeRes.json() as { items: Array<{ source_type: string }> }).items;
    assert.ok(multiSourceTypeItems.length >= 3);
    assert.ok(multiSourceTypeItems.some((x) => x.source_type === "youtube"));
    assert.ok(multiSourceTypeItems.some((x) => x.source_type === "web"));
    assert.ok(multiSourceTypeItems.every((x) => ["youtube", "web"].includes(x.source_type)));

    const invalidPriorityRes = await app.inject({
      method: "GET",
      url: "/api/items?priority=READ_NEXT,NOT_A_PRIORITY",
    });
    assert.equal(invalidPriorityRes.statusCode, 400);
    const invalidPriorityPayload = invalidPriorityRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidPriorityPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidPriorityPayload.error.message, /priority must contain read_next\|worth_it\|if_time\|skip/i);

    const blankPriorityRes = await app.inject({
      method: "GET",
      url: "/api/items?priority=%20%20%20",
    });
    assert.equal(blankPriorityRes.statusCode, 400);
    const blankPriorityPayload = blankPriorityRes.json() as { error: { code: string; message: string } };
    assert.equal(blankPriorityPayload.error.code, "VALIDATION_ERROR");
    assert.match(blankPriorityPayload.error.message, /priority must contain read_next\|worth_it\|if_time\|skip/i);

    const invalidSourceTypeRes = await app.inject({
      method: "GET",
      url: "/api/items?source_type=web,unknown",
    });
    assert.equal(invalidSourceTypeRes.statusCode, 400);
    const invalidSourceTypePayload = invalidSourceTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidSourceTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidSourceTypePayload.error.message, /source_type must contain web\|youtube\|newsletter\|other/i);

    const blankSourceTypeRes = await app.inject({
      method: "GET",
      url: "/api/items?source_type=%20%20%20",
    });
    assert.equal(blankSourceTypeRes.statusCode, 400);
    const blankSourceTypePayload = blankSourceTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(blankSourceTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(blankSourceTypePayload.error.message, /source_type must contain web\|youtube\|newsletter\|other/i);

    const trimmedSortRes = await app.inject({
      method: "GET",
      url: "/api/items?sort=%20created_desc%20&limit=1",
    });
    assert.equal(trimmedSortRes.statusCode, 200);
    const trimmedSortItems = (trimmedSortRes.json() as { items: Array<{ id: string }> }).items;
    assert.equal(trimmedSortItems.length, 1);

    const invalidSortRes = await app.inject({
      method: "GET",
      url: "/api/items?sort=bad_order",
    });
    assert.equal(invalidSortRes.statusCode, 400);
    const invalidSortPayload = invalidSortRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidSortPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidSortPayload.error.message, /sort must be priority_score_desc\|created_desc\|updated_desc/i);

    const blankSortRes = await app.inject({
      method: "GET",
      url: "/api/items?sort=%20%20%20",
    });
    assert.equal(blankSortRes.statusCode, 400);
    const blankSortPayload = blankSortRes.json() as { error: { code: string; message: string } };
    assert.equal(blankSortPayload.error.code, "VALIDATION_ERROR");
    assert.match(blankSortPayload.error.message, /sort must be priority_score_desc\|created_desc\|updated_desc/i);

    const invalidCursorTypeRes = await app.inject({
      method: "GET",
      url: "/api/items?cursor=first&cursor=second",
    });
    assert.equal(invalidCursorTypeRes.statusCode, 400);
    const invalidCursorTypePayload = invalidCursorTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidCursorTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidCursorTypePayload.error.message, /cursor must be a non-empty string when provided/i);

    const blankCursorRes = await app.inject({
      method: "GET",
      url: "/api/items?cursor=%20%20%20",
    });
    assert.equal(blankCursorRes.statusCode, 400);
    const blankCursorPayload = blankCursorRes.json() as { error: { code: string; message: string } };
    assert.equal(blankCursorPayload.error.code, "VALIDATION_ERROR");
    assert.match(blankCursorPayload.error.message, /cursor must be a non-empty string when provided/i);

    const limitOneRes = await app.inject({
      method: "GET",
      url: "/api/items?limit=1",
    });
    assert.equal(limitOneRes.statusCode, 200);
    const limitOneItems = (limitOneRes.json() as { items: Array<{ id: string }> }).items;
    assert.equal(limitOneItems.length, 1);

    const limitNegativeRes = await app.inject({
      method: "GET",
      url: "/api/items?limit=-5",
    });
    assert.equal(limitNegativeRes.statusCode, 200);
    const limitNegativeItems = (limitNegativeRes.json() as { items: Array<{ id: string }> }).items;
    assert.equal(limitNegativeItems.length, 1);

    const limitInvalidRes = await app.inject({
      method: "GET",
      url: "/api/items?limit=not-a-number",
    });
    assert.equal(limitInvalidRes.statusCode, 200);
    const limitInvalidItems = (limitInvalidRes.json() as { items: Array<{ id: string }> }).items;
    assert.ok(limitInvalidItems.length >= 2);

    const limitBlankRes = await app.inject({
      method: "GET",
      url: "/api/items?limit=%20%20%20",
    });
    assert.equal(limitBlankRes.statusCode, 200);
    const limitBlankItems = (limitBlankRes.json() as { items: Array<{ id: string }> }).items;
    assert.ok(limitBlankItems.length >= 2);

    const limitFloatRes = await app.inject({
      method: "GET",
      url: "/api/items?limit=1.5",
    });
    assert.equal(limitFloatRes.statusCode, 200);
    const limitFloatItems = (limitFloatRes.json() as { items: Array<{ id: string }> }).items;
    assert.ok(limitFloatItems.length >= 2);

    const offsetRes = await app.inject({
      method: "GET",
      url: "/api/items?limit=1&offset=1",
    });
    assert.equal(offsetRes.statusCode, 200);
    const offsetPayload = offsetRes.json() as { items: Array<{ id: string }>; requested_offset: number };
    assert.equal(offsetPayload.requested_offset, 1);
    assert.equal(offsetPayload.items.length, 1);

    const negativeOffsetRes = await app.inject({
      method: "GET",
      url: "/api/items?limit=1&offset=-9",
    });
    assert.equal(negativeOffsetRes.statusCode, 200);
    const negativeOffsetPayload = negativeOffsetRes.json() as { requested_offset: number; items: Array<{ id: string }> };
    assert.equal(negativeOffsetPayload.requested_offset, 0);
    assert.equal(negativeOffsetPayload.items.length, 1);

    const invalidOffsetRes = await app.inject({
      method: "GET",
      url: "/api/items?limit=1&offset=not-a-number",
    });
    assert.equal(invalidOffsetRes.statusCode, 200);
    const invalidOffsetPayload = invalidOffsetRes.json() as { requested_offset: number; items: Array<{ id: string }> };
    assert.equal(invalidOffsetPayload.requested_offset, 0);
    assert.equal(invalidOffsetPayload.items.length, 1);

    const floatOffsetRes = await app.inject({
      method: "GET",
      url: "/api/items?limit=1&offset=1.25",
    });
    assert.equal(floatOffsetRes.statusCode, 200);
    const floatOffsetPayload = floatOffsetRes.json() as { requested_offset: number; items: Array<{ id: string }> };
    assert.equal(floatOffsetPayload.requested_offset, 0);
    assert.equal(floatOffsetPayload.items.length, 1);
  } finally {
    await app.close();
  }
});

test("items endpoint applies retryable filter before limit truncation", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-list-retryable-limit-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const readyCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20is%20a%20long%20content%20that%20will%20become%20READY%20after%20worker%20processing%20for%20retryable%20limit%20test.",
        title: "Ready Item",
        domain: "example.items.ready",
        source_type: "web",
        intent_text: "create ready item first",
      },
    });
    assert.equal(readyCaptureRes.statusCode, 201);

    const failedCaptureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,short",
        title: "Failed Item A",
        domain: "example.items.failed.a",
        source_type: "web",
        intent_text: "create failed item second a",
      },
    });
    assert.equal(failedCaptureRes.statusCode, 201);
    const failedItemAId = (failedCaptureRes.json() as { item: { id: string } }).item.id;

    const failedCaptureBRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,tiny",
        title: "Failed Item B",
        domain: "example.items.failed.b",
        source_type: "web",
        intent_text: "create failed item third b",
      },
    });
    assert.equal(failedCaptureBRes.statusCode, 201);
    const failedItemBId = (failedCaptureBRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();
    await app.runWorkerOnce();
    await app.runWorkerOnce();

    const retryableRes = await app.inject({
      method: "GET",
      url: "/api/items?retryable=true&sort=created_desc&limit=1",
    });
    assert.equal(retryableRes.statusCode, 200);
    const retryableItems = (retryableRes.json() as { items: Array<{ id: string; status: string }> }).items;
    assert.equal(retryableItems.length, 1);
    assert.ok(retryableItems[0].status.startsWith("FAILED_"));
    assert.equal(retryableItems[0].id, failedItemBId);

    const failureStepRes = await app.inject({
      method: "GET",
      url: "/api/items?failure_step=extract&limit=1",
    });
    assert.equal(failureStepRes.statusCode, 200);
    const failureStepItems = (failureStepRes.json() as { items: Array<{ status: string; failure?: { failed_step?: string } }> }).items;
    assert.equal(failureStepItems.length, 1);
    assert.equal(failureStepItems[0].status, "FAILED_EXTRACTION");
    assert.equal(failureStepItems[0].failure?.failed_step, "extract");

    const retryableOffsetRes = await app.inject({
      method: "GET",
      url: "/api/items?retryable=true&sort=created_desc&limit=1&offset=1",
    });
    assert.equal(retryableOffsetRes.statusCode, 200);
    const retryableOffsetPayload = retryableOffsetRes.json() as {
      items: Array<{ id: string; status: string }>;
      requested_offset: number;
    };
    assert.equal(retryableOffsetPayload.requested_offset, 1);
    assert.equal(retryableOffsetPayload.items.length, 1);
    assert.equal(retryableOffsetPayload.items[0].id, failedItemAId);
    assert.ok(retryableOffsetPayload.items[0].status.startsWith("FAILED_"));

    const failedWildcardRes = await app.inject({
      method: "GET",
      url: "/api/items?status=FAILED_*&sort=created_desc&limit=10",
    });
    assert.equal(failedWildcardRes.statusCode, 200);
    const failedWildcardItems = (failedWildcardRes.json() as { items: Array<{ id: string; status: string }> }).items;
    assert.ok(failedWildcardItems.length >= 2);
    assert.ok(failedWildcardItems.some((x) => x.id === failedItemAId));
    assert.ok(failedWildcardItems.some((x) => x.id === failedItemBId));
    assert.ok(failedWildcardItems.every((x) => x.status.startsWith("FAILED_")));
  } finally {
    await app.close();
  }
});

test("items endpoint validates retryable and failure_step query values", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-items-query-validate-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const invalidRetryableRes = await app.inject({
      method: "GET",
      url: "/api/items?retryable=maybe",
    });
    assert.equal(invalidRetryableRes.statusCode, 400);
    const invalidRetryablePayload = invalidRetryableRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidRetryablePayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidRetryablePayload.error.message, /retryable must be true\\|false/i);

    const blankRetryableRes = await app.inject({
      method: "GET",
      url: "/api/items?retryable=%20%20%20",
    });
    assert.equal(blankRetryableRes.statusCode, 400);
    const blankRetryablePayload = blankRetryableRes.json() as { error: { code: string; message: string } };
    assert.equal(blankRetryablePayload.error.code, "VALIDATION_ERROR");
    assert.match(blankRetryablePayload.error.message, /retryable must be true\\|false/i);

    const invalidFailureStepRes = await app.inject({
      method: "GET",
      url: "/api/items?failure_step=unknown",
    });
    assert.equal(invalidFailureStepRes.statusCode, 400);
    const invalidFailureStepPayload = invalidFailureStepRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidFailureStepPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidFailureStepPayload.error.message, /failure_step must be extract\\|pipeline\\|export/i);

    const blankFailureStepRes = await app.inject({
      method: "GET",
      url: "/api/items?failure_step=%20%20%20",
    });
    assert.equal(blankFailureStepRes.statusCode, 400);
    const blankFailureStepPayload = blankFailureStepRes.json() as { error: { code: string; message: string } };
    assert.equal(blankFailureStepPayload.error.code, "VALIDATION_ERROR");
    assert.match(blankFailureStepPayload.error.message, /failure_step must be extract\\|pipeline\\|export/i);
  } finally {
    await app.close();
  }
});

test("item detail validates include_history query values", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-item-detail-include-history-"));
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
        url: "data:text/plain,This%20item%20verifies%20include_history%20query%20validation%20for%20item%20detail.",
        title: "Include History Validation",
        domain: "example.include.history",
        source_type: "web",
        intent_text: "validate include_history query values",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    const validDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(validDetailRes.statusCode, 200);

    const invalidDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=maybe`,
    });
    assert.equal(invalidDetailRes.statusCode, 400);
    const invalidDetailPayload = invalidDetailRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidDetailPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidDetailPayload.error.message, /include_history must be true\|false/i);

    const blankDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=%20%20%20`,
    });
    assert.equal(blankDetailRes.statusCode, 400);
    const blankDetailPayload = blankDetailRes.json() as { error: { code: string; message: string } };
    assert.equal(blankDetailPayload.error.code, "VALIDATION_ERROR");
    assert.match(blankDetailPayload.error.message, /include_history must be true\|false/i);

    const unknownDetailQueryRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?unknown=true`,
    });
    assert.equal(unknownDetailQueryRes.statusCode, 400);
    const unknownDetailQueryPayload = unknownDetailQueryRes.json() as { error: { code: string; message: string } };
    assert.equal(unknownDetailQueryPayload.error.code, "VALIDATION_ERROR");
    assert.match(unknownDetailQueryPayload.error.message, /item detail query supports only include_history\|artifact_versions/i);
  } finally {
    await app.close();
  }
});

test("items endpoint clamps limit to maximum 100", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-list-limit-max-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    for (let i = 0; i < 105; i += 1) {
      const captureRes = await app.inject({
        method: "POST",
        url: "/api/capture",
        payload: {
          url: `data:text/plain,limit-max-case-${i}`,
          title: `Limit Max ${i}`,
          domain: "example.items.limit.max",
          source_type: "web",
          intent_text: `create item for max limit case ${i}`,
        },
      });
      assert.equal(captureRes.statusCode, 201);
    }

    const listRes = await app.inject({
      method: "GET",
      url: "/api/items?limit=999",
    });
    assert.equal(listRes.statusCode, 200);
    const items = (listRes.json() as { items: Array<{ id: string }> }).items;
    assert.equal(items.length, 100);
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

    const invalidPinnedRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?artifact_versions=${encodeURIComponent('"oops"')}`,
    });
    assert.equal(invalidPinnedRes.statusCode, 200);
    const invalidPinned = invalidPinnedRes.json() as {
      artifacts: {
        todos: {
          version: number;
          created_by: string;
        };
      };
      artifact_versions_selected: Record<string, number>;
    };
    assert.equal(Object.keys(invalidPinned.artifact_versions_selected).length, 0);
    assert.equal(invalidPinned.artifacts.todos.version, after.artifacts.todos.version);
    assert.equal(invalidPinned.artifacts.todos.created_by, "user");
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

test("intent endpoint validates intent_text and regenerate types", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-intent-validate-"));
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
        url: "data:text/plain,This%20item%20is%20used%20to%20validate%20intent%20endpoint%20input%20types.",
        title: "Intent Validate",
        domain: "example.intent.validate",
        source_type: "web",
        intent_text: "Initial intent for validation.",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    const nonStringIntentRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/intent`,
      payload: {
        intent_text: { bad: true },
        regenerate: false,
      },
    });
    assert.equal(nonStringIntentRes.statusCode, 400);
    const nonStringIntentPayload = nonStringIntentRes.json() as { error: { code: string; message: string } };
    assert.equal(nonStringIntentPayload.error.code, "VALIDATION_ERROR");
    assert.match(nonStringIntentPayload.error.message, /intent_text must be a string/i);

    const nonBooleanRegenerateRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/intent`,
      payload: {
        intent_text: "Still valid intent text",
        regenerate: "false",
      },
    });
    assert.equal(nonBooleanRegenerateRes.statusCode, 400);
    const nonBooleanRegeneratePayload = nonBooleanRegenerateRes.json() as { error: { code: string; message: string } };
    assert.equal(nonBooleanRegeneratePayload.error.code, "VALIDATION_ERROR");
    assert.match(nonBooleanRegeneratePayload.error.message, /regenerate must be a boolean/i);

    const nonObjectIntentBodyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/intent`,
      payload: [],
    });
    assert.equal(nonObjectIntentBodyRes.statusCode, 400);
    const nonObjectIntentBodyPayload = nonObjectIntentBodyRes.json() as { error: { code: string; message: string } };
    assert.equal(nonObjectIntentBodyPayload.error.code, "VALIDATION_ERROR");
    assert.match(nonObjectIntentBodyPayload.error.message, /request body must be an object/i);

    const unknownIntentKeyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/intent`,
      payload: {
        intent_text: "Still valid intent text",
        unknown_key: true,
      },
    });
    assert.equal(unknownIntentKeyRes.statusCode, 400);
    const unknownIntentKeyPayload = unknownIntentKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(unknownIntentKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(unknownIntentKeyPayload.error.message, /intent body supports only intent_text\|regenerate/i);
  } finally {
    await app.close();
  }
});

test("artifact edit rejects non-object payload shapes", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-artifact-edit-shape-"));
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
        url: "data:text/plain,This%20item%20verifies%20artifact%20edit%20payload%20shape%20validation.",
        title: "Artifact Edit Payload Shape",
        domain: "example.artifact.shape",
        source_type: "web",
        intent_text: "ensure non-object artifact payload is rejected",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const invalidEditRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/todos`,
      payload: {
        payload: [],
      },
    });
    assert.equal(invalidEditRes.statusCode, 400);
    const invalidPayload = invalidEditRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidPayload.error.message, /payload must be a JSON object/i);

    const nonObjectBodyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/todos`,
      payload: [],
    });
    assert.equal(nonObjectBodyRes.statusCode, 400);
    const nonObjectBodyPayload = nonObjectBodyRes.json() as { error: { code: string; message: string } };
    assert.equal(nonObjectBodyPayload.error.code, "VALIDATION_ERROR");
    assert.match(nonObjectBodyPayload.error.message, /request body must be an object/i);

    const unknownArtifactEditKeyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/todos`,
      payload: {
        payload: { todos: [] },
        unknown_key: true,
      },
    });
    assert.equal(unknownArtifactEditKeyRes.statusCode, 400);
    const unknownArtifactEditKeyPayload = unknownArtifactEditKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(unknownArtifactEditKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(unknownArtifactEditKeyPayload.error.message, /artifact edit body supports only payload\|template_version/i);

    const templateVersionTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/todos`,
      payload: {
        payload: { todos: [] },
        template_version: 1234,
      },
    });
    assert.equal(templateVersionTypeRes.statusCode, 400);
    const templateVersionTypePayload = templateVersionTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(templateVersionTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(templateVersionTypePayload.error.message, /template_version must be a string/i);

    const templateVersionBlankRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/todos`,
      payload: {
        payload: { todos: [] },
        template_version: "   ",
      },
    });
    assert.equal(templateVersionBlankRes.statusCode, 400);
    const templateVersionBlankPayload = templateVersionBlankRes.json() as { error: { code: string; message: string } };
    assert.equal(templateVersionBlankPayload.error.code, "VALIDATION_ERROR");
    assert.match(templateVersionBlankPayload.error.message, /template_version must be a non-empty string/i);
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

    const invalidWorkerQueryRes = await app.inject({
      method: "GET",
      url: "/api/system/worker?verbose=true",
    });
    assert.equal(invalidWorkerQueryRes.statusCode, 400);
    const invalidWorkerQueryPayload = invalidWorkerQueryRes.json() as { error: { code: string; message: string } };
    assert.equal(invalidWorkerQueryPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidWorkerQueryPayload.error.message, /worker status does not accept query parameters/i);
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

    const invalidRetryableStringBooleanRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { retryable: "true" },
    });
    assert.equal(invalidRetryableStringBooleanRes.statusCode, 400);
    const invalidRetryableStringBooleanPayload = invalidRetryableStringBooleanRes.json() as {
      error: { code: string; message: string };
    };
    assert.equal(invalidRetryableStringBooleanPayload.error.code, "VALIDATION_ERROR");
    assert.match(invalidRetryableStringBooleanPayload.error.message, /retryable must be true\|false\|null\|all/i);

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

test("single unarchive endpoint enforces archived state and regenerate option", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-unarchive-single-"));
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
        url: "data:text/plain,This%20item%20validates%20single%20unarchive%20endpoint%20flows.",
        title: "Single Unarchive",
        domain: "example.unarchive.single",
        source_type: "web",
        intent_text: "verify single unarchive behavior",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const archiveRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/archive`,
      payload: { reason: "single-unarchive-test" },
    });
    assert.equal(archiveRes.statusCode, 200);

    const unarchiveReadyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/unarchive`,
      payload: { regenerate: false },
    });
    assert.equal(unarchiveReadyRes.statusCode, 200);
    const unarchiveReadyPayload = unarchiveReadyRes.json() as { item: { status: string } };
    assert.equal(unarchiveReadyPayload.item.status, "READY");

    const unarchiveConflictRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/unarchive`,
      payload: { regenerate: false },
    });
    assert.equal(unarchiveConflictRes.statusCode, 409);
    const unarchiveConflictPayload = unarchiveConflictRes.json() as { error: { code: string } };
    assert.equal(unarchiveConflictPayload.error.code, "STATE_CONFLICT");

    const archiveAgainRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/archive`,
      payload: { reason: "single-unarchive-test-regenerate" },
    });
    assert.equal(archiveAgainRes.statusCode, 200);

    const unarchiveQueuedRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/unarchive`,
      payload: { regenerate: true },
    });
    assert.equal(unarchiveQueuedRes.statusCode, 200);
    const unarchiveQueuedPayload = unarchiveQueuedRes.json() as { item: { status: string } };
    assert.equal(unarchiveQueuedPayload.item.status, "QUEUED");
  } finally {
    await app.close();
  }
});

test("archive and unarchive endpoints validate request body shapes", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-archive-unarchive-body-validation-"));
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
        url: "data:text/plain,This%20item%20is%20used%20to%20validate%20archive%20and%20unarchive%20request%20body%20shapes.",
        title: "Archive Body Validation",
        domain: "example.archive.body.validation",
        source_type: "web",
        intent_text: "validate archive and unarchive body validation behavior",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    const archiveBodyTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/archive`,
      payload: [],
    });
    assert.equal(archiveBodyTypeRes.statusCode, 400);
    const archiveBodyTypePayload = archiveBodyTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveBodyTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveBodyTypePayload.error.message, /request body must be an object/i);

    const archiveReasonTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/archive`,
      payload: { reason: 1234 },
    });
    assert.equal(archiveReasonTypeRes.statusCode, 400);
    const archiveReasonTypePayload = archiveReasonTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveReasonTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveReasonTypePayload.error.message, /reason must be a string/i);

    const archiveReasonBlankRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/archive`,
      payload: { reason: "   " },
    });
    assert.equal(archiveReasonBlankRes.statusCode, 400);
    const archiveReasonBlankPayload = archiveReasonBlankRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveReasonBlankPayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveReasonBlankPayload.error.message, /reason must be a non-empty string/i);

    const archiveUnknownKeyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/archive`,
      payload: { reason: "valid reason", foo: "bar" },
    });
    assert.equal(archiveUnknownKeyRes.statusCode, 400);
    const archiveUnknownKeyPayload = archiveUnknownKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveUnknownKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveUnknownKeyPayload.error.message, /archive body supports only reason/i);

    const archiveRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/archive`,
      payload: { reason: "validated reason" },
    });
    assert.equal(archiveRes.statusCode, 200);

    const unarchiveBodyTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/unarchive`,
      payload: [],
    });
    assert.equal(unarchiveBodyTypeRes.statusCode, 400);
    const unarchiveBodyTypePayload = unarchiveBodyTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(unarchiveBodyTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(unarchiveBodyTypePayload.error.message, /request body must be an object/i);

    const unarchiveUnknownKeyRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/unarchive`,
      payload: { regenerate: false, unknown: true },
    });
    assert.equal(unarchiveUnknownKeyRes.statusCode, 400);
    const unarchiveUnknownKeyPayload = unarchiveUnknownKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(unarchiveUnknownKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(unarchiveUnknownKeyPayload.error.message, /unarchive body supports only regenerate/i);
  } finally {
    await app.close();
  }
});

test("batch and unarchive endpoints validate boolean control flags", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-bool-flags-"));
  const app = await createApp({
    dbPath: join(dbDir, "readdo.db"),
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const retryBodyTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: [],
    });
    assert.equal(retryBodyTypeRes.statusCode, 400);
    const retryBodyTypePayload = retryBodyTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(retryBodyTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(retryBodyTypePayload.error.message, /request body must be an object/i);

    const retryUnknownKeyRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { unknown_key: true },
    });
    assert.equal(retryUnknownKeyRes.statusCode, 400);
    const retryUnknownKeyPayload = retryUnknownKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(retryUnknownKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(retryUnknownKeyPayload.error.message, /retry-failed body supports only/i);

    const retryDryRunTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { dry_run: "false" },
    });
    assert.equal(retryDryRunTypeRes.statusCode, 400);
    const retryDryRunTypePayload = retryDryRunTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(retryDryRunTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(retryDryRunTypePayload.error.message, /dry_run must be a boolean/i);

    const retryQTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { q: 1234 },
    });
    assert.equal(retryQTypeRes.statusCode, 400);
    const retryQTypePayload = retryQTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(retryQTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(retryQTypePayload.error.message, /q must be a string/i);

    const retryQBlankRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { q: "   " },
    });
    assert.equal(retryQBlankRes.statusCode, 400);
    const retryQBlankPayload = retryQBlankRes.json() as { error: { code: string; message: string } };
    assert.equal(retryQBlankPayload.error.code, "VALIDATION_ERROR");
    assert.match(retryQBlankPayload.error.message, /q must be a non-empty string/i);

    const retryLimitTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { limit: "20" },
    });
    assert.equal(retryLimitTypeRes.statusCode, 400);
    const retryLimitTypePayload = retryLimitTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(retryLimitTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(retryLimitTypePayload.error.message, /limit must be an integer/i);

    const retryOffsetTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { offset: 1.5 },
    });
    assert.equal(retryOffsetTypeRes.statusCode, 400);
    const retryOffsetTypePayload = retryOffsetTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(retryOffsetTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(retryOffsetTypePayload.error.message, /offset must be an integer/i);

    const retryFailureStepTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { failure_step: ["extract"] },
    });
    assert.equal(retryFailureStepTypeRes.statusCode, 400);
    const retryFailureStepTypePayload = retryFailureStepTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(retryFailureStepTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(retryFailureStepTypePayload.error.message, /failure_step must be a string/i);

    const retryFailureStepValueRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { failure_step: "unknown-step" },
    });
    assert.equal(retryFailureStepValueRes.statusCode, 400);
    const retryFailureStepValuePayload = retryFailureStepValueRes.json() as { error: { code: string; message: string } };
    assert.equal(retryFailureStepValuePayload.error.code, "VALIDATION_ERROR");
    assert.match(retryFailureStepValuePayload.error.message, /failure_step must be extract\|pipeline\|export/i);

    const retryFailureStepBlankRes = await app.inject({
      method: "POST",
      url: "/api/items/retry-failed",
      payload: { failure_step: "   " },
    });
    assert.equal(retryFailureStepBlankRes.statusCode, 400);
    const retryFailureStepBlankPayload = retryFailureStepBlankRes.json() as { error: { code: string; message: string } };
    assert.equal(retryFailureStepBlankPayload.error.code, "VALIDATION_ERROR");
    assert.match(retryFailureStepBlankPayload.error.message, /failure_step must be extract\|pipeline\|export/i);

    const archiveDryRunTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { dry_run: "false" },
    });
    assert.equal(archiveDryRunTypeRes.statusCode, 400);
    const archiveDryRunTypePayload = archiveDryRunTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveDryRunTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveDryRunTypePayload.error.message, /dry_run must be a boolean/i);

    const archiveQTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { q: 5678 },
    });
    assert.equal(archiveQTypeRes.statusCode, 400);
    const archiveQTypePayload = archiveQTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveQTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveQTypePayload.error.message, /q must be a string/i);

    const archiveQBlankRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { q: "   " },
    });
    assert.equal(archiveQBlankRes.statusCode, 400);
    const archiveQBlankPayload = archiveQBlankRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveQBlankPayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveQBlankPayload.error.message, /q must be a non-empty string/i);

    const archiveLimitTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { limit: "50" },
    });
    assert.equal(archiveLimitTypeRes.statusCode, 400);
    const archiveLimitTypePayload = archiveLimitTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveLimitTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveLimitTypePayload.error.message, /limit must be an integer/i);

    const archiveOffsetTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { offset: 2.2 },
    });
    assert.equal(archiveOffsetTypeRes.statusCode, 400);
    const archiveOffsetTypePayload = archiveOffsetTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveOffsetTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveOffsetTypePayload.error.message, /offset must be an integer/i);

    const archiveFailureStepTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { failure_step: ["pipeline"] },
    });
    assert.equal(archiveFailureStepTypeRes.statusCode, 400);
    const archiveFailureStepTypePayload = archiveFailureStepTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveFailureStepTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveFailureStepTypePayload.error.message, /failure_step must be a string/i);

    const archiveFailureStepValueRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { failure_step: "unknown-step" },
    });
    assert.equal(archiveFailureStepValueRes.statusCode, 400);
    const archiveFailureStepValuePayload = archiveFailureStepValueRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveFailureStepValuePayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveFailureStepValuePayload.error.message, /failure_step must be extract\|pipeline\|export/i);

    const archiveFailureStepBlankRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { failure_step: "   " },
    });
    assert.equal(archiveFailureStepBlankRes.statusCode, 400);
    const archiveFailureStepBlankPayload = archiveFailureStepBlankRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveFailureStepBlankPayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveFailureStepBlankPayload.error.message, /failure_step must be extract\|pipeline\|export/i);

    const archiveRetryableBlankStringRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { retryable: "   " },
    });
    assert.equal(archiveRetryableBlankStringRes.statusCode, 400);
    const archiveRetryableBlankStringPayload = archiveRetryableBlankStringRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveRetryableBlankStringPayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveRetryableBlankStringPayload.error.message, /retryable must be true\|false\|null\|all/i);

    const archiveBodyTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: [],
    });
    assert.equal(archiveBodyTypeRes.statusCode, 400);
    const archiveBodyTypePayload = archiveBodyTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveBodyTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveBodyTypePayload.error.message, /request body must be an object/i);

    const archiveUnknownKeyRes = await app.inject({
      method: "POST",
      url: "/api/items/archive-failed",
      payload: { unknown_key: true },
    });
    assert.equal(archiveUnknownKeyRes.statusCode, 400);
    const archiveUnknownKeyPayload = archiveUnknownKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(archiveUnknownKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(archiveUnknownKeyPayload.error.message, /archive-failed body supports only/i);

    const unarchiveBatchDryRunTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { dry_run: "false", regenerate: false },
    });
    assert.equal(unarchiveBatchDryRunTypeRes.statusCode, 400);
    const unarchiveBatchDryRunTypePayload = unarchiveBatchDryRunTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(unarchiveBatchDryRunTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(unarchiveBatchDryRunTypePayload.error.message, /dry_run must be a boolean/i);

    const unarchiveBatchRegenerateTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { dry_run: false, regenerate: "true" },
    });
    assert.equal(unarchiveBatchRegenerateTypeRes.statusCode, 400);
    const unarchiveBatchRegenerateTypePayload = unarchiveBatchRegenerateTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(unarchiveBatchRegenerateTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(unarchiveBatchRegenerateTypePayload.error.message, /regenerate must be a boolean/i);

    const unarchiveBatchQTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { dry_run: false, regenerate: false, q: 9012 },
    });
    assert.equal(unarchiveBatchQTypeRes.statusCode, 400);
    const unarchiveBatchQTypePayload = unarchiveBatchQTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(unarchiveBatchQTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(unarchiveBatchQTypePayload.error.message, /q must be a string/i);

    const unarchiveBatchQBlankRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { dry_run: false, regenerate: false, q: "   " },
    });
    assert.equal(unarchiveBatchQBlankRes.statusCode, 400);
    const unarchiveBatchQBlankPayload = unarchiveBatchQBlankRes.json() as { error: { code: string; message: string } };
    assert.equal(unarchiveBatchQBlankPayload.error.code, "VALIDATION_ERROR");
    assert.match(unarchiveBatchQBlankPayload.error.message, /q must be a non-empty string/i);

    const unarchiveBatchLimitTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { limit: "50" },
    });
    assert.equal(unarchiveBatchLimitTypeRes.statusCode, 400);
    const unarchiveBatchLimitTypePayload = unarchiveBatchLimitTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(unarchiveBatchLimitTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(unarchiveBatchLimitTypePayload.error.message, /limit must be an integer/i);

    const unarchiveBatchOffsetTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { offset: 1.25 },
    });
    assert.equal(unarchiveBatchOffsetTypeRes.statusCode, 400);
    const unarchiveBatchOffsetTypePayload = unarchiveBatchOffsetTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(unarchiveBatchOffsetTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(unarchiveBatchOffsetTypePayload.error.message, /offset must be an integer/i);

    const unarchiveBatchBodyTypeRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: [],
    });
    assert.equal(unarchiveBatchBodyTypeRes.statusCode, 400);
    const unarchiveBatchBodyTypePayload = unarchiveBatchBodyTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(unarchiveBatchBodyTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(unarchiveBatchBodyTypePayload.error.message, /request body must be an object/i);

    const unarchiveBatchUnknownKeyRes = await app.inject({
      method: "POST",
      url: "/api/items/unarchive-batch",
      payload: { unknown_key: true },
    });
    assert.equal(unarchiveBatchUnknownKeyRes.statusCode, 400);
    const unarchiveBatchUnknownKeyPayload = unarchiveBatchUnknownKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(unarchiveBatchUnknownKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(unarchiveBatchUnknownKeyPayload.error.message, /unarchive-batch body supports only/i);

    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20item%20is%20used%20for%20single%20unarchive%20boolean%20flag%20validation.",
        title: "Unarchive Bool Validate",
        domain: "example.unarchive.bool",
        source_type: "web",
        intent_text: "validate single unarchive regenerate type",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    const archiveRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/archive`,
      payload: { reason: "prepare-single-unarchive-validate" },
    });
    assert.equal(archiveRes.statusCode, 200);

    const singleUnarchiveTypeRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/unarchive`,
      payload: { regenerate: "false" },
    });
    assert.equal(singleUnarchiveTypeRes.statusCode, 400);
    const singleUnarchiveTypePayload = singleUnarchiveTypeRes.json() as { error: { code: string; message: string } };
    assert.equal(singleUnarchiveTypePayload.error.code, "VALIDATION_ERROR");
    assert.match(singleUnarchiveTypePayload.error.message, /regenerate must be a boolean/i);
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
    const runOnceNonObjectBodyRes = await app.inject({
      method: "POST",
      url: "/api/system/worker/run-once",
      payload: [],
    });
    assert.equal(runOnceNonObjectBodyRes.statusCode, 400);
    const runOnceNonObjectBodyPayload = runOnceNonObjectBodyRes.json() as { error: { code: string; message: string } };
    assert.equal(runOnceNonObjectBodyPayload.error.code, "VALIDATION_ERROR");
    assert.match(runOnceNonObjectBodyPayload.error.message, /request body must be an object/i);

    const runOnceUnknownBodyKeyRes = await app.inject({
      method: "POST",
      url: "/api/system/worker/run-once",
      payload: { dry_run: true },
    });
    assert.equal(runOnceUnknownBodyKeyRes.statusCode, 400);
    const runOnceUnknownBodyKeyPayload = runOnceUnknownBodyKeyRes.json() as { error: { code: string; message: string } };
    assert.equal(runOnceUnknownBodyKeyPayload.error.code, "VALIDATION_ERROR");
    assert.match(runOnceUnknownBodyKeyPayload.error.message, /run-once does not accept request body fields/i);

    const runOnceUnknownQueryRes = await app.inject({
      method: "POST",
      url: "/api/system/worker/run-once?verbose=true",
    });
    assert.equal(runOnceUnknownQueryRes.statusCode, 400);
    const runOnceUnknownQueryPayload = runOnceUnknownQueryRes.json() as { error: { code: string; message: string } };
    assert.equal(runOnceUnknownQueryPayload.error.code, "VALIDATION_ERROR");
    assert.match(runOnceUnknownQueryPayload.error.message, /run-once does not accept query parameters/i);

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

    const invalidProtocolRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "chrome://extensions",
        source_type: "web",
        intent_text: "unsupported protocol",
      },
    });
    assert.equal(invalidProtocolRes.statusCode, 400);
    assert.match((invalidProtocolRes.json() as { error: { message: string } }).error.message, /url protocol must be http\/https\/data/i);

    const ftpProtocolRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "ftp://example.com/file.txt",
        source_type: "web",
        intent_text: "unsupported ftp protocol",
      },
    });
    assert.equal(ftpProtocolRes.statusCode, 400);
    assert.match((ftpProtocolRes.json() as { error: { message: string } }).error.message, /url protocol must be http\/https\/data/i);

    const dataUrlRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20is%20a%20data%20url%20capture%20used%20for%20local%20testing",
        source_type: "web",
        intent_text: "valid data url/source type",
      },
    });
    assert.equal(dataUrlRes.statusCode, 201);

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
    const validId = (validRes.json() as { item: { id: string } }).item.id;
    const validDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${validId}`,
    });
    assert.equal(validDetailRes.statusCode, 200);
    const validDetail = validDetailRes.json() as { item: { domain: string | null } };
    assert.equal(validDetail.item.domain, "example.com");

    const inferredSourceTypeRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://www.youtube.com/watch?v=test123",
        intent_text: "infer source type from URL",
      },
    });
    assert.equal(inferredSourceTypeRes.statusCode, 201);
    const inferredSourceTypeId = (inferredSourceTypeRes.json() as { item: { id: string } }).item.id;
    const inferredSourceTypeDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${inferredSourceTypeId}`,
    });
    assert.equal(inferredSourceTypeDetailRes.statusCode, 200);
    const inferredSourceTypeDetail = inferredSourceTypeDetailRes.json() as { item: { source_type: string } };
    assert.equal(inferredSourceTypeDetail.item.source_type, "youtube");

    const inferredSourceTypeTrailingDotRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://www.youtube.com./watch?v=test123",
        intent_text: "infer source type from URL with trailing dot hostname",
      },
    });
    assert.equal(inferredSourceTypeTrailingDotRes.statusCode, 201);
    const inferredSourceTypeTrailingDotId = (inferredSourceTypeTrailingDotRes.json() as { item: { id: string } }).item.id;
    const inferredSourceTypeTrailingDotDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${inferredSourceTypeTrailingDotId}`,
    });
    assert.equal(inferredSourceTypeTrailingDotDetailRes.statusCode, 200);
    const inferredSourceTypeTrailingDotDetail = inferredSourceTypeTrailingDotDetailRes.json() as {
      item: { source_type: string };
    };
    assert.equal(inferredSourceTypeTrailingDotDetail.item.source_type, "youtube");

    const inferredShortYoutubeTrailingDotRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://youtu.be./test123",
        intent_text: "infer source type from short youtube trailing-dot hostname",
      },
    });
    assert.equal(inferredShortYoutubeTrailingDotRes.statusCode, 201);
    const inferredShortYoutubeTrailingDotId = (inferredShortYoutubeTrailingDotRes.json() as { item: { id: string } }).item.id;
    const inferredShortYoutubeTrailingDotDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${inferredShortYoutubeTrailingDotId}`,
    });
    assert.equal(inferredShortYoutubeTrailingDotDetailRes.statusCode, 200);
    const inferredShortYoutubeTrailingDotDetail = inferredShortYoutubeTrailingDotDetailRes.json() as {
      item: { source_type: string };
    };
    assert.equal(inferredShortYoutubeTrailingDotDetail.item.source_type, "youtube");

    const falsePositiveYoutubeRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://notyoutube.com/watch?v=test123",
        intent_text: "avoid false-positive youtube host match",
      },
    });
    assert.equal(falsePositiveYoutubeRes.statusCode, 201);
    const falsePositiveYoutubeId = (falsePositiveYoutubeRes.json() as { item: { id: string } }).item.id;
    const falsePositiveYoutubeDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${falsePositiveYoutubeId}`,
    });
    assert.equal(falsePositiveYoutubeDetailRes.statusCode, 200);
    const falsePositiveYoutubeDetail = falsePositiveYoutubeDetailRes.json() as { item: { source_type: string } };
    assert.equal(falsePositiveYoutubeDetail.item.source_type, "web");

    const falsePositiveYoutubeTrailingDotRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://notyoutube.com./watch?v=test123",
        intent_text: "avoid false-positive youtube trailing-dot host match",
      },
    });
    assert.equal(falsePositiveYoutubeTrailingDotRes.statusCode, 201);
    const falsePositiveYoutubeTrailingDotId = (falsePositiveYoutubeTrailingDotRes.json() as { item: { id: string } }).item.id;
    const falsePositiveYoutubeTrailingDotDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${falsePositiveYoutubeTrailingDotId}`,
    });
    assert.equal(falsePositiveYoutubeTrailingDotDetailRes.statusCode, 200);
    const falsePositiveYoutubeTrailingDotDetail = falsePositiveYoutubeTrailingDotDetailRes.json() as {
      item: { source_type: string };
    };
    assert.equal(falsePositiveYoutubeTrailingDotDetail.item.source_type, "web");

    const inferredNewsletterRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://writer.substack.com/p/weekly-brief",
        intent_text: "infer newsletter source type from URL",
      },
    });
    assert.equal(inferredNewsletterRes.statusCode, 201);
    const inferredNewsletterId = (inferredNewsletterRes.json() as { item: { id: string } }).item.id;
    const inferredNewsletterDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${inferredNewsletterId}`,
    });
    assert.equal(inferredNewsletterDetailRes.statusCode, 200);
    const inferredNewsletterDetail = inferredNewsletterDetailRes.json() as { item: { source_type: string } };
    assert.equal(inferredNewsletterDetail.item.source_type, "newsletter");

    const inferredNewsletterTrailingDotRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://writer.substack.com./p/weekly-brief",
        intent_text: "infer newsletter source type from trailing-dot hostname",
      },
    });
    assert.equal(inferredNewsletterTrailingDotRes.statusCode, 201);
    const inferredNewsletterTrailingDotId = (inferredNewsletterTrailingDotRes.json() as { item: { id: string } }).item.id;
    const inferredNewsletterTrailingDotDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${inferredNewsletterTrailingDotId}`,
    });
    assert.equal(inferredNewsletterTrailingDotDetailRes.statusCode, 200);
    const inferredNewsletterTrailingDotDetail = inferredNewsletterTrailingDotDetailRes.json() as {
      item: { source_type: string };
    };
    assert.equal(inferredNewsletterTrailingDotDetail.item.source_type, "newsletter");

    const falsePositiveNewsletterRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://notnewsletter.com/p/weekly-brief",
        intent_text: "avoid false-positive newsletter host match",
      },
    });
    assert.equal(falsePositiveNewsletterRes.statusCode, 201);
    const falsePositiveNewsletterId = (falsePositiveNewsletterRes.json() as { item: { id: string } }).item.id;
    const falsePositiveNewsletterDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${falsePositiveNewsletterId}`,
    });
    assert.equal(falsePositiveNewsletterDetailRes.statusCode, 200);
    const falsePositiveNewsletterDetail = falsePositiveNewsletterDetailRes.json() as { item: { source_type: string } };
    assert.equal(falsePositiveNewsletterDetail.item.source_type, "web");

    const inferredDataSourceRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,source-type-infer-data",
        intent_text: "infer fallback source type for data URL",
      },
    });
    assert.equal(inferredDataSourceRes.statusCode, 201);
    const inferredDataSourceId = (inferredDataSourceRes.json() as { item: { id: string } }).item.id;
    const inferredDataSourceDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${inferredDataSourceId}`,
    });
    assert.equal(inferredDataSourceDetailRes.statusCode, 200);
    const inferredDataSourceDetail = inferredDataSourceDetailRes.json() as { item: { source_type: string } };
    assert.equal(inferredDataSourceDetail.item.source_type, "other");

    const normalizedSourceTypeRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com/source-normalize",
        source_type: "WEB",
        intent_text: "validate source type normalization",
      },
    });
    assert.equal(normalizedSourceTypeRes.statusCode, 201);
    const normalizedId = (normalizedSourceTypeRes.json() as { item: { id: string } }).item.id;
    const normalizedDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${normalizedId}`,
    });
    assert.equal(normalizedDetailRes.statusCode, 200);
    const normalizedDetail = normalizedDetailRes.json() as { item: { source_type: string } };
    assert.equal(normalizedDetail.item.source_type, "web");

    const normalizedDomainRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com/domain-normalize",
        domain: "Example.ORG",
        source_type: "web",
        intent_text: "validate domain normalization",
      },
    });
    assert.equal(normalizedDomainRes.statusCode, 201);
    const normalizedDomainId = (normalizedDomainRes.json() as { item: { id: string } }).item.id;
    const normalizedDomainDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${normalizedDomainId}`,
    });
    assert.equal(normalizedDomainDetailRes.statusCode, 200);
    const normalizedDomainDetail = normalizedDomainDetailRes.json() as { item: { domain: string | null } };
    assert.equal(normalizedDomainDetail.item.domain, "example.com");

    const normalizedTrailingDotDomainRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://Example.COM./domain-normalize-dot",
        source_type: "web",
        intent_text: "validate domain normalization removes trailing dot",
      },
    });
    assert.equal(normalizedTrailingDotDomainRes.statusCode, 201);
    const normalizedTrailingDotDomainId = (normalizedTrailingDotDomainRes.json() as { item: { id: string } }).item.id;
    const normalizedTrailingDotDomainDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${normalizedTrailingDotDomainId}`,
    });
    assert.equal(normalizedTrailingDotDomainDetailRes.statusCode, 200);
    const normalizedTrailingDotDomainDetail = normalizedTrailingDotDomainDetailRes.json() as {
      item: { domain: string | null };
    };
    assert.equal(normalizedTrailingDotDomainDetail.item.domain, "example.com");

    const credentialUrlRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://alice:secret@Example.com.:443/private?a=1",
        source_type: "web",
        intent_text: "strip URL credentials before storage",
      },
    });
    assert.equal(credentialUrlRes.statusCode, 201);
    const credentialUrlId = (credentialUrlRes.json() as { item: { id: string } }).item.id;
    const credentialUrlDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${credentialUrlId}`,
    });
    assert.equal(credentialUrlDetailRes.statusCode, 200);
    const credentialUrlDetail = credentialUrlDetailRes.json() as { item: { url: string } };
    assert.equal(credentialUrlDetail.item.url, "https://example.com/private?a=1");

    const httpCredentialUrlRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "http://bob:pwd@Example.com.:80/hello?x=1",
        source_type: "web",
        intent_text: "normalize http credential URL before storage",
      },
    });
    assert.equal(httpCredentialUrlRes.statusCode, 201);
    const httpCredentialUrlId = (httpCredentialUrlRes.json() as { item: { id: string } }).item.id;
    const httpCredentialUrlDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${httpCredentialUrlId}`,
    });
    assert.equal(httpCredentialUrlDetailRes.statusCode, 200);
    const httpCredentialUrlDetail = httpCredentialUrlDetailRes.json() as { item: { url: string } };
    assert.equal(httpCredentialUrlDetail.item.url, "http://example.com/hello?x=1");

    const hashUrlRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com/path?x=1#section-anchor",
        source_type: "web",
        intent_text: "strip hash fragment before URL storage",
      },
    });
    assert.equal(hashUrlRes.statusCode, 201);
    const hashUrlId = (hashUrlRes.json() as { item: { id: string } }).item.id;
    const hashUrlDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${hashUrlId}`,
    });
    assert.equal(hashUrlDetailRes.statusCode, 200);
    const hashUrlDetail = hashUrlDetailRes.json() as { item: { url: string } };
    assert.equal(hashUrlDetail.item.url, "https://example.com/path?x=1");

    const trackingUrlRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://Example.com/path?b=2&utm_source=x&UTM_MEDIUM=z&A=1&FbClId=foo&GcLiD=bar#section",
        source_type: "web",
        intent_text: "strip tracking params and normalize query order before storage",
      },
    });
    assert.equal(trackingUrlRes.statusCode, 201);
    const trackingUrlId = (trackingUrlRes.json() as { item: { id: string } }).item.id;
    const trackingUrlDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${trackingUrlId}`,
    });
    assert.equal(trackingUrlDetailRes.statusCode, 200);
    const trackingUrlDetail = trackingUrlDetailRes.json() as { item: { url: string } };
    assert.equal(trackingUrlDetail.item.url, "https://example.com/path?A=1&b=2");

    const repeatedQueryUrlRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "https://example.com/path?tag=b&x=1&tag=a",
        source_type: "web",
        intent_text: "normalize repeated query param ordering before storage",
      },
    });
    assert.equal(repeatedQueryUrlRes.statusCode, 201);
    const repeatedQueryUrlId = (repeatedQueryUrlRes.json() as { item: { id: string } }).item.id;
    const repeatedQueryUrlDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${repeatedQueryUrlId}`,
    });
    assert.equal(repeatedQueryUrlDetailRes.statusCode, 200);
    const repeatedQueryUrlDetail = repeatedQueryUrlDetailRes.json() as { item: { url: string } };
    assert.equal(repeatedQueryUrlDetail.item.url, "https://example.com/path?tag=a&tag=b&x=1");

    const dataDomainRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,domain-source-for-data-url",
        domain: "Data.Domain.",
        source_type: "web",
        intent_text: "preserve explicit domain for data url",
      },
    });
    assert.equal(dataDomainRes.statusCode, 201);
    const dataDomainId = (dataDomainRes.json() as { item: { id: string } }).item.id;
    const dataDomainDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${dataDomainId}`,
    });
    assert.equal(dataDomainDetailRes.statusCode, 200);
    const dataDomainDetail = dataDomainDetailRes.json() as { item: { domain: string | null } };
    assert.equal(dataDomainDetail.item.domain, "data.domain");

    const dataHashUrlRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,hash-fragment#part",
        source_type: "web",
        intent_text: "strip hash fragment for data URL storage",
      },
    });
    assert.equal(dataHashUrlRes.statusCode, 201);
    const dataHashUrlId = (dataHashUrlRes.json() as { item: { id: string } }).item.id;
    const dataHashUrlDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${dataHashUrlId}`,
    });
    assert.equal(dataHashUrlDetailRes.statusCode, 200);
    const dataHashUrlDetail = dataHashUrlDetailRes.json() as { item: { url: string } };
    assert.equal(dataHashUrlDetail.item.url, "data:text/plain,hash-fragment");

    const dataTrackingUrlRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,query-kept?utm_source=x&b=1#part",
        source_type: "web",
        intent_text: "keep data query parameters while stripping hash",
      },
    });
    assert.equal(dataTrackingUrlRes.statusCode, 201);
    const dataTrackingUrlId = (dataTrackingUrlRes.json() as { item: { id: string } }).item.id;
    const dataTrackingUrlDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${dataTrackingUrlId}`,
    });
    assert.equal(dataTrackingUrlDetailRes.statusCode, 200);
    const dataTrackingUrlDetail = dataTrackingUrlDetailRes.json() as { item: { url: string } };
    assert.equal(dataTrackingUrlDetail.item.url, "data:text/plain,query-kept?utm_source=x&b=1");
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

test("export replay is still allowed after retry limit is reached", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-retry-limit-replay-"));
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
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20export%20replay%20after%20retry%20limit%20is%20reached.",
        title: "Export Replay After Retry Limit",
        domain: "example.export.retry.replay",
        source_type: "web",
        intent_text: "allow replay even after retry limit reached",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const replayableKey = "exp-replay-after-limit";
    const successExportRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: replayableKey, formats: ["md"] },
    });
    assert.equal(successExportRes.statusCode, 200);

    for (let i = 1; i <= 3; i += 1) {
      const exportRes = await app.inject({
        method: "POST",
        url: `/api/items/${itemId}/export`,
        payload: { export_key: `png-fail-replay-${i}`, formats: ["png"] },
      });
      assert.equal(exportRes.statusCode, 500);
    }

    const failedDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(failedDetailRes.statusCode, 200);
    const failedDetail = failedDetailRes.json() as {
      item: { status: string };
      failure: { retryable: boolean; retry_attempts: number; retry_limit: number };
    };
    assert.equal(failedDetail.item.status, "FAILED_EXPORT");
    assert.equal(failedDetail.failure.retryable, false);
    assert.equal(failedDetail.failure.retry_attempts, 3);
    assert.equal(failedDetail.failure.retry_limit, 3);

    const replayRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: replayableKey, formats: ["md"] },
    });
    assert.equal(replayRes.statusCode, 200);
    const replayPayload = replayRes.json() as {
      idempotent_replay: boolean;
      export: { payload: { export_key: string } };
    };
    assert.equal(replayPayload.idempotent_replay, true);
    assert.equal(replayPayload.export.payload.export_key, replayableKey);

    const replayDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(replayDetailRes.statusCode, 200);
    const replayDetail = replayDetailRes.json() as {
      item: { status: string };
      failure?: unknown;
    };
    assert.equal(replayDetail.item.status, "SHIPPED");
    assert.equal(replayDetail.failure, undefined);
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

    const compareUnknownQueryRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}/artifacts/todos/compare?base_version=1&target_version=2&unknown=true`,
    });
    assert.equal(compareUnknownQueryRes.statusCode, 400);
    const compareUnknownQueryPayload = compareUnknownQueryRes.json() as { error: { code: string; message: string } };
    assert.equal(compareUnknownQueryPayload.error.code, "VALIDATION_ERROR");
    assert.match(compareUnknownQueryPayload.error.message, /compare query supports only base_version\|target_version/i);

    const compareBlankVersionRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}/artifacts/todos/compare?base_version=%20%20%20&target_version=2`,
    });
    assert.equal(compareBlankVersionRes.statusCode, 400);
    const compareBlankVersionPayload = compareBlankVersionRes.json() as { error: { code: string; message: string } };
    assert.equal(compareBlankVersionPayload.error.code, "VALIDATION_ERROR");
    assert.match(compareBlankVersionPayload.error.message, /base_version and target_version must be integers >= 1/i);
  } finally {
    await app.close();
  }
});

test("item artifact reads skip malformed artifact payload rows", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-legacy-artifact-json-"));
  const dbPath = join(dbDir, "readdo.db");
  const app = await createApp({
    dbPath,
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20malformed%20artifact%20payload%20compatibility.",
        title: "Legacy Artifact Payload",
        domain: "example.legacy.artifact",
        source_type: "web",
        intent_text: "verify malformed artifact payload does not crash item endpoints",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const beforeRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(beforeRes.statusCode, 200);
    const beforePayload = beforeRes.json() as {
      artifacts: {
        summary: {
          version: number;
          payload: Record<string, unknown>;
        };
      };
    };
    assert.equal(beforePayload.artifacts.summary.version, 1);

    const duplicateSummaryRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/summary`,
      payload: { payload: beforePayload.artifacts.summary.payload },
    });
    assert.equal(duplicateSummaryRes.statusCode, 201);

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("UPDATE artifacts SET payload_json = ? WHERE item_id = ? AND artifact_type = 'summary' AND version = 2").run(
        "{bad-json",
        itemId,
      );
    } finally {
      db.close();
    }

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detailPayload = detailRes.json() as {
      artifacts: {
        summary: {
          version: number;
        };
      };
    };
    assert.equal(detailPayload.artifacts.summary.version, 1);

    const historyRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(historyRes.statusCode, 200);
    const historyPayload = historyRes.json() as {
      artifact_history: {
        summary: Array<{ version: number }>;
      };
    };
    assert.deepEqual(
      historyPayload.artifact_history.summary.map((x) => x.version),
      [1],
    );

    const compareRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}/artifacts/summary/compare?base_version=1&target_version=2`,
    });
    assert.equal(compareRes.statusCode, 500);
    const compareErrPayload = compareRes.json() as { error: { code: string } };
    assert.equal(compareErrPayload.error.code, "DATA_CORRUPTION");
  } finally {
    await app.close();
  }
});

test("item artifact reads skip non-object artifact payload rows", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-legacy-artifact-nonobject-payload-"));
  const dbPath = join(dbDir, "readdo.db");
  const app = await createApp({
    dbPath,
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20non-object%20artifact%20payload%20compatibility.",
        title: "Legacy Non-Object Artifact Payload",
        domain: "example.legacy.artifact.nonobject",
        source_type: "web",
        intent_text: "verify non-object payload is treated as data corruption",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const beforeRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(beforeRes.statusCode, 200);
    const beforePayload = beforeRes.json() as {
      artifacts: {
        summary: {
          payload: Record<string, unknown>;
        };
      };
    };

    const duplicateSummaryRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/summary`,
      payload: { payload: beforePayload.artifacts.summary.payload },
    });
    assert.equal(duplicateSummaryRes.statusCode, 201);

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("UPDATE artifacts SET payload_json = ? WHERE item_id = ? AND artifact_type = 'summary' AND version = 2").run(
        "\"bad-payload-shape\"",
        itemId,
      );
    } finally {
      db.close();
    }

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detailPayload = detailRes.json() as {
      artifacts: {
        summary: {
          version: number;
        };
      };
    };
    assert.equal(detailPayload.artifacts.summary.version, 1);

    const historyRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(historyRes.statusCode, 200);
    const historyPayload = historyRes.json() as {
      artifact_history: {
        summary: Array<{ version: number }>;
      };
    };
    assert.deepEqual(
      historyPayload.artifact_history.summary.map((x) => x.version),
      [1],
    );

    const compareRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}/artifacts/summary/compare?base_version=1&target_version=2`,
    });
    assert.equal(compareRes.statusCode, 500);
    const compareErrPayload = compareRes.json() as { error: { code: string } };
    assert.equal(compareErrPayload.error.code, "DATA_CORRUPTION");
  } finally {
    await app.close();
  }
});

test("item artifact reads degrade malformed artifact meta_json to empty object", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-legacy-artifact-meta-json-"));
  const dbPath = join(dbDir, "readdo.db");
  const app = await createApp({
    dbPath,
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20malformed%20artifact%20meta%20compatibility.",
        title: "Legacy Artifact Meta",
        domain: "example.legacy.artifact.meta",
        source_type: "web",
        intent_text: "verify malformed artifact meta does not hide valid payload",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const beforeRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(beforeRes.statusCode, 200);
    const beforePayload = beforeRes.json() as {
      artifacts: {
        summary: {
          payload: Record<string, unknown>;
        };
      };
    };

    const duplicateSummaryRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/summary`,
      payload: { payload: beforePayload.artifacts.summary.payload },
    });
    assert.equal(duplicateSummaryRes.statusCode, 201);

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("UPDATE artifacts SET meta_json = ? WHERE item_id = ? AND artifact_type = 'summary' AND version = 2").run(
        "{bad-json",
        itemId,
      );
    } finally {
      db.close();
    }

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}?include_history=true`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detailPayload = detailRes.json() as {
      artifacts: {
        summary: {
          version: number;
          meta: Record<string, unknown>;
        };
      };
      artifact_history: {
        summary: Array<{ version: number; meta: Record<string, unknown> }>;
      };
    };
    assert.equal(detailPayload.artifacts.summary.version, 2);
    assert.deepEqual(detailPayload.artifacts.summary.meta, {});
    assert.deepEqual(
      detailPayload.artifact_history.summary.map((x) => x.version),
      [2, 1],
    );
    assert.deepEqual(detailPayload.artifact_history.summary[0]?.meta, {});
  } finally {
    await app.close();
  }
});

test("export falls back to previous valid card when latest card payload is malformed", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-export-card-fallback-"));
  const dbPath = join(dbDir, "readdo.db");
  const app = await createApp({
    dbPath,
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20export%20fallback%20when%20latest%20card%20payload%20is%20malformed.",
        title: "Export Card Fallback",
        domain: "example.export.card.fallback",
        source_type: "web",
        intent_text: "verify export can fallback to previous valid card payload",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    await app.runWorkerOnce();

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detailPayload = detailRes.json() as {
      artifacts: {
        card: {
          payload: Record<string, unknown>;
        };
      };
    };

    const duplicateCardRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/artifacts/card`,
      payload: { payload: detailPayload.artifacts.card.payload },
    });
    assert.equal(duplicateCardRes.statusCode, 201);

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("UPDATE artifacts SET payload_json = ? WHERE item_id = ? AND artifact_type = 'card' AND version = 2").run(
        "{bad-json",
        itemId,
      );
    } finally {
      db.close();
    }

    const exportRes = await app.inject({
      method: "POST",
      url: `/api/items/${itemId}/export`,
      payload: { export_key: "exp-card-fallback", formats: ["md"] },
    });
    assert.equal(exportRes.statusCode, 200);
    const exportPayload = exportRes.json() as {
      item: { status: string };
      idempotent_replay: boolean;
      export: { payload: { files: Array<{ type: string }> } };
    };
    assert.equal(exportPayload.item.status, "SHIPPED");
    assert.equal(exportPayload.idempotent_replay, false);
    assert.ok(exportPayload.export.payload.files.some((x) => x.type === "md"));
  } finally {
    await app.close();
  }
});

test("items endpoints tolerate malformed legacy failure_json payloads", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "readdo-api-legacy-failure-json-"));
  const dbPath = join(dbDir, "readdo.db");
  const app = await createApp({
    dbPath,
    workerIntervalMs: 20,
    startWorker: false,
  });

  try {
    const captureRes = await app.inject({
      method: "POST",
      url: "/api/capture",
      payload: {
        url: "data:text/plain,This%20content%20is%20used%20to%20verify%20legacy%20failure%20payload%20compatibility.",
        title: "Legacy Failure Payload",
        domain: "example.legacy.failure",
        source_type: "web",
        intent_text: "verify malformed failure_json does not crash item endpoints",
      },
    });
    assert.equal(captureRes.statusCode, 201);
    const itemId = (captureRes.json() as { item: { id: string } }).item.id;

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("UPDATE items SET status = 'FAILED_AI', failure_json = ? WHERE id = ?").run("{bad-json", itemId);
    } finally {
      db.close();
    }

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(detailRes.statusCode, 200);
    const detailPayload = detailRes.json() as { item: { id: string }; failure?: unknown };
    assert.equal(detailPayload.item.id, itemId);
    assert.equal(detailPayload.failure, undefined);

    const listRes = await app.inject({
      method: "GET",
      url: "/api/items?status=FAILED_AI",
    });
    assert.equal(listRes.statusCode, 200);
    const listPayload = listRes.json() as { items: Array<{ id: string; failure?: unknown }> };
    const target = listPayload.items.find((x) => x.id === itemId);
    assert.ok(target);
    assert.equal(target?.failure, undefined);

    const db2 = new DatabaseSync(dbPath);
    try {
      db2.prepare("UPDATE items SET status = 'FAILED_AI', failure_json = ? WHERE id = ?").run('"non-object-json-string"', itemId);
    } finally {
      db2.close();
    }

    const nonObjectDetailRes = await app.inject({
      method: "GET",
      url: `/api/items/${itemId}`,
    });
    assert.equal(nonObjectDetailRes.statusCode, 200);
    const nonObjectDetailPayload = nonObjectDetailRes.json() as { item: { id: string }; failure?: unknown };
    assert.equal(nonObjectDetailPayload.item.id, itemId);
    assert.equal(nonObjectDetailPayload.failure, undefined);

    const nonObjectListRes = await app.inject({
      method: "GET",
      url: "/api/items?status=FAILED_AI",
    });
    assert.equal(nonObjectListRes.statusCode, 200);
    const nonObjectListPayload = nonObjectListRes.json() as { items: Array<{ id: string; failure?: unknown }> };
    const nonObjectTarget = nonObjectListPayload.items.find((x) => x.id === itemId);
    assert.ok(nonObjectTarget);
    assert.equal(nonObjectTarget?.failure, undefined);
  } finally {
    await app.close();
  }
});
