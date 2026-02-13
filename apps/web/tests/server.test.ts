import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join, resolve } from "node:path";
import { AddressInfo } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startWebServer } from "../src/index.js";

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = startWebServer(0);
  await new Promise<void>((resolveReady) => server.once("listening", () => resolveReady()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((err) => {
        if (err) rejectClose(err);
        else resolveClose();
      });
    });
  }
}

test("web root serves inbox html shell", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(baseUrl + "/");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /Read→Do Inbox/u);
    assert.match(text, /从信息堆积到可执行决策/u);
    assert.match(text, /Clear Filters/u);
    assert.match(text, /Preview Retry/u);
    assert.match(text, /Retry Failed/u);
    assert.match(text, /Preview Archive/u);
    assert.match(text, /Preview Unarchive/u);
    assert.match(text, /Preview Offset/u);
    assert.match(text, /press \//u);
    assert.match(text, /id="queueHighlights"/u);
    assert.match(text, /id="focusChips"/u);
    assert.match(text, /id="statusLegend"/u);
    assert.match(text, /id="detailModeChips"/u);
    assert.match(text, /id="detailSectionNav"/u);
    assert.match(text, /data-focus="ready"/u);
    assert.match(text, /Focus Mode \(F\)/u);
    assert.match(text, /Advanced Panels \(A\)/u);
    assert.match(text, /Aha Snapshot/u);
    assert.match(text, /Quick Actions/u);
    assert.match(text, /Process & Regenerate/u);
    assert.match(text, /Ship & Export/u);
    assert.match(text, /Maintain Queue/u);
    assert.match(text, /Recovery Playbook/u);
    assert.match(text, /Shipping Playbook/u);
    assert.match(text, /Export Snapshot/u);
    assert.match(text, /Copy Latest Paths/u);
    assert.match(text, /Artifacts JSON/u);
  });
});

test("exports route serves markdown file content", async () => {
  const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const exportDir = mkdtempSync(join(repoRoot, "exports", "web-test-"));
  const filePath = join(exportDir, "card.md");
  writeFileSync(filePath, "# hello export\n", "utf-8");

  try {
    await withServer(async (baseUrl) => {
      const relative = filePath.replace(repoRoot + "/", "");
      const res = await fetch(baseUrl + "/" + relative);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/markdown; charset=utf-8");
      assert.equal(await res.text(), "# hello export\n");
    });
  } finally {
    rmSync(exportDir, { recursive: true, force: true });
  }
});

test("exports route blocks path traversal", async () => {
  await withServer(async (baseUrl) => {
    const target = new URL(baseUrl);
    const statusCode = await new Promise<number>((resolveStatus, rejectStatus) => {
      const req = httpRequest(
        {
          hostname: target.hostname,
          port: Number(target.port),
          path: "/exports/../package.json",
          method: "GET",
        },
        (res) => {
          resolveStatus(res.statusCode ?? 0);
        },
      );
      req.on("error", rejectStatus);
      req.end();
    });
    assert.equal(statusCode, 403);
  });
});

test("exports route returns 404 for missing file", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(baseUrl + "/exports/not-found-file.md");
    assert.equal(res.status, 404);
  });
});
