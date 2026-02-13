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
    assert.match(text, /id="selectionHint"/u);
    assert.match(text, /Selected: none/u);
    assert.match(text, /Preview Archive/u);
    assert.match(text, /Preview Unarchive/u);
    assert.match(text, /Preview Offset/u);
    assert.match(text, /press \//u);
    assert.match(text, /Press \? for shortcuts/u);
    assert.match(text, /Shortcuts \(\?\)/u);
    assert.match(text, /id="shortcutHintBtn"/u);
    assert.match(text, /aria-expanded="false"/u);
    assert.match(text, /title="Shortcuts: \/ Search · H Toggle Shortcut Guide · J Select next item · K Select previous item · F Focus Mode · A Advanced Panels · V Toggle Detail Mode · P Focus Priority · Shift\+P Focus Priority \(reverse\) · G Edit Context Filters · N Focus Recommended Item · M Run Primary Item Action · O Open Selected Source · Y Copy Selected Source · I Copy Selected Context · B Open First Blocked · X Rescue Last Retry · Shift\+G Clear Step Focus · Esc Clear Step Focus · 1 Focus extract step · 2 Focus pipeline step · 3 Focus export step · 0 Focus unknown step · Alt\+1 Focus Priority Smart · Alt\+2 Focus Priority Query First · Alt\+3 Focus Priority Step First · \[ Previous Recovery Run · \] Next Recovery Run · L Latest Recovery Run · C Clear Filters · Shift\+C Reset Controls · T Toggle Auto Refresh · W Run Worker Once · R Refresh · \? Show shortcuts"/u);
    assert.match(text, /aria-label="Shortcuts: \/ Search · H Toggle Shortcut Guide · J Select next item · K Select previous item · F Focus Mode · A Advanced Panels · V Toggle Detail Mode · P Focus Priority · Shift\+P Focus Priority \(reverse\) · G Edit Context Filters · N Focus Recommended Item · M Run Primary Item Action · O Open Selected Source · Y Copy Selected Source · I Copy Selected Context · B Open First Blocked · X Rescue Last Retry · Shift\+G Clear Step Focus · Esc Clear Step Focus · 1 Focus extract step · 2 Focus pipeline step · 3 Focus export step · 0 Focus unknown step · Alt\+1 Focus Priority Smart · Alt\+2 Focus Priority Query First · Alt\+3 Focus Priority Step First · \[ Previous Recovery Run · \] Next Recovery Run · L Latest Recovery Run · C Clear Filters · Shift\+C Reset Controls · T Toggle Auto Refresh · W Run Worker Once · R Refresh · \? Show shortcuts"/u);
    assert.match(text, /Shortcuts: \/ Search · H Toggle Shortcut Guide · J Select next item · K Select previous item · F Focus Mode · A Advanced Panels · V Toggle Detail Mode · P Focus Priority · Shift\+P Focus Priority \(reverse\) · G Edit Context Filters · N Focus Recommended Item · M Run Primary Item Action · O Open Selected Source · Y Copy Selected Source · I Copy Selected Context · B Open First Blocked · X Rescue Last Retry · Shift\+G Clear Step Focus · Esc Clear Step Focus · 1 Focus extract step · 2 Focus pipeline step · 3 Focus export step · 0 Focus unknown step · Alt\+1 Focus Priority Smart · Alt\+2 Focus Priority Query First · Alt\+3 Focus Priority Step First · \[ Previous Recovery Run · \] Next Recovery Run · L Latest Recovery Run · C Clear Filters · Shift\+C Reset Controls · T Toggle Auto Refresh · W Run Worker Once · R Refresh · \? Show shortcuts/u);
    assert.match(text, /id="shortcutPanelBackdrop"/u);
    assert.match(text, /id="shortcutPanelCloseBtn"/u);
    assert.match(text, /Shortcut Guide/u);
    assert.match(text, /Use these keys to move from reading to doing faster/u);
    assert.match(text, /id="shortcutPanelList"/u);
    assert.match(text, /<kbd>\/<\/kbd><span>Search<\/span>/u);
    assert.match(text, /<kbd>H<\/kbd><span>Toggle Shortcut Guide<\/span>/u);
    assert.match(text, /<kbd>J<\/kbd><span>Select next item<\/span>/u);
    assert.match(text, /<kbd>K<\/kbd><span>Select previous item<\/span>/u);
    assert.match(text, /<kbd>V<\/kbd><span>Toggle Detail Mode<\/span>/u);
    assert.match(text, /<kbd>P<\/kbd><span>Focus Priority<\/span>/u);
    assert.match(text, /<kbd>Shift\+P<\/kbd><span>Focus Priority \(reverse\)<\/span>/u);
    assert.match(text, /<kbd>G<\/kbd><span>Edit Context Filters<\/span>/u);
    assert.match(text, /<kbd>N<\/kbd><span>Focus Recommended Item<\/span>/u);
    assert.match(text, /<kbd>M<\/kbd><span>Run Primary Item Action<\/span>/u);
    assert.match(text, /<kbd>O<\/kbd><span>Open Selected Source<\/span>/u);
    assert.match(text, /<kbd>Y<\/kbd><span>Copy Selected Source<\/span>/u);
    assert.match(text, /<kbd>I<\/kbd><span>Copy Selected Context<\/span>/u);
    assert.match(text, /<kbd>B<\/kbd><span>Open First Blocked<\/span>/u);
    assert.match(text, /<kbd>X<\/kbd><span>Rescue Last Retry<\/span>/u);
    assert.match(text, /<kbd>Shift\+G<\/kbd><span>Clear Step Focus<\/span>/u);
    assert.match(text, /<kbd>Esc<\/kbd><span>Clear Step Focus<\/span>/u);
    assert.match(text, /<kbd>1<\/kbd><span>Focus extract step<\/span>/u);
    assert.match(text, /<kbd>2<\/kbd><span>Focus pipeline step<\/span>/u);
    assert.match(text, /<kbd>3<\/kbd><span>Focus export step<\/span>/u);
    assert.match(text, /<kbd>0<\/kbd><span>Focus unknown step<\/span>/u);
    assert.match(text, /<kbd>Alt\+1<\/kbd><span>Focus Priority Smart<\/span>/u);
    assert.match(text, /<kbd>Alt\+2<\/kbd><span>Focus Priority Query First<\/span>/u);
    assert.match(text, /<kbd>Alt\+3<\/kbd><span>Focus Priority Step First<\/span>/u);
    assert.match(text, /<kbd>\[<\/kbd><span>Previous Recovery Run<\/span>/u);
    assert.match(text, /<kbd>\]<\/kbd><span>Next Recovery Run<\/span>/u);
    assert.match(text, /<kbd>L<\/kbd><span>Latest Recovery Run<\/span>/u);
    assert.match(text, /<kbd>C<\/kbd><span>Clear Filters<\/span>/u);
    assert.match(text, /<kbd>Shift\+C<\/kbd><span>Reset Controls<\/span>/u);
    assert.match(text, /<kbd>T<\/kbd><span>Toggle Auto Refresh<\/span>/u);
    assert.match(text, /<kbd>W<\/kbd><span>Run Worker Once<\/span>/u);
    assert.match(text, /id="queueHighlights"/u);
    assert.match(text, /id="queueFlowPulse"/u);
    assert.match(text, /Pipeline Pulse/u);
    assert.match(text, /Track capture → ship momentum/u);
    assert.match(text, /Flow health:/u);
    assert.match(text, /View Blocked/u);
    assert.match(text, /Open First Blocked/u);
    assert.match(text, /Rescue Last Retry/u);
    assert.match(text, /id="ahaNudge"/u);
    assert.match(text, /Aha Now/u);
    assert.match(text, /spotlight-note/u);
    assert.match(text, /Focus Recommended Item/u);
    assert.match(text, /nudge-actions/u);
    assert.match(text, /id="queueActionBanner"/u);
    assert.match(text, /id="recoveryRadar"/u);
    assert.match(text, /Recovery Radar/u);
    assert.match(text, /history-badge/u);
    assert.match(text, /0\/5/u);
    assert.match(text, /No recovery runs yet/u);
    assert.match(text, /Copy Recovery Summary/u);
    assert.match(text, /Download Summary/u);
    assert.match(text, /Previous Run/u);
    assert.match(text, /Next Run/u);
    assert.match(text, /Latest Run/u);
    assert.match(text, /Clear Radar/u);
    assert.match(text, /id="recoveryRadarTrend"/u);
    assert.match(text, /Trend vs previous/u);
    assert.match(text, /Trend Status/u);
    assert.match(text, /Step failed delta/u);
    assert.match(text, /trendStepDeltaExtractBtn/u);
    assert.match(text, /Click again to clear step filter/u);
    assert.match(text, /Click again to clear failed filter/u);
    assert.match(text, /Edit Context Filters/u);
    assert.match(text, /Focus Priority/u);
    assert.match(text, /trendFocusModeSmartBtn/u);
    assert.match(text, /trendFocusModeQueryFirstBtn/u);
    assert.match(text, /trendFocusModeStepFirstBtn/u);
    assert.match(text, /Query First/u);
    assert.match(text, /Step First/u);
    assert.match(text, /Step focus inactive/u);
    assert.match(text, /Choose a step delta to enable context jump/u);
    assert.match(text, /Auto-pick Search\/Retryable when active/u);
    assert.match(text, /filter-attention/u);
    assert.match(text, /Clear Step Focus/u);
    assert.match(text, /Clear Failed Filter/u);
    assert.match(text, /Filter Context/u);
    assert.match(text, /aria-pressed=/u);
    assert.match(text, /id="recoveryRadarTimeline"/u);
    assert.match(text, /History keeps last 5 recovery runs/u);
    assert.match(text, /Open Sample/u);
    assert.match(text, /Filter Step/u);
    assert.match(text, /recovery-step-grid/u);
    assert.match(text, /id="focusChips"/u);
    assert.match(text, /id="statusLegend"/u);
    assert.match(text, /id="recoveryFocusModeFilter"/u);
    assert.match(text, /Focus Priority: Smart/u);
    assert.match(text, /Focus Priority: Query First/u);
    assert.match(text, /Focus Priority: Step First/u);
    assert.match(text, /title="Focus Priority: Smart\. Auto-pick Search\/Retryable when active, otherwise jump by failed step\."/u);
    assert.match(text, /aria-label="Focus Priority: Smart\. Auto-pick Search\/Retryable when active, otherwise jump by failed step\."/u);
    assert.match(text, /id="detailModeChips"/u);
    assert.match(text, /id="detailSectionNav"/u);
    assert.match(text, /data-focus="ready"/u);
    assert.match(text, /Focus Mode \(F\)/u);
    assert.match(text, /Advanced Panels \(A\)/u);
    assert.match(text, /Aha Snapshot/u);
    assert.match(text, /Quick Actions/u);
    assert.match(text, /Recommended Action/u);
    assert.match(text, /Process & Regenerate/u);
    assert.match(text, /Ship & Export/u);
    assert.match(text, /Maintain Queue/u);
    assert.match(text, /Recovery Playbook/u);
    assert.match(text, /Recovery Priority:/u);
    assert.match(text, /Shipping Playbook/u);
    assert.match(text, /Next Recommended Move/u);
    assert.match(text, /Primary Next Step/u);
    assert.match(text, /id="detailActionBanner"/u);
    assert.match(text, /Queue Recommended/u);
    assert.match(text, /hero-recommendation/u);
    assert.match(text, /detail-hero/u);
    assert.match(text, /hero-kicker/u);
    assert.match(text, /Aha Momentum · Ready to ship now/u);
    assert.match(text, /Blocked Recovery/u);
    assert.match(text, /status-chip/u);
    assert.match(text, /Mirrors global action status/u);
    assert.match(text, /Top actions are pinned in the header/u);
    assert.match(text, /Primary shipping action is already pinned in header/u);
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
