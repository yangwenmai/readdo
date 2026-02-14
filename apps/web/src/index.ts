import { existsSync, readFileSync, statSync } from "node:fs";
import { IncomingMessage, ServerResponse, createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.WEB_PORT ?? 5173);
const apiBase = process.env.API_BASE_URL ?? "http://localhost:8787/api";
const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const exportsRoot = resolve(repoRoot, "exports");
const shortcutTriggerKey = "?";
const shortcutGuideItems = [
  { key: "/", label: "Search" },
  { key: "H", label: "Toggle Shortcut Guide" },
  { key: "J", label: "Select next item" },
  { key: "K", label: "Select previous item" },
  { key: "F", label: "Focus Mode" },
  { key: "A", label: "Advanced Panels" },
  { key: "V", label: "Toggle Detail Mode" },
  { key: "P", label: "Focus Priority" },
  { key: "Shift+P", label: "Focus Priority (reverse)" },
  { key: "G", label: "Edit Context Filters" },
  { key: "N", label: "Focus Recommended Item" },
  { key: "Z", label: "Focus Top Aha Item" },
  { key: "Shift+N", label: "Focus Next Aha Candidate" },
  { key: "Alt+N", label: "Focus Previous Aha Candidate" },
  { key: "Shift+Z", label: "Focus 2nd Aha Candidate" },
  { key: "Alt+Z", label: "Toggle Duel Pair" },
  { key: "Q", label: "Run Top Aha Action" },
  { key: "Alt+Q", label: "Run Duel Pair Actions" },
  { key: "Shift+Q", label: "Copy Duel Action Plan" },
  { key: "Shift+S", label: "Copy Duel Snapshot" },
  { key: "Alt+C", label: "Copy Duel Call" },
  { key: "Alt+S", label: "Copy Duel Signals" },
  { key: "Alt+M", label: "Run Duel Call" },
  { key: "Alt+P", label: "Run Signal Protocol" },
  { key: "Alt+L", label: "Run Signal Command" },
  { key: "Alt+Shift+L", label: "Copy Signal Command" },
  { key: "Alt+Shift+P", label: "Copy Signal Protocol" },
  { key: "E", label: "Open Aha Rival" },
  { key: "Shift+E", label: "Copy Aha Duel" },
  { key: "Alt+E", label: "Run Rival Action" },
  { key: "Shift+D", label: "Copy Decision Brief" },
  { key: "Alt+D", label: "Download Decision Brief" },
  { key: "M", label: "Run Primary Item Action" },
  { key: "O", label: "Open Selected Source" },
  { key: "Y", label: "Copy Selected Source" },
  { key: "I", label: "Copy Selected Context" },
  { key: "U", label: "Copy Aha Snapshot" },
  { key: "Shift+U", label: "Download Aha Snapshot" },
  { key: "B", label: "Open First Blocked" },
  { key: "X", label: "Rescue Last Retry" },
  { key: "Shift+G", label: "Clear Step Focus" },
  { key: "Esc", label: "Clear Step Focus" },
  { key: "1", label: "Focus extract step" },
  { key: "2", label: "Focus pipeline step" },
  { key: "3", label: "Focus export step" },
  { key: "0", label: "Focus unknown step" },
  { key: "Alt+1", label: "Focus Priority Smart" },
  { key: "Alt+2", label: "Focus Priority Query First" },
  { key: "Alt+3", label: "Focus Priority Step First" },
  { key: "[", label: "Previous Recovery Run" },
  { key: "]", label: "Next Recovery Run" },
  { key: "L", label: "Latest Recovery Run" },
  { key: "C", label: "Clear Filters" },
  { key: "Shift+C", label: "Reset Controls" },
  { key: "T", label: "Toggle Auto Refresh" },
  { key: "W", label: "Run Worker Once" },
  { key: "R", label: "Refresh" },
  { key: "Shift+R", label: "Reset Aha Cycle" },
  { key: shortcutTriggerKey, label: "Show shortcuts" },
];
const shortcutDiscoveryText = `Press ${shortcutTriggerKey} for shortcuts`;
const shortcutSummaryText =
  "Shortcuts: " + shortcutGuideItems.map((item) => `${item.key} ${item.label}`).join(" · ");
const shortcutHintButtonText = `Shortcuts (${shortcutTriggerKey})`;
const shortcutPanelListHtml = shortcutGuideItems
  .map((item) => `<li><kbd>${item.key}</kbd><span>${item.label}</span></li>`)
  .join("");
const queuePreviewLabels = {
  archive: "Preview Archive",
  retry: "Preview Retry",
  unarchive: "Preview Unarchive",
  next: "Preview Next",
};
const queueBatchLabels = {
  retry: { trigger: "Retry Failed", action: "Retry Failed Batch" },
  archive: { trigger: "Archive Failed", action: "Archive Failed Batch" },
  unarchive: { trigger: "Unarchive Archived", action: "Unarchive Batch" },
};
const queueFlowRailNodeLabels = ["Catch", "Queue", "Process", "Ready", "Ship"];
const queueSpotlightBadgeText = "Aha Now";
const queueNudgeFocusLabel = "Focus Recommended Item";
const queueNudgeFocusTopLabel = "Focus Top Aha (Z)";
const queueNudgeFocusNextLabel = "Focus Next Aha (Shift+N)";
const queueNudgeFocusPrevLabel = "Focus Previous Aha (Alt+N)";
const queueNudgeFocusSecondLabel = "Focus 2nd Aha (Shift+Z)";
const queueNudgeRunTopLabel = "Run Top Aha Action (Q)";
const queueNudgeCopySnapshotLabel = "Copy Aha Snapshot (U)";
const queueNudgeCopyStoryLabel = "Copy Aha Story";
const queueNudgeDownloadSnapshotLabel = "Download Aha Snapshot (Shift+U)";
const queueNudgeResetCycleLabel = "Reset Aha Cycle (Shift+R)";
const queueNudgeCandidatesLabel = "Top Aha Candidates";
const queueNudgeCandidateOpenLabel = "Open Candidate";
const queueNudgeHeatmapLabel = "Aha Heatmap";
const queueNudgeHeatFocusLabel = "Focus";
const queueNudgeHeatMomentumPrefix = "Momentum";
const queueNudgeHeatTrendLabel = "Momentum Trend";
const queueNudgeHeatTrendSeriesLabel = "Hot+Strong";
const queueNudgeStoryLabel = "Aha Storyline";
const queueNudgeDuelLabel = "Aha Duel";
const queueNudgeDuelGapLabel = "Duel Gap";
const queueNudgeDuelEdgeLabel = "Duel Edge";
const queueNudgeDuelCallLabel = "Duel Call";
const queueNudgeDuelCallTrendLabel = "Duel Call Trend";
const queueNudgeDuelCallConfidenceLabel = "Duel Call Confidence";
const queueNudgeDuelCallStabilityLabel = "Duel Call Stability";
const queueNudgeDuelCallRiskLabel = "Duel Call Shift Risk";
const queueNudgeDuelCallSequenceLabel = "Duel Call Sequence";
const queueNudgeDuelSignalLabel = "Duel Signal Index";
const queueNudgeDuelSignalPulseLabel = "Duel Signal Pulse";
const queueNudgeDuelSignalSeriesLabel = "Signal Points";
const queueNudgeDuelSignalVolatilityLabel = "Duel Signal Volatility";
const queueNudgeDuelSignalOutlookLabel = "Duel Signal Outlook";
const queueNudgeDuelSignalRegimeLabel = "Duel Signal Regime";
const queueNudgeDuelSignalConvictionLabel = "Duel Signal Conviction";
const queueNudgeDuelSignalHandoffLabel = "Duel Signal Handoff";
const queueNudgeDuelSignalHandoffTrendLabel = "Duel Signal Handoff Trend";
const queueNudgeDuelSignalHandoffSeriesLabel = "Handoff Points";
const queueNudgeDuelSignalHandoffMomentumLabel = "Duel Signal Handoff Momentum";
const queueNudgeDuelSignalConsensusLabel = "Duel Signal Consensus";
const queueNudgeDuelSignalConsensusTrendLabel = "Duel Signal Consensus Trend";
const queueNudgeDuelSignalConsensusSeriesLabel = "Consensus Points";
const queueNudgeDuelSignalConsensusMomentumLabel = "Duel Signal Consensus Momentum";
const queueNudgeDuelSignalConsensusRiskLabel = "Duel Signal Consensus Risk";
const queueNudgeDuelSignalConsensusStabilityLabel = "Duel Signal Consensus Stability";
const queueNudgeDuelSignalConsensusReadinessLabel = "Duel Signal Consensus Readiness";
const queueNudgeDuelSignalConsensusWindowLabel = "Duel Signal Consensus Window";
const queueNudgeDuelSignalConsensusGuardrailLabel = "Duel Signal Consensus Guardrail";
const queueNudgeDuelSignalConsensusTriggerLabel = "Duel Signal Consensus Trigger";
const queueNudgeDuelSignalConsensusProtocolLabel = "Duel Signal Consensus Protocol";
const queueNudgeDuelSignalConsensusProtocolConfidenceLabel = "Duel Signal Consensus Protocol Confidence";
const queueNudgeDuelSignalConsensusProtocolTrendLabel = "Duel Signal Protocol Trend";
const queueNudgeDuelSignalConsensusProtocolSeriesLabel = "Protocol Confidence Points";
const queueNudgeDuelSignalConsensusProtocolRiskLabel = "Duel Signal Protocol Risk";
const queueNudgeDuelSignalConsensusProtocolRegimeLabel = "Duel Signal Protocol Regime";
const queueNudgeDuelSignalConsensusProtocolCadenceLabel = "Duel Signal Protocol Cadence";
const queueNudgeDuelSignalConsensusProtocolPressureLabel = "Duel Signal Protocol Pressure";
const queueNudgeDuelSignalConsensusProtocolCommandLabel = "Duel Signal Protocol Command";
const queueNudgeDuelSignalConsensusProtocolScriptLabel = "Duel Signal Protocol Script";
const queueNudgeDuelSignalConsensusProtocolScriptLaneLabel = "Duel Signal Script Lane";
const queueNudgeDuelSignalConsensusProtocolScriptChecklistLabel = "Duel Signal Script Checklist";
const queueNudgeDuelSnapshotLabel = "Duel Snapshot";
const queueNudgeDuelTrendLabel = "Duel Gap Trend";
const queueNudgeDuelSeriesLabel = "Lead-Rival";
const queueNudgeDuelPlanLabel = "Duel Action Plan";
const queueNudgeOpenRivalLabel = "Open Rival";
const queueNudgeCopyDuelLabel = "Copy Duel";
const queueNudgeCopyDuelPlanLabel = "Copy Duel Plan (Shift+Q)";
const queueNudgeCopyDuelSnapshotLabel = "Copy Duel Snapshot (Shift+S)";
const queueNudgeRunRivalLabel = "Run Rival Action (Alt+E)";
const queueNudgeToggleDuelLabel = "Toggle Duel Pair (Alt+Z)";
const queueNudgeRunDuelLabel = "Run Duel Pair (Alt+Q)";
const queueNudgeRunDuelCallLabel = "Run Duel Call (Alt+M)";
const queueNudgeRunSignalHandoffLabel = "Run Signal Handoff";
const queueNudgeRunSignalConsensusLabel = "Run Signal Consensus";
const queueNudgeRunSignalProtocolLabel = "Run Signal Protocol (Alt+P)";
const queueNudgeRunSignalCommandLabel = "Run Signal Command (Alt+L)";
const queueNudgeRunSignalScriptLabel = "Run Signal Script";
const queueNudgeCopySignalHandoffLabel = "Copy Signal Handoff";
const queueNudgeCopySignalConsensusLabel = "Copy Signal Consensus";
const queueNudgeCopySignalCommandLabel = "Copy Signal Command (Alt+Shift+L)";
const queueNudgeCopySignalScriptLabel = "Copy Signal Script";
const queueNudgeCopySignalChecklistLabel = "Copy Signal Checklist";
const queueNudgeCopySignalProtocolLabel = "Copy Signal Protocol (Alt+Shift+P)";
const queueNudgeDownloadSignalHandoffLabel = "Download Signal Handoff";
const queueNudgeDownloadSignalConsensusLabel = "Download Signal Consensus";
const queueNudgeDownloadSignalCommandLabel = "Download Signal Command";
const queueNudgeDownloadSignalScriptLabel = "Download Signal Script";
const queueNudgeDownloadSignalChecklistLabel = "Download Signal Checklist";
const queueNudgeDownloadSignalProtocolLabel = "Download Signal Protocol";
const queueNudgeCopyDuelCallLabel = "Copy Duel Call (Alt+C)";
const queueNudgeCopyDuelSignalsLabel = "Copy Duel Signals (Alt+S)";
const queueNudgeCopyBriefLabel = "Copy Decision Brief (Shift+D)";
const queueNudgeDownloadBriefLabel = "Download Decision Brief (Alt+D)";
const queueNudgeBriefLabel = "Decision Brief Preview";
const queueNudgeBriefContextLabel = "Brief Context";
const queueLeadGapLabelPrefix = "Lead Gap";
const queueDuelRoleLabelPrefix = "Duel Role";
const detailStoryLabel = "Queue Storyline";
const detailStoryOpenLeadPrefix = "Open Lead";
const queueNudgePoolPrefix = "Aha pool";
const queueNudgeCycleHint = "Cycle with Shift+N";
const queueRecoveryCopyLabel = "Copy Recovery Summary";
const queueRecoveryClearLabel = "Clear Radar";
const queueRecoveryDownloadLabel = "Download Summary";
const queueRecoveryHistoryHint = "History keeps last 5 recovery runs.";
const queueRecoveryPrevLabel = "Previous Run";
const queueRecoveryNextLabel = "Next Run";
const queueRecoveryLatestLabel = "Latest Run";
const queueRecoveryClearStepLabel = "Clear Step Focus";
const queueRecoveryClearFailedLabel = "Clear Failed Filter";
const queueRecoveryContextLabel = "Filter Context";
const queueRecoveryEditContextLabel = "Edit Context Filters";
const queueRecoveryFocusModePrefix = "Focus Priority";
const queueRecoveryFocusModeSmartHint = "Focus Priority: Smart. Auto-pick Search/Retryable when active, otherwise jump by failed step.";

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Read→Do Inbox</title>
    <style>
      * { box-sizing: border-box; }
      body {
        font-family: Inter, "Segoe UI", Arial, sans-serif;
        margin: 0;
        background:
          radial-gradient(circle at top right, #dbeafe 0%, rgba(219, 234, 254, 0) 45%),
          radial-gradient(circle at top left, #ede9fe 0%, rgba(237, 233, 254, 0) 40%),
          #f4f6fb;
        color: #1f2937;
      }
      header {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px 16px;
        background: linear-gradient(135deg, #0f172a, #1d4ed8 55%, #312e81);
        color: white;
        box-shadow: 0 10px 30px rgba(30, 64, 175, 0.25);
      }
      .header-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .brand h1 { font-size: 22px; margin: 0; letter-spacing: 0.01em; }
      .brand p { margin: 4px 0 0; font-size: 13px; color: #dbeafe; }
      main { display: grid; grid-template-columns: 1.2fr 1fr; gap: 14px; padding: 14px; min-height: calc(100vh - 140px); }
      section {
        background: rgba(255, 255, 255, 0.94);
        border-radius: 14px;
        padding: 14px;
        overflow: auto;
        border: 1px solid rgba(148, 163, 184, 0.2);
        box-shadow: 0 8px 30px rgba(148, 163, 184, 0.16);
      }
      h2 { margin: 0; font-size: 16px; }
      h3 { margin: 12px 0 8px; font-size: 15px; color: #0f172a; }
      .panel-subtitle { margin: 6px 0 10px; font-size: 12px; color: #64748b; }
      .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .controls .muted { color: #e2e8f0; }
      .controls #ahaPulseBtn {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1e3a8a;
        font-weight: 700;
      }
      .controls #ahaPulseBtn.heat-up {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .controls #ahaPulseBtn.heat-down {
        border-color: #fda4af;
        background: #fff1f2;
        color: #be123c;
      }
      .controls #ahaPulseBtn.heat-flat {
        border-color: #cbd5e1;
        background: #f8fafc;
        color: #475569;
      }
      .controls .filter-attention {
        border-color: #60a5fa !important;
        box-shadow: 0 0 0 2px rgba(147, 197, 253, 0.6), 0 6px 16px rgba(37, 99, 235, 0.25);
        animation: filterAttentionPulse 850ms ease-out;
      }
      .shortcut-panel-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.58);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        z-index: 80;
      }
      .shortcut-panel {
        width: min(560px, 100%);
        border-radius: 14px;
        border: 1px solid rgba(148, 163, 184, 0.45);
        background: linear-gradient(165deg, #0b1224 0%, #1e293b 100%);
        color: #e2e8f0;
        box-shadow: 0 20px 48px rgba(15, 23, 42, 0.45);
        padding: 14px;
      }
      .shortcut-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .shortcut-panel-head h3 {
        margin: 0;
        font-size: 16px;
        color: #f8fafc;
      }
      .shortcut-panel .muted {
        color: #cbd5e1;
        margin: 8px 0 10px;
      }
      .shortcut-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 8px;
      }
      .shortcut-list li {
        display: flex;
        align-items: center;
        gap: 10px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 10px;
        padding: 8px 10px;
        background: rgba(15, 23, 42, 0.35);
      }
      .shortcut-list kbd {
        min-width: 26px;
        text-align: center;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        border-radius: 6px;
        border: 1px solid rgba(191, 219, 254, 0.45);
        background: rgba(30, 64, 175, 0.36);
        color: #eff6ff;
        padding: 3px 6px;
      }
      button {
        padding: 7px 11px;
        border-radius: 10px;
        border: 1px solid #cbd5e1;
        background: #fff;
        cursor: pointer;
        color: #0f172a;
        transition: all 120ms ease-in-out;
      }
      button:hover { border-color: #60a5fa; box-shadow: 0 3px 10px rgba(37, 99, 235, 0.2); transform: translateY(-1px); }
      button.primary { background: #0f172a; color: #fff; border-color: #0f172a; }
      input, select {
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        padding: 7px 9px;
        background: #ffffff;
        color: #0f172a;
      }
      .item-card {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 10px 12px;
        margin-bottom: 10px;
        background: linear-gradient(180deg, #ffffff, #f8fafc);
        box-shadow: 0 4px 10px rgba(148, 163, 184, 0.16);
      }
      .item-card.clickable { cursor: pointer; }
      .item-card.clickable:hover { border-color: #93c5fd; box-shadow: 0 10px 24px rgba(59, 130, 246, 0.2); }
      .item-card.is-selected { border-color: #2563eb; box-shadow: 0 12px 28px rgba(37, 99, 235, 0.24); }
      .item-card.priority-read-next { border-left: 4px solid #2563eb; }
      .item-card.priority-worth-it { border-left: 4px solid #7c3aed; }
      .item-card.priority-if-time { border-left: 4px solid #14b8a6; }
      .item-card.priority-default { border-left: 4px solid #94a3b8; }
      .item-card.aha-lead {
        border-color: #86efac;
        box-shadow: 0 12px 28px rgba(34, 197, 94, 0.24);
      }
      .item-card.aha-chase {
        border-color: #93c5fd;
      }
      .item-card.aha-trail {
        border-color: #cbd5e1;
      }
      .item-card.is-spotlight {
        border-color: #93c5fd;
        box-shadow: 0 12px 26px rgba(59, 130, 246, 0.26);
        position: relative;
        overflow: hidden;
        animation: spotlightGlow 2.4s ease-in-out infinite;
      }
      .item-card.is-spotlight::after {
        content: "";
        position: absolute;
        inset: 0 auto auto 0;
        width: 100%;
        height: 2px;
        background: linear-gradient(90deg, rgba(29, 78, 216, 0.85), rgba(56, 189, 248, 0.82));
      }
      .item-card.spotlight-recover::after {
        background: linear-gradient(90deg, rgba(220, 38, 38, 0.9), rgba(251, 191, 36, 0.88));
      }
      .item-card.spotlight-process::after {
        background: linear-gradient(90deg, rgba(124, 58, 237, 0.9), rgba(59, 130, 246, 0.9));
      }
      .item-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 8px; }
      .status-cluster {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .status-chip {
        font-size: 10px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid transparent;
        letter-spacing: 0.02em;
      }
      .status-chip.normal {
        border-color: #bae6fd;
        background: #f0f9ff;
        color: #0c4a6e;
      }
      .status-chip.urgent {
        border-color: #fed7aa;
        background: #fff7ed;
        color: #9a3412;
      }
      .status-chip.blocked {
        border-color: #fecaca;
        background: #fef2f2;
        color: #991b1b;
      }
      .intent { font-weight: 700; margin: 4px 0; color: #0f172a; }
      .spotlight-note {
        margin-top: 6px;
        border: 1px solid #bfdbfe;
        border-radius: 10px;
        background: linear-gradient(145deg, #eff6ff, #f8fafc);
        padding: 6px 8px;
        color: #1e3a8a;
        font-size: 12px;
      }
      .spotlight-note .spotlight-badge {
        display: inline-flex;
        align-items: center;
        padding: 1px 8px;
        border-radius: 999px;
        border: 1px solid #93c5fd;
        background: #dbeafe;
        color: #1d4ed8;
        font-size: 11px;
        font-weight: 700;
        margin-right: 6px;
        animation: spotlightBadgePulse 1.8s ease-in-out infinite;
      }
      .item-card.focus-flash {
        animation: focusFlash 880ms ease-out;
      }
      .muted { color: #64748b; font-size: 12px; }
      .status { font-size: 11px; padding: 3px 9px; border-radius: 999px; letter-spacing: 0.03em; font-weight: 700; border: 1px solid transparent; }
      .status-ready, .status-shipped { background: #dcfce7; color: #166534; border-color: #86efac; }
      .status-failed { background: #fee2e2; color: #991b1b; border-color: #fecaca; }
      .status-processing, .status-queued { background: #dbeafe; color: #1e40af; border-color: #bfdbfe; }
      .status-captured { background: #ede9fe; color: #5b21b6; border-color: #ddd6fe; }
      .status-archived { background: #f1f5f9; color: #334155; border-color: #cbd5e1; }
      .status-default { background: #eef2ff; color: #3730a3; border-color: #e0e7ff; }
      .status-rail {
        margin-top: 7px;
        display: grid;
        gap: 4px;
      }
      .status-rail-track {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 5px;
      }
      .rail-node {
        display: block;
        height: 5px;
        border-radius: 999px;
        background: #e2e8f0;
        transition: all 120ms ease-in-out;
      }
      .rail-node.is-done {
        background: linear-gradient(90deg, #60a5fa, #34d399);
      }
      .rail-node.is-current {
        background: #1d4ed8;
        box-shadow: 0 0 0 1px rgba(29, 78, 216, 0.18), 0 0 0 3px rgba(147, 197, 253, 0.35);
      }
      .status-rail-caption {
        font-size: 11px;
      }
      .insight-pills {
        margin-top: 7px;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .insight-pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        border: 1px solid transparent;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.02em;
        padding: 3px 8px;
      }
      .insight-pill.impact-high {
        border-color: #93c5fd;
        background: #eff6ff;
        color: #1e40af;
      }
      .insight-pill.impact-medium {
        border-color: #c4b5fd;
        background: #f5f3ff;
        color: #5b21b6;
      }
      .insight-pill.impact-low {
        border-color: #99f6e4;
        background: #f0fdfa;
        color: #0f766e;
      }
      .insight-pill.impact-default {
        border-color: #cbd5e1;
        background: #f8fafc;
        color: #475569;
      }
      .insight-pill.urgency-now {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .insight-pill.urgency-soon {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .insight-pill.urgency-later {
        border-color: #d1d5db;
        background: #f8fafc;
        color: #475569;
      }
      .aha-rank-chip {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.02em;
        padding: 3px 8px;
      }
      .aha-rank-chip.rank-top {
        border-color: #93c5fd;
        background: #eff6ff;
        color: #1e3a8a;
      }
      .aha-rank-chip.rank-strong {
        border-color: #c4b5fd;
        background: #f5f3ff;
        color: #5b21b6;
      }
      .duel-role-chip {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.02em;
        padding: 3px 8px;
      }
      .duel-role-chip.role-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .duel-role-chip.role-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .duel-role-chip.role-observer {
        border-color: #d1d5db;
        background: #f8fafc;
        color: #475569;
      }
      .aha-rank-delta {
        margin-left: 4px;
        font-size: 10px;
        font-weight: 700;
      }
      .aha-rank-delta.delta-up {
        color: #166534;
      }
      .aha-rank-delta.delta-down {
        color: #b91c1c;
      }
      .aha-rank-delta.delta-flat {
        color: #475569;
      }
      .aha-gap-line {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.02em;
        padding: 3px 8px;
      }
      .aha-gap-line .label {
        opacity: 0.82;
      }
      .aha-gap-line.gap-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-gap-line.gap-chase {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-gap-line.gap-trail {
        border-color: #d1d5db;
        background: #f8fafc;
        color: #475569;
      }
      .score-meter {
        margin-top: 7px;
        display: grid;
        gap: 4px;
      }
      .score-meter-track {
        height: 6px;
        border-radius: 999px;
        background: #e2e8f0;
        overflow: hidden;
      }
      .score-meter-fill {
        display: block;
        height: 100%;
        width: 0;
        border-radius: inherit;
        transition: width 160ms ease-in-out;
      }
      .score-meter-fill.score-high {
        background: linear-gradient(90deg, #22c55e, #16a34a);
      }
      .score-meter-fill.score-medium {
        background: linear-gradient(90deg, #3b82f6, #2563eb);
      }
      .score-meter-fill.score-low {
        background: linear-gradient(90deg, #f59e0b, #f97316);
      }
      .score-meter-fill.score-unknown {
        background: linear-gradient(90deg, #94a3b8, #64748b);
      }
      .score-meter-label {
        font-size: 11px;
      }
      .freshness-chip {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        border: 1px solid transparent;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.02em;
        padding: 3px 8px;
      }
      .freshness-chip.age-fresh {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .freshness-chip.age-warm {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .freshness-chip.age-stale {
        border-color: #cbd5e1;
        background: #f8fafc;
        color: #475569;
      }
      .aha-index {
        margin-top: 7px;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border-radius: 999px;
        border: 1px solid transparent;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 9px;
      }
      .aha-index-chip {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.92);
        color: #ffffff;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.02em;
        padding: 2px 7px;
      }
      .aha-index.tone-hot {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-index.tone-strong {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-index.tone-warm {
        border-color: #ddd6fe;
        background: #f5f3ff;
        color: #6d28d9;
      }
      .aha-index.tone-cool {
        border-color: #cbd5e1;
        background: #f8fafc;
        color: #475569;
      }
      .next-move-line {
        margin-top: 7px;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border-radius: 999px;
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        color: #1e3a8a;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 9px;
      }
      .next-move-line .next-move-chip {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        background: #1d4ed8;
        color: #ffffff;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.02em;
        padding: 2px 7px;
      }
      .next-move-line.tone-ship {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .next-move-line.tone-ship .next-move-chip {
        background: #16a34a;
      }
      .next-move-line.tone-recover {
        border-color: #fca5a5;
        background: #fff1f2;
        color: #9f1239;
      }
      .next-move-line.tone-recover .next-move-chip {
        background: #e11d48;
      }
      .actions { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
      .actions button:disabled { cursor: not-allowed; opacity: 0.6; transform: none; box-shadow: none; }
      .quick-action-grid {
        margin-top: 8px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .quick-action-group {
        border: 1px solid #dbeafe;
        border-radius: 10px;
        padding: 8px;
        background: #f8fbff;
      }
      .quick-action-group h4 {
        margin: 0 0 4px;
        font-size: 12px;
        color: #1e3a8a;
      }
      .quick-action-group .muted {
        display: block;
        margin-bottom: 6px;
      }
      .quick-action-group .actions {
        margin-top: 0;
      }
      .quick-action-group .actions .primary {
        border-color: #1d4ed8;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.26);
      }
      .action-feedback {
        margin-top: 8px;
      }
      .action-feedback.pending { color: #1d4ed8; }
      .action-feedback.done { color: #166534; }
      .action-feedback.error { color: #b91c1c; }
      .detail-hero {
        position: relative;
        overflow: hidden;
        border-color: rgba(147, 197, 253, 0.65);
        box-shadow: 0 14px 32px rgba(15, 23, 42, 0.14);
      }
      .detail-hero::before {
        content: "";
        position: absolute;
        inset: -48px auto auto -54px;
        width: 180px;
        height: 180px;
        border-radius: 999px;
        filter: blur(2px);
        opacity: 0.55;
        pointer-events: none;
      }
      .detail-hero.hero-ready {
        background: linear-gradient(135deg, #effcf3 0%, #f8fafc 52%, #eefcf2 100%);
      }
      .detail-hero.hero-ready::before {
        background: radial-gradient(circle, rgba(34, 197, 94, 0.38), rgba(187, 247, 208, 0));
      }
      .detail-hero.hero-failed {
        background: linear-gradient(135deg, #fff1f1 0%, #fff7ed 52%, #fff8f8 100%);
      }
      .detail-hero.hero-failed::before {
        background: radial-gradient(circle, rgba(248, 113, 113, 0.42), rgba(254, 226, 226, 0));
      }
      .detail-hero.hero-processing {
        background: linear-gradient(135deg, #eff6ff 0%, #f5f3ff 52%, #eef5ff 100%);
      }
      .detail-hero.hero-processing::before {
        background: radial-gradient(circle, rgba(59, 130, 246, 0.42), rgba(219, 234, 254, 0));
      }
      .detail-hero.hero-captured {
        background: linear-gradient(135deg, #f5f3ff 0%, #eef2ff 52%, #f8fafc 100%);
      }
      .detail-hero.hero-captured::before {
        background: radial-gradient(circle, rgba(139, 92, 246, 0.4), rgba(221, 214, 254, 0));
      }
      .detail-hero.hero-archived {
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 52%, #eef2f7 100%);
      }
      .detail-hero.hero-archived::before {
        background: radial-gradient(circle, rgba(148, 163, 184, 0.42), rgba(226, 232, 240, 0));
      }
      .detail-hero.hero-default {
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 52%, #eef2ff 100%);
      }
      .detail-hero.hero-default::before {
        background: radial-gradient(circle, rgba(99, 102, 241, 0.32), rgba(224, 231, 255, 0));
      }
      .hero-kicker {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid rgba(59, 130, 246, 0.28);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.78);
        color: #1e3a8a;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.01em;
        padding: 4px 9px;
      }
      .hero-actions {
        margin-top: 8px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }
      .hero-actions .muted {
        width: 100%;
      }
      .hero-recommendation {
        width: 100%;
        border: 1px dashed #93c5fd;
        border-radius: 10px;
        background: #eff6ff;
        color: #1e3a8a;
        font-size: 12px;
        padding: 6px 8px;
        animation: recommendationPulse 2.4s ease-in-out infinite;
      }
      .hero-recommendation strong {
        font-weight: 700;
      }
      .hero-actions button.primary.recommended {
        box-shadow: 0 0 0 2px rgba(147, 197, 253, 0.65), 0 6px 16px rgba(37, 99, 235, 0.3);
      }
      .hero-story {
        margin-top: 8px;
        border: 1px dashed rgba(147, 197, 253, 0.8);
        border-radius: 10px;
        background: rgba(239, 246, 255, 0.85);
        padding: 8px 10px;
      }
      .hero-story .label {
        font-size: 11px;
        color: #1e3a8a;
        font-weight: 700;
      }
      .hero-story .body {
        margin-top: 4px;
        font-size: 12px;
        color: #1e293b;
        line-height: 1.45;
      }
      .hero-story .hero-duel {
        margin-top: 6px;
        border: 1px dashed rgba(148, 163, 184, 0.55);
        border-radius: 8px;
        background: rgba(248, 250, 252, 0.9);
        padding: 6px 8px;
        font-size: 11px;
        color: #334155;
        line-height: 1.4;
      }
      .hero-story .duel-gap-pill {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-gap-pill.gap-tight {
        border-color: #fda4af;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-gap-pill.gap-balanced {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-gap-pill.gap-wide {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-edge-pill {
        margin-top: 6px;
        margin-left: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-edge-pill.edge-close {
        border-color: #fda4af;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-edge-pill.edge-mid {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-edge-pill.edge-strong {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-call-pill {
        margin-top: 6px;
        margin-left: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-call-pill.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-call-pill.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-call-pill.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-call-trend-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-call-trend-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-call-trend-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-call-trend-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-call-confidence-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-call-confidence-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-call-confidence-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-call-confidence-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-call-stability-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-call-stability-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-call-stability-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-call-stability-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-call-risk-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-call-risk-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-call-risk-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-call-risk-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-call-sequence-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-call-sequence-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-call-sequence-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-call-sequence-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-pulse-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-pulse-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-pulse-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-pulse-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-volatility-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-volatility-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-volatility-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-volatility-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-outlook-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-outlook-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-outlook-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-outlook-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-regime-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-regime-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-regime-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-regime-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-conviction-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-conviction-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-conviction-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-conviction-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-handoff-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-handoff-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-handoff-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-handoff-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-handoff-trend-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-handoff-trend-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-handoff-trend-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-handoff-trend-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-handoff-momentum-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-handoff-momentum-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-handoff-momentum-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-handoff-momentum-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-trend-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-trend-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-trend-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-trend-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-momentum-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-momentum-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-momentum-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-momentum-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-risk-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-risk-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-risk-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-risk-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-stability-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-stability-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-stability-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-stability-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-readiness-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-readiness-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-readiness-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-readiness-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-window-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-window-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-window-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-window-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-guardrail-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-guardrail-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-guardrail-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-guardrail-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-trigger-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-trigger-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-trigger-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-trigger-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-protocol-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-protocol-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-protocol-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-confidence-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-protocol-confidence-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-protocol-confidence-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-protocol-confidence-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-trend-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-protocol-trend-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-protocol-trend-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-protocol-trend-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-risk-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-protocol-risk-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-protocol-risk-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-protocol-risk-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-regime-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-protocol-regime-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-protocol-regime-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-protocol-regime-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-cadence-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-protocol-cadence-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-protocol-cadence-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-protocol-cadence-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-pressure-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-protocol-pressure-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-protocol-pressure-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-protocol-pressure-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-command-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-protocol-command-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-protocol-command-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-protocol-command-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-script-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-protocol-script-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-protocol-script-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-protocol-script-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-script-lane-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px dashed #cbd5e1;
        background: linear-gradient(90deg, #f8fafc 0%, #f1f5f9 100%);
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-signal-consensus-protocol-script-lane-inline.call-lead {
        border-color: #86efac;
        background: linear-gradient(90deg, #ecfdf5 0%, #dcfce7 100%);
        color: #166534;
      }
      .hero-story .duel-signal-consensus-protocol-script-lane-inline.call-rival {
        border-color: #bfdbfe;
        background: linear-gradient(90deg, #eff6ff 0%, #dbeafe 100%);
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-protocol-script-lane-inline.call-hold {
        border-color: #fecaca;
        background: linear-gradient(90deg, #fff1f2 0%, #ffe4e6 100%);
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-script-checklist-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 10px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 5px 9px;
      }
      .hero-story .duel-signal-consensus-protocol-script-checklist-inline.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-signal-consensus-protocol-script-checklist-inline.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-signal-consensus-protocol-script-checklist-inline.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-signal-consensus-protocol-chart-inline {
        margin-top: 6px;
        display: grid;
        gap: 4px;
      }
      .hero-story .duel-signal-consensus-protocol-chart-inline .meta {
        font-size: 11px;
        color: #334155;
      }
      .hero-story .duel-signal-consensus-protocol-chart-inline .bars {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        min-height: 26px;
      }
      .hero-story .duel-signal-consensus-protocol-chart-inline .bar {
        border-radius: 6px 6px 4px 4px;
        border: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #e2e8f0, #f8fafc);
        min-height: 8px;
      }
      .hero-story .duel-signal-consensus-protocol-chart-inline .bar.high {
        border-color: #86efac;
        background: linear-gradient(180deg, #bbf7d0, #ecfdf5);
      }
      .hero-story .duel-signal-consensus-protocol-chart-inline .bar.low {
        border-color: #fda4af;
        background: linear-gradient(180deg, #ffe4e6, #fff1f2);
      }
      .hero-story .duel-signal-consensus-chart-inline {
        margin-top: 6px;
        display: grid;
        gap: 4px;
      }
      .hero-story .duel-signal-consensus-chart-inline .meta {
        font-size: 11px;
        color: #334155;
      }
      .hero-story .duel-signal-consensus-chart-inline .bars {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        min-height: 26px;
      }
      .hero-story .duel-signal-consensus-chart-inline .bar {
        border-radius: 6px 6px 4px 4px;
        border: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #e2e8f0, #f8fafc);
        min-height: 8px;
      }
      .hero-story .duel-signal-consensus-chart-inline .bar.high {
        border-color: #86efac;
        background: linear-gradient(180deg, #bbf7d0, #ecfdf5);
      }
      .hero-story .duel-signal-consensus-chart-inline .bar.low {
        border-color: #fda4af;
        background: linear-gradient(180deg, #ffe4e6, #fff1f2);
      }
      .hero-story .duel-signal-handoff-chart-inline {
        margin-top: 6px;
        display: grid;
        gap: 4px;
      }
      .hero-story .duel-signal-handoff-chart-inline .meta {
        font-size: 11px;
        color: #334155;
      }
      .hero-story .duel-signal-handoff-chart-inline .bars {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        min-height: 26px;
      }
      .hero-story .duel-signal-handoff-chart-inline .bar {
        border-radius: 6px 6px 4px 4px;
        border: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #e2e8f0, #f8fafc);
        min-height: 8px;
      }
      .hero-story .duel-signal-handoff-chart-inline .bar.high {
        border-color: #86efac;
        background: linear-gradient(180deg, #bbf7d0, #ecfdf5);
      }
      .hero-story .duel-signal-handoff-chart-inline .bar.low {
        border-color: #fda4af;
        background: linear-gradient(180deg, #ffe4e6, #fff1f2);
      }
      .hero-story .duel-signal-chart-inline {
        margin-top: 6px;
        display: grid;
        gap: 4px;
      }
      .hero-story .duel-signal-chart-inline .meta {
        font-size: 11px;
        color: #334155;
      }
      .hero-story .duel-signal-chart-inline .bars {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        min-height: 26px;
      }
      .hero-story .duel-signal-chart-inline .bar {
        border-radius: 6px 6px 4px 4px;
        border: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #e2e8f0, #f8fafc);
        min-height: 8px;
      }
      .hero-story .duel-signal-chart-inline .bar.high {
        border-color: #86efac;
        background: linear-gradient(180deg, #bbf7d0, #ecfdf5);
      }
      .hero-story .duel-signal-chart-inline .bar.low {
        border-color: #fda4af;
        background: linear-gradient(180deg, #ffe4e6, #fff1f2);
      }
      .hero-story .duel-snapshot-inline {
        margin-top: 6px;
        border-radius: 8px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        line-height: 1.42;
        padding: 6px 8px;
      }
      .hero-story .duel-trend-inline {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .hero-story .duel-trend-inline.edge-close {
        border-color: #fda4af;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .duel-trend-inline.edge-mid {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-trend-inline.edge-strong {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-plan-inline {
        margin-top: 6px;
        border-radius: 8px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        line-height: 1.42;
        padding: 6px 8px;
      }
      .hero-story .duel-plan-inline .muted {
        font-size: 11px;
      }
      .hero-story .duel-plan-inline.plan-ready {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .hero-story .duel-plan-inline.plan-partial {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .hero-story .duel-plan-inline.plan-empty {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .hero-story .hero-brief {
        margin-top: 6px;
        border: 1px dashed rgba(148, 163, 184, 0.55);
        border-radius: 8px;
        background: rgba(248, 250, 252, 0.92);
        padding: 6px 8px;
        font-size: 11px;
        color: #334155;
        line-height: 1.42;
        white-space: pre-line;
      }
      .hero-story-actions {
        margin-top: 6px;
        display: inline-flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .hero-story-actions button {
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 11px;
      }
      .group-title {
        margin: 12px 0 6px;
        font-size: 13px;
        color: #334155;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 700;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .group-title .section-chip {
        padding: 3px 8px;
        font-size: 11px;
      }
      .aha-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
      .focus-chips {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin: 6px 0 10px;
      }
      .focus-chip {
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        color: #1e3a8a;
        border-radius: 999px;
        padding: 5px 10px;
        font-size: 12px;
      }
      .focus-chip.active {
        border-color: #1d4ed8;
        background: #1d4ed8;
        color: #ffffff;
      }
      .section-chip {
        border: 1px solid #cbd5e1;
        background: #ffffff;
        color: #1e293b;
        border-radius: 999px;
        padding: 5px 10px;
        font-size: 12px;
      }
      .section-chip:hover {
        border-color: #60a5fa;
        color: #1d4ed8;
      }
      .status-legend {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin: 8px 0 10px;
      }
      .queue-flow-pulse {
        border: 1px solid #c7d2fe;
        border-radius: 12px;
        background: linear-gradient(145deg, #eef2ff, #f8fafc);
        padding: 10px;
        margin-bottom: 10px;
      }
      .queue-flow-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      .queue-flow-title {
        margin: 0;
        font-size: 13px;
        color: #312e81;
      }
      .queue-flow-track {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 6px;
      }
      .pulse-segment {
        border-radius: 8px;
        border: 1px solid transparent;
        padding: 7px 8px;
        font-size: 11px;
        text-align: left;
      }
      .pulse-segment .value {
        display: block;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.2;
        margin-top: 2px;
      }
      .pulse-segment .meta {
        display: block;
        margin-top: 2px;
        font-size: 10px;
        opacity: 0.86;
      }
      .pulse-segment.is-empty {
        opacity: 0.75;
      }
      .pulse-segment.active {
        border-color: #1d4ed8;
        box-shadow: 0 5px 14px rgba(37, 99, 235, 0.24);
      }
      .pulse-captured { background: #ede9fe; border-color: #ddd6fe; color: #5b21b6; }
      .pulse-queued { background: #dbeafe; border-color: #bfdbfe; color: #1e40af; }
      .pulse-processing { background: #e0f2fe; border-color: #bae6fd; color: #0c4a6e; }
      .pulse-ready { background: #dcfce7; border-color: #bbf7d0; color: #166534; }
      .pulse-shipped { background: #d1fae5; border-color: #a7f3d0; color: #065f46; }
      .queue-flow-meta {
        margin-top: 8px;
      }
      .queue-flow-meta strong {
        color: #991b1b;
      }
      .queue-flow-meta button {
        margin-left: 8px;
        padding: 4px 8px;
        border-radius: 8px;
        border: 1px solid #fecaca;
        background: #fff1f2;
        color: #b91c1c;
        font-size: 11px;
      }
      .recovery-radar {
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        background: linear-gradient(145deg, #f8fafc, #ffffff);
        padding: 10px;
        margin-bottom: 10px;
      }
      .recovery-radar-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      .recovery-radar-head h4 {
        margin: 0;
        font-size: 13px;
        color: #0f172a;
      }
      .recovery-radar-head .history-badge {
        margin-left: 8px;
        border: 1px solid #bfdbfe;
        border-radius: 999px;
        background: #eff6ff;
        color: #1d4ed8;
        padding: 2px 8px;
        font-size: 10px;
        font-weight: 700;
      }
      .recovery-radar-kpi {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
      }
      .recovery-radar-kpi .cell {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
        padding: 6px 8px;
      }
      .recovery-radar-kpi .label {
        font-size: 10px;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .recovery-radar-kpi .value {
        font-size: 14px;
        font-weight: 700;
        margin-top: 2px;
      }
      .recovery-step-grid {
        margin-top: 8px;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
      }
      .recovery-step {
        border-radius: 8px;
        border: 1px solid #dbe2ea;
        background: #f8fafc;
        padding: 6px 8px;
      }
      .recovery-step .title {
        font-size: 11px;
        font-weight: 700;
        color: #334155;
      }
      .recovery-step .meta {
        margin-top: 2px;
        font-size: 11px;
        color: #64748b;
      }
      .recovery-step button {
        margin-top: 6px;
        width: 100%;
        padding: 4px 8px;
        border-radius: 8px;
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
        font-size: 11px;
      }
      .recovery-step button.secondary {
        border-color: #e2e8f0;
        background: #ffffff;
        color: #334155;
      }
      .recovery-radar-actions {
        margin-top: 8px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .recovery-radar-actions button.secondary {
        border-color: #dbe2ea;
        background: #ffffff;
        color: #334155;
      }
      .recovery-radar-trend {
        margin-top: 8px;
        border: 1px solid #dbe2ea;
        border-radius: 10px;
        background: #ffffff;
        padding: 8px;
      }
      .recovery-radar-trend .trend-head {
        font-size: 11px;
        color: #475569;
      }
      .recovery-radar-trend .trend-status {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 10px;
        font-weight: 700;
      }
      .recovery-radar-trend .trend-status.improving {
        border-color: #86efac;
        background: #dcfce7;
        color: #166534;
      }
      .recovery-radar-trend .trend-status.regressing {
        border-color: #fecaca;
        background: #fef2f2;
        color: #991b1b;
      }
      .recovery-radar-trend .trend-status.flat {
        border-color: #dbe2ea;
        background: #f8fafc;
        color: #334155;
      }
      .recovery-radar-trend .trend-subhead {
        margin-top: 8px;
        font-size: 11px;
        color: #475569;
      }
      .recovery-radar-trend .trend-grid {
        margin-top: 6px;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
      }
      .recovery-radar-trend .trend-cell {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
        padding: 5px 7px;
        font-size: 11px;
        color: #334155;
      }
      .recovery-radar-trend .trend-cell-action {
        text-align: left;
        cursor: pointer;
        width: 100%;
      }
      .recovery-radar-trend .trend-cell-action.active {
        border-color: #1d4ed8;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.22);
      }
      .recovery-radar-trend .trend-cell-action:hover {
        border-color: #93c5fd;
        box-shadow: 0 3px 10px rgba(37, 99, 235, 0.18);
      }
      .recovery-radar-trend .trend-focus-hint {
        margin-top: 8px;
        border: 1px dashed #cbd5e1;
        border-radius: 8px;
        background: #f8fafc;
        padding: 6px 8px;
        font-size: 11px;
        color: #334155;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }
      .recovery-radar-trend .trend-focus-hint .trend-focus-meta {
        width: 100%;
        color: #64748b;
      }
      .recovery-radar-trend .trend-focus-hint .trend-focus-note {
        width: 100%;
        color: #475569;
        font-size: 11px;
      }
      .recovery-radar-trend .trend-focus-hint button {
        padding: 3px 8px;
        border-radius: 8px;
        border: 1px solid #dbe2ea;
        background: #ffffff;
        color: #334155;
        font-size: 11px;
      }
      .recovery-radar-trend .trend-focus-hint button.secondary {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .recovery-radar-trend .trend-focus-hint .trend-focus-mode-group {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .recovery-radar-trend .trend-focus-hint .trend-focus-mode-group .mode-prefix {
        color: #64748b;
        font-size: 11px;
      }
      .recovery-radar-trend .trend-focus-hint .trend-focus-mode-btn {
        border-color: #dbe2ea;
        background: #ffffff;
        color: #475569;
      }
      .recovery-radar-trend .trend-focus-hint .trend-focus-mode-btn.active {
        border-color: #1d4ed8;
        background: #dbeafe;
        color: #1e3a8a;
        box-shadow: 0 4px 10px rgba(37, 99, 235, 0.2);
      }
      .recovery-radar-trend .trend-focus-hint button[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
        box-shadow: none;
      }
      .trend-delta.pos { color: #166534; font-weight: 700; }
      .trend-delta.neg { color: #b91c1c; font-weight: 700; }
      .trend-delta.zero { color: #475569; font-weight: 700; }
      .recovery-radar-timeline {
        margin-top: 8px;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .recovery-radar-timeline .timeline-chip {
        border: 1px solid #dbe2ea;
        border-radius: 999px;
        background: #ffffff;
        color: #334155;
        padding: 4px 10px;
        font-size: 11px;
      }
      .recovery-radar-timeline .timeline-chip.active {
        border-color: #1d4ed8;
        color: #1d4ed8;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.22);
      }
      .legend-item {
        border: 1px solid #dbe2ea;
        border-radius: 999px;
        background: #ffffff;
        color: #334155;
        font-size: 12px;
        padding: 4px 10px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .legend-item.active {
        border-color: #1d4ed8;
        color: #1d4ed8;
        box-shadow: 0 3px 10px rgba(37, 99, 235, 0.22);
      }
      .legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        display: inline-block;
      }
      .legend-dot.ready { background: #22c55e; }
      .legend-dot.failed { background: #ef4444; }
      .legend-dot.processing { background: #3b82f6; }
      .legend-dot.captured { background: #8b5cf6; }
      .legend-dot.shipped { background: #10b981; }
      .legend-dot.archived { background: #94a3b8; }
      .aha-card {
        border: 1px solid #dbeafe;
        border-radius: 12px;
        padding: 10px;
        background: linear-gradient(145deg, #eff6ff, #ffffff);
        min-height: 86px;
      }
      .aha-nudge {
        border: 1px solid #bfdbfe;
        border-radius: 12px;
        background: linear-gradient(145deg, #dbeafe, #eff6ff);
        padding: 10px;
        margin-bottom: 10px;
      }
      .aha-nudge.nudge-recover {
        border-color: #fca5a5;
        background: linear-gradient(145deg, #fee2e2, #fff7ed);
      }
      .aha-nudge.nudge-process {
        border-color: #c4b5fd;
        background: linear-gradient(145deg, #ede9fe, #eff6ff);
      }
      .aha-nudge h4 {
        margin: 0 0 6px;
        color: #1e3a8a;
        font-size: 13px;
      }
      .aha-nudge.nudge-recover h4 {
        color: #991b1b;
      }
      .aha-nudge.nudge-process h4 {
        color: #5b21b6;
      }
      .aha-nudge .muted { margin-bottom: 8px; display: block; color: #334155; }
      .aha-nudge .nudge-context {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed rgba(148, 163, 184, 0.5);
      }
      .aha-nudge .nudge-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .aha-nudge .nudge-actions .secondary {
        border-color: #bfdbfe;
        background: #f8fbff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-candidates {
        margin-top: 8px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }
      .aha-nudge .nudge-heatmap {
        margin-top: 8px;
        border-top: 1px dashed rgba(148, 163, 184, 0.45);
        padding-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .aha-nudge .nudge-heatmap .label {
        font-size: 11px;
        color: #334155;
        font-weight: 700;
      }
      .aha-nudge .nudge-heat-trend {
        width: 100%;
        display: grid;
        gap: 6px;
      }
      .aha-nudge .nudge-heat-trend .meta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #334155;
      }
      .aha-nudge .nudge-heat-trend .trend-bars {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        min-height: 34px;
      }
      .aha-nudge .nudge-heat-trend .trend-bar {
        border-radius: 6px 6px 4px 4px;
        border: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #dbeafe, #eff6ff);
        min-height: 8px;
      }
      .aha-nudge .nudge-heat-trend .trend-bar.peak {
        border-color: #86efac;
        background: linear-gradient(180deg, #bbf7d0, #ecfdf5);
      }
      .aha-nudge .nudge-heat-trend .trend-bar.low {
        border-color: #d8b4fe;
        background: linear-gradient(180deg, #ede9fe, #f5f3ff);
      }
      .aha-nudge .nudge-heat-chip {
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .aha-nudge .nudge-heat-chip button {
        border: 1px solid transparent;
        border-radius: 999px;
        font-size: 10px;
        padding: 2px 6px;
        background: rgba(15, 23, 42, 0.08);
        color: inherit;
      }
      .aha-nudge .nudge-heat-chip button:hover {
        border-color: currentColor;
      }
      .aha-nudge .nudge-heat-delta {
        font-size: 10px;
        font-weight: 800;
      }
      .aha-nudge .nudge-heat-delta.heat-up { color: #166534; }
      .aha-nudge .nudge-heat-delta.heat-down { color: #be123c; }
      .aha-nudge .nudge-heat-delta.heat-flat { color: #475569; }
      .aha-nudge .nudge-heat-momentum {
        font-size: 11px;
        font-weight: 700;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        padding: 4px 8px;
      }
      .aha-nudge .nudge-heat-momentum.heat-up {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-heat-momentum.heat-down {
        border-color: #fda4af;
        background: #fff1f2;
        color: #be123c;
      }
      .aha-nudge .nudge-heat-momentum.heat-flat {
        border-color: #cbd5e1;
        background: #f8fafc;
        color: #475569;
      }
      .aha-nudge .nudge-story {
        margin-top: 8px;
        border-top: 1px dashed rgba(148, 163, 184, 0.45);
        padding-top: 8px;
        display: grid;
        gap: 4px;
      }
      .aha-nudge .nudge-story .label {
        font-size: 11px;
        color: #334155;
        font-weight: 700;
      }
      .aha-nudge .nudge-duel {
        margin-top: 8px;
        border-top: 1px dashed rgba(148, 163, 184, 0.45);
        padding-top: 8px;
        display: grid;
        gap: 6px;
      }
      .aha-nudge .nudge-duel .label {
        font-size: 11px;
        color: #334155;
        font-weight: 700;
      }
      .aha-nudge .nudge-duel .body {
        font-size: 12px;
        color: #1e293b;
        line-height: 1.42;
      }
      .aha-nudge .nudge-duel .actions {
        margin-top: 0;
      }
      .aha-nudge .nudge-brief {
        margin-top: 8px;
        border-top: 1px dashed rgba(148, 163, 184, 0.45);
        padding-top: 8px;
        display: grid;
        gap: 4px;
      }
      .aha-nudge .nudge-brief .label {
        font-size: 11px;
        color: #334155;
        font-weight: 700;
      }
      .aha-nudge .nudge-brief .body {
        font-size: 12px;
        color: #1e293b;
        line-height: 1.45;
        white-space: pre-line;
      }
      .aha-nudge .nudge-duel-gap {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-gap .muted {
        font-size: 11px;
      }
      .aha-nudge .nudge-duel-gap.gap-tight {
        border-color: #fda4af;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-gap.gap-balanced {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-gap.gap-wide {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-edge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-edge.edge-close {
        border-color: #fda4af;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-edge.edge-mid {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-edge.edge-strong {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-call {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-call.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-call.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-call.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-call-trend {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-call-trend.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-call-trend.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-call-trend.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-call-confidence {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-call-confidence.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-call-confidence.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-call-confidence.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-call-stability {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-call-stability.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-call-stability.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-call-stability.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-call-risk {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-call-risk.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-call-risk.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-call-risk.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-call-sequence {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-call-sequence.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-call-sequence.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-call-sequence.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-pulse {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-pulse.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-pulse.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-pulse.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-volatility {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-volatility.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-volatility.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-volatility.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-outlook {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-outlook.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-outlook.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-outlook.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-regime {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-regime.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-regime.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-regime.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-conviction {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-conviction.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-conviction.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-conviction.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-handoff {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-handoff.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-handoff.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-handoff.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-handoff-trend {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-handoff-trend.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-handoff-trend.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-handoff-trend.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-handoff-momentum {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-handoff-momentum.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-handoff-momentum.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-handoff-momentum.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-trend {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-trend.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-trend.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-trend.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-momentum {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-momentum.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-momentum.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-momentum.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-risk {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-risk.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-risk.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-risk.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-stability {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-stability.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-stability.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-stability.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-readiness {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-readiness.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-readiness.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-readiness.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-window {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-window.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-window.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-window.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-guardrail {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-guardrail.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-guardrail.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-guardrail.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-trigger.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-trigger.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-trigger.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-confidence {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-confidence.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-confidence.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-confidence.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-trend {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-trend.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-trend.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-trend.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-risk {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-risk.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-risk.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-risk.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-regime {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-regime.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-regime.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-regime.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-cadence {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-cadence.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-cadence.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-cadence.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-pressure {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-pressure.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-pressure.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-pressure.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-command {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-command.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-command.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-command.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script-lane {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px dashed #cbd5e1;
        background: linear-gradient(90deg, #f8fafc 0%, #f1f5f9 100%);
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script-lane.call-lead {
        border-color: #86efac;
        background: linear-gradient(90deg, #ecfdf5 0%, #dcfce7 100%);
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script-lane.call-rival {
        border-color: #bfdbfe;
        background: linear-gradient(90deg, #eff6ff 0%, #dbeafe 100%);
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script-lane.call-hold {
        border-color: #fecaca;
        background: linear-gradient(90deg, #fff1f2 0%, #ffe4e6 100%);
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script-checklist {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 10px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        padding: 5px 9px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script-checklist.call-lead {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script-checklist.call-rival {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-script-checklist.call-hold {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-chart {
        margin-top: 6px;
        display: grid;
        gap: 4px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-chart .meta {
        font-size: 11px;
        color: #334155;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-chart .bars {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        min-height: 28px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-chart .bar {
        border-radius: 6px 6px 4px 4px;
        border: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #e2e8f0, #f8fafc);
        min-height: 8px;
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-chart .bar.high {
        border-color: #86efac;
        background: linear-gradient(180deg, #bbf7d0, #ecfdf5);
      }
      .aha-nudge .nudge-duel-signal-consensus-protocol-chart .bar.low {
        border-color: #fda4af;
        background: linear-gradient(180deg, #ffe4e6, #fff1f2);
      }
      .aha-nudge .nudge-duel-signal-consensus-chart {
        margin-top: 6px;
        display: grid;
        gap: 4px;
      }
      .aha-nudge .nudge-duel-signal-consensus-chart .meta {
        font-size: 11px;
        color: #334155;
      }
      .aha-nudge .nudge-duel-signal-consensus-chart .bars {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        min-height: 28px;
      }
      .aha-nudge .nudge-duel-signal-consensus-chart .bar {
        border-radius: 6px 6px 4px 4px;
        border: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #e2e8f0, #f8fafc);
        min-height: 8px;
      }
      .aha-nudge .nudge-duel-signal-consensus-chart .bar.high {
        border-color: #86efac;
        background: linear-gradient(180deg, #bbf7d0, #ecfdf5);
      }
      .aha-nudge .nudge-duel-signal-consensus-chart .bar.low {
        border-color: #fda4af;
        background: linear-gradient(180deg, #ffe4e6, #fff1f2);
      }
      .aha-nudge .nudge-duel-signal-handoff-chart {
        margin-top: 6px;
        display: grid;
        gap: 4px;
      }
      .aha-nudge .nudge-duel-signal-handoff-chart .meta {
        font-size: 11px;
        color: #334155;
      }
      .aha-nudge .nudge-duel-signal-handoff-chart .bars {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        min-height: 28px;
      }
      .aha-nudge .nudge-duel-signal-handoff-chart .bar {
        border-radius: 6px 6px 4px 4px;
        border: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #e2e8f0, #f8fafc);
        min-height: 8px;
      }
      .aha-nudge .nudge-duel-signal-handoff-chart .bar.high {
        border-color: #86efac;
        background: linear-gradient(180deg, #bbf7d0, #ecfdf5);
      }
      .aha-nudge .nudge-duel-signal-handoff-chart .bar.low {
        border-color: #fda4af;
        background: linear-gradient(180deg, #ffe4e6, #fff1f2);
      }
      .aha-nudge .nudge-duel-signal-chart {
        margin-top: 6px;
        display: grid;
        gap: 4px;
      }
      .aha-nudge .nudge-duel-signal-chart .meta {
        font-size: 11px;
        color: #334155;
      }
      .aha-nudge .nudge-duel-signal-chart .bars {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        min-height: 28px;
      }
      .aha-nudge .nudge-duel-signal-chart .bar {
        border-radius: 6px 6px 4px 4px;
        border: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #e2e8f0, #f8fafc);
        min-height: 8px;
      }
      .aha-nudge .nudge-duel-signal-chart .bar.high {
        border-color: #86efac;
        background: linear-gradient(180deg, #bbf7d0, #ecfdf5);
      }
      .aha-nudge .nudge-duel-signal-chart .bar.low {
        border-color: #fda4af;
        background: linear-gradient(180deg, #ffe4e6, #fff1f2);
      }
      .aha-nudge .nudge-duel-snapshot {
        margin-top: 6px;
        border-radius: 10px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        padding: 6px 8px;
        display: grid;
        gap: 2px;
      }
      .aha-nudge .nudge-duel-snapshot .label {
        font-size: 11px;
        font-weight: 700;
      }
      .aha-nudge .nudge-duel-snapshot .body {
        font-size: 12px;
        line-height: 1.4;
      }
      .aha-nudge .nudge-duel-plan {
        margin-top: 4px;
        border-radius: 10px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        padding: 6px 8px;
        display: grid;
        gap: 2px;
      }
      .aha-nudge .nudge-duel-plan .label {
        font-size: 11px;
        font-weight: 700;
      }
      .aha-nudge .nudge-duel-plan .body {
        font-size: 12px;
        line-height: 1.4;
      }
      .aha-nudge .nudge-duel-plan .muted {
        font-size: 11px;
      }
      .aha-nudge .nudge-duel-plan.plan-ready {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-duel-plan.plan-partial {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-duel-plan.plan-empty {
        border-color: #fecaca;
        background: #fff1f2;
        color: #9f1239;
      }
      .aha-nudge .nudge-duel-trend {
        margin-top: 6px;
        display: grid;
        gap: 6px;
      }
      .aha-nudge .nudge-duel-trend .meta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #334155;
      }
      .aha-nudge .nudge-duel-trend .bars {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        min-height: 28px;
      }
      .aha-nudge .nudge-duel-trend .bar {
        border-radius: 6px 6px 4px 4px;
        border: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #e2e8f0, #f8fafc);
        min-height: 8px;
      }
      .aha-nudge .nudge-duel-trend .bar.high {
        border-color: #86efac;
        background: linear-gradient(180deg, #bbf7d0, #ecfdf5);
      }
      .aha-nudge .nudge-duel-trend .bar.low {
        border-color: #fda4af;
        background: linear-gradient(180deg, #ffe4e6, #fff1f2);
      }
      .aha-nudge .nudge-heat-chip.tone-hot {
        border-color: #86efac;
        background: #ecfdf5;
        color: #166534;
      }
      .aha-nudge .nudge-heat-chip.tone-strong {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .aha-nudge .nudge-heat-chip.tone-warm {
        border-color: #ddd6fe;
        background: #f5f3ff;
        color: #6d28d9;
      }
      .aha-nudge .nudge-heat-chip.tone-cool {
        border-color: #cbd5e1;
        background: #f8fafc;
        color: #475569;
      }
      .aha-nudge .nudge-pool {
        margin-top: 8px;
        border-top: 1px dashed rgba(148, 163, 184, 0.45);
        padding-top: 8px;
        font-size: 12px;
      }
      .aha-nudge .nudge-candidates .label {
        font-size: 11px;
        color: #334155;
        font-weight: 700;
      }
      .aha-nudge .nudge-candidate-chip {
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        color: #1e3a8a;
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 11px;
        transition: all 120ms ease-in-out;
      }
      .aha-nudge .nudge-candidate-chip.is-top {
        border-color: #93c5fd;
        background: linear-gradient(135deg, #dbeafe, #eff6ff);
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
      }
      .aha-nudge .nudge-candidate-chip:hover {
        border-color: #60a5fa;
        transform: translateY(-1px);
      }
      .aha-label { color: #1e3a8a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
      .aha-value { color: #0f172a; font-size: 24px; font-weight: 800; line-height: 1; }
      .aha-meta { color: #475569; font-size: 12px; margin-top: 6px; }
      .detail-aha .aha-insight {
        font-size: 14px;
        line-height: 1.45;
        color: #0f172a;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 10px;
        padding: 10px;
        margin: 8px 0 10px;
      }
      .detail-aha-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .detail-aha-kpi {
        border: 1px solid #dbeafe;
        border-radius: 10px;
        padding: 8px;
        background: #ffffff;
      }
      .detail-aha-kpi .label {
        color: #1e3a8a;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .detail-aha-kpi .value {
        margin-top: 4px;
        font-size: 14px;
        color: #0f172a;
        font-weight: 700;
      }
      .score-meter {
        height: 8px;
        border-radius: 999px;
        background: #e2e8f0;
        overflow: hidden;
        margin-top: 6px;
      }
      .score-meter-fill {
        height: 100%;
        background: linear-gradient(90deg, #38bdf8, #2563eb);
      }
      .aha-reasons {
        margin: 10px 0 0;
        padding-left: 16px;
      }
      .aha-reasons li {
        color: #334155;
        margin: 4px 0;
        font-size: 12px;
      }
      details.raw-panel {
        border: 1px solid #dbe2ea;
        border-radius: 10px;
        padding: 8px 10px;
        background: #f8fafc;
        margin-top: 8px;
      }
      details.raw-panel > summary {
        cursor: pointer;
        color: #334155;
        font-weight: 700;
      }
      details.detail-section {
        border: 1px solid #dbe2ea;
        border-radius: 12px;
        background: #ffffff;
        margin-top: 10px;
        overflow: hidden;
      }
      details.detail-section > summary {
        cursor: pointer;
        list-style: none;
        padding: 10px 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: linear-gradient(180deg, #f8fafc, #f1f5f9);
      }
      details.detail-section > summary::-webkit-details-marker { display: none; }
      .detail-section-title { font-weight: 700; color: #0f172a; font-size: 14px; }
      .detail-section-subtitle { color: #64748b; font-size: 12px; }
      .detail-section-body { padding: 10px; border-top: 1px solid #e2e8f0; }
      .detail-section-body .item-card { margin: 0; box-shadow: none; }
      pre { background: #0b1020; color: #d1d5db; padding: 8px; border-radius: 8px; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
      .empty { padding: 18px; border: 1px dashed #cbd5e1; border-radius: 10px; color: #64748b; text-align: center; background: #f8fafc; }
      .error { color: #b91c1c; font-size: 13px; }
      textarea { width: 100%; min-height: 180px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .editor-row { display: flex; gap: 8px; margin: 8px 0; align-items: center; flex-wrap: wrap; }
      .hint { font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 8px; margin-top: 6px; }
      .failure-priority {
        margin-top: 6px;
        border-radius: 8px;
        border: 1px solid transparent;
        padding: 6px 8px;
        font-size: 12px;
        font-weight: 700;
      }
      .failure-priority.normal {
        border-color: #bae6fd;
        background: #f0f9ff;
        color: #0c4a6e;
      }
      .failure-priority.urgent {
        border-color: #fed7aa;
        background: #fff7ed;
        color: #9a3412;
      }
      .failure-priority.blocked {
        border-color: #fecaca;
        background: #fef2f2;
        color: #991b1b;
      }
      .coach-card {
        margin-top: 8px;
        border: 1px solid #bfdbfe;
        border-radius: 10px;
        background: #eff6ff;
        padding: 8px;
      }
      .coach-card.blocked {
        border-color: #fca5a5;
        background: #fff1f2;
      }
      .coach-card h4 {
        margin: 0 0 6px;
        font-size: 12px;
        color: #1e3a8a;
      }
      .coach-list {
        margin: 0 0 8px 16px;
        padding: 0;
      }
      .coach-list li {
        margin: 4px 0;
        color: #334155;
        font-size: 12px;
      }
      .diff { font-size: 12px; color: #1f2937; background: #ecfeff; border: 1px solid #a5f3fc; border-radius: 6px; padding: 6px 8px; margin-top: 6px; white-space: pre-wrap; }
      .failure-note { font-size: 12px; color: #991b1b; margin-top: 6px; }
      .file-row { display: flex; gap: 8px; align-items: center; margin: 4px 0; }
      .file-path { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #374151; }
      .export-snapshot {
        border: 1px solid #bfdbfe;
        border-radius: 12px;
        background: linear-gradient(145deg, #eff6ff, #ffffff);
        padding: 10px;
        margin: 8px 0 10px;
      }
      .export-kpi-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }
      .export-kpi {
        border: 1px solid #dbeafe;
        border-radius: 10px;
        background: #ffffff;
        padding: 8px;
      }
      .export-kpi .label {
        color: #1e3a8a;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .export-kpi .value {
        margin-top: 4px;
        font-size: 14px;
        color: #0f172a;
        font-weight: 700;
        word-break: break-word;
      }
      .file-pills {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 8px;
      }
      .file-pill {
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
        border: 1px solid #bfdbfe;
        background: #ffffff;
        color: #1e3a8a;
      }
      .export-row { border-left: 4px solid #bfdbfe; }
      .diff-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
      .diff-column { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px; background: #fafafa; }
      .diff-column h4 { margin: 0 0 6px; font-size: 12px; color: #374151; }
      .diff-column ul { margin: 0; padding-left: 16px; max-height: 160px; overflow: auto; }
      .diff-column li { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      @keyframes spotlightGlow {
        0%, 100% { box-shadow: 0 12px 26px rgba(59, 130, 246, 0.22); }
        50% { box-shadow: 0 16px 34px rgba(37, 99, 235, 0.34); }
      }
      @keyframes spotlightBadgePulse {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-1px); }
      }
      @keyframes focusFlash {
        0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.45); }
        100% { box-shadow: 0 0 0 18px rgba(59, 130, 246, 0); }
      }
      @keyframes recommendationPulse {
        0%, 100% { border-color: #93c5fd; }
        50% { border-color: #60a5fa; }
      }
      @keyframes filterAttentionPulse {
        0% { transform: translateY(0); }
        50% { transform: translateY(-1px); }
        100% { transform: translateY(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .item-card.is-spotlight,
        .spotlight-note .spotlight-badge,
        .hero-recommendation,
        .item-card.focus-flash,
        .controls .filter-attention {
          animation: none !important;
        }
      }
      @media (max-width: 1200px) {
        .aha-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 900px) {
        .detail-aha-grid { grid-template-columns: 1fr; }
        .export-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .quick-action-grid { grid-template-columns: 1fr; }
        .recovery-radar-kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .recovery-step-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .recovery-radar-trend .trend-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 1100px) {
        main { grid-template-columns: 1fr; min-height: auto; }
      }
      @media (max-width: 700px) {
        .aha-strip { grid-template-columns: 1fr; }
        .export-kpi-grid { grid-template-columns: 1fr; }
        .recovery-radar-kpi,
        .recovery-step-grid,
        .recovery-radar-trend .trend-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="header-top">
        <div class="brand">
          <h1>Read→Do Inbox</h1>
          <p>从信息堆积到可执行决策，优先做最值得做的一件事。</p>
        </div>
      </div>
      <div class="controls">
        <span class="muted">API: ${apiBase}</span>
        <span class="muted" id="workerStats">Queue: -</span>
        <span class="muted" id="selectionHint">Selected: none</span>
        <button id="ahaPulseBtn" type="button" title="Aha Pulse: waiting for items. Click focus lead. Shift+Click run lead action. Alt+Click focus #2.">Aha Pulse: —</button>
        <button id="runWorkerBtn" type="button">Run Worker Once</button>
        <button id="previewRetryBtn" type="button">${queuePreviewLabels.retry}</button>
        <button id="previewNextBtn" type="button" style="display:none;">${queuePreviewLabels.next}</button>
        <button id="retryFailedBtn" type="button">${queueBatchLabels.retry.trigger}</button>
        <button id="previewArchiveBtn" type="button">${queuePreviewLabels.archive}</button>
        <button id="archiveBlockedBtn" type="button">${queueBatchLabels.archive.trigger}</button>
        <button id="previewUnarchiveBtn" type="button">${queuePreviewLabels.unarchive}</button>
        <button id="unarchiveBatchBtn" type="button">${queueBatchLabels.unarchive.trigger}</button>
        <label class="muted" style="display:flex;align-items:center;gap:4px;">
          <input id="autoRefreshToggle" type="checkbox" />
          Auto refresh
        </label>
        <input id="queryInput" placeholder="Search title/domain/intent (press /)" />
        <span class="muted">${shortcutDiscoveryText}</span>
        <button id="shortcutHintBtn" type="button" title="${shortcutSummaryText}" aria-label="${shortcutSummaryText}" aria-expanded="false">${shortcutHintButtonText}</button>
        <select id="statusFilter">
          <option value="">All Status</option>
          <option value="CAPTURED">CAPTURED</option>
          <option value="QUEUED">QUEUED</option>
          <option value="PROCESSING">PROCESSING</option>
          <option value="READY">READY</option>
          <option value="FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT">FAILED_*</option>
          <option value="SHIPPED">SHIPPED</option>
          <option value="ARCHIVED">ARCHIVED</option>
        </select>
        <select id="retryableFilter">
          <option value="">Retryable: All</option>
          <option value="true">Retryable: true</option>
          <option value="false">Retryable: false</option>
        </select>
        <select id="failureStepFilter">
          <option value="">Failure Step: All</option>
          <option value="extract">extract</option>
          <option value="pipeline">pipeline</option>
          <option value="export">export</option>
        </select>
        <select id="recoveryFocusModeFilter" title="${queueRecoveryFocusModeSmartHint}" aria-label="${queueRecoveryFocusModeSmartHint}">
          <option value="smart">Focus Priority: Smart</option>
          <option value="query_first">Focus Priority: Query First</option>
          <option value="step_first">Focus Priority: Step First</option>
        </select>
        <select id="archiveRetryableFilter">
          <option value="false">Archive Scope: blocked</option>
          <option value="true">Archive Scope: retryable</option>
          <option value="all">Archive Scope: all failed</option>
        </select>
        <select id="unarchiveModeFilter">
          <option value="smart">Unarchive Mode: smart</option>
          <option value="regenerate">Unarchive Mode: regenerate</option>
        </select>
        <label class="muted" style="display:flex;align-items:center;gap:4px;">
          Batch Limit
          <input id="batchLimitInput" type="number" min="1" max="200" step="1" value="100" style="width:72px;" />
        </label>
        <label class="muted" style="display:flex;align-items:center;gap:4px;">
          Preview Offset
          <input id="previewOffsetInput" type="number" min="0" step="1" value="0" style="width:72px;" />
        </label>
        <button id="clearFiltersBtn" type="button">Clear Filters</button>
        <button id="resetControlsBtn" type="button">Reset Controls</button>
        <button class="primary" id="refreshBtn">Refresh</button>
      </div>
    </header>
    <div id="shortcutPanelBackdrop" class="shortcut-panel-backdrop" hidden>
      <section id="shortcutPanel" class="shortcut-panel" role="dialog" aria-modal="true" aria-labelledby="shortcutPanelTitle">
        <div class="shortcut-panel-head">
          <h3 id="shortcutPanelTitle">Shortcut Guide</h3>
          <button id="shortcutPanelCloseBtn" type="button">Close</button>
        </div>
        <p class="muted">Use these keys to move from reading to doing faster.</p>
        <ul id="shortcutPanelList" class="shortcut-list">${shortcutPanelListHtml}</ul>
      </section>
    </div>
    <main>
      <section>
        <h2>Decision Queue</h2>
        <p class="panel-subtitle">系统会自动提炼优先级与行动项，下面是当前最有产出的执行视图。</p>
        <div id="queueHighlights" class="aha-strip"></div>
        <div id="queueFlowPulse" class="queue-flow-pulse">
          <div class="queue-flow-head">
            <h4 class="queue-flow-title">Pipeline Pulse</h4>
            <span class="muted">Track capture → ship momentum.</span>
          </div>
        </div>
        <div id="ahaNudge" class="aha-nudge"></div>
        <div id="queueActionBanner" class="muted action-feedback">Ready.</div>
        <div id="recoveryRadar" class="recovery-radar">
          <div class="recovery-radar-head">
            <h4>Recovery Radar <span class="history-badge">0/5</span></h4>
            <span class="muted">No recovery runs yet.</span>
          </div>
          <div class="recovery-radar-actions">
            <button type="button" disabled>${queueRecoveryCopyLabel}</button>
            <button type="button" class="secondary" disabled>${queueRecoveryDownloadLabel}</button>
            <button type="button" class="secondary" disabled>${queueRecoveryPrevLabel}</button>
            <button type="button" class="secondary" disabled>${queueRecoveryNextLabel}</button>
            <button type="button" class="secondary" disabled>${queueRecoveryLatestLabel}</button>
            <button type="button" class="secondary" disabled>${queueRecoveryClearLabel}</button>
          </div>
          <div id="recoveryRadarTrend" class="recovery-radar-trend muted">Trend vs previous: —</div>
          <div id="recoveryRadarTimeline" class="recovery-radar-timeline muted">${queueRecoveryHistoryHint}</div>
        </div>
        <div id="focusChips" class="focus-chips">
          <button type="button" class="focus-chip active" data-focus="all">All</button>
          <button type="button" class="focus-chip" data-focus="ready">Ready</button>
          <button type="button" class="focus-chip" data-focus="failed">Failed</button>
          <button type="button" class="focus-chip" data-focus="queued">Queued</button>
          <button type="button" class="focus-chip" data-focus="archived">Archived</button>
        </div>
        <div id="statusLegend" class="status-legend"></div>
        <div id="error" class="error"></div>
        <pre id="retryPreviewOutput" style="display:none;"></pre>
        <div id="inbox"></div>
      </section>
      <section>
        <h2>Detail</h2>
        <p class="panel-subtitle">查看结构化工件、版本差异与导出记录，快速完成从想法到交付。</p>
        <div id="detailModeChips" class="focus-chips">
          <button id="detailFocusModeBtn" type="button" class="focus-chip active">Focus Mode (F)</button>
          <button id="detailAdvancedModeBtn" type="button" class="focus-chip">Advanced Panels (A)</button>
        </div>
        <div id="detailSectionNav" class="focus-chips" style="display:none;"></div>
        <div id="detail" class="empty">Select one item from the list.</div>
      </section>
    </main>
    <script>
      const API_BASE = ${JSON.stringify(apiBase)};
      const SHORTCUT_TRIGGER_KEY = ${JSON.stringify(shortcutTriggerKey)};
      const QUEUE_PREVIEW_LABELS = ${JSON.stringify(queuePreviewLabels)};
      const QUEUE_BATCH_LABELS = ${JSON.stringify(queueBatchLabels)};
      const QUEUE_FLOW_RAIL_NODE_LABELS = ${JSON.stringify(queueFlowRailNodeLabels)};
      const QUEUE_SPOTLIGHT_BADGE_TEXT = ${JSON.stringify(queueSpotlightBadgeText)};
      const QUEUE_NUDGE_FOCUS_LABEL = ${JSON.stringify(queueNudgeFocusLabel)};
      const QUEUE_NUDGE_FOCUS_TOP_LABEL = ${JSON.stringify(queueNudgeFocusTopLabel)};
      const QUEUE_NUDGE_FOCUS_NEXT_LABEL = ${JSON.stringify(queueNudgeFocusNextLabel)};
      const QUEUE_NUDGE_FOCUS_PREV_LABEL = ${JSON.stringify(queueNudgeFocusPrevLabel)};
      const QUEUE_NUDGE_FOCUS_SECOND_LABEL = ${JSON.stringify(queueNudgeFocusSecondLabel)};
      const QUEUE_NUDGE_RUN_TOP_LABEL = ${JSON.stringify(queueNudgeRunTopLabel)};
      const QUEUE_NUDGE_COPY_SNAPSHOT_LABEL = ${JSON.stringify(queueNudgeCopySnapshotLabel)};
      const QUEUE_NUDGE_COPY_STORY_LABEL = ${JSON.stringify(queueNudgeCopyStoryLabel)};
      const QUEUE_NUDGE_DOWNLOAD_SNAPSHOT_LABEL = ${JSON.stringify(queueNudgeDownloadSnapshotLabel)};
      const QUEUE_NUDGE_RESET_CYCLE_LABEL = ${JSON.stringify(queueNudgeResetCycleLabel)};
      const QUEUE_NUDGE_CANDIDATES_LABEL = ${JSON.stringify(queueNudgeCandidatesLabel)};
      const QUEUE_NUDGE_CANDIDATE_OPEN_LABEL = ${JSON.stringify(queueNudgeCandidateOpenLabel)};
      const QUEUE_NUDGE_HEATMAP_LABEL = ${JSON.stringify(queueNudgeHeatmapLabel)};
      const QUEUE_NUDGE_HEAT_FOCUS_LABEL = ${JSON.stringify(queueNudgeHeatFocusLabel)};
      const QUEUE_NUDGE_HEAT_MOMENTUM_PREFIX = ${JSON.stringify(queueNudgeHeatMomentumPrefix)};
      const QUEUE_NUDGE_HEAT_TREND_LABEL = ${JSON.stringify(queueNudgeHeatTrendLabel)};
      const QUEUE_NUDGE_HEAT_TREND_SERIES_LABEL = ${JSON.stringify(queueNudgeHeatTrendSeriesLabel)};
      const QUEUE_NUDGE_STORY_LABEL = ${JSON.stringify(queueNudgeStoryLabel)};
      const QUEUE_NUDGE_DUEL_LABEL = ${JSON.stringify(queueNudgeDuelLabel)};
      const QUEUE_NUDGE_DUEL_GAP_LABEL = ${JSON.stringify(queueNudgeDuelGapLabel)};
      const QUEUE_NUDGE_DUEL_EDGE_LABEL = ${JSON.stringify(queueNudgeDuelEdgeLabel)};
      const QUEUE_NUDGE_DUEL_CALL_LABEL = ${JSON.stringify(queueNudgeDuelCallLabel)};
      const QUEUE_NUDGE_DUEL_CALL_TREND_LABEL = ${JSON.stringify(queueNudgeDuelCallTrendLabel)};
      const QUEUE_NUDGE_DUEL_CALL_CONFIDENCE_LABEL = ${JSON.stringify(queueNudgeDuelCallConfidenceLabel)};
      const QUEUE_NUDGE_DUEL_CALL_STABILITY_LABEL = ${JSON.stringify(queueNudgeDuelCallStabilityLabel)};
      const QUEUE_NUDGE_DUEL_CALL_RISK_LABEL = ${JSON.stringify(queueNudgeDuelCallRiskLabel)};
      const QUEUE_NUDGE_DUEL_CALL_SEQUENCE_LABEL = ${JSON.stringify(queueNudgeDuelCallSequenceLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_LABEL = ${JSON.stringify(queueNudgeDuelSignalLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_PULSE_LABEL = ${JSON.stringify(queueNudgeDuelSignalPulseLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_SERIES_LABEL = ${JSON.stringify(queueNudgeDuelSignalSeriesLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_VOLATILITY_LABEL = ${JSON.stringify(queueNudgeDuelSignalVolatilityLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_OUTLOOK_LABEL = ${JSON.stringify(queueNudgeDuelSignalOutlookLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_REGIME_LABEL = ${JSON.stringify(queueNudgeDuelSignalRegimeLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONVICTION_LABEL = ${JSON.stringify(queueNudgeDuelSignalConvictionLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_LABEL = ${JSON.stringify(queueNudgeDuelSignalHandoffLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_TREND_LABEL = ${JSON.stringify(queueNudgeDuelSignalHandoffTrendLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_SERIES_LABEL = ${JSON.stringify(queueNudgeDuelSignalHandoffSeriesLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_MOMENTUM_LABEL = ${JSON.stringify(queueNudgeDuelSignalHandoffMomentumLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TREND_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusTrendLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_SERIES_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusSeriesLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_MOMENTUM_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusMomentumLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_RISK_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusRiskLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_STABILITY_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusStabilityLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_READINESS_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusReadinessLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_WINDOW_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusWindowLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_GUARDRAIL_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusGuardrailLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusTriggerLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolConfidenceLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_TREND_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolTrendLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SERIES_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolSeriesLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_RISK_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolRiskLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_REGIME_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolRegimeLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolCadenceLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolPressureLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolCommandLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolScriptLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LANE_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolScriptLaneLabel)};
      const QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_CHECKLIST_LABEL = ${JSON.stringify(queueNudgeDuelSignalConsensusProtocolScriptChecklistLabel)};
      const QUEUE_NUDGE_DUEL_SNAPSHOT_LABEL = ${JSON.stringify(queueNudgeDuelSnapshotLabel)};
      const QUEUE_NUDGE_DUEL_TREND_LABEL = ${JSON.stringify(queueNudgeDuelTrendLabel)};
      const QUEUE_NUDGE_DUEL_SERIES_LABEL = ${JSON.stringify(queueNudgeDuelSeriesLabel)};
      const QUEUE_NUDGE_DUEL_PLAN_LABEL = ${JSON.stringify(queueNudgeDuelPlanLabel)};
      const QUEUE_NUDGE_OPEN_RIVAL_LABEL = ${JSON.stringify(queueNudgeOpenRivalLabel)};
      const QUEUE_NUDGE_COPY_DUEL_LABEL = ${JSON.stringify(queueNudgeCopyDuelLabel)};
      const QUEUE_NUDGE_COPY_DUEL_PLAN_LABEL = ${JSON.stringify(queueNudgeCopyDuelPlanLabel)};
      const QUEUE_NUDGE_COPY_DUEL_SNAPSHOT_LABEL = ${JSON.stringify(queueNudgeCopyDuelSnapshotLabel)};
      const QUEUE_NUDGE_RUN_RIVAL_LABEL = ${JSON.stringify(queueNudgeRunRivalLabel)};
      const QUEUE_NUDGE_TOGGLE_DUEL_LABEL = ${JSON.stringify(queueNudgeToggleDuelLabel)};
      const QUEUE_NUDGE_RUN_DUEL_LABEL = ${JSON.stringify(queueNudgeRunDuelLabel)};
      const QUEUE_NUDGE_RUN_DUEL_CALL_LABEL = ${JSON.stringify(queueNudgeRunDuelCallLabel)};
      const QUEUE_NUDGE_RUN_SIGNAL_HANDOFF_LABEL = ${JSON.stringify(queueNudgeRunSignalHandoffLabel)};
      const QUEUE_NUDGE_RUN_SIGNAL_CONSENSUS_LABEL = ${JSON.stringify(queueNudgeRunSignalConsensusLabel)};
      const QUEUE_NUDGE_RUN_SIGNAL_PROTOCOL_LABEL = ${JSON.stringify(queueNudgeRunSignalProtocolLabel)};
      const QUEUE_NUDGE_RUN_SIGNAL_COMMAND_LABEL = ${JSON.stringify(queueNudgeRunSignalCommandLabel)};
      const QUEUE_NUDGE_RUN_SIGNAL_SCRIPT_LABEL = ${JSON.stringify(queueNudgeRunSignalScriptLabel)};
      const QUEUE_NUDGE_COPY_SIGNAL_HANDOFF_LABEL = ${JSON.stringify(queueNudgeCopySignalHandoffLabel)};
      const QUEUE_NUDGE_COPY_SIGNAL_CONSENSUS_LABEL = ${JSON.stringify(queueNudgeCopySignalConsensusLabel)};
      const QUEUE_NUDGE_COPY_SIGNAL_COMMAND_LABEL = ${JSON.stringify(queueNudgeCopySignalCommandLabel)};
      const QUEUE_NUDGE_COPY_SIGNAL_SCRIPT_LABEL = ${JSON.stringify(queueNudgeCopySignalScriptLabel)};
      const QUEUE_NUDGE_COPY_SIGNAL_CHECKLIST_LABEL = ${JSON.stringify(queueNudgeCopySignalChecklistLabel)};
      const QUEUE_NUDGE_COPY_SIGNAL_PROTOCOL_LABEL = ${JSON.stringify(queueNudgeCopySignalProtocolLabel)};
      const QUEUE_NUDGE_DOWNLOAD_SIGNAL_HANDOFF_LABEL = ${JSON.stringify(queueNudgeDownloadSignalHandoffLabel)};
      const QUEUE_NUDGE_DOWNLOAD_SIGNAL_CONSENSUS_LABEL = ${JSON.stringify(queueNudgeDownloadSignalConsensusLabel)};
      const QUEUE_NUDGE_DOWNLOAD_SIGNAL_COMMAND_LABEL = ${JSON.stringify(queueNudgeDownloadSignalCommandLabel)};
      const QUEUE_NUDGE_DOWNLOAD_SIGNAL_SCRIPT_LABEL = ${JSON.stringify(queueNudgeDownloadSignalScriptLabel)};
      const QUEUE_NUDGE_DOWNLOAD_SIGNAL_CHECKLIST_LABEL = ${JSON.stringify(queueNudgeDownloadSignalChecklistLabel)};
      const QUEUE_NUDGE_DOWNLOAD_SIGNAL_PROTOCOL_LABEL = ${JSON.stringify(queueNudgeDownloadSignalProtocolLabel)};
      const QUEUE_NUDGE_COPY_DUEL_CALL_LABEL = ${JSON.stringify(queueNudgeCopyDuelCallLabel)};
      const QUEUE_NUDGE_COPY_DUEL_SIGNALS_LABEL = ${JSON.stringify(queueNudgeCopyDuelSignalsLabel)};
      const QUEUE_NUDGE_COPY_BRIEF_LABEL = ${JSON.stringify(queueNudgeCopyBriefLabel)};
      const QUEUE_NUDGE_DOWNLOAD_BRIEF_LABEL = ${JSON.stringify(queueNudgeDownloadBriefLabel)};
      const QUEUE_NUDGE_BRIEF_LABEL = ${JSON.stringify(queueNudgeBriefLabel)};
      const QUEUE_NUDGE_BRIEF_CONTEXT_LABEL = ${JSON.stringify(queueNudgeBriefContextLabel)};
      const QUEUE_LEAD_GAP_LABEL_PREFIX = ${JSON.stringify(queueLeadGapLabelPrefix)};
      const QUEUE_DUEL_ROLE_LABEL_PREFIX = ${JSON.stringify(queueDuelRoleLabelPrefix)};
      const DETAIL_STORY_LABEL = ${JSON.stringify(detailStoryLabel)};
      const DETAIL_STORY_OPEN_LEAD_PREFIX = ${JSON.stringify(detailStoryOpenLeadPrefix)};
      const QUEUE_NUDGE_POOL_PREFIX = ${JSON.stringify(queueNudgePoolPrefix)};
      const QUEUE_NUDGE_CYCLE_HINT = ${JSON.stringify(queueNudgeCycleHint)};
      const QUEUE_RECOVERY_COPY_LABEL = ${JSON.stringify(queueRecoveryCopyLabel)};
      const QUEUE_RECOVERY_CLEAR_LABEL = ${JSON.stringify(queueRecoveryClearLabel)};
      const QUEUE_RECOVERY_DOWNLOAD_LABEL = ${JSON.stringify(queueRecoveryDownloadLabel)};
      const QUEUE_RECOVERY_HISTORY_HINT = ${JSON.stringify(queueRecoveryHistoryHint)};
      const QUEUE_RECOVERY_PREV_LABEL = ${JSON.stringify(queueRecoveryPrevLabel)};
      const QUEUE_RECOVERY_NEXT_LABEL = ${JSON.stringify(queueRecoveryNextLabel)};
      const QUEUE_RECOVERY_LATEST_LABEL = ${JSON.stringify(queueRecoveryLatestLabel)};
      const QUEUE_RECOVERY_CLEAR_STEP_LABEL = ${JSON.stringify(queueRecoveryClearStepLabel)};
      const QUEUE_RECOVERY_CLEAR_FAILED_LABEL = ${JSON.stringify(queueRecoveryClearFailedLabel)};
      const QUEUE_RECOVERY_CONTEXT_LABEL = ${JSON.stringify(queueRecoveryContextLabel)};
      const QUEUE_RECOVERY_EDIT_CONTEXT_LABEL = ${JSON.stringify(queueRecoveryEditContextLabel)};
      const QUEUE_RECOVERY_FOCUS_MODE_PREFIX = ${JSON.stringify(queueRecoveryFocusModePrefix)};
      const QUEUE_RECOVERY_FOCUS_MODE_SMART_HINT = ${JSON.stringify(queueRecoveryFocusModeSmartHint)};
      const RECOVERY_HISTORY_LIMIT = 5;
      const inboxEl = document.getElementById("inbox");
      const detailEl = document.getElementById("detail");
      const detailModeChipsEl = document.getElementById("detailModeChips");
      const detailFocusModeBtn = document.getElementById("detailFocusModeBtn");
      const detailAdvancedModeBtn = document.getElementById("detailAdvancedModeBtn");
      const detailSectionNavEl = document.getElementById("detailSectionNav");
      const errorEl = document.getElementById("error");
      const queueHighlightsEl = document.getElementById("queueHighlights");
      const queueFlowPulseEl = document.getElementById("queueFlowPulse");
      const ahaNudgeEl = document.getElementById("ahaNudge");
      const queueActionBannerEl = document.getElementById("queueActionBanner");
      const recoveryRadarEl = document.getElementById("recoveryRadar");
      const focusChipsEl = document.getElementById("focusChips");
      const statusLegendEl = document.getElementById("statusLegend");
      const retryPreviewOutputEl = document.getElementById("retryPreviewOutput");
      const refreshBtn = document.getElementById("refreshBtn");
      const clearFiltersBtn = document.getElementById("clearFiltersBtn");
      const resetControlsBtn = document.getElementById("resetControlsBtn");
      const queryInput = document.getElementById("queryInput");
      const shortcutHintBtn = document.getElementById("shortcutHintBtn");
      const shortcutPanelBackdropEl = document.getElementById("shortcutPanelBackdrop");
      const shortcutPanelCloseBtn = document.getElementById("shortcutPanelCloseBtn");
      const statusFilter = document.getElementById("statusFilter");
      const retryableFilter = document.getElementById("retryableFilter");
      const failureStepFilter = document.getElementById("failureStepFilter");
      const recoveryFocusModeFilter = document.getElementById("recoveryFocusModeFilter");
      const archiveRetryableFilter = document.getElementById("archiveRetryableFilter");
      const workerStatsEl = document.getElementById("workerStats");
      const selectionHintEl = document.getElementById("selectionHint");
      const ahaPulseBtn = document.getElementById("ahaPulseBtn");
      const runWorkerBtn = document.getElementById("runWorkerBtn");
      const previewRetryBtn = document.getElementById("previewRetryBtn");
      const previewNextBtn = document.getElementById("previewNextBtn");
      const retryFailedBtn = document.getElementById("retryFailedBtn");
      const previewArchiveBtn = document.getElementById("previewArchiveBtn");
      const archiveBlockedBtn = document.getElementById("archiveBlockedBtn");
      const previewUnarchiveBtn = document.getElementById("previewUnarchiveBtn");
      const unarchiveBatchBtn = document.getElementById("unarchiveBatchBtn");
      const autoRefreshToggle = document.getElementById("autoRefreshToggle");
      const unarchiveModeFilter = document.getElementById("unarchiveModeFilter");
      const batchLimitInput = document.getElementById("batchLimitInput");
      const previewOffsetInput = document.getElementById("previewOffsetInput");

      let allItems = [];
      let selectedId = null;
      let selectedDetail = null;
      let isLoadingItems = false;
      let autoRefreshTimer = null;
      let previewContinuation = null;
      let detailAdvancedEnabled = false;
      let latestRecoverySummary = null;
      let recoveryRadarHistory = [];
      let activeRecoverySummaryId = null;
      let focusedFilterControl = null;
      let focusedFilterControlTimer = null;
      let recoveryContextFocusMode = "smart";
      const inFlightActionIds = new Set();
      const controlsStorageKey = "readdo.web.controls.v1";
      const recoveryRadarStorageKey = "readdo.web.recovery-radar.v1";
      const defaultCollapsedGroups = {
        read_next: false,
        worth_it: false,
        if_time: false,
        in_progress: false,
        needs_attention: false,
        skip: false,
        shipped: true,
        archived: true,
      };
      let collapsedGroups = { ...defaultCollapsedGroups };
      const controlDefaults = {
        q: "",
        status: "",
        retryable: "",
        failure_step: "",
        archive_retryable: "false",
        unarchive_mode: "smart",
        batch_limit: 100,
        preview_offset: 0,
        auto_refresh: false,
        detail_advanced: false,
        recovery_focus_mode: "smart",
        collapsed_groups: defaultCollapsedGroups,
      };
      const queueActionCopy = {
        preview_error_prefix: {
          archive: "Archive preview failed: ",
          retry: "Retry preview failed: ",
          unarchive: "Unarchive preview failed: ",
          next: "Preview next failed: ",
        },
        batch_error_prefix: {
          retry: "Retry failed batch action failed: ",
          archive: "Archive blocked failed: ",
          unarchive: "Unarchive batch failed: ",
        },
        batch_cancelled: {
          retry: "Retry failed action cancelled.",
          archive: "Archive blocked action cancelled.",
          unarchive: "Unarchive action cancelled.",
        },
        batch_progress: {
          retry: "Retrying failed items...",
        },
      };
      const queueActionMeta = {
        preview: {
          archive: { id: "queue_preview_archive", label: QUEUE_PREVIEW_LABELS.archive },
          retry: { id: "queue_preview_retry", label: QUEUE_PREVIEW_LABELS.retry },
          unarchive: { id: "queue_preview_unarchive", label: QUEUE_PREVIEW_LABELS.unarchive },
          next: { id: "queue_preview_next", label: QUEUE_PREVIEW_LABELS.next },
        },
        batch: {
          retry: { id: "queue_retry_failed", label: QUEUE_BATCH_LABELS.retry.action },
          archive: { id: "queue_archive_failed", label: QUEUE_BATCH_LABELS.archive.action },
          unarchive: { id: "queue_unarchive_batch", label: QUEUE_BATCH_LABELS.unarchive.action },
        },
      };
      const queueFilterMeta = {
        controls: {
          focus_priority: "Focus Priority",
          archive_scope: "Archive Scope",
          unarchive_mode: "Unarchive Mode",
          batch_limit: "Batch Limit",
          preview_offset: "Preview Offset",
        },
        list: {
          status: "Status Filter",
          retryable: "Retryable Filter",
          failure_step: "Failure Step Filter",
        },
      };
      const emptyQueueNudgeState = {
        itemId: null,
        tone: "ship",
        actionLabel: "",
        context: "",
      };
      let queueNudgeState = { ...emptyQueueNudgeState };
      let ahaCandidateCycleCursor = -1;
      let currentAhaRankMap = new Map();
      let previousAhaRankMap = new Map();
      let currentAhaLeadMeta = null;
      let currentAhaHeatMap = new Map();
      let previousAhaHeatMap = new Map();
      let ahaHeatHistory = [];
      const AHA_HEAT_HISTORY_LIMIT = 8;
      let ahaDuelGapHistory = [];
      const AHA_DUEL_GAP_HISTORY_LIMIT = 8;
      let ahaDuelCallHistory = [];
      const AHA_DUEL_CALL_HISTORY_LIMIT = 8;
      let ahaDuelSignalHandoffHistory = [];
      const AHA_DUEL_SIGNAL_HANDOFF_HISTORY_LIMIT = 8;
      let ahaDuelSignalConsensusHistory = [];
      const AHA_DUEL_SIGNAL_CONSENSUS_HISTORY_LIMIT = 8;
      let ahaDuelSignalConsensusProtocolConfidenceHistory = [];
      const AHA_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_HISTORY_LIMIT = 8;
      let latestAhaSnapshot = null;

      function statusByFocusChip(focus) {
        if (focus === "ready") return "READY";
        if (focus === "failed") return "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT";
        if (focus === "queued") return "QUEUED";
        if (focus === "archived") return "ARCHIVED";
        return "";
      }

      function syncFocusChips() {
        if (!focusChipsEl) return;
        const buttons = focusChipsEl.querySelectorAll("[data-focus]");
        for (const button of buttons) {
          const focus = button.getAttribute("data-focus") || "all";
          const statusValue = statusByFocusChip(focus);
          const isActive = statusFilter.value === statusValue;
          button.classList.toggle("active", isActive);
        }
      }

      function clearPreviewContinuation() {
        previewContinuation = null;
        previewNextBtn.style.display = "none";
        previewNextBtn.textContent = QUEUE_PREVIEW_LABELS.next;
        previewNextBtn.disabled = false;
      }

      function clearPreviewOutput() {
        retryPreviewOutputEl.style.display = "none";
        retryPreviewOutputEl.textContent = "";
      }

      function clearPreviewState() {
        clearPreviewContinuation();
        clearPreviewOutput();
      }

      function setPreviewContinuation(kind, nextOffset) {
        if (nextOffset == null) {
          clearPreviewContinuation();
          return;
        }
        previewContinuation = { kind, next_offset: Number(nextOffset) };
        previewNextBtn.style.display = "inline-block";
        previewNextBtn.textContent = QUEUE_PREVIEW_LABELS.next + " (" + nextOffset + ")";
      }

      function clearDetailSectionNav() {
        if (!detailSectionNavEl) return;
        detailSectionNavEl.innerHTML = "";
        detailSectionNavEl.style.display = "none";
      }

      function syncDetailModeChips() {
        if (!detailModeChipsEl) return;
        detailFocusModeBtn?.classList.toggle("active", !detailAdvancedEnabled);
        detailAdvancedModeBtn?.classList.toggle("active", detailAdvancedEnabled);
      }

      function setDetailAdvancedEnabled(enabled, rerender = true) {
        detailAdvancedEnabled = Boolean(enabled);
        syncDetailModeChips();
        persistControls();
        if (rerender && selectedDetail) {
          renderDetailFromPayload(selectedDetail);
        }
      }

      function addDetailSectionNav(label, sectionId) {
        if (!detailSectionNavEl) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "section-chip";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          const section = document.getElementById(sectionId);
          if (!section) return;
          if (section instanceof HTMLDetailsElement) {
            section.open = true;
          }
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        detailSectionNavEl.appendChild(btn);
        detailSectionNavEl.style.display = "flex";
      }

      function appendDetailSection(sectionId, title, subtitle, contentEl, defaultOpen = false) {
        const wrapper = document.createElement("details");
        wrapper.className = "detail-section";
        wrapper.id = sectionId;
        wrapper.open = defaultOpen;
        wrapper.innerHTML =
          '<summary><div><div class="detail-section-title">' +
          title +
          '</div><div class="detail-section-subtitle">' +
          subtitle +
          '</div></div><span class="muted">Expand</span></summary><div class="detail-section-body"></div>';
        const body = wrapper.querySelector(".detail-section-body");
        body.appendChild(contentEl);
        detailEl.appendChild(wrapper);
        addDetailSectionNav(title, sectionId);
      }

      function persistControls() {
        try {
          const payload = {
            q: queryInput.value || "",
            status: statusFilter.value || "",
            retryable: retryableFilter.value || "",
            failure_step: failureStepFilter.value || "",
            archive_retryable: archiveRetryableFilter.value || "false",
            unarchive_mode: unarchiveModeFilter.value || "smart",
            batch_limit: normalizedBatchLimit(),
            preview_offset: normalizedPreviewOffset(),
            auto_refresh: Boolean(autoRefreshToggle.checked),
            detail_advanced: Boolean(detailAdvancedEnabled),
            recovery_focus_mode: recoveryContextFocusMode,
            collapsed_groups: collapsedGroups,
          };
          localStorage.setItem(controlsStorageKey, JSON.stringify(payload));
        } catch {
          // ignore storage failures
        }
      }

      function restoreControls() {
        try {
          const raw = localStorage.getItem(controlsStorageKey);
          if (!raw) return;
          const payload = JSON.parse(raw);
          if (typeof payload?.q === "string") queryInput.value = payload.q;
          if (typeof payload?.status === "string") statusFilter.value = payload.status;
          if (typeof payload?.retryable === "string") retryableFilter.value = payload.retryable;
          if (typeof payload?.failure_step === "string") failureStepFilter.value = payload.failure_step;
          if (typeof payload?.archive_retryable === "string") archiveRetryableFilter.value = payload.archive_retryable;
          if (typeof payload?.unarchive_mode === "string") unarchiveModeFilter.value = payload.unarchive_mode;
          if (Number.isInteger(Number(payload?.batch_limit))) {
            batchLimitInput.value = String(Math.min(Math.max(Number(payload.batch_limit), 1), 200));
          }
          if (Number.isInteger(Number(payload?.preview_offset))) {
            previewOffsetInput.value = String(Math.max(Number(payload.preview_offset), 0));
          }
          autoRefreshToggle.checked = Boolean(payload?.auto_refresh);
          detailAdvancedEnabled = Boolean(payload?.detail_advanced);
          if (typeof payload?.recovery_focus_mode === "string") {
            setRecoveryContextFocusMode(payload.recovery_focus_mode);
          }
          if (payload?.collapsed_groups && typeof payload.collapsed_groups === "object" && !Array.isArray(payload.collapsed_groups)) {
            const normalizedGroups = { ...defaultCollapsedGroups };
            for (const [key, value] of Object.entries(payload.collapsed_groups)) {
              if (Object.prototype.hasOwnProperty.call(normalizedGroups, key)) {
                normalizedGroups[key] = Boolean(value);
              }
            }
            collapsedGroups = normalizedGroups;
          }
          syncDetailModeChips();
        } catch {
          // ignore malformed storage payloads
        }
      }

      function persistRecoveryRadarState() {
        try {
          const payload = {
            active_summary_id: activeRecoverySummaryId || null,
            history: recoveryRadarHistory.slice(0, RECOVERY_HISTORY_LIMIT),
          };
          localStorage.setItem(recoveryRadarStorageKey, JSON.stringify(payload));
        } catch {
          // ignore storage failures
        }
      }

      function restoreRecoveryRadarState() {
        try {
          const raw = localStorage.getItem(recoveryRadarStorageKey);
          if (!raw) return;
          const payload = JSON.parse(raw);
          if (!Array.isArray(payload?.history)) return;
          const normalizedHistory = payload.history
            .map((entry) => normalizeRecoverySummary(entry))
            .filter(Boolean)
            .slice(0, RECOVERY_HISTORY_LIMIT);
          if (!normalizedHistory.length) return;
          recoveryRadarHistory = normalizedHistory;
          activeRecoverySummaryId =
            typeof payload?.active_summary_id === "string" ? payload.active_summary_id : normalizedHistory[0].summary_id;
          const activeSummary = activeRecoverySummary();
          latestRecoverySummary = activeSummary || normalizedHistory[0];
          renderRecoveryRadar(latestRecoverySummary);
        } catch {
          // ignore malformed recovery radar payloads
        }
      }

      function applyControlDefaults() {
        queryInput.value = controlDefaults.q;
        statusFilter.value = controlDefaults.status;
        retryableFilter.value = controlDefaults.retryable;
        failureStepFilter.value = controlDefaults.failure_step;
        archiveRetryableFilter.value = controlDefaults.archive_retryable;
        unarchiveModeFilter.value = controlDefaults.unarchive_mode;
        batchLimitInput.value = String(controlDefaults.batch_limit);
        previewOffsetInput.value = String(controlDefaults.preview_offset);
        autoRefreshToggle.checked = controlDefaults.auto_refresh;
        detailAdvancedEnabled = controlDefaults.detail_advanced;
        setRecoveryContextFocusMode(controlDefaults.recovery_focus_mode);
        collapsedGroups = { ...controlDefaults.collapsed_groups };
        syncDetailModeChips();
      }

      function clearListFilters() {
        queryInput.value = controlDefaults.q;
        statusFilter.value = controlDefaults.status;
        retryableFilter.value = controlDefaults.retryable;
        failureStepFilter.value = controlDefaults.failure_step;
      }

      function groupKeyForItem(item) {
        if (!item) return null;
        if (item.status === "ARCHIVED") return "archived";
        if (item.status === "SHIPPED") return "shipped";
        if (item.status === "READY") {
          if (item.priority === "READ_NEXT") return "read_next";
          if (item.priority === "WORTH_IT") return "worth_it";
          if (item.priority === "IF_TIME") return "if_time";
          return "skip";
        }
        if (String(item.status || "").startsWith("FAILED_")) return "needs_attention";
        return "in_progress";
      }

      function groupedItems(items) {
        const groups = {
          read_next: [],
          worth_it: [],
          if_time: [],
          in_progress: [],
          needs_attention: [],
          skip: [],
          shipped: [],
          archived: []
        };

        for (const item of items) {
          if (item.status === "ARCHIVED") {
            groups.archived.push(item);
            continue;
          }
          if (item.status === "SHIPPED") {
            groups.shipped.push(item);
            continue;
          }
          if (item.status === "READY") {
            if (item.priority === "READ_NEXT") groups.read_next.push(item);
            else if (item.priority === "WORTH_IT") groups.worth_it.push(item);
            else if (item.priority === "IF_TIME") groups.if_time.push(item);
            else groups.skip.push(item);
            continue;
          }
          if (item.status.startsWith("FAILED_")) {
            groups.needs_attention.push(item);
          } else {
            groups.in_progress.push(item);
          }
        }
        return groups;
      }

      function statusTone(status) {
        if (status === "READY" || status === "SHIPPED") return "ready";
        if (status === "CAPTURED") return "captured";
        if (status === "QUEUED") return "queued";
        if (status === "PROCESSING") return "processing";
        if (status === "ARCHIVED") return "archived";
        if (typeof status === "string" && status.startsWith("FAILED_")) return "failed";
        return "default";
      }

      function detailHeroTone(status) {
        const tone = statusTone(status);
        if (tone === "ready") return "hero-ready";
        if (tone === "captured") return "hero-captured";
        if (tone === "processing" || tone === "queued") return "hero-processing";
        if (tone === "archived") return "hero-archived";
        if (tone === "failed") return "hero-failed";
        return "hero-default";
      }

      function detailMomentumLabel(status) {
        if (status === "READY") return "Aha Momentum · Ready to ship now";
        if (status === "SHIPPED") return "Aha Momentum · Delivered, now refine or archive";
        if (status === "PROCESSING") return "Aha Momentum · Pipeline is actively running";
        if (status === "QUEUED") return "Aha Momentum · Waiting in queue for next run";
        if (status === "CAPTURED") return "Aha Momentum · Captured, trigger process to unlock value";
        if (status === "ARCHIVED") return "Aha Momentum · Archived for later revisit";
        if (typeof status === "string" && status.startsWith("FAILED_")) return "Aha Momentum · Recovery needed before ship";
        return "Aha Momentum · Keep the flow moving";
      }

      function priorityTone(priority) {
        if (priority === "READ_NEXT") return "read-next";
        if (priority === "WORTH_IT") return "worth-it";
        if (priority === "IF_TIME") return "if-time";
        return "default";
      }

      function impactMetaForItem(item) {
        if (item?.priority === "READ_NEXT") return { label: "Impact: High", tone: "impact-high" };
        if (item?.priority === "WORTH_IT") return { label: "Impact: Medium", tone: "impact-medium" };
        if (item?.priority === "IF_TIME") return { label: "Impact: Low", tone: "impact-low" };
        return { label: "Impact: Unscored", tone: "impact-default" };
      }

      function urgencyMetaForItem(item) {
        const status = String(item?.status || "");
        if (status === "READY" || status.startsWith("FAILED_")) {
          return { label: "Urgency: Now", tone: "urgency-now" };
        }
        if (status === "QUEUED" || status === "PROCESSING" || status === "CAPTURED") {
          return { label: "Urgency: Soon", tone: "urgency-soon" };
        }
        return { label: "Urgency: Later", tone: "urgency-later" };
      }

      function queueInsightPillsHtml(item) {
        const impactMeta = impactMetaForItem(item);
        const urgencyMeta = urgencyMetaForItem(item);
        return (
          '<div class="insight-pills">' +
          '<span class="insight-pill ' +
          impactMeta.tone +
          '">' +
          impactMeta.label +
          '</span><span class="insight-pill ' +
          urgencyMeta.tone +
          '">' +
          urgencyMeta.label +
          "</span></div>"
        );
      }

      function scoreMeterMeta(rawScore) {
        const score = Number(rawScore);
        if (!Number.isFinite(score)) {
          return { value: 0, tone: "score-unknown", label: "Score: Unscored" };
        }
        const clamped = Math.min(Math.max(score, 0), 100);
        if (clamped >= 80) {
          return { value: clamped, tone: "score-high", label: "Score: " + clamped.toFixed(1) + " · High confidence" };
        }
        if (clamped >= 60) {
          return { value: clamped, tone: "score-medium", label: "Score: " + clamped.toFixed(1) + " · Medium confidence" };
        }
        return { value: clamped, tone: "score-low", label: "Score: " + clamped.toFixed(1) + " · Needs review" };
      }

      function scoreMeterHtml(rawScore) {
        const meta = scoreMeterMeta(rawScore);
        return (
          '<div class="score-meter" role="img" aria-label="' +
          meta.label +
          '"><div class="score-meter-track"><span class="score-meter-fill ' +
          meta.tone +
          '" style="width:' +
          meta.value.toFixed(1) +
          '%"></span></div><div class="score-meter-label muted">' +
          meta.label +
          "</div></div>"
        );
      }

      function freshnessMeta(updatedAt) {
        const parsedMs = Date.parse(String(updatedAt || ""));
        if (!Number.isFinite(parsedMs)) {
          return { label: "Updated: unknown", tone: "age-stale" };
        }
        const elapsedMinutes = Math.max(Math.floor((Date.now() - parsedMs) / 60000), 0);
        if (elapsedMinutes <= 10) {
          return { label: "Updated: just now", tone: "age-fresh" };
        }
        if (elapsedMinutes < 60) {
          return { label: "Updated: " + elapsedMinutes + "m ago", tone: "age-fresh" };
        }
        const elapsedHours = Math.floor(elapsedMinutes / 60);
        if (elapsedHours < 24) {
          return { label: "Updated: " + elapsedHours + "h ago", tone: "age-warm" };
        }
        const elapsedDays = Math.floor(elapsedHours / 24);
        if (elapsedDays <= 3) {
          return { label: "Updated: " + elapsedDays + "d ago", tone: "age-warm" };
        }
        return { label: "Updated: " + elapsedDays + "d ago", tone: "age-stale" };
      }

      function freshnessChipHtml(updatedAt) {
        const meta = freshnessMeta(updatedAt);
        return '<span class="freshness-chip ' + meta.tone + '">' + meta.label + "</span>";
      }

      function ahaIndexMetaForItem(item) {
        const scoreMeta = scoreMeterMeta(item?.match_score);
        const urgencyMeta = urgencyMetaForItem(item);
        const freshness = freshnessMeta(item?.updated_at);
        let base = scoreMeta.value;
        if (urgencyMeta.tone === "urgency-now") {
          base += 16;
        } else if (urgencyMeta.tone === "urgency-soon") {
          base += 10;
        } else {
          base += 4;
        }
        if (freshness.tone === "age-fresh") {
          base += 12;
        } else if (freshness.tone === "age-warm") {
          base += 6;
        }
        if (String(item?.status || "").startsWith("FAILED_")) {
          base -= 8;
        }
        const value = Math.min(Math.max(Math.round(base), 0), 100);
        if (value >= 85) {
          return { value, tone: "tone-hot", note: "Hot Now" };
        }
        if (value >= 70) {
          return { value, tone: "tone-strong", note: "Ready Push" };
        }
        if (value >= 50) {
          return { value, tone: "tone-warm", note: "Worth Queue" };
        }
        return { value, tone: "tone-cool", note: "Park/Refine" };
      }

      function ahaIndexHtml(item) {
        const meta = ahaIndexMetaForItem(item);
        return (
          '<div class="aha-index ' +
          meta.tone +
          '" role="img" aria-label="Aha Index: ' +
          meta.value +
          ' · ' +
          meta.note +
          '"><span class="aha-index-chip">Aha Index</span>' +
          meta.value +
          '<span class="muted">· ' +
          meta.note +
          "</span></div>"
        );
      }

      function queueNextMoveHtml(item, ops, spotlight = null) {
        if (!Array.isArray(ops) || !ops.length) return "";
        const primaryOp = ops.find((op) => op.is_primary) || ops[0];
        if (!primaryOp) return "";
        let tone = "tone-act";
        if (primaryOp.id === "export" || primaryOp.id === "reexport") {
          tone = "tone-ship";
        } else if (String(item?.status || "").startsWith("FAILED_")) {
          tone = "tone-recover";
        }
        const chipLabel = spotlight ? "Aha Pick" : "Next Move";
        return (
          '<div class="next-move-line ' +
          tone +
          '"><span class="next-move-chip">' +
          chipLabel +
          "</span>" +
          primaryOp.label +
          '<span class="muted">· press M</span></div>'
        );
      }

      function flowStageMetaForItem(item) {
        const status = String(item?.status || "");
        if (status === "CAPTURED") return { index: 0, label: "Captured · ready to queue" };
        if (status === "QUEUED") return { index: 1, label: "Queued · waiting for worker" };
        if (status === "PROCESSING") return { index: 2, label: "Processing · generating artifacts" };
        if (status === "READY") return { index: 3, label: "Ready · review and export" };
        if (status === "SHIPPED") return { index: 4, label: "Shipped · delivered output" };
        if (status === "ARCHIVED") return { index: 4, label: "Archived · parked after processing" };
        if (status.startsWith("FAILED_")) {
          const failedStep = String(item?.failure?.failed_step || "");
          if (failedStep === "extract") return { index: 1, label: "Failed at extract · source recovery needed" };
          if (failedStep === "pipeline") return { index: 2, label: "Failed at pipeline · intent/artifact fix needed" };
          if (failedStep === "export") return { index: 4, label: "Failed at export · shipping recovery needed" };
          return { index: 2, label: "Failed · manual recovery needed" };
        }
        return { index: 2, label: "In progress · keep flow moving" };
      }

      function queueFlowRailHtml(item) {
        const stage = flowStageMetaForItem(item);
        const nodesHtml = QUEUE_FLOW_RAIL_NODE_LABELS
          .map((label, index) => {
            const toneClass = index < stage.index ? "is-done" : index === stage.index ? "is-current" : "";
            const className = toneClass ? "rail-node " + toneClass : "rail-node";
            return '<span class="' + className + '" title="' + label + '" aria-hidden="true"></span>';
          })
          .join("");
        return (
          '<div class="status-rail" role="img" aria-label="Flow stage: ' +
          stage.label +
          '"><div class="status-rail-track">' +
          nodesHtml +
          '</div><div class="status-rail-caption muted">Flow: ' +
          stage.label +
          "</div></div>"
        );
      }

      function topReadyItem(items) {
        return items
          .filter((item) => item.status === "READY")
          .sort((a, b) => Number(b.match_score ?? -1) - Number(a.match_score ?? -1))[0];
      }

      function sortedAhaItems(items) {
        if (!Array.isArray(items) || !items.length) return [];
        return [...items]
          .filter((item) => item.status !== "ARCHIVED")
          .sort((a, b) => {
            const ahaDelta = ahaIndexMetaForItem(b).value - ahaIndexMetaForItem(a).value;
            if (ahaDelta !== 0) return ahaDelta;
            return Number(b.match_score ?? -1) - Number(a.match_score ?? -1);
          });
      }

      function topAhaItem(items) {
        return sortedAhaItems(items)[0] || null;
      }

      function topAhaCandidates(items, limit = 3) {
        return sortedAhaItems(items).slice(0, Math.max(0, Number(limit) || 0));
      }

      function ahaHeatBuckets(items) {
        const buckets = [
          { key: "hot", tone: "tone-hot", label: "Hot", count: 0, firstItem: null },
          { key: "strong", tone: "tone-strong", label: "Strong", count: 0, firstItem: null },
          { key: "warm", tone: "tone-warm", label: "Warm", count: 0, firstItem: null },
          { key: "cool", tone: "tone-cool", label: "Cool", count: 0, firstItem: null },
        ];
        const bucketByTone = new Map(buckets.map((bucket) => [bucket.tone, bucket]));
        for (const item of Array.isArray(items) ? items : []) {
          const tone = ahaIndexMetaForItem(item).tone;
          const bucket = bucketByTone.get(tone) || bucketByTone.get("tone-cool");
          if (!bucket) continue;
          bucket.count += 1;
          if (!bucket.firstItem) {
            bucket.firstItem = item;
          }
        }
        return buckets;
      }

      function refreshAhaHeatMap(items) {
        previousAhaHeatMap = currentAhaHeatMap;
        const nextMap = new Map();
        for (const bucket of ahaHeatBuckets(items)) {
          nextMap.set(bucket.key, Number(bucket.count || 0));
        }
        currentAhaHeatMap = nextMap;
      }

      function refreshAhaHeatHistory(items) {
        const buckets = ahaHeatBuckets(items);
        const hot = Number(buckets.find((bucket) => bucket.key === "hot")?.count || 0);
        const strong = Number(buckets.find((bucket) => bucket.key === "strong")?.count || 0);
        const point = { hot, strong, total: hot + strong };
        ahaHeatHistory = [...ahaHeatHistory, point].slice(-AHA_HEAT_HISTORY_LIMIT);
      }

      function refreshAhaDuelGapHistory(items) {
        const ranked = sortedAhaItems(items);
        const lead = ranked[0] || null;
        const rival = ranked[1] || null;
        if (!lead || !rival) {
          ahaDuelGapHistory = [...ahaDuelGapHistory, { gap: 0 }].slice(-AHA_DUEL_GAP_HISTORY_LIMIT);
          return;
        }
        const leadValue = Number(ahaIndexMetaForItem(lead).value || 0);
        const rivalValue = Number(ahaIndexMetaForItem(rival).value || 0);
        const gap = Math.max(leadValue - rivalValue, 0);
        ahaDuelGapHistory = [...ahaDuelGapHistory, { gap }].slice(-AHA_DUEL_GAP_HISTORY_LIMIT);
      }

      function refreshAhaDuelCallHistory(items) {
        const ranked = sortedAhaItems(items);
        const call = ahaDuelCallMeta(ranked);
        const role = String(call?.role || "Hold").toLowerCase();
        const tone = String(call?.tone || "call-hold");
        ahaDuelCallHistory = [...ahaDuelCallHistory, { role, tone }].slice(-AHA_DUEL_CALL_HISTORY_LIMIT);
      }

      function normalizeHandoffRole(role) {
        const normalized = String(role || "hold").toLowerCase();
        if (normalized === "lead" || normalized === "rival" || normalized === "split" || normalized === "hold") {
          return normalized;
        }
        return "hold";
      }

      function handoffToneFromRole(role) {
        const normalized = String(role || "hold").toLowerCase();
        if (normalized === "lead") return "call-lead";
        if (normalized === "rival" || normalized === "split") return "call-rival";
        return "call-hold";
      }

      function refreshAhaDuelSignalHandoffHistory(items) {
        const ranked = sortedAhaItems(items);
        const handoff = ahaDuelSignalHandoffMeta(ranked);
        const role = normalizeHandoffRole(handoff?.role);
        const tone = handoffToneFromRole(role);
        ahaDuelSignalHandoffHistory = [...ahaDuelSignalHandoffHistory, { role, tone }].slice(
          -AHA_DUEL_SIGNAL_HANDOFF_HISTORY_LIMIT,
        );
      }

      function normalizeConsensusRole(role) {
        const normalized = String(role || "conflict").toLowerCase();
        if (
          normalized === "lead" ||
          normalized === "rival" ||
          normalized === "split" ||
          normalized === "hold" ||
          normalized === "mixed" ||
          normalized === "conflict"
        ) {
          return normalized;
        }
        return "conflict";
      }

      function consensusToneFromRole(role) {
        const normalized = normalizeConsensusRole(role);
        if (normalized === "lead") return "call-lead";
        if (normalized === "rival" || normalized === "split" || normalized === "mixed") return "call-rival";
        return "call-hold";
      }

      function refreshAhaDuelSignalConsensusHistory(items) {
        const ranked = sortedAhaItems(items);
        const consensus = ahaDuelSignalConsensusMeta(ranked);
        const role = normalizeConsensusRole(consensus?.role);
        const tone = consensusToneFromRole(role);
        ahaDuelSignalConsensusHistory = [...ahaDuelSignalConsensusHistory, { role, tone }].slice(
          -AHA_DUEL_SIGNAL_CONSENSUS_HISTORY_LIMIT,
        );
      }

      function refreshAhaDuelSignalConsensusProtocolConfidenceHistory(items) {
        const ranked = sortedAhaItems(items);
        const confidence = ahaDuelSignalConsensusProtocolConfidenceMeta(ranked);
        if (!confidence) {
          ahaDuelSignalConsensusProtocolConfidenceHistory = [...ahaDuelSignalConsensusProtocolConfidenceHistory, { score: 0 }].slice(
            -AHA_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_HISTORY_LIMIT,
          );
          return;
        }
        const score = Math.max(0, Math.min(100, Number(confidence.score || 0)));
        ahaDuelSignalConsensusProtocolConfidenceHistory = [
          ...ahaDuelSignalConsensusProtocolConfidenceHistory,
          { score, tone: confidence.tone, label: confidence.label },
        ].slice(-AHA_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_HISTORY_LIMIT);
      }

      function ahaDuelGapTrendPoints() {
        return ahaDuelGapHistory.slice(-AHA_DUEL_GAP_HISTORY_LIMIT);
      }

      function ahaDuelCallTrendPoints() {
        return ahaDuelCallHistory.slice(-AHA_DUEL_CALL_HISTORY_LIMIT);
      }

      function ahaDuelSignalHandoffTrendPoints() {
        return ahaDuelSignalHandoffHistory.slice(-AHA_DUEL_SIGNAL_HANDOFF_HISTORY_LIMIT);
      }

      function ahaDuelSignalConsensusTrendPoints() {
        return ahaDuelSignalConsensusHistory.slice(-AHA_DUEL_SIGNAL_CONSENSUS_HISTORY_LIMIT);
      }

      function ahaDuelSignalConsensusProtocolConfidencePoints() {
        return ahaDuelSignalConsensusProtocolConfidenceHistory.slice(-AHA_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_HISTORY_LIMIT);
      }

      function ahaDuelSignalHandoffTrendMeta(points = ahaDuelSignalHandoffTrendPoints()) {
        if (!points.length) return { label: "No handoff", tone: "call-hold", hint: "Need handoff transitions" };
        const counts = { lead: 0, rival: 0, hold: 0, split: 0 };
        for (const point of points) {
          const key = String(point?.role || "hold");
          if (key === "lead" || key === "rival" || key === "hold" || key === "split") {
            counts[key] += 1;
          } else {
            counts.hold += 1;
          }
        }
        const total = points.length;
        const ordered = [
          { role: "lead", label: "Lead handoff", tone: "call-lead", count: counts.lead },
          { role: "rival", label: "Rival handoff", tone: "call-rival", count: counts.rival },
          { role: "split", label: "Split handoff", tone: "call-rival", count: counts.split },
          { role: "hold", label: "Hold handoff", tone: "call-hold", count: counts.hold },
        ].sort((a, b) => b.count - a.count);
        const dominant = ordered[0];
        const second = ordered[1];
        if (dominant.count === second.count) {
          return {
            label: "Mixed handoff " + dominant.count + "/" + total,
            tone: "call-rival",
            hint: "Lead/Rival/Hold handoffs are rotating",
          };
        }
        return {
          label: dominant.label + " " + dominant.count + "/" + total,
          tone: dominant.tone,
          hint: "Recent handoff bias",
        };
      }

      function ahaDuelSignalConsensusTrendMeta(points = ahaDuelSignalConsensusTrendPoints()) {
        if (!points.length) return { label: "No consensus", tone: "call-hold", hint: "Need consensus transitions" };
        const counts = { lead: 0, rival: 0, split: 0, hold: 0, mixed: 0, conflict: 0 };
        for (const point of points) {
          const key = normalizeConsensusRole(point?.role);
          counts[key] += 1;
        }
        const total = points.length;
        const ordered = [
          { role: "lead", label: "Lead consensus", tone: "call-lead", count: counts.lead },
          { role: "rival", label: "Rival consensus", tone: "call-rival", count: counts.rival },
          { role: "split", label: "Split consensus", tone: "call-rival", count: counts.split },
          { role: "hold", label: "Hold consensus", tone: "call-hold", count: counts.hold },
          { role: "mixed", label: "Mixed consensus", tone: "call-rival", count: counts.mixed },
          { role: "conflict", label: "Conflict consensus", tone: "call-hold", count: counts.conflict },
        ].sort((a, b) => b.count - a.count);
        const dominant = ordered[0];
        const second = ordered[1];
        if (dominant.count === second.count) {
          return { label: "Mixed consensus " + dominant.count + "/" + total, tone: "call-rival", hint: "Consensus roles are rotating" };
        }
        return { label: dominant.label + " " + dominant.count + "/" + total, tone: dominant.tone, hint: "Recent consensus bias" };
      }

      function handoffTrendScoreByRole(role) {
        const normalized = String(role || "hold").toLowerCase();
        if (normalized === "lead") return 100;
        if (normalized === "rival") return 70;
        if (normalized === "split") return 45;
        return 25;
      }

      function ahaDuelSignalHandoffTrendSeries(points = ahaDuelSignalHandoffTrendPoints()) {
        return points.map((point) => handoffTrendScoreByRole(point?.role));
      }

      function consensusTrendScoreByRole(role) {
        const normalized = normalizeConsensusRole(role);
        if (normalized === "lead") return 100;
        if (normalized === "rival") return 75;
        if (normalized === "split") return 55;
        if (normalized === "mixed") return 45;
        if (normalized === "hold") return 30;
        return 20;
      }

      function ahaDuelSignalConsensusTrendSeries(points = ahaDuelSignalConsensusTrendPoints()) {
        return points.map((point) => consensusTrendScoreByRole(point?.role));
      }

      function ahaDuelSignalConsensusMomentumMeta(points = ahaDuelSignalConsensusTrendSeries()) {
        if (!points.length) return { label: "No momentum", tone: "call-hold", hint: "Need consensus points" };
        const first = Number(points[0] || 0);
        const last = Number(points[points.length - 1] || 0);
        const delta = last - first;
        const tone = last >= 80 ? "call-lead" : last >= 50 ? "call-rival" : "call-hold";
        if (points.length < 2) {
          return { label: "Baseline", tone, hint: "1 consensus point" };
        }
        if (delta > 0) {
          return { label: "Strengthening +" + delta, tone, hint: points.length + " consensus points" };
        }
        if (delta < 0) {
          return { label: "Drifting -" + Math.abs(delta), tone, hint: points.length + " consensus points" };
        }
        return { label: "Flat", tone, hint: points.length + " consensus points" };
      }

      function ahaDuelSignalConsensusRiskMeta(points = ahaDuelSignalConsensusTrendPoints()) {
        if (!points.length) return { label: "Unknown", tone: "call-hold", hint: "Need consensus states" };
        const total = points.length;
        let unstable = 0;
        for (const point of points) {
          const role = normalizeConsensusRole(point?.role);
          if (role === "mixed" || role === "conflict" || role === "split") {
            unstable += 1;
          } else if (role === "hold") {
            unstable += 0.5;
          }
        }
        const ratio = unstable / Math.max(total, 1);
        if (ratio <= 0.2) {
          return { label: "Low consensus risk", tone: "call-lead", hint: unstable + "/" + total + " unstable states" };
        }
        if (ratio <= 0.5) {
          return { label: "Medium consensus risk", tone: "call-rival", hint: unstable + "/" + total + " unstable states" };
        }
        return { label: "High consensus risk", tone: "call-hold", hint: unstable + "/" + total + " unstable states" };
      }

      function ahaDuelSignalConsensusStabilityMeta(points = ahaDuelSignalConsensusTrendPoints()) {
        if (!points.length) return { label: "Baseline", tone: "call-hold", hint: "Need consensus states" };
        if (points.length < 2) return { label: "Steady 100%", tone: "call-lead", hint: "0/0 shifts" };
        const roles = points.map((point) => normalizeConsensusRole(point?.role));
        const windows = Math.max(roles.length - 1, 1);
        let shifts = 0;
        for (let index = 1; index < roles.length; index += 1) {
          if (roles[index] !== roles[index - 1]) {
            shifts += 1;
          }
        }
        const stability = Math.max(0, Math.round(((windows - shifts) / windows) * 100));
        if (stability >= 75) {
          return { label: "Steady " + stability + "%", tone: "call-lead", hint: shifts + "/" + windows + " shifts" };
        }
        if (stability >= 45) {
          return { label: "Mixed " + stability + "%", tone: "call-rival", hint: shifts + "/" + windows + " shifts" };
        }
        return { label: "Volatile " + stability + "%", tone: "call-hold", hint: shifts + "/" + windows + " shifts" };
      }

      function ahaDuelSignalConsensusReadinessMeta(poolItems = null) {
        const ranked =
          Array.isArray(poolItems) && poolItems.length
            ? sortedAhaItems(poolItems)
            : (() => {
                const visibleItems = visibleQueueItems();
                const pool = visibleItems.length ? visibleItems : allItems;
                return sortedAhaItems(pool);
              })();
        const consensus = ahaDuelSignalConsensusMeta(ranked);
        if (!consensus) return null;
        const role = normalizeConsensusRole(consensus.role);
        const risk = ahaDuelSignalConsensusRiskMeta();
        const stability = ahaDuelSignalConsensusStabilityMeta();
        const momentum = ahaDuelSignalConsensusMomentumMeta();
        const riskLabel = String(risk?.label || "").toLowerCase();
        const stabilityLabel = String(stability?.label || "").toLowerCase();
        const momentumLabel = String(momentum?.label || "").toLowerCase();
        const roleTone = role === "lead" ? "call-lead" : role === "rival" ? "call-rival" : "call-hold";

        if (role === "hold" || role === "mixed" || role === "conflict") {
          return { label: "Hold confirmation", tone: "call-hold", hint: "Consensus unresolved · " + consensus.hint };
        }
        if (role === "split") {
          return { label: "Split test ready", tone: "call-rival", hint: "Run lead and rival in parallel" };
        }
        if (riskLabel.includes("high") || stabilityLabel.includes("volatile")) {
          return { label: "Delay execution", tone: "call-hold", hint: "Risk high or stability volatile" };
        }
        if (momentumLabel.includes("drifting")) {
          return { label: "Probe before commit", tone: "call-rival", hint: "Consensus momentum is drifting" };
        }
        if (riskLabel.includes("low") && stabilityLabel.includes("steady") && momentumLabel.includes("strengthening")) {
          return { label: "Execute now", tone: roleTone, hint: "Low risk + steady + strengthening" };
        }
        if (riskLabel.includes("low") && stabilityLabel.includes("steady")) {
          return { label: "Ready with guardrails", tone: roleTone, hint: "Stable lane, monitor momentum" };
        }
        return { label: "Cautious go", tone: roleTone, hint: "Run with tight follow-up checks" };
      }

      function ahaDuelSignalConsensusWindowMeta(poolItems = null) {
        const ranked =
          Array.isArray(poolItems) && poolItems.length
            ? sortedAhaItems(poolItems)
            : (() => {
                const visibleItems = visibleQueueItems();
                const pool = visibleItems.length ? visibleItems : allItems;
                return sortedAhaItems(pool);
              })();
        const consensus = ahaDuelSignalConsensusMeta(ranked);
        const readiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const momentum = ahaDuelSignalConsensusMomentumMeta();
        if (!consensus || !readiness) return null;
        const role = normalizeConsensusRole(consensus.role);
        const momentumLabel = String(momentum?.label || "").toLowerCase();
        if (role === "hold" || role === "mixed" || role === "conflict" || readiness.label === "Delay execution") {
          return { label: "Hold window", tone: "call-hold", hint: "Wait for lower risk and steadier consensus" };
        }
        if (role === "split" || readiness.label === "Split test ready") {
          return { label: "Parallel window", tone: "call-rival", hint: "Execute lead + rival with short checkpoints" };
        }
        if (readiness.label === "Execute now" && momentumLabel.includes("strengthening")) {
          return { label: "Immediate window", tone: readiness.tone, hint: "Commit now while alignment is strengthening" };
        }
        if (readiness.label === "Ready with guardrails") {
          return { label: "Staged window", tone: readiness.tone, hint: "Execute with a fallback trigger in place" };
        }
        if (readiness.label === "Probe before commit" || readiness.label === "Cautious go") {
          return { label: "Probe window", tone: "call-rival", hint: "Run a small probe, then re-evaluate" };
        }
        return { label: "Adaptive window", tone: readiness.tone, hint: "Monitor next consensus update before scaling" };
      }

      function ahaDuelSignalConsensusGuardrailMeta(poolItems = null) {
        const ranked =
          Array.isArray(poolItems) && poolItems.length
            ? sortedAhaItems(poolItems)
            : (() => {
                const visibleItems = visibleQueueItems();
                const pool = visibleItems.length ? visibleItems : allItems;
                return sortedAhaItems(pool);
              })();
        const consensus = ahaDuelSignalConsensusMeta(ranked);
        const readiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const windowMeta = ahaDuelSignalConsensusWindowMeta(ranked);
        const risk = ahaDuelSignalConsensusRiskMeta();
        if (!consensus || !readiness || !windowMeta || !risk) return null;
        const role = normalizeConsensusRole(consensus.role);
        const riskLabel = String(risk.label || "").toLowerCase();
        if (role === "hold" || role === "mixed" || role === "conflict" || readiness.label === "Delay execution") {
          return { label: "Pause guardrail", tone: "call-hold", hint: "No action until risk cools and consensus stabilizes" };
        }
        if (role === "split" || windowMeta.label === "Parallel window") {
          return { label: "Dual-lane guardrail", tone: "call-rival", hint: "Run lead+rival with strict compare checkpoint" };
        }
        if (readiness.label === "Execute now" && riskLabel.includes("low")) {
          return { label: "Single-lane guardrail", tone: readiness.tone, hint: "Set one fallback checkpoint after first execution" };
        }
        if (readiness.label === "Ready with guardrails" || windowMeta.label === "Staged window") {
          return { label: "Checkpoint guardrail", tone: readiness.tone, hint: "Trigger fallback immediately on first drift" };
        }
        if (readiness.label === "Probe before commit" || windowMeta.label === "Probe window") {
          return { label: "Probe guardrail", tone: "call-rival", hint: "Limit blast radius to one probe cycle" };
        }
        return { label: "Adaptive guardrail", tone: readiness.tone, hint: "Re-check readiness before each scale step" };
      }

      function ahaDuelSignalConsensusTriggerMeta(poolItems = null) {
        const ranked =
          Array.isArray(poolItems) && poolItems.length
            ? sortedAhaItems(poolItems)
            : (() => {
                const visibleItems = visibleQueueItems();
                const pool = visibleItems.length ? visibleItems : allItems;
                return sortedAhaItems(pool);
              })();
        const consensus = ahaDuelSignalConsensusMeta(ranked);
        const readiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const windowMeta = ahaDuelSignalConsensusWindowMeta(ranked);
        const guardrail = ahaDuelSignalConsensusGuardrailMeta(ranked);
        if (!consensus || !readiness || !windowMeta || !guardrail) return null;
        const role = normalizeConsensusRole(consensus.role);
        if (role === "hold" || role === "mixed" || role === "conflict" || readiness.label === "Delay execution") {
          return { label: "No trigger", tone: "call-hold", hint: "Wait until consensus exits hold and risk cools" };
        }
        if (role === "split" || windowMeta.label === "Parallel window") {
          return { label: "Trigger split replay", tone: "call-rival", hint: "Run lead+rival now, compare primary action outcomes" };
        }
        if (readiness.label === "Execute now" && windowMeta.label === "Immediate window") {
          return { label: "Trigger immediate execute", tone: readiness.tone, hint: "Fire top action now with " + guardrail.label };
        }
        if (readiness.label === "Ready with guardrails" || windowMeta.label === "Staged window") {
          return { label: "Trigger staged execute", tone: readiness.tone, hint: "Execute next action after checkpoint is set" };
        }
        if (readiness.label === "Probe before commit" || windowMeta.label === "Probe window") {
          return { label: "Trigger probe execute", tone: "call-rival", hint: "Execute one probe cycle and re-evaluate" };
        }
        return { label: "Trigger watch execute", tone: readiness.tone, hint: "Re-check consensus on next refresh before scaling" };
      }

      function ahaDuelSignalConsensusProtocolMeta(poolItems = null) {
        const ranked =
          Array.isArray(poolItems) && poolItems.length
            ? sortedAhaItems(poolItems)
            : (() => {
                const visibleItems = visibleQueueItems();
                const pool = visibleItems.length ? visibleItems : allItems;
                return sortedAhaItems(pool);
              })();
        const readiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const windowMeta = ahaDuelSignalConsensusWindowMeta(ranked);
        const guardrail = ahaDuelSignalConsensusGuardrailMeta(ranked);
        const trigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        if (!readiness || !windowMeta || !guardrail || !trigger) return null;
        if (trigger.label === "No trigger") {
          return { label: "Standby protocol", tone: "call-hold", hint: "Wait for trigger, then re-check guardrail" };
        }
        if (trigger.label === "Trigger split replay" || windowMeta.label === "Parallel window") {
          return { label: "Parallel protocol", tone: "call-rival", hint: "Run dual-lane flow and compare outcomes before commit" };
        }
        if (trigger.label === "Trigger immediate execute") {
          return { label: "Sprint protocol", tone: readiness.tone, hint: "Execute now and pin " + guardrail.label };
        }
        if (trigger.label === "Trigger staged execute") {
          return { label: "Checkpoint protocol", tone: readiness.tone, hint: "Set fallback checkpoint, then execute staged steps" };
        }
        if (trigger.label === "Trigger probe execute") {
          return { label: "Probe protocol", tone: "call-rival", hint: "Limit to one probe cycle and evaluate drift" };
        }
        return { label: "Adaptive protocol", tone: readiness.tone, hint: "Scale only after next consensus refresh confirms trigger" };
      }

      function ahaDuelSignalConsensusProtocolConfidenceMeta(poolItems = null) {
        const ranked =
          Array.isArray(poolItems) && poolItems.length
            ? sortedAhaItems(poolItems)
            : (() => {
                const visibleItems = visibleQueueItems();
                const pool = visibleItems.length ? visibleItems : allItems;
                return sortedAhaItems(pool);
              })();
        const protocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const readiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const windowMeta = ahaDuelSignalConsensusWindowMeta(ranked);
        const guardrail = ahaDuelSignalConsensusGuardrailMeta(ranked);
        const trigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        if (!protocol || !readiness || !windowMeta || !guardrail || !trigger) return null;
        let score = 50;
        if (readiness.label.includes("Execute now")) score += 25;
        else if (readiness.label.includes("Ready with guardrails")) score += 15;
        else if (readiness.label.includes("Probe before commit")) score += 6;
        else if (readiness.label.includes("Cautious go")) score += 4;
        else if (readiness.label.includes("Split test ready")) score += 10;
        else if (readiness.label.includes("Delay execution")) score -= 25;
        else if (readiness.label.includes("Hold confirmation")) score -= 20;

        if (windowMeta.label.includes("Immediate")) score += 15;
        else if (windowMeta.label.includes("Staged")) score += 9;
        else if (windowMeta.label.includes("Probe")) score += 2;
        else if (windowMeta.label.includes("Parallel")) score += 6;
        else if (windowMeta.label.includes("Hold")) score -= 15;
        else if (windowMeta.label.includes("Adaptive")) score += 4;

        if (guardrail.label.includes("Single-lane")) score += 10;
        else if (guardrail.label.includes("Checkpoint")) score += 8;
        else if (guardrail.label.includes("Dual-lane")) score += 4;
        else if (guardrail.label.includes("Probe")) score += 2;
        else if (guardrail.label.includes("Pause")) score -= 10;
        else if (guardrail.label.includes("Adaptive")) score += 4;

        if (trigger.label.includes("immediate")) score += 15;
        else if (trigger.label.includes("staged")) score += 10;
        else if (trigger.label.includes("probe")) score += 5;
        else if (trigger.label.includes("split")) score += 8;
        else if (trigger.label.includes("No trigger")) score -= 20;
        else if (trigger.label.includes("watch")) score += 2;

        const normalized = Math.max(0, Math.min(100, Math.round(score)));
        if (normalized >= 85) {
          return {
            label: "Protocol Prime " + normalized,
            tone: "call-lead",
            hint: "trigger " + trigger.label + " · " + protocol.label,
            score: normalized,
          };
        }
        if (normalized >= 70) {
          return {
            label: "Protocol Ready " + normalized,
            tone: "call-lead",
            hint: "window " + windowMeta.label + " · " + guardrail.label,
            score: normalized,
          };
        }
        if (normalized >= 50) {
          return {
            label: "Protocol Watch " + normalized,
            tone: "call-rival",
            hint: "readiness " + readiness.label + " · " + trigger.label,
            score: normalized,
          };
        }
        return {
          label: "Protocol Fragile " + normalized,
          tone: "call-hold",
          hint: "guardrail " + guardrail.label + " · " + trigger.label,
          score: normalized,
        };
      }

      function ahaDuelSignalConsensusProtocolTrendMeta(points = ahaDuelSignalConsensusProtocolConfidencePoints()) {
        if (!points.length) return { label: "No trend", tone: "call-hold", hint: "Need protocol confidence points" };
        const values = points.map((point) => Number(point?.score || 0));
        const first = Number(values[0] || 0);
        const last = Number(values[values.length - 1] || 0);
        const delta = last - first;
        const tone = last >= 80 ? "call-lead" : last >= 55 ? "call-rival" : "call-hold";
        if (values.length < 2) {
          return { label: "Baseline", tone, hint: "1 protocol confidence point" };
        }
        if (delta > 0) {
          return { label: "Rising +" + delta, tone, hint: values.length + " protocol confidence points" };
        }
        if (delta < 0) {
          return { label: "Falling -" + Math.abs(delta), tone, hint: values.length + " protocol confidence points" };
        }
        return { label: "Flat", tone, hint: values.length + " protocol confidence points" };
      }

      function ahaDuelSignalConsensusProtocolRiskMeta(points = ahaDuelSignalConsensusProtocolConfidencePoints()) {
        if (!points.length) return { label: "Unknown", tone: "call-hold", hint: "Need protocol confidence points" };
        if (points.length < 2) return { label: "Low protocol risk", tone: "call-lead", hint: "Baseline confidence sample" };
        const values = points.map((point) => Number(point?.score || 0));
        let totalSwing = 0;
        let maxSwing = 0;
        for (let index = 1; index < values.length; index += 1) {
          const swing = Math.abs(values[index] - values[index - 1]);
          totalSwing += swing;
          if (swing > maxSwing) {
            maxSwing = swing;
          }
        }
        const windows = Math.max(values.length - 1, 1);
        const avgSwing = Number((totalSwing / windows).toFixed(1));
        if (avgSwing <= 8 && maxSwing <= 15) {
          return { label: "Low protocol risk", tone: "call-lead", hint: "avg swing " + avgSwing + " · max " + maxSwing };
        }
        if (avgSwing <= 18 && maxSwing <= 30) {
          return { label: "Medium protocol risk", tone: "call-rival", hint: "avg swing " + avgSwing + " · max " + maxSwing };
        }
        return { label: "High protocol risk", tone: "call-hold", hint: "avg swing " + avgSwing + " · max " + maxSwing };
      }

      function ahaDuelSignalConsensusProtocolRegimeMeta(
        points = ahaDuelSignalConsensusProtocolConfidencePoints(),
        trend = ahaDuelSignalConsensusProtocolTrendMeta(points),
        risk = ahaDuelSignalConsensusProtocolRiskMeta(points),
      ) {
        if (!points.length) return { label: "Unknown regime", tone: "call-hold", hint: "Need protocol confidence points" };
        const values = points.map((point) => Number(point?.score || 0));
        const last = Number(values[values.length - 1] || 0);
        const trendLabel = String(trend?.label || "").toLowerCase();
        const riskLabel = String(risk?.label || "").toLowerCase();
        const rising = trendLabel.includes("rising");
        const falling = trendLabel.includes("falling");
        const highRisk = riskLabel.includes("high");
        const mediumRisk = riskLabel.includes("medium");
        if (highRisk) {
          return { label: "Whipsaw protocol lane", tone: "call-hold", hint: trend.label + " · " + risk.label };
        }
        if (last >= 82 && rising && !mediumRisk) {
          return { label: "Breakout protocol lane", tone: "call-lead", hint: trend.label + " · " + risk.label };
        }
        if (last >= 68 && !falling && !highRisk) {
          return { label: "Stable protocol lane", tone: "call-lead", hint: trend.label + " · " + risk.label };
        }
        if (falling && last < 60) {
          return { label: "Cooling protocol lane", tone: "call-hold", hint: trend.label + " · " + risk.label };
        }
        if (last >= 45) {
          return { label: "Probe protocol lane", tone: "call-rival", hint: trend.label + " · " + risk.label };
        }
        return { label: "Fragile protocol lane", tone: "call-hold", hint: trend.label + " · " + risk.label };
      }

      function ahaDuelSignalConsensusProtocolCadenceMeta(
        points = ahaDuelSignalConsensusProtocolConfidencePoints(),
        trend = ahaDuelSignalConsensusProtocolTrendMeta(points),
        risk = ahaDuelSignalConsensusProtocolRiskMeta(points),
        regime = ahaDuelSignalConsensusProtocolRegimeMeta(points, trend, risk),
      ) {
        if (!points.length) return { label: "Unknown cadence", tone: "call-hold", hint: "Need protocol confidence points" };
        const regimeLabel = String(regime?.label || "").toLowerCase();
        const riskLabel = String(risk?.label || "").toLowerCase();
        const trendLabel = String(trend?.label || "").toLowerCase();
        if (regimeLabel.includes("whipsaw") || riskLabel.includes("high")) {
          return { label: "Hold cadence", tone: "call-hold", hint: regime.label + " · " + risk.label };
        }
        if (regimeLabel.includes("breakout") && trendLabel.includes("rising")) {
          return { label: "Burst cadence", tone: "call-lead", hint: trend.label + " · " + regime.label };
        }
        if (regimeLabel.includes("stable") && riskLabel.includes("low")) {
          return { label: "Rhythm cadence", tone: "call-lead", hint: risk.label + " · " + regime.label };
        }
        if (regimeLabel.includes("probe")) {
          return { label: "Probe cadence", tone: "call-rival", hint: trend.label + " · " + regime.label };
        }
        if (regimeLabel.includes("cooling") || regimeLabel.includes("fragile")) {
          return { label: "Watch cadence", tone: "call-hold", hint: trend.label + " · " + regime.label };
        }
        return { label: "Rhythm cadence", tone: "call-rival", hint: trend.label + " · " + risk.label };
      }

      function ahaDuelSignalConsensusProtocolPressureMeta(
        points = ahaDuelSignalConsensusProtocolConfidencePoints(),
        trend = ahaDuelSignalConsensusProtocolTrendMeta(points),
        risk = ahaDuelSignalConsensusProtocolRiskMeta(points),
        regime = ahaDuelSignalConsensusProtocolRegimeMeta(points, trend, risk),
        cadence = ahaDuelSignalConsensusProtocolCadenceMeta(points, trend, risk, regime),
      ) {
        if (!points.length) return { label: "Unknown pressure", tone: "call-hold", hint: "Need protocol confidence points" };
        const regimeLabel = String(regime?.label || "").toLowerCase();
        const cadenceLabel = String(cadence?.label || "").toLowerCase();
        const riskLabel = String(risk?.label || "").toLowerCase();
        if (riskLabel.includes("high") || cadenceLabel.includes("hold")) {
          return { label: "Freeze pressure", tone: "call-hold", hint: risk.label + " · " + cadence.label };
        }
        if (regimeLabel.includes("breakout") && cadenceLabel.includes("burst")) {
          return { label: "Surge pressure", tone: "call-lead", hint: regime.label + " · " + cadence.label };
        }
        if (regimeLabel.includes("stable") && cadenceLabel.includes("rhythm")) {
          return { label: "Stable pressure", tone: "call-lead", hint: risk.label + " · " + cadence.label };
        }
        if (cadenceLabel.includes("probe") || regimeLabel.includes("probe")) {
          return { label: "Probe pressure", tone: "call-rival", hint: trend.label + " · " + cadence.label };
        }
        return { label: "Caution pressure", tone: "call-rival", hint: regime.label + " · " + risk.label };
      }

      function ahaDuelSignalConsensusProtocolCommandMeta(
        poolItems = null,
        trigger = null,
        protocol = null,
        cadence = null,
        pressure = null,
      ) {
        const ranked =
          Array.isArray(poolItems) && poolItems.length
            ? sortedAhaItems(poolItems)
            : (() => {
                const visibleItems = visibleQueueItems();
                const pool = visibleItems.length ? visibleItems : allItems;
                return sortedAhaItems(pool);
              })();
        const resolvedTrigger = trigger || ahaDuelSignalConsensusTriggerMeta(ranked);
        const resolvedProtocol = protocol || ahaDuelSignalConsensusProtocolMeta(ranked);
        const resolvedCadence = cadence || ahaDuelSignalConsensusProtocolCadenceMeta();
        const resolvedPressure = pressure || ahaDuelSignalConsensusProtocolPressureMeta();
        if (!resolvedTrigger || !resolvedProtocol || !resolvedCadence || !resolvedPressure) {
          return null;
        }
        const triggerLabel = String(resolvedTrigger.label || "").toLowerCase();
        const cadenceLabel = String(resolvedCadence.label || "").toLowerCase();
        const pressureLabel = String(resolvedPressure.label || "").toLowerCase();
        if (triggerLabel.includes("no trigger") || pressureLabel.includes("freeze")) {
          return { label: "Hold command", tone: "call-hold", hint: resolvedTrigger.label + " · " + resolvedPressure.label };
        }
        if (triggerLabel.includes("split")) {
          return { label: "Split command", tone: "call-rival", hint: resolvedTrigger.label + " · " + resolvedProtocol.label };
        }
        if (triggerLabel.includes("immediate") && cadenceLabel.includes("burst") && !pressureLabel.includes("caution")) {
          return { label: "Launch command", tone: "call-lead", hint: resolvedTrigger.label + " · " + resolvedCadence.label };
        }
        if (triggerLabel.includes("staged") || cadenceLabel.includes("rhythm")) {
          return { label: "Stage command", tone: "call-lead", hint: resolvedCadence.label + " · " + resolvedPressure.label };
        }
        if (triggerLabel.includes("probe") || cadenceLabel.includes("probe")) {
          return { label: "Probe command", tone: "call-rival", hint: resolvedTrigger.label + " · " + resolvedCadence.label };
        }
        if (triggerLabel.includes("watch") || pressureLabel.includes("caution") || cadenceLabel.includes("watch")) {
          return { label: "Watch command", tone: "call-rival", hint: resolvedPressure.label + " · " + resolvedCadence.label };
        }
        return { label: "Stage command", tone: "call-rival", hint: resolvedProtocol.label + " · " + resolvedCadence.label };
      }

      function ahaDuelSignalConsensusProtocolScriptMeta(
        poolItems = null,
        command = null,
        cadence = null,
        pressure = null,
      ) {
        const ranked =
          Array.isArray(poolItems) && poolItems.length
            ? sortedAhaItems(poolItems)
            : (() => {
                const visibleItems = visibleQueueItems();
                const pool = visibleItems.length ? visibleItems : allItems;
                return sortedAhaItems(pool);
              })();
        const resolvedCadence = cadence || ahaDuelSignalConsensusProtocolCadenceMeta();
        const resolvedPressure = pressure || ahaDuelSignalConsensusProtocolPressureMeta();
        const resolvedCommand =
          command ||
          ahaDuelSignalConsensusProtocolCommandMeta(
            ranked,
            null,
            null,
            resolvedCadence,
            resolvedPressure,
          );
        if (!resolvedCommand || !resolvedCadence || !resolvedPressure) return null;
        const commandLabel = String(resolvedCommand.label || "").toLowerCase();
        if (commandLabel.includes("launch")) {
          return { label: "Execute lead now script", tone: "call-lead", hint: resolvedCommand.label + " · " + resolvedCadence.label };
        }
        if (commandLabel.includes("stage")) {
          return { label: "Stage checkpoint script", tone: "call-lead", hint: resolvedCommand.label + " · " + resolvedPressure.label };
        }
        if (commandLabel.includes("probe")) {
          return { label: "Probe compare script", tone: "call-rival", hint: resolvedCommand.label + " · " + resolvedCadence.label };
        }
        if (commandLabel.includes("watch")) {
          return { label: "Watch refresh script", tone: "call-rival", hint: resolvedCommand.label + " · " + resolvedPressure.label };
        }
        if (commandLabel.includes("split")) {
          return { label: "Split replay script", tone: "call-rival", hint: resolvedCommand.label + " · " + resolvedPressure.label };
        }
        return { label: "Hold and wait script", tone: "call-hold", hint: resolvedCommand.label + " · " + resolvedPressure.label };
      }

      function ahaDuelSignalConsensusProtocolScriptLaneMeta(
        poolItems = null,
        script = null,
        command = null,
      ) {
        const ranked =
          Array.isArray(poolItems) && poolItems.length
            ? sortedAhaItems(poolItems)
            : (() => {
                const visibleItems = visibleQueueItems();
                const pool = visibleItems.length ? visibleItems : allItems;
                return sortedAhaItems(pool);
              })();
        const resolvedCommand = command || ahaDuelSignalConsensusProtocolCommandMeta(ranked);
        const resolvedScript = script || ahaDuelSignalConsensusProtocolScriptMeta(ranked, resolvedCommand);
        if (!resolvedScript || !resolvedCommand) return null;
        const scriptLabel = String(resolvedScript.label || "").toLowerCase();
        if (scriptLabel.includes("execute")) {
          return { label: "Execute lane", tone: "call-lead", hint: resolvedScript.label + " · " + resolvedCommand.label };
        }
        if (scriptLabel.includes("stage")) {
          return { label: "Checkpoint lane", tone: "call-lead", hint: resolvedScript.label + " · " + resolvedCommand.label };
        }
        if (scriptLabel.includes("probe")) {
          return { label: "Probe lane", tone: "call-rival", hint: resolvedScript.label + " · " + resolvedCommand.label };
        }
        if (scriptLabel.includes("watch")) {
          return { label: "Watch lane", tone: "call-rival", hint: resolvedScript.label + " · " + resolvedCommand.label };
        }
        if (scriptLabel.includes("split")) {
          return { label: "Replay lane", tone: "call-rival", hint: resolvedScript.label + " · " + resolvedCommand.label };
        }
        return { label: "Hold lane", tone: "call-hold", hint: resolvedScript.label + " · " + resolvedCommand.label };
      }

      function ahaDuelSignalConsensusProtocolScriptChecklistMeta(
        poolItems = null,
        script = null,
        lane = null,
        command = null,
      ) {
        const ranked =
          Array.isArray(poolItems) && poolItems.length
            ? sortedAhaItems(poolItems)
            : (() => {
                const visibleItems = visibleQueueItems();
                const pool = visibleItems.length ? visibleItems : allItems;
                return sortedAhaItems(pool);
              })();
        const resolvedCommand = command || ahaDuelSignalConsensusProtocolCommandMeta(ranked);
        const resolvedScript = script || ahaDuelSignalConsensusProtocolScriptMeta(ranked, resolvedCommand);
        const resolvedLane = lane || ahaDuelSignalConsensusProtocolScriptLaneMeta(ranked, resolvedScript, resolvedCommand);
        if (!resolvedScript || !resolvedLane || !resolvedCommand) return null;
        const laneLabel = String(resolvedLane.label || "").toLowerCase();
        if (laneLabel.includes("execute")) {
          return { label: "Lead launch checklist", tone: "call-lead", hint: "Run lead → verify checkpoint → log delta" };
        }
        if (laneLabel.includes("checkpoint")) {
          return { label: "Stage checkpoint checklist", tone: "call-lead", hint: "Ship stage 1 → verify guardrail → unlock next stage" };
        }
        if (laneLabel.includes("probe")) {
          return { label: "Probe compare checklist", tone: "call-rival", hint: "Run probe A/B → compare signal drift → pick lane" };
        }
        if (laneLabel.includes("watch")) {
          return { label: "Watch refresh checklist", tone: "call-rival", hint: "Hold execution → refresh signal window → re-evaluate trigger" };
        }
        if (laneLabel.includes("replay")) {
          return { label: "Replay split checklist", tone: "call-rival", hint: "Replay lead+rival → compare outcomes → promote winner" };
        }
        return { label: "Hold readiness checklist", tone: "call-hold", hint: "Pause action → gather confidence points → wait for stable trigger" };
      }

      function ahaDuelSignalConsensusProtocolBarsHtml(points = ahaDuelSignalConsensusProtocolConfidencePoints()) {
        if (!points.length) return "";
        const values = points.map((point) => Number(point?.score || 0));
        const maxValue = Math.max(...values, 1);
        const minValue = Math.min(...values);
        return values
          .map((value, index) => {
            const height = Math.max(Math.round((value / maxValue) * 100), 18);
            const tone = value === maxValue ? " high" : values.length > 1 && value === minValue && maxValue !== minValue ? " low" : "";
            return (
              '<span class="bar' +
              tone +
              '" style="height:' +
              height +
              '%" title="p' +
              (index + 1) +
              ": " +
              value +
              '"></span>'
            );
          })
          .join("");
      }

      function ahaDuelSignalHandoffMomentumMeta(points = ahaDuelSignalHandoffTrendSeries()) {
        if (!points.length) return { label: "No momentum", tone: "call-hold", hint: "Need handoff points" };
        const first = Number(points[0] || 0);
        const last = Number(points[points.length - 1] || 0);
        const delta = last - first;
        const tone = last >= 80 ? "call-lead" : last >= 50 ? "call-rival" : "call-hold";
        if (points.length < 2) {
          return { label: "Baseline", tone, hint: "1 handoff point" };
        }
        if (delta > 0) {
          return { label: "Escalating +" + delta, tone, hint: points.length + " handoff points" };
        }
        if (delta < 0) {
          return { label: "Softening -" + Math.abs(delta), tone, hint: points.length + " handoff points" };
        }
        return { label: "Flat", tone, hint: points.length + " handoff points" };
      }

      function ahaDuelSignalHandoffTrendBarsHtml(points = ahaDuelSignalHandoffTrendSeries()) {
        if (!points.length) return "";
        const values = points.map((point) => Number(point || 0));
        const maxValue = Math.max(...values, 1);
        const minValue = Math.min(...values);
        return points
          .map((point, index) => {
            const value = Number(point || 0);
            const height = Math.max(Math.round((value / maxValue) * 100), 18);
            const tone = value === maxValue ? " high" : values.length > 1 && value === minValue && maxValue !== minValue ? " low" : "";
            return (
              '<span class="bar' +
              tone +
              '" style="height:' +
              height +
              '%" title="h' +
              (index + 1) +
              ": " +
              value +
              '"></span>'
            );
          })
          .join("");
      }

      function ahaDuelSignalConsensusTrendBarsHtml(points = ahaDuelSignalConsensusTrendSeries()) {
        if (!points.length) return "";
        const values = points.map((point) => Number(point || 0));
        const maxValue = Math.max(...values, 1);
        const minValue = Math.min(...values);
        return points
          .map((point, index) => {
            const value = Number(point || 0);
            const height = Math.max(Math.round((value / maxValue) * 100), 18);
            const tone = value === maxValue ? " high" : values.length > 1 && value === minValue && maxValue !== minValue ? " low" : "";
            return (
              '<span class="bar' +
              tone +
              '" style="height:' +
              height +
              '%" title="c' +
              (index + 1) +
              ": " +
              value +
              '"></span>'
            );
          })
          .join("");
      }

      function ahaDuelCallTrendMeta(points = ahaDuelCallTrendPoints()) {
        if (!points.length) return { label: "No signal", tone: "call-hold" };
        const counts = { lead: 0, rival: 0, hold: 0 };
        for (const point of points) {
          const key = String(point?.role || "hold");
          if (key === "lead" || key === "rival" || key === "hold") {
            counts[key] += 1;
          } else {
            counts.hold += 1;
          }
        }
        const total = points.length;
        const lead = counts.lead;
        const rival = counts.rival;
        const hold = counts.hold;
        if (lead === rival && rival === hold) {
          return { label: "Split signal " + lead + "/" + total, tone: "call-hold" };
        }
        if (lead >= rival && lead >= hold) {
          return { label: "Lead bias " + lead + "/" + total, tone: "call-lead" };
        }
        if (rival >= lead && rival >= hold) {
          return { label: "Rival bias " + rival + "/" + total, tone: "call-rival" };
        }
        return { label: "Hold bias " + hold + "/" + total, tone: "call-hold" };
      }

      function ahaDuelCallConfidenceMeta(points = ahaDuelCallTrendPoints()) {
        if (!points.length) {
          return { label: "Baseline 0%", tone: "call-hold", hint: "Need more duel samples" };
        }
        const counts = { lead: 0, rival: 0, hold: 0 };
        for (const point of points) {
          const key = String(point?.role || "hold");
          if (key === "lead" || key === "rival" || key === "hold") {
            counts[key] += 1;
          } else {
            counts.hold += 1;
          }
        }
        const total = points.length;
        const entries = [
          { role: "lead", count: counts.lead, tone: "call-lead", label: "Lead" },
          { role: "rival", count: counts.rival, tone: "call-rival", label: "Rival" },
          { role: "hold", count: counts.hold, tone: "call-hold", label: "Hold" },
        ].sort((a, b) => b.count - a.count);
        const dominant = entries[0];
        const ratio = Math.round((dominant.count / Math.max(total, 1)) * 100);
        return {
          label: dominant.label + " " + ratio + "%",
          tone: dominant.tone,
          hint: dominant.count + "/" + total + " recent calls",
        };
      }

      function ahaDuelCallStabilityMeta(points = ahaDuelCallTrendPoints()) {
        if (!points.length) {
          return { label: "Baseline 0%", tone: "call-hold", hint: "Need more call transitions" };
        }
        if (points.length < 2) {
          return { label: "Steady 100%", tone: "call-lead", hint: "Only one call observed" };
        }
        let shifts = 0;
        for (let index = 1; index < points.length; index += 1) {
          const prev = String(points[index - 1]?.role || "hold");
          const current = String(points[index]?.role || "hold");
          if (prev !== current) shifts += 1;
        }
        const windows = Math.max(points.length - 1, 1);
        const stability = Math.max(0, Math.round(((windows - shifts) / windows) * 100));
        if (stability >= 75) {
          return { label: "Steady " + stability + "%", tone: "call-lead", hint: shifts + "/" + windows + " shifts" };
        }
        if (stability >= 45) {
          return { label: "Mixed " + stability + "%", tone: "call-rival", hint: shifts + "/" + windows + " shifts" };
        }
        return { label: "Volatile " + stability + "%", tone: "call-hold", hint: shifts + "/" + windows + " shifts" };
      }

      function ahaDuelCallRiskMeta(points = ahaDuelCallTrendPoints()) {
        if (!points.length) {
          return { label: "Unknown", tone: "call-hold", hint: "Need call transitions" };
        }
        if (points.length < 2) {
          return { label: "Low shift risk", tone: "call-lead", hint: "0/1 shifts" };
        }
        let shifts = 0;
        for (let index = 1; index < points.length; index += 1) {
          const prev = String(points[index - 1]?.role || "hold");
          const current = String(points[index]?.role || "hold");
          if (prev !== current) shifts += 1;
        }
        const windows = Math.max(points.length - 1, 1);
        const shiftRatio = shifts / windows;
        if (shiftRatio <= 0.25) {
          return { label: "Low shift risk", tone: "call-lead", hint: shifts + "/" + windows + " shifts" };
        }
        if (shiftRatio <= 0.55) {
          return { label: "Medium shift risk", tone: "call-rival", hint: shifts + "/" + windows + " shifts" };
        }
        return { label: "High shift risk", tone: "call-hold", hint: shifts + "/" + windows + " shifts" };
      }

      function duelCallRoleSymbol(role) {
        const value = String(role || "hold").toLowerCase();
        if (value === "lead") return "L";
        if (value === "rival") return "R";
        return "H";
      }

      function duelCallRoleTone(role) {
        const value = String(role || "hold").toLowerCase();
        if (value === "lead") return "call-lead";
        if (value === "rival") return "call-rival";
        return "call-hold";
      }

      function ahaDuelCallSequenceMeta(points = ahaDuelCallTrendPoints(), limit = 6) {
        if (!points.length) {
          return { label: "No sequence", tone: "call-hold", hint: "Awaiting duel calls" };
        }
        const recent = points.slice(-Math.max(2, Number(limit) || 2));
        const label = recent.map((point) => duelCallRoleSymbol(point?.role)).join(" → ");
        const lastRole = String(recent[recent.length - 1]?.role || "hold");
        return {
          label,
          tone: duelCallRoleTone(lastRole),
          hint: "Last " + recent.length + " calls",
        };
      }

      function percentFromLabel(labelText, fallback = 0) {
        const match = String(labelText || "").match(/([0-9]{1,3})%/);
        if (!match) return Number(fallback || 0);
        return Number(match[1] || 0);
      }

      function riskAdjustmentByLabel(riskLabel) {
        const normalized = String(riskLabel || "").toLowerCase();
        if (normalized.includes("low shift risk")) return 15;
        if (normalized.includes("medium shift risk")) return 0;
        if (normalized.includes("high shift risk")) return -15;
        return 0;
      }

      function ahaDuelSignalMeta(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return null;
        const confidence = ahaDuelCallConfidenceMeta();
        const stability = ahaDuelCallStabilityMeta();
        const risk = ahaDuelCallRiskMeta();
        const confidencePct = percentFromLabel(confidence?.label, 0);
        const stabilityPct = percentFromLabel(stability?.label, 0);
        const riskAdj = riskAdjustmentByLabel(risk?.label);
        const value = Math.max(0, Math.min(100, Math.round(confidencePct * 0.45 + stabilityPct * 0.35 + 20 + riskAdj)));
        const tone = value >= 70 ? "call-lead" : value >= 45 ? "call-rival" : "call-hold";
        return {
          tone,
          label: String(value),
          hint:
            "confidence " +
            confidencePct +
            "% · stability " +
            stabilityPct +
            "% · " +
            String(risk?.label || "risk unknown"),
        };
      }

      function duelSignalScoreByRole(role) {
        const normalized = String(role || "hold").toLowerCase();
        if (normalized === "lead") return 100;
        if (normalized === "rival") return 60;
        return 25;
      }

      function ahaDuelSignalPulsePoints(points = ahaDuelCallTrendPoints()) {
        return points.map((point) => duelSignalScoreByRole(point?.role));
      }

      function ahaDuelSignalPulseMeta(points = ahaDuelSignalPulsePoints()) {
        if (!points.length) {
          return { label: "No pulse", tone: "call-hold", hint: "Need signal points" };
        }
        const first = Number(points[0] || 0);
        const last = Number(points[points.length - 1] || 0);
        const delta = last - first;
        const tone = last >= 75 ? "call-lead" : last >= 45 ? "call-rival" : "call-hold";
        if (points.length < 2) {
          return { label: "Baseline", tone, hint: "1 signal point" };
        }
        if (delta > 0) {
          return { label: "Rising +" + delta, tone, hint: points.length + " signal points" };
        }
        if (delta < 0) {
          return { label: "Cooling -" + Math.abs(delta), tone, hint: points.length + " signal points" };
        }
        return { label: "Flat", tone, hint: points.length + " signal points" };
      }

      function ahaDuelSignalVolatilityMeta(points = ahaDuelSignalPulsePoints()) {
        if (!points.length) {
          return { label: "Baseline 0", tone: "call-hold", hint: "Need signal transitions" };
        }
        if (points.length < 2) {
          return { label: "Calm 0", tone: "call-lead", hint: "0/1 transitions" };
        }
        let totalSwing = 0;
        for (let index = 1; index < points.length; index += 1) {
          const prev = Number(points[index - 1] || 0);
          const current = Number(points[index] || 0);
          totalSwing += Math.abs(current - prev);
        }
        const windows = Math.max(points.length - 1, 1);
        const averageSwing = Math.round(totalSwing / windows);
        if (averageSwing <= 12) {
          return { label: "Calm " + averageSwing, tone: "call-lead", hint: totalSwing + "/" + windows + " swing" };
        }
        if (averageSwing <= 35) {
          return { label: "Active " + averageSwing, tone: "call-rival", hint: totalSwing + "/" + windows + " swing" };
        }
        return { label: "Choppy " + averageSwing, tone: "call-hold", hint: totalSwing + "/" + windows + " swing" };
      }

      function ahaDuelSignalOutlookMeta(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return null;
        const signal = ahaDuelSignalMeta(ranked);
        const pulse = ahaDuelSignalPulseMeta();
        const volatility = ahaDuelSignalVolatilityMeta();
        if (!signal || !pulse || !volatility) return null;
        const signalValue = Number(signal.label || 0);
        const pulseLabel = String(pulse.label || "").toLowerCase();
        const volatilityLabel = String(volatility.label || "").toLowerCase();
        const rising = pulseLabel.startsWith("rising");
        const cooling = pulseLabel.startsWith("cooling");
        const choppy = volatilityLabel.startsWith("choppy");
        if (signalValue >= 75 && rising && !choppy) {
          return { label: "Charge", tone: "call-lead", hint: "High confidence and rising pulse" };
        }
        if (signalValue >= 60 && !cooling && !choppy) {
          return { label: "Advance", tone: "call-lead", hint: "Signal remains strong with controlled swings" };
        }
        if (cooling && choppy) {
          return { label: "Recheck", tone: "call-hold", hint: "Cooling trend with unstable swings" };
        }
        if (choppy || signalValue < 45) {
          return { label: "Probe", tone: "call-rival", hint: "Mixed signal, validate rival before commit" };
        }
        return { label: "Watch", tone: "call-rival", hint: "Stable but undecided, monitor next pulse" };
      }

      function ahaDuelSignalRegimeMeta(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return null;
        const signal = ahaDuelSignalMeta(ranked);
        const pulse = ahaDuelSignalPulseMeta();
        const volatility = ahaDuelSignalVolatilityMeta();
        if (!signal || !pulse || !volatility) return null;
        const signalValue = Number(signal.label || 0);
        const pulseLabel = String(pulse.label || "").toLowerCase();
        const volatilityLabel = String(volatility.label || "").toLowerCase();
        const rising = pulseLabel.startsWith("rising");
        const cooling = pulseLabel.startsWith("cooling");
        const flat = pulseLabel.startsWith("flat") || pulseLabel.startsWith("baseline");
        const calm = volatilityLabel.startsWith("calm");
        const choppy = volatilityLabel.startsWith("choppy");
        if (rising && signalValue >= 70 && !choppy) {
          return { label: "Momentum breakout", tone: "call-lead", hint: "Signal is accelerating with manageable noise" };
        }
        if (flat && calm && signalValue >= 55) {
          return { label: "Stable lane", tone: "call-lead", hint: "Signal is consistent and execution-friendly" };
        }
        if (cooling && choppy) {
          return { label: "Whipsaw risk", tone: "call-hold", hint: "Direction and swings disagree, reduce commitment size" };
        }
        if (signalValue < 45 || choppy) {
          return { label: "Transition zone", tone: "call-rival", hint: "Edge is weak or unstable, gather more evidence" };
        }
        return { label: "Rotation watch", tone: "call-rival", hint: "Signals are rotating, monitor next two pulses closely" };
      }

      function signalConvictionRegimeAdjustment(label) {
        const normalized = String(label || "").toLowerCase();
        if (normalized.includes("momentum breakout")) return 10;
        if (normalized.includes("stable lane")) return 6;
        if (normalized.includes("whipsaw risk")) return -12;
        if (normalized.includes("transition zone")) return -6;
        if (normalized.includes("rotation watch")) return -2;
        return 0;
      }

      function signalConvictionOutlookAdjustment(label) {
        const normalized = String(label || "").toLowerCase();
        if (normalized.includes("charge")) return 8;
        if (normalized.includes("advance")) return 4;
        if (normalized.includes("recheck")) return -8;
        if (normalized.includes("probe")) return -4;
        if (normalized.includes("watch")) return 0;
        return 0;
      }

      function ahaDuelSignalConvictionMeta(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return null;
        const signal = ahaDuelSignalMeta(ranked);
        const confidence = ahaDuelCallConfidenceMeta();
        const regime = ahaDuelSignalRegimeMeta(ranked);
        const outlook = ahaDuelSignalOutlookMeta(ranked);
        if (!signal || !confidence || !regime || !outlook) return null;
        const signalValue = Number(signal.label || 0);
        const confidencePct = percentFromLabel(confidence.label, 0);
        const regimeAdj = signalConvictionRegimeAdjustment(regime.label);
        const outlookAdj = signalConvictionOutlookAdjustment(outlook.label);
        const value = Math.max(0, Math.min(100, Math.round(signalValue * 0.55 + confidencePct * 0.35 + 10 + regimeAdj + outlookAdj)));
        const hint =
          "signal " +
          signalValue +
          " · confidence " +
          confidencePct +
          "% · " +
          regime.label +
          " · " +
          outlook.label;
        if (value >= 80) {
          return { label: "Prime " + value, tone: "call-lead", hint };
        }
        if (value >= 60) {
          return { label: "Ready " + value, tone: "call-lead", hint };
        }
        if (value >= 45) {
          return { label: "Watch " + value, tone: "call-rival", hint };
        }
        return { label: "Fragile " + value, tone: "call-hold", hint };
      }

      function ahaDuelSignalHandoffMeta(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return null;
        const call = ahaDuelCallMeta(ranked);
        const conviction = ahaDuelSignalConvictionMeta(ranked);
        const outlook = ahaDuelSignalOutlookMeta(ranked);
        if (!call || !conviction || !outlook) return null;
        const callRole = String(call.role || "Hold").toLowerCase();
        const convictionLabel = String(conviction.label || "").toLowerCase();
        const outlookLabel = String(outlook.label || "").toLowerCase();
        if (callRole === "hold" || convictionLabel.includes("fragile") || outlookLabel.includes("recheck")) {
          return { role: "hold", label: "Hold & scan", tone: "call-hold", hint: "Wait for a cleaner pulse before committing" };
        }
        if (callRole === "lead" && convictionLabel.includes("prime")) {
          return { role: "lead", label: "Lead sprint", tone: "call-lead", hint: "Lead edge is strong, execute immediately" };
        }
        if (callRole === "lead" && (convictionLabel.includes("ready") || outlookLabel.includes("charge"))) {
          return { role: "lead", label: "Lead push", tone: "call-lead", hint: "Lead setup is healthy, push next action" };
        }
        if (callRole === "rival" || convictionLabel.includes("watch") || outlookLabel.includes("probe")) {
          return { role: "rival", label: "Rival probe", tone: "call-rival", hint: "Run rival test before final commitment" };
        }
        return { role: "split", label: "Split test", tone: "call-rival", hint: "Signals are mixed, split attention across both paths" };
      }

      function roleFromDuelCall(call) {
        const value = String(call?.role || "Hold").toLowerCase();
        if (value === "lead" || value === "rival" || value === "hold") return value;
        return "hold";
      }

      function ahaDuelSignalConsensusMeta(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return null;
        const call = ahaDuelCallMeta(ranked);
        const handoff = ahaDuelSignalHandoffMeta(ranked);
        const trend = ahaDuelSignalHandoffTrendMeta();
        if (!call || !handoff || !trend) return null;
        const callRole = roleFromDuelCall(call);
        const handoffRole = normalizeHandoffRole(handoff.role);
        const trendLabel = String(trend.label || "").toLowerCase();
        if (trendLabel.includes("mixed handoff")) {
          return { role: "mixed", label: "Mixed consensus", tone: "call-rival", hint: "Handoff roles are rotating across recent samples" };
        }
        if (callRole === "hold" || handoffRole === "hold") {
          return { role: "hold", label: "Hold consensus", tone: "call-hold", hint: "Call and handoff both prefer risk control" };
        }
        if (callRole === handoffRole && handoffRole === "lead") {
          return { role: "lead", label: "Aligned Lead", tone: "call-lead", hint: "Call and handoff both back the lead path" };
        }
        if (callRole === handoffRole && handoffRole === "rival") {
          return { role: "rival", label: "Aligned Rival", tone: "call-rival", hint: "Call and handoff both back the rival path" };
        }
        if (handoffRole === "split") {
          return { role: "split", label: "Split consensus", tone: "call-rival", hint: "Call is singular but handoff suggests split execution" };
        }
        return { role: "conflict", label: "Conflict", tone: "call-hold", hint: "Call and handoff disagree, re-check confidence before running" };
      }

      function ahaDuelSignalPulseBarsHtml(points = ahaDuelSignalPulsePoints()) {
        if (!points.length) return "";
        const values = points.map((point) => Number(point || 0));
        const maxValue = Math.max(...values, 1);
        const minValue = Math.min(...values);
        return points
          .map((point, index) => {
            const value = Number(point || 0);
            const height = Math.max(Math.round((value / maxValue) * 100), 18);
            const tone = value === maxValue ? " high" : values.length > 1 && value === minValue && maxValue !== minValue ? " low" : "";
            return (
              '<span class="bar' +
              tone +
              '" style="height:' +
              height +
              '%" title="s' +
              (index + 1) +
              ": " +
              value +
              '"></span>'
            );
          })
          .join("");
      }

      function ahaDuelGapTrendMeta(points = ahaDuelGapTrendPoints()) {
        if (!points.length) return { label: "No trend", tone: "edge-mid" };
        if (points.length < 2) return { label: "Baseline", tone: "edge-mid" };
        const first = Number(points[0]?.gap || 0);
        const last = Number(points[points.length - 1]?.gap || 0);
        const delta = last - first;
        if (delta > 0) return { label: "Widening +" + delta, tone: "edge-strong" };
        if (delta < 0) return { label: "Closing -" + Math.abs(delta), tone: "edge-close" };
        return { label: "Flat", tone: "edge-mid" };
      }

      function ahaDuelGapTrendBarsHtml(points = ahaDuelGapTrendPoints()) {
        if (!points.length) return "";
        const values = points.map((point) => Number(point?.gap || 0));
        const maxValue = Math.max(...values, 1);
        const minValue = Math.min(...values);
        return points
          .map((point, index) => {
            const gap = Number(point?.gap || 0);
            const height = Math.max(Math.round((gap / maxValue) * 100), 18);
            const tone = gap === maxValue ? " high" : values.length > 1 && gap === minValue && maxValue !== minValue ? " low" : "";
            return (
              '<span class="bar' +
              tone +
              '" style="height:' +
              height +
              '%" title="g' +
              (index + 1) +
              ": " +
              gap +
              '"></span>'
            );
          })
          .join("");
      }

      function decisionBriefContextSummary() {
        const statusLabel = statusFilter.value || "all";
        const retryableLabel = retryableFilter.value || "all";
        const stepLabel = failureStepFilter.value || "all";
        const queryLabel = queryInput.value.trim() || "all";
        return (
          "status=" +
          statusLabel +
          " · retryable=" +
          retryableLabel +
          " · step=" +
          stepLabel +
          " · q=" +
          queryLabel
        );
      }

      function ahaDecisionBriefText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (!ranked.length) return "";
        const story = ahaStoryText(ranked, ahaHeatBuckets(ranked));
        const duel = ahaDuelText(ranked);
        const duelGap = ahaDuelGapMeta(ranked);
        const duelEdge = ahaDuelEdgeMeta(ranked);
        const duelCall = ahaDuelCallMeta(ranked);
        const duelCallTrend = ahaDuelCallTrendMeta();
        const duelCallConfidence = ahaDuelCallConfidenceMeta();
        const duelCallStability = ahaDuelCallStabilityMeta();
        const duelCallRisk = ahaDuelCallRiskMeta();
        const duelCallSequence = ahaDuelCallSequenceMeta();
        const duelSignal = ahaDuelSignalMeta(ranked);
        const duelSignalPulse = ahaDuelSignalPulseMeta();
        const duelSignalVolatility = ahaDuelSignalVolatilityMeta();
        const duelSignalOutlook = ahaDuelSignalOutlookMeta(ranked);
        const duelSignalRegime = ahaDuelSignalRegimeMeta(ranked);
        const duelSignalConviction = ahaDuelSignalConvictionMeta(ranked);
        const duelSignalHandoff = ahaDuelSignalHandoffMeta(ranked);
        const duelSignalHandoffTrend = ahaDuelSignalHandoffTrendMeta();
        const duelSignalHandoffMomentum = ahaDuelSignalHandoffMomentumMeta();
        const duelSignalConsensus = ahaDuelSignalConsensusMeta(ranked);
        const duelSignalConsensusTrend = ahaDuelSignalConsensusTrendMeta();
        const duelSignalConsensusMomentum = ahaDuelSignalConsensusMomentumMeta();
        const duelSignalConsensusRisk = ahaDuelSignalConsensusRiskMeta();
        const duelSignalConsensusStability = ahaDuelSignalConsensusStabilityMeta();
        const duelSignalConsensusReadiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const duelSignalConsensusWindow = ahaDuelSignalConsensusWindowMeta(ranked);
        const duelSignalConsensusGuardrail = ahaDuelSignalConsensusGuardrailMeta(ranked);
        const duelSignalConsensusTrigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        const duelSignalConsensusProtocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const duelSignalConsensusProtocolConfidence = ahaDuelSignalConsensusProtocolConfidenceMeta(ranked);
        const duelSignalConsensusProtocolTrend = ahaDuelSignalConsensusProtocolTrendMeta();
        const duelSignalConsensusProtocolRisk = ahaDuelSignalConsensusProtocolRiskMeta();
        const duelSignalConsensusProtocolRegime = ahaDuelSignalConsensusProtocolRegimeMeta();
        const duelSignalConsensusProtocolCadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const duelSignalConsensusProtocolPressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const duelSignalConsensusProtocolCommand = ahaDuelSignalConsensusProtocolCommandMeta();
        const duelSignalConsensusProtocolScript = ahaDuelSignalConsensusProtocolScriptMeta();
        const duelSignalConsensusProtocolScriptLane = ahaDuelSignalConsensusProtocolScriptLaneMeta();
        const duelSignalConsensusProtocolScriptChecklist = ahaDuelSignalConsensusProtocolScriptChecklistMeta();
        const duelTrend = ahaDuelGapTrendMeta();
        const lines = ["Aha Decision Brief", QUEUE_NUDGE_BRIEF_CONTEXT_LABEL + ": " + decisionBriefContextSummary(), story || "Storyline unavailable."];
        if (duel) {
          lines.push(duel);
        }
        if (duelGap) {
          lines.push(QUEUE_NUDGE_DUEL_GAP_LABEL + ": " + duelGap.label + " · " + duelGap.hint);
        }
        if (duelEdge) {
          lines.push(QUEUE_NUDGE_DUEL_EDGE_LABEL + ": " + duelEdge.label + " · " + duelEdge.hint);
        }
        if (duelCall) {
          lines.push(QUEUE_NUDGE_DUEL_CALL_LABEL + ": " + duelCall.label + " · " + duelCall.hint);
        }
        if (duelCallTrend) {
          lines.push(QUEUE_NUDGE_DUEL_CALL_TREND_LABEL + ": " + duelCallTrend.label);
        }
        if (duelCallConfidence) {
          lines.push(QUEUE_NUDGE_DUEL_CALL_CONFIDENCE_LABEL + ": " + duelCallConfidence.label + " · " + duelCallConfidence.hint);
        }
        if (duelCallStability) {
          lines.push(QUEUE_NUDGE_DUEL_CALL_STABILITY_LABEL + ": " + duelCallStability.label + " · " + duelCallStability.hint);
        }
        if (duelCallRisk) {
          lines.push(QUEUE_NUDGE_DUEL_CALL_RISK_LABEL + ": " + duelCallRisk.label + " · " + duelCallRisk.hint);
        }
        if (duelCallSequence) {
          lines.push(QUEUE_NUDGE_DUEL_CALL_SEQUENCE_LABEL + ": " + duelCallSequence.label + " · " + duelCallSequence.hint);
        }
        if (duelSignal) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_LABEL + ": " + duelSignal.label + " · " + duelSignal.hint);
        }
        if (duelSignalPulse) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_PULSE_LABEL + ": " + duelSignalPulse.label + " · " + duelSignalPulse.hint);
        }
        if (duelSignalVolatility) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_VOLATILITY_LABEL + ": " + duelSignalVolatility.label + " · " + duelSignalVolatility.hint,
          );
        }
        if (duelSignalOutlook) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_OUTLOOK_LABEL + ": " + duelSignalOutlook.label + " · " + duelSignalOutlook.hint);
        }
        if (duelSignalRegime) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_REGIME_LABEL + ": " + duelSignalRegime.label + " · " + duelSignalRegime.hint);
        }
        if (duelSignalConviction) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONVICTION_LABEL + ": " + duelSignalConviction.label + " · " + duelSignalConviction.hint);
        }
        if (duelSignalHandoff) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_LABEL + ": " + duelSignalHandoff.label + " · " + duelSignalHandoff.hint);
        }
        if (duelSignalHandoffTrend) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_TREND_LABEL +
              ": " +
              duelSignalHandoffTrend.label +
              " · " +
              duelSignalHandoffTrend.hint,
          );
        }
        if (duelSignalHandoffMomentum) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_MOMENTUM_LABEL +
              ": " +
              duelSignalHandoffMomentum.label +
              " · " +
              duelSignalHandoffMomentum.hint,
          );
        }
        if (duelSignalConsensus) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_LABEL + ": " + duelSignalConsensus.label + " · " + duelSignalConsensus.hint);
        }
        if (duelSignalConsensusTrend) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TREND_LABEL +
              ": " +
              duelSignalConsensusTrend.label +
              " · " +
              duelSignalConsensusTrend.hint,
          );
        }
        if (duelSignalConsensusMomentum) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_MOMENTUM_LABEL +
              ": " +
              duelSignalConsensusMomentum.label +
              " · " +
              duelSignalConsensusMomentum.hint,
          );
        }
        if (duelSignalConsensusRisk) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_RISK_LABEL + ": " + duelSignalConsensusRisk.label + " · " + duelSignalConsensusRisk.hint);
        }
        if (duelSignalConsensusStability) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_STABILITY_LABEL +
              ": " +
              duelSignalConsensusStability.label +
              " · " +
              duelSignalConsensusStability.hint,
          );
        }
        if (duelSignalConsensusReadiness) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_READINESS_LABEL +
              ": " +
              duelSignalConsensusReadiness.label +
              " · " +
              duelSignalConsensusReadiness.hint,
          );
        }
        if (duelSignalConsensusWindow) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_WINDOW_LABEL +
              ": " +
              duelSignalConsensusWindow.label +
              " · " +
              duelSignalConsensusWindow.hint,
          );
        }
        if (duelSignalConsensusGuardrail) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_GUARDRAIL_LABEL +
              ": " +
              duelSignalConsensusGuardrail.label +
              " · " +
              duelSignalConsensusGuardrail.hint,
          );
        }
        if (duelSignalConsensusTrigger) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL +
              ": " +
              duelSignalConsensusTrigger.label +
              " · " +
              duelSignalConsensusTrigger.hint,
          );
        }
        if (duelSignalConsensusProtocol) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL +
              ": " +
              duelSignalConsensusProtocol.label +
              " · " +
              duelSignalConsensusProtocol.hint,
          );
        }
        if (duelSignalConsensusProtocolConfidence) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_LABEL +
              ": " +
              duelSignalConsensusProtocolConfidence.label +
              " · " +
              duelSignalConsensusProtocolConfidence.hint,
          );
        }
        if (duelSignalConsensusProtocolTrend) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_TREND_LABEL +
              ": " +
              duelSignalConsensusProtocolTrend.label +
              " · " +
              duelSignalConsensusProtocolTrend.hint,
          );
        }
        if (duelSignalConsensusProtocolRisk) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_RISK_LABEL +
              ": " +
              duelSignalConsensusProtocolRisk.label +
              " · " +
              duelSignalConsensusProtocolRisk.hint,
          );
        }
        if (duelSignalConsensusProtocolRegime) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_REGIME_LABEL +
              ": " +
              duelSignalConsensusProtocolRegime.label +
              " · " +
              duelSignalConsensusProtocolRegime.hint,
          );
        }
        if (duelSignalConsensusProtocolCadence) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL +
              ": " +
              duelSignalConsensusProtocolCadence.label +
              " · " +
              duelSignalConsensusProtocolCadence.hint,
          );
        }
        if (duelSignalConsensusProtocolPressure) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL +
              ": " +
              duelSignalConsensusProtocolPressure.label +
              " · " +
              duelSignalConsensusProtocolPressure.hint,
          );
        }
        if (duelSignalConsensusProtocolCommand) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL +
              ": " +
              duelSignalConsensusProtocolCommand.label +
              " · " +
              duelSignalConsensusProtocolCommand.hint,
          );
        }
        if (duelSignalConsensusProtocolScript) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL +
              ": " +
              duelSignalConsensusProtocolScript.label +
              " · " +
              duelSignalConsensusProtocolScript.hint,
          );
        }
        if (duelSignalConsensusProtocolScriptLane) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LANE_LABEL +
              ": " +
              duelSignalConsensusProtocolScriptLane.label +
              " · " +
              duelSignalConsensusProtocolScriptLane.hint,
          );
        }
        if (duelSignalConsensusProtocolScriptChecklist) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_CHECKLIST_LABEL +
              ": " +
              duelSignalConsensusProtocolScriptChecklist.label +
              " · " +
              duelSignalConsensusProtocolScriptChecklist.hint,
          );
        }
        if (duelTrend) {
          lines.push(QUEUE_NUDGE_DUEL_TREND_LABEL + ": " + duelTrend.label);
        }
        return lines.join("\\n");
      }

      function ahaDecisionBriefPreview(poolItems, lineLimit = 3) {
        const brief = ahaDecisionBriefText(poolItems);
        if (!brief) return "";
        return brief
          .split("\\n")
          .slice(0, Math.max(1, Number(lineLimit) || 1))
          .join("\\n");
      }

      function ahaHeatTrendPoints() {
        return ahaHeatHistory.slice(-AHA_HEAT_HISTORY_LIMIT);
      }

      function ahaHeatTrendMeta(points = ahaHeatTrendPoints()) {
        if (!points.length) {
          return { label: "No trend", tone: "heat-flat" };
        }
        if (points.length < 2) {
          return { label: "Baseline", tone: "heat-flat" };
        }
        const first = Number(points[0]?.total || 0);
        const last = Number(points[points.length - 1]?.total || 0);
        const delta = last - first;
        if (delta > 0) {
          return { label: "Rising +" + delta, tone: "heat-up" };
        }
        if (delta < 0) {
          return { label: "Falling -" + Math.abs(delta), tone: "heat-down" };
        }
        return { label: "Flat", tone: "heat-flat" };
      }

      function ahaHeatTrendBarsHtml(points = ahaHeatTrendPoints()) {
        if (!points.length) return "";
        const values = points.map((point) => Number(point?.total || 0));
        const maxValue = Math.max(...values, 1);
        const minValue = Math.min(...values);
        return points
          .map((point, index) => {
            const total = Number(point?.total || 0);
            const height = Math.max(Math.round((total / maxValue) * 100), 18);
            const tone =
              total === maxValue ? " peak" : values.length > 1 && total === minValue && maxValue !== minValue ? " low" : "";
            return (
              '<span class="trend-bar' +
              tone +
              '" style="height:' +
              height +
              '%" title="t' +
              (index + 1) +
              ": " +
              total +
              '"></span>'
            );
          })
          .join("");
      }

      function ahaHeatDeltaMeta(bucketKey, currentCount) {
        const previousCount = Number(previousAhaHeatMap.get(bucketKey) || 0);
        if (!previousAhaHeatMap.size) {
          return { value: 0, label: "→0", tone: "heat-flat" };
        }
        const delta = Number(currentCount || 0) - previousCount;
        if (delta > 0) {
          return { value: delta, label: "↑" + delta, tone: "heat-up" };
        }
        if (delta < 0) {
          return { value: delta, label: "↓" + Math.abs(delta), tone: "heat-down" };
        }
        return { value: 0, label: "→0", tone: "heat-flat" };
      }

      function ahaHeatMomentumMeta(buckets) {
        const hotNow = Number(buckets.find((bucket) => bucket.key === "hot")?.count || 0);
        const strongNow = Number(buckets.find((bucket) => bucket.key === "strong")?.count || 0);
        const now = hotNow + strongNow;
        const prevHot = Number(previousAhaHeatMap.get("hot") || 0);
        const prevStrong = Number(previousAhaHeatMap.get("strong") || 0);
        const previous = prevHot + prevStrong;
        if (!previousAhaHeatMap.size) {
          return { label: "Baseline", tone: "heat-flat" };
        }
        const delta = now - previous;
        if (delta > 0) {
          return { label: "Heating +" + delta, tone: "heat-up" };
        }
        if (delta < 0) {
          return { label: "Cooling -" + Math.abs(delta), tone: "heat-down" };
        }
        return { label: "Steady", tone: "heat-flat" };
      }

      function ahaStoryText(poolItems, heatBuckets = ahaHeatBuckets(poolItems)) {
        const ranked = sortedAhaItems(poolItems);
        if (!ranked.length) return "";
        const top = ranked[0];
        const topMeta = ahaIndexMetaForItem(top);
        const topPrimary = primaryActionForItem(top);
        const momentum = ahaHeatMomentumMeta(heatBuckets);
        const hot = Number(heatBuckets.find((bucket) => bucket.key === "hot")?.count || 0);
        const strong = Number(heatBuckets.find((bucket) => bucket.key === "strong")?.count || 0);
        const warm = Number(heatBuckets.find((bucket) => bucket.key === "warm")?.count || 0);
        const cool = Number(heatBuckets.find((bucket) => bucket.key === "cool")?.count || 0);
        return (
          "Storyline: " +
          momentum.label +
          " · Hot " +
          hot +
          ", Strong " +
          strong +
          ", Warm " +
          warm +
          ", Cool " +
          cool +
          ". Lead #" +
          top.id +
          " (" +
          topMeta.value +
          ", " +
          topMeta.note +
          ") → " +
          (topPrimary?.label || "Review candidate") +
          "."
        );
      }

      function detailStoryText(item, poolItems = null) {
        if (!item) return "";
        const source =
          Array.isArray(poolItems) && poolItems.length
            ? poolItems
            : (() => {
                const visibleItems = visibleQueueItems();
                return visibleItems.length ? visibleItems : allItems;
              })();
        const ranked = sortedAhaItems(source);
        if (!ranked.length) return "";
        const story = ahaStoryText(ranked, ahaHeatBuckets(ranked));
        const top = ranked[0];
        const topMeta = ahaIndexMetaForItem(top);
        const index = ranked.findIndex((entry) => String(entry?.id) === String(item?.id));
        if (index === 0) {
          return "You are on the lead candidate #" + item.id + " (" + topMeta.value + "). " + story;
        }
        if (index > 0) {
          const currentMeta = ahaIndexMetaForItem(item);
          return (
            "Lead is #" +
            top.id +
            " (" +
            topMeta.value +
            "), current is #" +
            item.id +
            " at rank #" +
            (index + 1) +
            " (" +
            currentMeta.value +
            "). " +
            story
          );
        }
        return "Current item is outside the active Aha pool. Lead is #" + top.id + " (" + topMeta.value + "). " + story;
      }

      function ahaDuelText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return "";
        const lead = ranked[0];
        const rival = ranked[1];
        const leadMeta = ahaIndexMetaForItem(lead);
        const rivalMeta = ahaIndexMetaForItem(rival);
        const gap = Math.max(leadMeta.value - rivalMeta.value, 0);
        const leadAction = primaryActionForItem(lead)?.label || "No action";
        const rivalAction = primaryActionForItem(rival)?.label || "No action";
        return (
          "Duel: #" +
          lead.id +
          " (" +
          leadMeta.value +
          ", " +
          leadMeta.note +
          ") vs #" +
          rival.id +
          " (" +
          rivalMeta.value +
          ", " +
          rivalMeta.note +
          ") · gap " +
          gap +
          " · lead→" +
          leadAction +
          " · rival→" +
          rivalAction +
          "."
        );
      }

      function ahaDuelGapMeta(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return null;
        const lead = ranked[0];
        const rival = ranked[1];
        const leadValue = ahaIndexMetaForItem(lead).value;
        const rivalValue = ahaIndexMetaForItem(rival).value;
        const gap = Math.max(leadValue - rivalValue, 0);
        if (gap <= 5) {
          return {
            tone: "gap-tight",
            label: "#" + lead.id + " vs #" + rival.id + " · " + gap,
            hint: "Neck and neck",
          };
        }
        if (gap <= 15) {
          return {
            tone: "gap-balanced",
            label: "#" + lead.id + " vs #" + rival.id + " · " + gap,
            hint: "Lead is clear",
          };
        }
        return {
          tone: "gap-wide",
          label: "#" + lead.id + " vs #" + rival.id + " · " + gap,
          hint: "Lead runaway",
        };
      }

      function ahaDuelEdgeMeta(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return null;
        const lead = ranked[0];
        const rival = ranked[1];
        const leadValue = ahaIndexMetaForItem(lead).value;
        const rivalValue = ahaIndexMetaForItem(rival).value;
        const gap = Math.max(leadValue - rivalValue, 0);
        const trend = ahaHeatTrendMeta();
        let edge = 50 + gap * 2.2;
        if (trend.tone === "heat-up") edge += 4;
        if (trend.tone === "heat-down") edge -= 4;
        const value = Math.min(Math.max(Math.round(edge), 50), 95);
        if (value <= 58) {
          return {
            tone: "edge-close",
            label: value + "%",
            hint: "Coin flip",
          };
        }
        if (value <= 74) {
          return {
            tone: "edge-mid",
            label: value + "%",
            hint: "Lean lead",
          };
        }
        return {
          tone: "edge-strong",
          label: value + "%",
          hint: "Strong lead",
        };
      }

      function ahaDuelCallMeta(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return null;
        const lead = ranked[0];
        const rival = ranked[1];
        const leadPrimary = primaryActionForItem(lead);
        const rivalPrimary = primaryActionForItem(rival);
        const leadRunnable = Boolean(leadPrimary && !leadPrimary.disabled);
        const rivalRunnable = Boolean(rivalPrimary && !rivalPrimary.disabled);
        const gap = ahaDuelGapMeta(ranked);
        const edge = ahaDuelEdgeMeta(ranked);
        if (!leadRunnable && !rivalRunnable) {
          return {
            tone: "call-hold",
            label: "Hold",
            hint: "Both sides blocked, resolve prerequisites first",
            role: "Hold",
            target: null,
            primary: null,
          };
        }
        if (leadRunnable && (edge?.tone === "edge-strong" || gap?.tone === "gap-wide")) {
          return {
            tone: "call-lead",
            label: "Execute Lead Now",
            hint: "Lead signal is clear, capture momentum",
            role: "Lead",
            target: lead,
            primary: leadPrimary,
          };
        }
        if (rivalRunnable && gap?.tone === "gap-tight") {
          return {
            tone: "call-rival",
            label: "Probe Rival First",
            hint: "Close race, validate rival before committing",
            role: "Rival",
            target: rival,
            primary: rivalPrimary,
          };
        }
        if (leadRunnable) {
          return {
            tone: "call-lead",
            label: "Execute Lead Now",
            hint: "Lead remains the safest execution path",
            role: "Lead",
            target: lead,
            primary: leadPrimary,
          };
        }
        return {
          tone: "call-rival",
          label: "Probe Rival First",
          hint: "Lead blocked, rival path is runnable",
          role: "Rival",
          target: rival,
          primary: rivalPrimary,
        };
      }

      function ahaDuelActionPlanMeta(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return null;
        const lead = ranked[0];
        const rival = ranked[1];
        const leadAction = primaryActionForItem(lead);
        const rivalAction = primaryActionForItem(rival);
        const leadRunnable = Boolean(leadAction && !leadAction.disabled);
        const rivalRunnable = Boolean(rivalAction && !rivalAction.disabled);
        const runnableCount = Number(leadRunnable) + Number(rivalRunnable);
        const tone = runnableCount >= 2 ? "plan-ready" : runnableCount === 1 ? "plan-partial" : "plan-empty";
        const hint = runnableCount >= 2 ? "Two-step sprint ready" : runnableCount === 1 ? "One side blocked" : "Both sides blocked";
        return {
          tone,
          hint,
          summary:
            "Lead #" +
            lead.id +
            " → " +
            (leadAction?.label || "No runnable action") +
            " · Rival #" +
            rival.id +
            " → " +
            (rivalAction?.label || "No runnable action"),
        };
      }

      function ahaDuelActionPlanText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        const duel = ahaDuelText(ranked);
        const call = ahaDuelCallMeta(ranked);
        const callTrend = ahaDuelCallTrendMeta();
        const callConfidence = ahaDuelCallConfidenceMeta();
        const callStability = ahaDuelCallStabilityMeta();
        const callRisk = ahaDuelCallRiskMeta();
        const callSequence = ahaDuelCallSequenceMeta();
        const signal = ahaDuelSignalMeta(ranked);
        const signalPulse = ahaDuelSignalPulseMeta();
        const signalVolatility = ahaDuelSignalVolatilityMeta();
        const signalOutlook = ahaDuelSignalOutlookMeta(ranked);
        const signalRegime = ahaDuelSignalRegimeMeta(ranked);
        const signalConviction = ahaDuelSignalConvictionMeta(ranked);
        const signalHandoff = ahaDuelSignalHandoffMeta(ranked);
        const signalHandoffTrend = ahaDuelSignalHandoffTrendMeta();
        const signalHandoffMomentum = ahaDuelSignalHandoffMomentumMeta();
        const signalConsensus = ahaDuelSignalConsensusMeta(ranked);
        const signalConsensusTrend = ahaDuelSignalConsensusTrendMeta();
        const signalConsensusMomentum = ahaDuelSignalConsensusMomentumMeta();
        const signalConsensusRisk = ahaDuelSignalConsensusRiskMeta();
        const signalConsensusStability = ahaDuelSignalConsensusStabilityMeta();
        const signalConsensusReadiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const signalConsensusWindow = ahaDuelSignalConsensusWindowMeta(ranked);
        const signalConsensusGuardrail = ahaDuelSignalConsensusGuardrailMeta(ranked);
        const signalConsensusTrigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        const signalConsensusProtocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const signalConsensusProtocolConfidence = ahaDuelSignalConsensusProtocolConfidenceMeta(ranked);
        const signalConsensusProtocolTrend = ahaDuelSignalConsensusProtocolTrendMeta();
        const signalConsensusProtocolRisk = ahaDuelSignalConsensusProtocolRiskMeta();
        const signalConsensusProtocolRegime = ahaDuelSignalConsensusProtocolRegimeMeta();
        const signalConsensusProtocolCadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const signalConsensusProtocolPressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const signalConsensusProtocolCommand = ahaDuelSignalConsensusProtocolCommandMeta(ranked);
        const signalConsensusProtocolScript = ahaDuelSignalConsensusProtocolScriptMeta(ranked, signalConsensusProtocolCommand, signalConsensusProtocolCadence, signalConsensusProtocolPressure);
        const plan = ahaDuelActionPlanMeta(ranked);
        if (!duel || !plan) return "";
        return (
          "Aha Duel Plan\\n" +
          duel +
          "\\n" +
          (call ? QUEUE_NUDGE_DUEL_CALL_LABEL + ": " + call.label + " · " + call.hint + "\\n" : "") +
          (callTrend ? QUEUE_NUDGE_DUEL_CALL_TREND_LABEL + ": " + callTrend.label + "\\n" : "") +
          (callConfidence ? QUEUE_NUDGE_DUEL_CALL_CONFIDENCE_LABEL + ": " + callConfidence.label + " · " + callConfidence.hint + "\\n" : "") +
          (callStability ? QUEUE_NUDGE_DUEL_CALL_STABILITY_LABEL + ": " + callStability.label + " · " + callStability.hint + "\\n" : "") +
          (callRisk ? QUEUE_NUDGE_DUEL_CALL_RISK_LABEL + ": " + callRisk.label + " · " + callRisk.hint + "\\n" : "") +
          (callSequence ? QUEUE_NUDGE_DUEL_CALL_SEQUENCE_LABEL + ": " + callSequence.label + " · " + callSequence.hint + "\\n" : "") +
          (signal ? QUEUE_NUDGE_DUEL_SIGNAL_LABEL + ": " + signal.label + " · " + signal.hint + "\\n" : "") +
          (signalPulse ? QUEUE_NUDGE_DUEL_SIGNAL_PULSE_LABEL + ": " + signalPulse.label + " · " + signalPulse.hint + "\\n" : "") +
          (signalVolatility
            ? QUEUE_NUDGE_DUEL_SIGNAL_VOLATILITY_LABEL + ": " + signalVolatility.label + " · " + signalVolatility.hint + "\\n"
            : "") +
          (signalOutlook ? QUEUE_NUDGE_DUEL_SIGNAL_OUTLOOK_LABEL + ": " + signalOutlook.label + " · " + signalOutlook.hint + "\\n" : "") +
          (signalRegime ? QUEUE_NUDGE_DUEL_SIGNAL_REGIME_LABEL + ": " + signalRegime.label + " · " + signalRegime.hint + "\\n" : "") +
          (signalConviction
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONVICTION_LABEL + ": " + signalConviction.label + " · " + signalConviction.hint + "\\n"
            : "") +
          (signalHandoff ? QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_LABEL + ": " + signalHandoff.label + " · " + signalHandoff.hint + "\\n" : "") +
          (signalHandoffTrend
            ? QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_TREND_LABEL + ": " + signalHandoffTrend.label + " · " + signalHandoffTrend.hint + "\\n"
            : "") +
          (signalHandoffMomentum
            ? QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_MOMENTUM_LABEL +
                ": " +
                signalHandoffMomentum.label +
                " · " +
                signalHandoffMomentum.hint +
                "\\n"
            : "") +
          (signalConsensus ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_LABEL + ": " + signalConsensus.label + " · " + signalConsensus.hint + "\\n" : "") +
          (signalConsensusTrend
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TREND_LABEL + ": " + signalConsensusTrend.label + " · " + signalConsensusTrend.hint + "\\n"
            : "") +
          (signalConsensusMomentum
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_MOMENTUM_LABEL +
                ": " +
                signalConsensusMomentum.label +
                " · " +
                signalConsensusMomentum.hint +
                "\\n"
            : "") +
          (signalConsensusRisk
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_RISK_LABEL + ": " + signalConsensusRisk.label + " · " + signalConsensusRisk.hint + "\\n"
            : "") +
          (signalConsensusStability
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_STABILITY_LABEL +
                ": " +
                signalConsensusStability.label +
                " · " +
                signalConsensusStability.hint +
                "\\n"
            : "") +
          (signalConsensusReadiness
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_READINESS_LABEL +
                ": " +
                signalConsensusReadiness.label +
                " · " +
                signalConsensusReadiness.hint +
                "\\n"
            : "") +
          (signalConsensusWindow
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_WINDOW_LABEL +
                ": " +
                signalConsensusWindow.label +
                " · " +
                signalConsensusWindow.hint +
                "\\n"
            : "") +
          (signalConsensusGuardrail
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_GUARDRAIL_LABEL +
                ": " +
                signalConsensusGuardrail.label +
                " · " +
                signalConsensusGuardrail.hint +
                "\\n"
            : "") +
          (signalConsensusTrigger
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL +
                ": " +
                signalConsensusTrigger.label +
                " · " +
                signalConsensusTrigger.hint +
                "\\n"
            : "") +
          (signalConsensusProtocol
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL +
                ": " +
                signalConsensusProtocol.label +
                " · " +
                signalConsensusProtocol.hint +
                "\\n"
            : "") +
          (signalConsensusProtocolConfidence
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_LABEL +
                ": " +
                signalConsensusProtocolConfidence.label +
                " · " +
                signalConsensusProtocolConfidence.hint +
                "\\n"
            : "") +
          (signalConsensusProtocolTrend
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_TREND_LABEL +
                ": " +
                signalConsensusProtocolTrend.label +
                " · " +
                signalConsensusProtocolTrend.hint +
                "\\n"
            : "") +
          (signalConsensusProtocolRisk
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_RISK_LABEL +
                ": " +
                signalConsensusProtocolRisk.label +
                " · " +
                signalConsensusProtocolRisk.hint +
                "\\n"
            : "") +
          (signalConsensusProtocolRegime
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_REGIME_LABEL +
                ": " +
                signalConsensusProtocolRegime.label +
                " · " +
                signalConsensusProtocolRegime.hint +
                "\\n"
            : "") +
          (signalConsensusProtocolCadence
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL +
                ": " +
                signalConsensusProtocolCadence.label +
                " · " +
                signalConsensusProtocolCadence.hint +
                "\\n"
            : "") +
          (signalConsensusProtocolPressure
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL +
                ": " +
                signalConsensusProtocolPressure.label +
                " · " +
                signalConsensusProtocolPressure.hint +
                "\\n"
            : "") +
          (signalConsensusProtocolCommand
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL +
                ": " +
                signalConsensusProtocolCommand.label +
                " · " +
                signalConsensusProtocolCommand.hint +
                "\\n"
            : "") +
          (signalConsensusProtocolScript
            ? QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL +
                ": " +
                signalConsensusProtocolScript.label +
                " · " +
                signalConsensusProtocolScript.hint +
                "\\n"
            : "") +
          QUEUE_NUDGE_DUEL_PLAN_LABEL +
          ": " +
          plan.summary +
          " · " +
          plan.hint
        );
      }

      function ahaDuelCallText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        const duel = ahaDuelText(ranked);
        const call = ahaDuelCallMeta(ranked);
        const callTrend = ahaDuelCallTrendMeta();
        const callConfidence = ahaDuelCallConfidenceMeta();
        const callStability = ahaDuelCallStabilityMeta();
        const callRisk = ahaDuelCallRiskMeta();
        const callSequence = ahaDuelCallSequenceMeta();
        const signal = ahaDuelSignalMeta(ranked);
        const signalPulse = ahaDuelSignalPulseMeta();
        const signalVolatility = ahaDuelSignalVolatilityMeta();
        const signalOutlook = ahaDuelSignalOutlookMeta(ranked);
        const signalRegime = ahaDuelSignalRegimeMeta(ranked);
        const signalConviction = ahaDuelSignalConvictionMeta(ranked);
        const signalHandoff = ahaDuelSignalHandoffMeta(ranked);
        const signalHandoffTrend = ahaDuelSignalHandoffTrendMeta();
        const signalHandoffMomentum = ahaDuelSignalHandoffMomentumMeta();
        const signalConsensus = ahaDuelSignalConsensusMeta(ranked);
        const signalConsensusTrend = ahaDuelSignalConsensusTrendMeta();
        const signalConsensusMomentum = ahaDuelSignalConsensusMomentumMeta();
        const signalConsensusRisk = ahaDuelSignalConsensusRiskMeta();
        const signalConsensusStability = ahaDuelSignalConsensusStabilityMeta();
        const signalConsensusReadiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const signalConsensusWindow = ahaDuelSignalConsensusWindowMeta(ranked);
        const signalConsensusGuardrail = ahaDuelSignalConsensusGuardrailMeta(ranked);
        const signalConsensusTrigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        const signalConsensusProtocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const signalConsensusProtocolConfidence = ahaDuelSignalConsensusProtocolConfidenceMeta(ranked);
        const signalConsensusProtocolTrend = ahaDuelSignalConsensusProtocolTrendMeta();
        const signalConsensusProtocolRisk = ahaDuelSignalConsensusProtocolRiskMeta();
        const signalConsensusProtocolRegime = ahaDuelSignalConsensusProtocolRegimeMeta();
        const signalConsensusProtocolCadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const signalConsensusProtocolPressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const signalConsensusProtocolCommand = ahaDuelSignalConsensusProtocolCommandMeta(ranked);
        const signalConsensusProtocolScript = ahaDuelSignalConsensusProtocolScriptMeta(ranked, signalConsensusProtocolCommand, signalConsensusProtocolCadence, signalConsensusProtocolPressure);
        if (!duel || !call) return "";
        return (
          "Aha Duel Call\\n" +
          duel +
          "\\n" +
          QUEUE_NUDGE_DUEL_CALL_LABEL +
          ": " +
          call.label +
          " · " +
          call.hint +
          (callTrend ? "\\n" + QUEUE_NUDGE_DUEL_CALL_TREND_LABEL + ": " + callTrend.label : "") +
          (callConfidence ? "\\n" + QUEUE_NUDGE_DUEL_CALL_CONFIDENCE_LABEL + ": " + callConfidence.label + " · " + callConfidence.hint : "") +
          (callStability ? "\\n" + QUEUE_NUDGE_DUEL_CALL_STABILITY_LABEL + ": " + callStability.label + " · " + callStability.hint : "") +
          (callRisk ? "\\n" + QUEUE_NUDGE_DUEL_CALL_RISK_LABEL + ": " + callRisk.label + " · " + callRisk.hint : "") +
          (callSequence ? "\\n" + QUEUE_NUDGE_DUEL_CALL_SEQUENCE_LABEL + ": " + callSequence.label + " · " + callSequence.hint : "") +
          (signal ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_LABEL + ": " + signal.label + " · " + signal.hint : "") +
          (signalPulse ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_PULSE_LABEL + ": " + signalPulse.label + " · " + signalPulse.hint : "") +
          (signalVolatility
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_VOLATILITY_LABEL + ": " + signalVolatility.label + " · " + signalVolatility.hint
            : "") +
          (signalOutlook ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_OUTLOOK_LABEL + ": " + signalOutlook.label + " · " + signalOutlook.hint : "") +
          (signalRegime ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_REGIME_LABEL + ": " + signalRegime.label + " · " + signalRegime.hint : "") +
          (signalConviction
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONVICTION_LABEL + ": " + signalConviction.label + " · " + signalConviction.hint
            : "") +
          (signalHandoff ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_LABEL + ": " + signalHandoff.label + " · " + signalHandoff.hint : "") +
          (signalHandoffTrend
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_TREND_LABEL + ": " + signalHandoffTrend.label + " · " + signalHandoffTrend.hint
            : "") +
          (signalHandoffMomentum
            ? "\\n" +
              QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_MOMENTUM_LABEL +
              ": " +
              signalHandoffMomentum.label +
              " · " +
              signalHandoffMomentum.hint
            : "") +
          (signalConsensus ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_LABEL + ": " + signalConsensus.label + " · " + signalConsensus.hint : "")
          + (signalConsensusTrend
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TREND_LABEL + ": " + signalConsensusTrend.label + " · " + signalConsensusTrend.hint
            : "")
          + (signalConsensusMomentum
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_MOMENTUM_LABEL + ": " + signalConsensusMomentum.label + " · " + signalConsensusMomentum.hint
            : "")
          + (signalConsensusRisk
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_RISK_LABEL + ": " + signalConsensusRisk.label + " · " + signalConsensusRisk.hint
            : "")
          + (signalConsensusStability
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_STABILITY_LABEL + ": " + signalConsensusStability.label + " · " + signalConsensusStability.hint
            : "")
          + (signalConsensusReadiness
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_READINESS_LABEL + ": " + signalConsensusReadiness.label + " · " + signalConsensusReadiness.hint
            : "")
          + (signalConsensusWindow
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_WINDOW_LABEL + ": " + signalConsensusWindow.label + " · " + signalConsensusWindow.hint
            : "")
          + (signalConsensusGuardrail
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_GUARDRAIL_LABEL + ": " + signalConsensusGuardrail.label + " · " + signalConsensusGuardrail.hint
            : "")
          + (signalConsensusTrigger
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL + ": " + signalConsensusTrigger.label + " · " + signalConsensusTrigger.hint
            : "")
          + (signalConsensusProtocol
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL + ": " + signalConsensusProtocol.label + " · " + signalConsensusProtocol.hint
            : "")
          + (signalConsensusProtocolConfidence
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_LABEL + ": " + signalConsensusProtocolConfidence.label + " · " + signalConsensusProtocolConfidence.hint
            : "")
          + (signalConsensusProtocolTrend
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_TREND_LABEL + ": " + signalConsensusProtocolTrend.label + " · " + signalConsensusProtocolTrend.hint
            : "")
          + (signalConsensusProtocolRisk
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_RISK_LABEL + ": " + signalConsensusProtocolRisk.label + " · " + signalConsensusProtocolRisk.hint
            : "")
          + (signalConsensusProtocolRegime
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_REGIME_LABEL + ": " + signalConsensusProtocolRegime.label + " · " + signalConsensusProtocolRegime.hint
            : "")
          + (signalConsensusProtocolCadence
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL + ": " + signalConsensusProtocolCadence.label + " · " + signalConsensusProtocolCadence.hint
            : "")
          + (signalConsensusProtocolPressure
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL + ": " + signalConsensusProtocolPressure.label + " · " + signalConsensusProtocolPressure.hint
            : "")
          + (signalConsensusProtocolCommand
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL + ": " + signalConsensusProtocolCommand.label + " · " + signalConsensusProtocolCommand.hint
            : "")
          + (signalConsensusProtocolScript
            ? "\\n" + QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL + ": " + signalConsensusProtocolScript.label + " · " + signalConsensusProtocolScript.hint
            : "")
        );
      }

      function ahaDuelSignalsText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return "";
        const lines = ["Aha Duel Signals"];
        const call = ahaDuelCallMeta(ranked);
        const callTrend = ahaDuelCallTrendMeta();
        const callConfidence = ahaDuelCallConfidenceMeta();
        const callStability = ahaDuelCallStabilityMeta();
        const callRisk = ahaDuelCallRiskMeta();
        const callSequence = ahaDuelCallSequenceMeta();
        const signal = ahaDuelSignalMeta(ranked);
        const signalPulse = ahaDuelSignalPulseMeta();
        const signalVolatility = ahaDuelSignalVolatilityMeta();
        const signalOutlook = ahaDuelSignalOutlookMeta(ranked);
        const signalRegime = ahaDuelSignalRegimeMeta(ranked);
        const signalConviction = ahaDuelSignalConvictionMeta(ranked);
        const signalHandoff = ahaDuelSignalHandoffMeta(ranked);
        const signalHandoffTrend = ahaDuelSignalHandoffTrendMeta();
        const signalHandoffMomentum = ahaDuelSignalHandoffMomentumMeta();
        const signalConsensus = ahaDuelSignalConsensusMeta(ranked);
        const signalConsensusTrend = ahaDuelSignalConsensusTrendMeta();
        const signalConsensusMomentum = ahaDuelSignalConsensusMomentumMeta();
        const signalConsensusRisk = ahaDuelSignalConsensusRiskMeta();
        const signalConsensusStability = ahaDuelSignalConsensusStabilityMeta();
        const signalConsensusReadiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const signalConsensusWindow = ahaDuelSignalConsensusWindowMeta(ranked);
        const signalConsensusGuardrail = ahaDuelSignalConsensusGuardrailMeta(ranked);
        const signalConsensusTrigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        const signalConsensusProtocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const signalConsensusProtocolConfidence = ahaDuelSignalConsensusProtocolConfidenceMeta(ranked);
        const signalConsensusProtocolTrend = ahaDuelSignalConsensusProtocolTrendMeta();
        const signalConsensusProtocolRisk = ahaDuelSignalConsensusProtocolRiskMeta();
        const signalConsensusProtocolRegime = ahaDuelSignalConsensusProtocolRegimeMeta();
        const signalConsensusProtocolCadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const signalConsensusProtocolPressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const signalConsensusProtocolCommand = ahaDuelSignalConsensusProtocolCommandMeta(ranked);
        const signalConsensusProtocolScript = ahaDuelSignalConsensusProtocolScriptMeta(ranked, signalConsensusProtocolCommand, signalConsensusProtocolCadence, signalConsensusProtocolPressure);
        if (call) lines.push(QUEUE_NUDGE_DUEL_CALL_LABEL + ": " + call.label + " · " + call.hint);
        if (callTrend) lines.push(QUEUE_NUDGE_DUEL_CALL_TREND_LABEL + ": " + callTrend.label);
        if (callConfidence) lines.push(QUEUE_NUDGE_DUEL_CALL_CONFIDENCE_LABEL + ": " + callConfidence.label + " · " + callConfidence.hint);
        if (callStability) lines.push(QUEUE_NUDGE_DUEL_CALL_STABILITY_LABEL + ": " + callStability.label + " · " + callStability.hint);
        if (callRisk) lines.push(QUEUE_NUDGE_DUEL_CALL_RISK_LABEL + ": " + callRisk.label + " · " + callRisk.hint);
        if (callSequence) lines.push(QUEUE_NUDGE_DUEL_CALL_SEQUENCE_LABEL + ": " + callSequence.label + " · " + callSequence.hint);
        if (signal) lines.push(QUEUE_NUDGE_DUEL_SIGNAL_LABEL + ": " + signal.label + " · " + signal.hint);
        if (signalPulse) lines.push(QUEUE_NUDGE_DUEL_SIGNAL_PULSE_LABEL + ": " + signalPulse.label + " · " + signalPulse.hint);
        if (signalVolatility) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_VOLATILITY_LABEL + ": " + signalVolatility.label + " · " + signalVolatility.hint);
        }
        if (signalOutlook) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_OUTLOOK_LABEL + ": " + signalOutlook.label + " · " + signalOutlook.hint);
        }
        if (signalRegime) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_REGIME_LABEL + ": " + signalRegime.label + " · " + signalRegime.hint);
        }
        if (signalConviction) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONVICTION_LABEL + ": " + signalConviction.label + " · " + signalConviction.hint);
        }
        if (signalHandoff) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_LABEL + ": " + signalHandoff.label + " · " + signalHandoff.hint);
        }
        if (signalHandoffTrend) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_TREND_LABEL + ": " + signalHandoffTrend.label + " · " + signalHandoffTrend.hint);
        }
        if (signalHandoffMomentum) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_MOMENTUM_LABEL + ": " + signalHandoffMomentum.label + " · " + signalHandoffMomentum.hint,
          );
        }
        if (signalConsensus) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_LABEL + ": " + signalConsensus.label + " · " + signalConsensus.hint);
        }
        if (signalConsensusTrend) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TREND_LABEL + ": " + signalConsensusTrend.label + " · " + signalConsensusTrend.hint);
        }
        if (signalConsensusMomentum) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_MOMENTUM_LABEL + ": " + signalConsensusMomentum.label + " · " + signalConsensusMomentum.hint);
        }
        if (signalConsensusRisk) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_RISK_LABEL + ": " + signalConsensusRisk.label + " · " + signalConsensusRisk.hint);
        }
        if (signalConsensusStability) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_STABILITY_LABEL +
              ": " +
              signalConsensusStability.label +
              " · " +
              signalConsensusStability.hint,
          );
        }
        if (signalConsensusReadiness) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_READINESS_LABEL +
              ": " +
              signalConsensusReadiness.label +
              " · " +
              signalConsensusReadiness.hint,
          );
        }
        if (signalConsensusWindow) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_WINDOW_LABEL +
              ": " +
              signalConsensusWindow.label +
              " · " +
              signalConsensusWindow.hint,
          );
        }
        if (signalConsensusGuardrail) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_GUARDRAIL_LABEL +
              ": " +
              signalConsensusGuardrail.label +
              " · " +
              signalConsensusGuardrail.hint,
          );
        }
        if (signalConsensusTrigger) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL +
              ": " +
              signalConsensusTrigger.label +
              " · " +
              signalConsensusTrigger.hint,
          );
        }
        if (signalConsensusProtocol) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL +
              ": " +
              signalConsensusProtocol.label +
              " · " +
              signalConsensusProtocol.hint,
          );
        }
        if (signalConsensusProtocolConfidence) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_LABEL +
              ": " +
              signalConsensusProtocolConfidence.label +
              " · " +
              signalConsensusProtocolConfidence.hint,
          );
        }
        if (signalConsensusProtocolTrend) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_TREND_LABEL +
              ": " +
              signalConsensusProtocolTrend.label +
              " · " +
              signalConsensusProtocolTrend.hint,
          );
        }
        if (signalConsensusProtocolRisk) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_RISK_LABEL +
              ": " +
              signalConsensusProtocolRisk.label +
              " · " +
              signalConsensusProtocolRisk.hint,
          );
        }
        if (signalConsensusProtocolRegime) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_REGIME_LABEL +
              ": " +
              signalConsensusProtocolRegime.label +
              " · " +
              signalConsensusProtocolRegime.hint,
          );
        }
        if (signalConsensusProtocolCadence) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL +
              ": " +
              signalConsensusProtocolCadence.label +
              " · " +
              signalConsensusProtocolCadence.hint,
          );
        }
        if (signalConsensusProtocolPressure) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL +
              ": " +
              signalConsensusProtocolPressure.label +
              " · " +
              signalConsensusProtocolPressure.hint,
          );
        }
        if (signalConsensusProtocolCommand) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL +
              ": " +
              signalConsensusProtocolCommand.label +
              " · " +
              signalConsensusProtocolCommand.hint,
          );
        }
        if (signalConsensusProtocolScript) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL +
              ": " +
              signalConsensusProtocolScript.label +
              " · " +
              signalConsensusProtocolScript.hint,
          );
        }
        return lines.join("\\n");
      }

      function ahaDuelSignalHandoffText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return "";
        const handoff = ahaDuelSignalHandoffMeta(ranked);
        const conviction = ahaDuelSignalConvictionMeta(ranked);
        const outlook = ahaDuelSignalOutlookMeta(ranked);
        const call = ahaDuelCallMeta(ranked);
        const handoffTrend = ahaDuelSignalHandoffTrendMeta();
        const handoffMomentum = ahaDuelSignalHandoffMomentumMeta();
        const consensus = ahaDuelSignalConsensusMeta(ranked);
        const consensusTrend = ahaDuelSignalConsensusTrendMeta();
        const consensusMomentum = ahaDuelSignalConsensusMomentumMeta();
        const consensusRisk = ahaDuelSignalConsensusRiskMeta();
        const consensusStability = ahaDuelSignalConsensusStabilityMeta();
        const consensusReadiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const consensusWindow = ahaDuelSignalConsensusWindowMeta(ranked);
        const consensusGuardrail = ahaDuelSignalConsensusGuardrailMeta(ranked);
        const consensusTrigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        const consensusProtocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const consensusProtocolConfidence = ahaDuelSignalConsensusProtocolConfidenceMeta(ranked);
        const consensusProtocolTrend = ahaDuelSignalConsensusProtocolTrendMeta();
        const consensusProtocolRisk = ahaDuelSignalConsensusProtocolRiskMeta();
        const consensusProtocolRegime = ahaDuelSignalConsensusProtocolRegimeMeta();
        const consensusProtocolCadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const consensusProtocolPressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const consensusProtocolCommand = ahaDuelSignalConsensusProtocolCommandMeta(ranked);
        const consensusProtocolScript = ahaDuelSignalConsensusProtocolScriptMeta(ranked, consensusProtocolCommand, consensusProtocolCadence, consensusProtocolPressure);
        if (!handoff) return "";
        const lines = ["Aha Duel Signal Handoff", QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_LABEL + ": " + handoff.label + " · " + handoff.hint];
        if (conviction) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONVICTION_LABEL + ": " + conviction.label + " · " + conviction.hint);
        }
        if (outlook) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_OUTLOOK_LABEL + ": " + outlook.label + " · " + outlook.hint);
        }
        if (call) {
          lines.push(QUEUE_NUDGE_DUEL_CALL_LABEL + ": " + call.label + " · " + call.hint);
        }
        if (handoffTrend) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_TREND_LABEL + ": " + handoffTrend.label + " · " + handoffTrend.hint);
        }
        if (handoffMomentum) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_MOMENTUM_LABEL + ": " + handoffMomentum.label + " · " + handoffMomentum.hint);
        }
        if (consensus) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_LABEL + ": " + consensus.label + " · " + consensus.hint);
        }
        if (consensusTrend) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TREND_LABEL + ": " + consensusTrend.label + " · " + consensusTrend.hint);
        }
        if (consensusMomentum) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_MOMENTUM_LABEL + ": " + consensusMomentum.label + " · " + consensusMomentum.hint);
        }
        if (consensusRisk) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_RISK_LABEL + ": " + consensusRisk.label + " · " + consensusRisk.hint);
        }
        if (consensusStability) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_STABILITY_LABEL + ": " + consensusStability.label + " · " + consensusStability.hint);
        }
        if (consensusReadiness) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_READINESS_LABEL + ": " + consensusReadiness.label + " · " + consensusReadiness.hint);
        }
        if (consensusWindow) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_WINDOW_LABEL + ": " + consensusWindow.label + " · " + consensusWindow.hint);
        }
        if (consensusGuardrail) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_GUARDRAIL_LABEL + ": " + consensusGuardrail.label + " · " + consensusGuardrail.hint);
        }
        if (consensusTrigger) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL + ": " + consensusTrigger.label + " · " + consensusTrigger.hint);
        }
        if (consensusProtocol) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL + ": " + consensusProtocol.label + " · " + consensusProtocol.hint);
        }
        if (consensusProtocolConfidence) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_LABEL +
              ": " +
              consensusProtocolConfidence.label +
              " · " +
              consensusProtocolConfidence.hint,
          );
        }
        if (consensusProtocolTrend) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_TREND_LABEL + ": " + consensusProtocolTrend.label + " · " + consensusProtocolTrend.hint);
        }
        if (consensusProtocolRisk) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_RISK_LABEL + ": " + consensusProtocolRisk.label + " · " + consensusProtocolRisk.hint);
        }
        if (consensusProtocolRegime) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_REGIME_LABEL + ": " + consensusProtocolRegime.label + " · " + consensusProtocolRegime.hint);
        }
        if (consensusProtocolCadence) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL + ": " + consensusProtocolCadence.label + " · " + consensusProtocolCadence.hint);
        }
        if (consensusProtocolPressure) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL + ": " + consensusProtocolPressure.label + " · " + consensusProtocolPressure.hint);
        }
        if (consensusProtocolCommand) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL + ": " + consensusProtocolCommand.label + " · " + consensusProtocolCommand.hint);
        }
        if (consensusProtocolScript) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL + ": " + consensusProtocolScript.label + " · " + consensusProtocolScript.hint);
        }
        return lines.join("\\n");
      }

      function ahaDuelSignalConsensusText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return "";
        const consensus = ahaDuelSignalConsensusMeta(ranked);
        const handoff = ahaDuelSignalHandoffMeta(ranked);
        const call = ahaDuelCallMeta(ranked);
        const trend = ahaDuelSignalConsensusTrendMeta();
        const momentum = ahaDuelSignalConsensusMomentumMeta();
        const risk = ahaDuelSignalConsensusRiskMeta();
        const stability = ahaDuelSignalConsensusStabilityMeta();
        const readiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const consensusWindow = ahaDuelSignalConsensusWindowMeta(ranked);
        const consensusGuardrail = ahaDuelSignalConsensusGuardrailMeta(ranked);
        const consensusTrigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        const consensusProtocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const consensusProtocolConfidence = ahaDuelSignalConsensusProtocolConfidenceMeta(ranked);
        const consensusProtocolTrend = ahaDuelSignalConsensusProtocolTrendMeta();
        const consensusProtocolRisk = ahaDuelSignalConsensusProtocolRiskMeta();
        const consensusProtocolRegime = ahaDuelSignalConsensusProtocolRegimeMeta();
        const consensusProtocolCadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const consensusProtocolPressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const consensusProtocolCommand = ahaDuelSignalConsensusProtocolCommandMeta(ranked);
        const consensusProtocolScript = ahaDuelSignalConsensusProtocolScriptMeta(ranked, consensusProtocolCommand, consensusProtocolCadence, consensusProtocolPressure);
        if (!consensus) return "";
        const lines = ["Aha Duel Signal Consensus", QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_LABEL + ": " + consensus.label + " · " + consensus.hint];
        if (handoff) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_LABEL + ": " + handoff.label + " · " + handoff.hint);
        }
        if (trend) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TREND_LABEL + ": " + trend.label + " · " + trend.hint);
        }
        if (momentum) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_MOMENTUM_LABEL + ": " + momentum.label + " · " + momentum.hint);
        }
        if (risk) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_RISK_LABEL + ": " + risk.label + " · " + risk.hint);
        }
        if (stability) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_STABILITY_LABEL + ": " + stability.label + " · " + stability.hint);
        }
        if (readiness) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_READINESS_LABEL + ": " + readiness.label + " · " + readiness.hint);
        }
        if (consensusWindow) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_WINDOW_LABEL + ": " + consensusWindow.label + " · " + consensusWindow.hint);
        }
        if (consensusGuardrail) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_GUARDRAIL_LABEL + ": " + consensusGuardrail.label + " · " + consensusGuardrail.hint);
        }
        if (consensusTrigger) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL + ": " + consensusTrigger.label + " · " + consensusTrigger.hint);
        }
        if (consensusProtocol) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL + ": " + consensusProtocol.label + " · " + consensusProtocol.hint);
        }
        if (consensusProtocolConfidence) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_LABEL +
              ": " +
              consensusProtocolConfidence.label +
              " · " +
              consensusProtocolConfidence.hint,
          );
        }
        if (consensusProtocolTrend) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_TREND_LABEL + ": " + consensusProtocolTrend.label + " · " + consensusProtocolTrend.hint);
        }
        if (consensusProtocolRisk) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_RISK_LABEL + ": " + consensusProtocolRisk.label + " · " + consensusProtocolRisk.hint);
        }
        if (consensusProtocolRegime) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_REGIME_LABEL + ": " + consensusProtocolRegime.label + " · " + consensusProtocolRegime.hint);
        }
        if (consensusProtocolCadence) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL + ": " + consensusProtocolCadence.label + " · " + consensusProtocolCadence.hint);
        }
        if (consensusProtocolPressure) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL + ": " + consensusProtocolPressure.label + " · " + consensusProtocolPressure.hint);
        }
        if (consensusProtocolCommand) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL + ": " + consensusProtocolCommand.label + " · " + consensusProtocolCommand.hint);
        }
        if (consensusProtocolScript) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL + ": " + consensusProtocolScript.label + " · " + consensusProtocolScript.hint);
        }
        if (call) {
          lines.push(QUEUE_NUDGE_DUEL_CALL_LABEL + ": " + call.label + " · " + call.hint);
        }
        return lines.join("\\n");
      }

      function ahaDuelSignalConsensusProtocolText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return "";
        const consensus = ahaDuelSignalConsensusMeta(ranked);
        const readiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const windowMeta = ahaDuelSignalConsensusWindowMeta(ranked);
        const guardrail = ahaDuelSignalConsensusGuardrailMeta(ranked);
        const trigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        const protocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const confidence = ahaDuelSignalConsensusProtocolConfidenceMeta(ranked);
        const trend = ahaDuelSignalConsensusProtocolTrendMeta();
        const risk = ahaDuelSignalConsensusProtocolRiskMeta(ranked);
        const regime = ahaDuelSignalConsensusProtocolRegimeMeta();
        const cadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const pressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const command = ahaDuelSignalConsensusProtocolCommandMeta(ranked, trigger, protocol, cadence, pressure);
        const script = ahaDuelSignalConsensusProtocolScriptMeta(ranked, command, cadence, pressure);
        const scriptLane = ahaDuelSignalConsensusProtocolScriptLaneMeta(ranked, script, command);
        const scriptChecklist = ahaDuelSignalConsensusProtocolScriptChecklistMeta(ranked, script, scriptLane, command);
        if (!consensus || !protocol) return "";
        const lines = [
          "Aha Duel Signal Protocol",
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_LABEL + ": " + consensus.label + " · " + consensus.hint,
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL + ": " + protocol.label + " · " + protocol.hint,
        ];
        if (readiness) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_READINESS_LABEL + ": " + readiness.label + " · " + readiness.hint);
        }
        if (windowMeta) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_WINDOW_LABEL + ": " + windowMeta.label + " · " + windowMeta.hint);
        }
        if (guardrail) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_GUARDRAIL_LABEL + ": " + guardrail.label + " · " + guardrail.hint);
        }
        if (trigger) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL + ": " + trigger.label + " · " + trigger.hint);
        }
        if (confidence) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_LABEL + ": " + confidence.label + " · " + confidence.hint);
        }
        if (trend) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_TREND_LABEL + ": " + trend.label + " · " + trend.hint);
        }
        if (risk) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_RISK_LABEL + ": " + risk.label + " · " + risk.hint);
        }
        if (regime) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_REGIME_LABEL + ": " + regime.label + " · " + regime.hint);
        }
        if (cadence) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL + ": " + cadence.label + " · " + cadence.hint);
        }
        if (pressure) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL + ": " + pressure.label + " · " + pressure.hint);
        }
        if (command) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL + ": " + command.label + " · " + command.hint);
        }
        if (script) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL + ": " + script.label + " · " + script.hint);
        }
        if (scriptLane) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LANE_LABEL + ": " + scriptLane.label + " · " + scriptLane.hint,
          );
        }
        if (scriptChecklist) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_CHECKLIST_LABEL +
              ": " +
              scriptChecklist.label +
              " · " +
              scriptChecklist.hint,
          );
        }
        return lines.join("\\n");
      }

      function ahaDuelSignalConsensusCommandText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return "";
        const trigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        const protocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const cadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const pressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const command = ahaDuelSignalConsensusProtocolCommandMeta(ranked, trigger, protocol, cadence, pressure);
        const script = ahaDuelSignalConsensusProtocolScriptMeta(ranked, command, cadence, pressure);
        const scriptLane = ahaDuelSignalConsensusProtocolScriptLaneMeta(ranked, script, command);
        const scriptChecklist = ahaDuelSignalConsensusProtocolScriptChecklistMeta(ranked, script, scriptLane, command);
        if (!command || !trigger || !protocol) return "";
        const lines = [
          "Aha Duel Signal Command",
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL + ": " + command.label + " · " + command.hint,
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL + ": " + trigger.label + " · " + trigger.hint,
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL + ": " + protocol.label + " · " + protocol.hint,
        ];
        if (cadence) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL + ": " + cadence.label + " · " + cadence.hint);
        }
        if (pressure) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL + ": " + pressure.label + " · " + pressure.hint);
        }
        if (script) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL + ": " + script.label + " · " + script.hint);
        }
        if (scriptLane) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LANE_LABEL + ": " + scriptLane.label + " · " + scriptLane.hint,
          );
        }
        if (scriptChecklist) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_CHECKLIST_LABEL +
              ": " +
              scriptChecklist.label +
              " · " +
              scriptChecklist.hint,
          );
        }
        return lines.join("\\n");
      }

      function ahaDuelSignalConsensusScriptText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return "";
        const trigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        const protocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const cadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const pressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const command = ahaDuelSignalConsensusProtocolCommandMeta(ranked, trigger, protocol, cadence, pressure);
        const script = ahaDuelSignalConsensusProtocolScriptMeta(ranked, command, cadence, pressure);
        const scriptLane = ahaDuelSignalConsensusProtocolScriptLaneMeta(ranked, script, command);
        const scriptChecklist = ahaDuelSignalConsensusProtocolScriptChecklistMeta(ranked, script, scriptLane, command);
        if (!script || !command || !trigger || !protocol) return "";
        const lines = [
          "Aha Duel Signal Script",
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL + ": " + script.label + " · " + script.hint,
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL + ": " + command.label + " · " + command.hint,
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL + ": " + trigger.label + " · " + trigger.hint,
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL + ": " + protocol.label + " · " + protocol.hint,
        ];
        if (cadence) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL + ": " + cadence.label + " · " + cadence.hint);
        }
        if (pressure) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL + ": " + pressure.label + " · " + pressure.hint);
        }
        if (scriptLane) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LANE_LABEL + ": " + scriptLane.label + " · " + scriptLane.hint,
          );
        }
        if (scriptChecklist) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_CHECKLIST_LABEL +
              ": " +
              scriptChecklist.label +
              " · " +
              scriptChecklist.hint,
          );
        }
        return lines.join("\\n");
      }

      function ahaDuelSignalConsensusChecklistText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return "";
        const trigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        const protocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const cadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const pressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const command = ahaDuelSignalConsensusProtocolCommandMeta(ranked, trigger, protocol, cadence, pressure);
        const script = ahaDuelSignalConsensusProtocolScriptMeta(ranked, command, cadence, pressure);
        const scriptLane = ahaDuelSignalConsensusProtocolScriptLaneMeta(ranked, script, command);
        const scriptChecklist = ahaDuelSignalConsensusProtocolScriptChecklistMeta(ranked, script, scriptLane, command);
        if (!scriptChecklist || !script || !command || !trigger || !protocol) return "";
        const lines = [
          "Aha Duel Signal Checklist",
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_CHECKLIST_LABEL +
            ": " +
            scriptChecklist.label +
            " · " +
            scriptChecklist.hint,
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL + ": " + script.label + " · " + script.hint,
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL + ": " + command.label + " · " + command.hint,
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL + ": " + trigger.label + " · " + trigger.hint,
          QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL + ": " + protocol.label + " · " + protocol.hint,
        ];
        if (scriptLane) {
          lines.push(
            QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LANE_LABEL + ": " + scriptLane.label + " · " + scriptLane.hint,
          );
        }
        if (cadence) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL + ": " + cadence.label + " · " + cadence.hint);
        }
        if (pressure) {
          lines.push(QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL + ": " + pressure.label + " · " + pressure.hint);
        }
        return lines.join("\\n");
      }

      function ahaDuelSnapshotText(poolItems) {
        const ranked = sortedAhaItems(poolItems);
        if (ranked.length < 2) return "";
        const call = ahaDuelCallMeta(ranked);
        const signal = ahaDuelSignalMeta(ranked);
        const pulse = ahaDuelSignalPulseMeta();
        const volatility = ahaDuelSignalVolatilityMeta();
        const outlook = ahaDuelSignalOutlookMeta(ranked);
        const regime = ahaDuelSignalRegimeMeta(ranked);
        const conviction = ahaDuelSignalConvictionMeta(ranked);
        const handoff = ahaDuelSignalHandoffMeta(ranked);
        const handoffTrend = ahaDuelSignalHandoffTrendMeta();
        const handoffMomentum = ahaDuelSignalHandoffMomentumMeta();
        const consensus = ahaDuelSignalConsensusMeta(ranked);
        const consensusTrend = ahaDuelSignalConsensusTrendMeta();
        const consensusMomentum = ahaDuelSignalConsensusMomentumMeta();
        const consensusRisk = ahaDuelSignalConsensusRiskMeta();
        const consensusStability = ahaDuelSignalConsensusStabilityMeta();
        const consensusReadiness = ahaDuelSignalConsensusReadinessMeta(ranked);
        const consensusWindow = ahaDuelSignalConsensusWindowMeta(ranked);
        const consensusGuardrail = ahaDuelSignalConsensusGuardrailMeta(ranked);
        const consensusTrigger = ahaDuelSignalConsensusTriggerMeta(ranked);
        const consensusProtocol = ahaDuelSignalConsensusProtocolMeta(ranked);
        const consensusProtocolConfidence = ahaDuelSignalConsensusProtocolConfidenceMeta(ranked);
        const consensusProtocolTrend = ahaDuelSignalConsensusProtocolTrendMeta();
        const consensusProtocolRisk = ahaDuelSignalConsensusProtocolRiskMeta(ranked);
        const consensusProtocolRegime = ahaDuelSignalConsensusProtocolRegimeMeta();
        const consensusProtocolCadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const consensusProtocolPressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const consensusProtocolCommand = ahaDuelSignalConsensusProtocolCommandMeta(ranked);
        const consensusProtocolScript = ahaDuelSignalConsensusProtocolScriptMeta(ranked, consensusProtocolCommand, consensusProtocolCadence, consensusProtocolPressure);
        const sequence = ahaDuelCallSequenceMeta();
        const risk = ahaDuelCallRiskMeta();
        const parts = ["Aha Duel Snapshot"];
        if (call) parts.push(call.label);
        if (signal) parts.push("signal " + signal.label);
        if (pulse) parts.push("pulse " + pulse.label);
        if (volatility) parts.push("volatility " + volatility.label);
        if (outlook) parts.push("outlook " + outlook.label);
        if (regime) parts.push("regime " + regime.label);
        if (conviction) parts.push("conviction " + conviction.label);
        if (handoff) parts.push("handoff " + handoff.label);
        if (handoffTrend) parts.push("handoffTrend " + handoffTrend.label);
        if (handoffMomentum) parts.push("handoffMomentum " + handoffMomentum.label);
        if (consensus) parts.push("consensus " + consensus.label);
        if (consensusTrend) parts.push("consensusTrend " + consensusTrend.label);
        if (consensusMomentum) parts.push("consensusMomentum " + consensusMomentum.label);
        if (consensusRisk) parts.push("consensusRisk " + consensusRisk.label);
        if (consensusStability) parts.push("consensusStability " + consensusStability.label);
        if (consensusReadiness) parts.push("consensusReadiness " + consensusReadiness.label);
        if (consensusWindow) parts.push("consensusWindow " + consensusWindow.label);
        if (consensusGuardrail) parts.push("consensusGuardrail " + consensusGuardrail.label);
        if (consensusTrigger) parts.push("consensusTrigger " + consensusTrigger.label);
        if (consensusProtocol) parts.push("consensusProtocol " + consensusProtocol.label);
        if (consensusProtocolConfidence) parts.push("consensusProtocolConfidence " + consensusProtocolConfidence.label);
        if (consensusProtocolTrend) parts.push("consensusProtocolTrend " + consensusProtocolTrend.label);
        if (consensusProtocolRisk) parts.push("consensusProtocolRisk " + consensusProtocolRisk.label);
        if (consensusProtocolRegime) parts.push("consensusProtocolRegime " + consensusProtocolRegime.label);
        if (consensusProtocolCadence) parts.push("consensusProtocolCadence " + consensusProtocolCadence.label);
        if (consensusProtocolPressure) parts.push("consensusProtocolPressure " + consensusProtocolPressure.label);
        if (consensusProtocolCommand) parts.push("consensusProtocolCommand " + consensusProtocolCommand.label);
        if (consensusProtocolScript) parts.push("consensusProtocolScript " + consensusProtocolScript.label);
        if (risk) parts.push(risk.label);
        if (sequence) parts.push(sequence.label);
        return parts.join(" · ");
      }

      function ahaDuelRoleMeta(item, poolItems = null) {
        if (!item) return null;
        const source =
          Array.isArray(poolItems) && poolItems.length
            ? poolItems
            : (() => {
                const visibleItems = visibleQueueItems();
                return visibleItems.length ? visibleItems : allItems;
              })();
        const ranked = sortedAhaItems(source);
        if (!ranked.length) return null;
        const index = ranked.findIndex((entry) => String(entry?.id) === String(item?.id));
        if (index === 0) return { role: "Lead", tone: "role-lead" };
        if (index === 1) return { role: "Rival", tone: "role-rival" };
        if (index >= 2) return { role: "Observer", tone: "role-observer" };
        return { role: "Observer", tone: "role-observer" };
      }

      function ahaDuelRoleHtml(item, poolItems = null) {
        const meta = ahaDuelRoleMeta(item, poolItems);
        if (!meta) return "";
        return '<span class="duel-role-chip ' + meta.tone + '">' + QUEUE_DUEL_ROLE_LABEL_PREFIX + ": " + meta.role + "</span>";
      }

      function ahaRankForItem(item, poolItems = null) {
        if (!item) return null;
        const source =
          Array.isArray(poolItems) && poolItems.length
            ? poolItems
            : (() => {
                const visibleItems = visibleQueueItems();
                return visibleItems.length ? visibleItems : allItems;
              })();
        const ranked = sortedAhaItems(source);
        if (!ranked.length) return null;
        const index = ranked.findIndex((candidate) => String(candidate?.id) === String(item?.id));
        if (index < 0) return null;
        const meta = ahaIndexMetaForItem(item);
        return {
          rank: index + 1,
          total: ranked.length,
          value: meta.value,
        };
      }

      function refreshAhaSnapshot(items) {
        const ranked = sortedAhaItems(items);
        if (!ranked.length) {
          latestAhaSnapshot = null;
          return;
        }
        latestAhaSnapshot = {
          generated_at: new Date().toISOString(),
          pool_size: ranked.length,
          candidates: ranked.slice(0, 5).map((item, index) => {
            const primary = primaryActionForItem(item);
            return {
              rank: index + 1,
              id: item.id,
              status: item.status,
              aha_index: ahaIndexMetaForItem(item).value,
              score: scoreMeterMeta(item.match_score).value,
              primary_action: primary?.label || "No action",
              title: truncateSelectionLabel(item.title || item.url || "Untitled", 80),
            };
          }),
        };
      }

      function ahaSnapshotText(snapshot = latestAhaSnapshot) {
        if (!snapshot || !Array.isArray(snapshot.candidates) || !snapshot.candidates.length) {
          return "";
        }
        const lines = [
          "Aha Snapshot",
          "generated_at: " + snapshot.generated_at,
          "pool_size: " + snapshot.pool_size,
          "top_candidates:",
        ];
        for (const candidate of snapshot.candidates) {
          lines.push(
            String(candidate.rank) +
              ". #" +
              String(candidate.id) +
              " " +
              String(candidate.status) +
              " · aha=" +
              String(candidate.aha_index) +
              " · score=" +
              Number(candidate.score ?? 0).toFixed(1) +
              " · next=" +
              String(candidate.primary_action || "No action") +
              " · " +
              String(candidate.title || "Untitled"),
          );
        }
        return lines.join("\\n");
      }

      function refreshAhaRankMap(items) {
        previousAhaRankMap = currentAhaRankMap;
        const nextMap = new Map();
        const ranked = sortedAhaItems(items);
        for (let index = 0; index < ranked.length; index += 1) {
          const item = ranked[index];
          const meta = ahaIndexMetaForItem(item);
          nextMap.set(String(item.id), {
            rank: index + 1,
            total: ranked.length,
            value: meta.value,
          });
        }
        currentAhaRankMap = nextMap;
        currentAhaLeadMeta = ranked[0]
          ? {
              id: String(ranked[0].id),
              value: ahaIndexMetaForItem(ranked[0]).value,
            }
          : null;
      }

      function ahaRankFromMap(item) {
        if (!item) return null;
        return currentAhaRankMap.get(String(item.id)) || null;
      }

      function ahaRankDeltaFromMap(item, currentRank = ahaRankFromMap(item)) {
        if (!item || !currentRank) return null;
        const previous = previousAhaRankMap.get(String(item.id)) || null;
        if (!previous) return null;
        const delta = Number(previous.rank ?? 0) - Number(currentRank.rank ?? 0);
        if (delta > 0) {
          return { value: delta, label: "↑" + delta, tone: "delta-up" };
        }
        if (delta < 0) {
          return { value: delta, label: "↓" + Math.abs(delta), tone: "delta-down" };
        }
        return { value: 0, label: "→0", tone: "delta-flat" };
      }

      function ahaLeadGapMeta(item, currentRank = ahaRankFromMap(item)) {
        if (!item || !currentRank || !currentAhaLeadMeta) return null;
        const leadId = String(currentAhaLeadMeta.id);
        const isLead = String(item.id) === leadId;
        if (isLead) {
          return {
            tone: "gap-lead",
            cardTone: "aha-lead",
            label: "Lead now",
            hint: "Keep shipping momentum.",
          };
        }
        const rankGap = Math.max(Number(currentRank.rank || 0) - 1, 0);
        const valueGap = Math.max(Number(currentAhaLeadMeta.value || 0) - Number(currentRank.value || 0), 0);
        if (rankGap <= 2 && valueGap <= 12) {
          return {
            tone: "gap-chase",
            cardTone: "aha-chase",
            label: "+" + rankGap + " rank · -" + valueGap,
            hint: "Close gap to lead #" + leadId,
          };
        }
        return {
          tone: "gap-trail",
          cardTone: "aha-trail",
          label: "+" + rankGap + " rank · -" + valueGap,
          hint: "Trail lead #" + leadId,
        };
      }

      function ahaLeadGapHtml(item, currentRank = ahaRankFromMap(item)) {
        const gap = ahaLeadGapMeta(item, currentRank);
        if (!gap) return "";
        return (
          '<div class="aha-gap-line ' +
          gap.tone +
          '"><span class="label">' +
          QUEUE_LEAD_GAP_LABEL_PREFIX +
          '</span>' +
          gap.label +
          '<span class="muted">· ' +
          gap.hint +
          "</span></div>"
        );
      }

      function ahaCandidateChipLabel(item, rank) {
        const meta = ahaIndexMetaForItem(item);
        return "Aha #" + rank + " · #" + item.id + " · " + meta.value;
      }

      function setQueueNudgeState(state = {}) {
        queueNudgeState = { ...emptyQueueNudgeState, ...state };
      }

      function queueNudgeForItem(item) {
        if (!item || queueNudgeState.itemId == null || item.id !== queueNudgeState.itemId) return null;
        return {
          tone: queueNudgeState.tone || "ship",
          actionLabel: queueNudgeState.actionLabel || "Take recommended action",
          context: queueNudgeState.context || "This is the current highest-impact item.",
        };
      }

      function failedRetryBuckets(items) {
        const buckets = {
          retryable: 0,
          blocked: 0,
          last_attempt: 0,
        };
        for (const item of items) {
          if (!String(item?.status || "").startsWith("FAILED_")) continue;
          const info = retryInfo(item);
          if (!info.retryable || info.remaining === 0) {
            buckets.blocked += 1;
            continue;
          }
          buckets.retryable += 1;
          if (info.remaining === 1) {
            buckets.last_attempt += 1;
          }
        }
        return buckets;
      }

      function recoveryStepKey(step) {
        if (step === "extract" || step === "pipeline" || step === "export") return step;
        return "unknown";
      }

      function emptyRecoveryStepBuckets() {
        return {
          extract: { targeted: 0, queued: 0, replayed: 0, failed: 0, sample_item_ids: [], failed_item_ids: [] },
          pipeline: { targeted: 0, queued: 0, replayed: 0, failed: 0, sample_item_ids: [], failed_item_ids: [] },
          export: { targeted: 0, queued: 0, replayed: 0, failed: 0, sample_item_ids: [], failed_item_ids: [] },
          unknown: { targeted: 0, queued: 0, replayed: 0, failed: 0, sample_item_ids: [], failed_item_ids: [] },
        };
      }

      function appendRecoverySampleId(list, itemId, limit = 3) {
        if (!Array.isArray(list)) return;
        if (itemId == null) return;
        const normalized = String(itemId);
        if (list.includes(normalized)) return;
        if (list.length >= limit) return;
        list.push(normalized);
      }

      function cloneRecoverySummary(summary) {
        try {
          return JSON.parse(JSON.stringify(summary));
        } catch {
          return summary ? { ...summary } : null;
        }
      }

      function normalizeRecoverySummary(summary) {
        const cloned = cloneRecoverySummary(summary);
        if (!cloned || typeof cloned !== "object") return null;
        return {
          ...cloned,
          summary_id: cloned.summary_id || crypto.randomUUID(),
          created_at: cloned.created_at || new Date().toISOString(),
          totals: cloned.totals || {},
          step_buckets: cloned.step_buckets || emptyRecoveryStepBuckets(),
        };
      }

      function recoverySummaryById(summaryId) {
        if (!summaryId) return null;
        return recoveryRadarHistory.find((entry) => entry.summary_id === summaryId) || null;
      }

      function activeRecoverySummary() {
        const active = recoverySummaryById(activeRecoverySummaryId);
        if (active) return active;
        return recoveryRadarHistory[0] || null;
      }

      function activateRecoverySummary(summaryId) {
        const active = recoverySummaryById(summaryId);
        if (!active) return;
        activeRecoverySummaryId = active.summary_id;
        latestRecoverySummary = active;
        persistRecoveryRadarState();
        renderRecoveryRadar(active);
      }

      function runRecoverySummaryNavigationAction(direction) {
        const active = activeRecoverySummary();
        const activeIndex = active?.summary_id
          ? recoveryRadarHistory.findIndex((entry) => entry.summary_id === active.summary_id)
          : -1;
        if (!active || activeIndex < 0 || recoveryRadarHistory.length <= 1) {
          const hint = "No additional recovery run available.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        let targetIndex = -1;
        if (direction === "prev") {
          targetIndex = activeIndex + 1;
        } else if (direction === "next") {
          targetIndex = activeIndex - 1;
        } else if (direction === "latest") {
          targetIndex = 0;
        }
        const target = recoveryRadarHistory[targetIndex] || null;
        if (!target) {
          const hint =
            direction === "prev"
              ? "Already at oldest recovery run."
              : direction === "next"
                ? "Already at latest recovery run."
                : "Latest recovery run already active.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        activateRecoverySummary(target.summary_id);
        const label = recoveryTimelineLabel(target, targetIndex);
        setActionFeedbackPair("done", "Recovery run: " + label, queueActionBannerEl);
        errorEl.textContent = "Switched to " + label + ".";
      }

      function recoveryTimelineLabel(summary, index) {
        const label = String(summary?.label || "Recovery Run");
        const timeText = String(summary?.created_at || "").split("T")[1]?.slice(0, 8) || "";
        const prefix = index === 0 ? "Latest" : "Run " + String(index + 1);
        return prefix + " · " + label + (timeText ? " · " + timeText : "");
      }

      function recoveryDeltaClass(value) {
        if (value > 0) return "pos";
        if (value < 0) return "neg";
        return "zero";
      }

      function recoveryDeltaText(value) {
        if (value > 0) return "+" + value;
        return String(value || 0);
      }

      function recoveryTrendVsPrevious(summary) {
        if (!summary?.summary_id) return null;
        const index = recoveryRadarHistory.findIndex((entry) => entry.summary_id === summary.summary_id);
        if (index < 0) return null;
        const previous = recoveryRadarHistory[index + 1] || null;
        if (!previous) return null;
        const currentTotals = summary.totals || {};
        const previousTotals = previous.totals || {};
        return {
          previous_label: recoveryTimelineLabel(previous, index + 1),
          deltas: {
            targeted: Number(currentTotals.targeted ?? 0) - Number(previousTotals.targeted ?? 0),
            queued: Number(currentTotals.queued ?? 0) - Number(previousTotals.queued ?? 0),
            replayed: Number(currentTotals.replayed ?? 0) - Number(previousTotals.replayed ?? 0),
            failed: Number(currentTotals.failed ?? 0) - Number(previousTotals.failed ?? 0),
          },
        };
      }

      function recoveryStepFailedDeltaVsPrevious(summary) {
        if (!summary?.summary_id) return null;
        const index = recoveryRadarHistory.findIndex((entry) => entry.summary_id === summary.summary_id);
        if (index < 0) return null;
        const previous = recoveryRadarHistory[index + 1] || null;
        if (!previous) return null;
        const currentBuckets = summary.step_buckets || emptyRecoveryStepBuckets();
        const previousBuckets = previous.step_buckets || emptyRecoveryStepBuckets();
        const keys = ["extract", "pipeline", "export", "unknown"];
        const deltas = {};
        for (const key of keys) {
          deltas[key] =
            Number(currentBuckets?.[key]?.failed ?? 0) -
            Number(previousBuckets?.[key]?.failed ?? 0);
        }
        return deltas;
      }

      function recoveryTrendStatusByDelta(trend) {
        const failedDelta = Number(trend?.deltas?.failed ?? 0);
        if (failedDelta < 0) return { tone: "improving", label: "Trend Status: Improving" };
        if (failedDelta > 0) return { tone: "regressing", label: "Trend Status: Regressing" };
        return { tone: "flat", label: "Trend Status: Flat" };
      }

      function recoverySampleIdByStep(summary, step) {
        const bucket = summary?.step_buckets?.[step] || null;
        if (!bucket) return null;
        const failedSamples = Array.isArray(bucket.failed_item_ids) ? bucket.failed_item_ids : [];
        const allSamples = Array.isArray(bucket.sample_item_ids) ? bucket.sample_item_ids : [];
        return failedSamples[0] || allSamples[0] || null;
      }

      function isFailedStepFilterActive(step) {
        return activeFailedStepKey() === step;
      }

      function activeFailedStepKey() {
        if (statusFilter.value !== "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT") return null;
        if (failureStepFilter.value === "extract" || failureStepFilter.value === "pipeline" || failureStepFilter.value === "export") {
          return failureStepFilter.value;
        }
        return "unknown";
      }

      function isRecoveryContextFocusMode(mode) {
        return mode === "smart" || mode === "query_first" || mode === "step_first";
      }

      function syncRecoveryFocusModeFilterControl() {
        if (!recoveryFocusModeFilter) return;
        if (recoveryFocusModeFilter.value !== recoveryContextFocusMode) {
          recoveryFocusModeFilter.value = recoveryContextFocusMode;
        }
        const hint = recoveryContextFocusModeControlHint(recoveryContextFocusMode);
        recoveryFocusModeFilter.setAttribute("title", hint);
        recoveryFocusModeFilter.setAttribute("aria-label", hint);
      }

      function setRecoveryContextFocusMode(mode) {
        if (!isRecoveryContextFocusMode(mode)) {
          syncRecoveryFocusModeFilterControl();
          return false;
        }
        if (recoveryContextFocusMode === mode) {
          syncRecoveryFocusModeFilterControl();
          return false;
        }
        recoveryContextFocusMode = mode;
        syncRecoveryFocusModeFilterControl();
        return true;
      }

      function recoveryContextFocusModes() {
        return [
          { key: "smart", label: "Smart", id: "trendFocusModeSmartBtn" },
          { key: "query_first", label: "Query First", id: "trendFocusModeQueryFirstBtn" },
          { key: "step_first", label: "Step First", id: "trendFocusModeStepFirstBtn" },
        ];
      }

      function recoveryContextFocusModeLabel(mode) {
        if (mode === "query_first") return "Query First";
        if (mode === "step_first") return "Step First";
        return "Smart";
      }

      function recoveryContextFocusModeNote(mode) {
        if (mode === "query_first") return "Always jump to Search first, then tune other filters.";
        if (mode === "step_first") return "Always jump to failed-step/status controls first.";
        return "Auto-pick Search/Retryable when active, otherwise jump by failed step.";
      }

      function recoveryContextFocusModeControlHint(mode) {
        if (!isRecoveryContextFocusMode(mode)) return QUEUE_RECOVERY_FOCUS_MODE_SMART_HINT;
        return (
          QUEUE_RECOVERY_FOCUS_MODE_PREFIX +
          ": " +
          recoveryContextFocusModeLabel(mode) +
          ". " +
          recoveryContextFocusModeNote(mode)
        );
      }

      function nextRecoveryContextFocusMode(mode) {
        if (mode === "smart") return "query_first";
        if (mode === "query_first") return "step_first";
        return "smart";
      }

      function previousRecoveryContextFocusMode(mode) {
        if (mode === "smart") return "step_first";
        if (mode === "query_first") return "smart";
        return "query_first";
      }

      function cycleRecoveryContextFocusMode(direction = "next") {
        const nextMode =
          direction === "previous"
            ? previousRecoveryContextFocusMode(recoveryContextFocusMode)
            : nextRecoveryContextFocusMode(recoveryContextFocusMode);
        const changed = setRecoveryContextFocusMode(nextMode);
        if (!changed) {
          setActionFeedbackPair("done", "Focus Priority: " + recoveryContextFocusModeLabel(recoveryContextFocusMode), queueActionBannerEl);
          return;
        }
        persistControls();
        const currentSummary = activeRecoverySummary();
        if (currentSummary) {
          renderRecoveryRadar(currentSummary);
        }
        const modeLabel = recoveryContextFocusModeLabel(nextMode);
        setActionFeedbackPair("done", "Focus Priority: " + modeLabel, queueActionBannerEl);
        errorEl.textContent = "Context focus mode: " + modeLabel + ".";
      }

      function setRecoveryContextFocusModeFromShortcut(mode) {
        const changed = setRecoveryContextFocusMode(mode);
        const modeLabel = recoveryContextFocusModeLabel(mode);
        if (!changed) {
          setActionFeedbackPair("done", "Focus Priority: " + modeLabel, queueActionBannerEl);
          errorEl.textContent = "Context focus mode already: " + modeLabel + ".";
          return;
        }
        persistControls();
        const currentSummary = activeRecoverySummary();
        if (currentSummary) {
          renderRecoveryRadar(currentSummary);
        }
        setActionFeedbackPair("done", "Focus Priority: " + modeLabel, queueActionBannerEl);
        errorEl.textContent = "Context focus mode: " + modeLabel + ".";
      }

      function clearFocusedFilterControl() {
        if (focusedFilterControl && focusedFilterControl.classList) {
          focusedFilterControl.classList.remove("filter-attention");
        }
        focusedFilterControl = null;
        if (focusedFilterControlTimer) {
          clearTimeout(focusedFilterControlTimer);
          focusedFilterControlTimer = null;
        }
      }

      function markFilterControlAttention(control) {
        if (!control || !control.classList) return;
        clearFocusedFilterControl();
        focusedFilterControl = control;
        control.classList.add("filter-attention");
        focusedFilterControlTimer = setTimeout(() => {
          clearFocusedFilterControl();
        }, 900);
      }

      function focusQueueFilterControl(control) {
        if (!control) return;
        const controlsHost = control.closest(".controls");
        if (controlsHost instanceof HTMLElement) {
          controlsHost.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          control.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        control.focus();
        markFilterControlAttention(control);
        if (control === queryInput) {
          queryInput.select();
        }
      }

      function baseRecoveryContextTarget(step) {
        if (step === "unknown") {
          return { control: statusFilter, label: "Status Filter" };
        }
        return { control: failureStepFilter, label: "Failure Step Filter" };
      }

      function recoveryContextTarget(step) {
        const baseTarget = baseRecoveryContextTarget(step);
        if (recoveryContextFocusMode === "query_first") {
          return { control: queryInput, label: "Search" };
        }
        if (recoveryContextFocusMode === "step_first") {
          return baseTarget;
        }
        if (queryInput.value.trim()) {
          return { control: queryInput, label: "Search" };
        }
        if (retryableFilter.value) {
          return { control: retryableFilter, label: "Retryable Filter" };
        }
        return baseTarget;
      }

      function recoveryContextActionLabel(step) {
        if (!step) return QUEUE_RECOVERY_EDIT_CONTEXT_LABEL;
        const target = recoveryContextTarget(step);
        return QUEUE_RECOVERY_EDIT_CONTEXT_LABEL + " → " + target.label;
      }

      function focusRecoveryContextControl(step) {
        const target = recoveryContextTarget(step);
        focusQueueFilterControl(target.control);
        return target;
      }

      function focusRecoveryContextFromShortcut() {
        const activeStep = activeFailedStepKey();
        if (!activeStep) {
          const hint = "No step focus active. Select a trend step delta first.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        const target = focusRecoveryContextControl(activeStep);
        const feedback = "Focused control: " + target.label + ".";
        setActionFeedbackPair("done", feedback, queueActionBannerEl);
        errorEl.textContent = feedback;
      }

      function clearRecoveryFocusFromShortcut(options = {}) {
        const activeStep = activeFailedStepKey();
        if (!activeStep) {
          if (options.silent_when_empty) return;
          const hint = "No step focus to clear.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        void focusRecoveryStepFromTrend(activeStep, activeRecoverySummary(), null);
      }

      function focusRecoveryStepFromShortcut(step) {
        void focusRecoveryStepFromTrend(step, activeRecoverySummary(), null);
      }

      function trendStepActionTitle(step) {
        if (isFailedStepFilterActive(step)) {
          if (step === "unknown") return "Click again to clear failed filter";
          return "Click again to clear step filter";
        }
        return "Filter failed items by " + step + " step";
      }

      function failedFilterContextSummary(step) {
        const stepLabel = step === "unknown" ? "all" : step;
        const retryableLabel = retryableFilter.value || "all";
        const queryLabel = queryInput.value.trim() || "all";
        return (
          "status=FAILED_* · step=" +
          stepLabel +
          " · retryable=" +
          retryableLabel +
          " · q=" +
          queryLabel
        );
      }

      function failedStepOfItem(item) {
        const rawStep = String(item?.failure?.failed_step || "").toLowerCase();
        if (rawStep === "extract" || rawStep === "pipeline" || rawStep === "export") return rawStep;
        return "unknown";
      }

      function firstFailedItemForStep(step, items) {
        const failedItems = (items || []).filter((item) => String(item?.status || "").startsWith("FAILED_"));
        const byScoreDesc = (a, b) => Number(b?.match_score ?? -1) - Number(a?.match_score ?? -1);
        const stepMatched = failedItems.filter((item) => failedStepOfItem(item) === step).sort(byScoreDesc);
        if (stepMatched.length) return stepMatched[0];
        const fallback = [...failedItems].sort(byScoreDesc);
        return fallback[0] || null;
      }

      async function focusRecoveryStepFromTrend(step, summary, button) {
        const sampleId = recoverySampleIdByStep(summary, step);
        const stepFilter = step === "unknown" ? "" : step;
        const activeStep = activeFailedStepKey();
        const isAlreadyFocused = activeStep === step;
        await runActionWithFeedback(
          {
            id: "recovery_trend_focus_" + step,
            label: "Trend Focus: " + step,
            action: async () => {
              if (isAlreadyFocused) {
                if (step === "unknown") {
                  statusFilter.value = "";
                  failureStepFilter.value = "";
                } else {
                  statusFilter.value = "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT";
                  failureStepFilter.value = "";
                }
              } else {
                statusFilter.value = "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT";
                failureStepFilter.value = stepFilter;
              }
              syncFocusChips();
              persistControls();
              resetPreviewOffset();
              clearPreviewState();
              await loadItems();
              if (isAlreadyFocused) {
                errorEl.textContent =
                  step === "unknown"
                    ? "Cleared failed filter focus."
                    : "Cleared step focus filter for " + step + ".";
                return;
              }
              const fallbackItem = firstFailedItemForStep(step, allItems);
              const targetId = sampleId != null ? sampleId : fallbackItem?.id;
              if (targetId != null) {
                await selectItem(targetId);
                focusQueueItemCard(targetId, { revealCollapsed: true });
                if (sampleId == null && fallbackItem?.id != null) {
                  errorEl.textContent =
                    "No step sample in summary. Opened fallback failed item for " + step + ".";
                }
              } else {
                errorEl.textContent = "No failed items found for step: " + step + ".";
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function copyTextToClipboard(text, messages = {}) {
        const value = String(text ?? "");
        const successMessage = messages.success || "Copied to clipboard.";
        const failureMessage = messages.failure || "Copy failed.";
        let copied = false;
        if (navigator?.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(value);
            copied = true;
          } catch {
            copied = false;
          }
        }
        if (!copied) {
          const textarea = document.createElement("textarea");
          textarea.value = value;
          textarea.setAttribute("readonly", "true");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          textarea.style.left = "-9999px";
          document.body.appendChild(textarea);
          textarea.select();
          try {
            copied = document.execCommand("copy");
          } catch {
            copied = false;
          } finally {
            document.body.removeChild(textarea);
          }
        }
        errorEl.textContent = copied ? successMessage : failureMessage;
        return copied;
      }

      async function copyRecoverySummary(summary) {
        if (!summary) return false;
        return copyTextToClipboard(JSON.stringify(summary, null, 2), {
          success: "Copied recovery summary.",
          failure: "Copy recovery summary failed.",
        });
      }

      function downloadRecoverySummary(summary) {
        if (!summary) return;
        const payload = JSON.stringify(summary, null, 2);
        const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        const summaryLabel =
          String(summary.label || "recovery")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "") || "recovery";
        anchor.href = url;
        anchor.download = "recovery_summary_" + summaryLabel + ".json";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }

      function renderRecoveryRadar(summary = null) {
        if (!recoveryRadarEl) return;
        const activeSummary = summary || activeRecoverySummary();
        const historyCount = recoveryRadarHistory.length;
        const historyBadge = '<span class="history-badge">' + historyCount + "/" + RECOVERY_HISTORY_LIMIT + "</span>";
        if (!activeSummary) {
          recoveryRadarEl.innerHTML =
            '<div class="recovery-radar-head"><h4>Recovery Radar ' + historyBadge + '</h4><span class="muted">No recovery runs yet.</span></div>' +
            '<div class="recovery-radar-actions">' +
            '<button type="button" disabled>' +
            QUEUE_RECOVERY_COPY_LABEL +
            '</button><button type="button" class="secondary" disabled>' +
            QUEUE_RECOVERY_DOWNLOAD_LABEL +
            '</button><button type="button" class="secondary" disabled>' +
            QUEUE_RECOVERY_PREV_LABEL +
            '</button><button type="button" class="secondary" disabled>' +
            QUEUE_RECOVERY_NEXT_LABEL +
            '</button><button type="button" class="secondary" disabled>' +
            QUEUE_RECOVERY_LATEST_LABEL +
            '</button><button type="button" class="secondary" disabled>' +
            QUEUE_RECOVERY_CLEAR_LABEL +
            "</button></div>" +
            '<div id="recoveryRadarTrend" class="recovery-radar-trend muted">Trend vs previous: —<br/>Trend Status: —<br/>Step failed delta: —</div>' +
            '<div id="recoveryRadarTimeline" class="recovery-radar-timeline muted">' +
            QUEUE_RECOVERY_HISTORY_HINT +
            "</div>";
          return;
        }
        const totals = activeSummary.totals || {};
        const stepBuckets = activeSummary.step_buckets || emptyRecoveryStepBuckets();
        const activeIndex = recoveryRadarHistory.findIndex((entry) => entry.summary_id === activeSummary.summary_id);
        const hasPrevRun = activeIndex >= 0 && activeIndex < recoveryRadarHistory.length - 1;
        const hasNextRun = activeIndex > 0;
        const hasLatestRun = activeIndex > 0;
        const activeStep = activeFailedStepKey();
        const trend = recoveryTrendVsPrevious(activeSummary);
        const stepFailedDelta = recoveryStepFailedDeltaVsPrevious(activeSummary);
        const trendStatus = recoveryTrendStatusByDelta(trend);
        const hasActiveStepFocus = Boolean(activeStep);
        const focusContext = activeStep ? failedFilterContextSummary(activeStep) : "";
        const focusModeButtonsHtml = recoveryContextFocusModes()
          .map((mode) => {
            const isActive = recoveryContextFocusMode === mode.key;
            return (
              '<button type="button" class="trend-focus-mode-btn ' +
              (isActive ? "active" : "") +
              '" id="' +
              mode.id +
              '" data-focus-mode="' +
              mode.key +
              '" aria-pressed="' +
              (isActive ? "true" : "false") +
              '">' +
              mode.label +
              "</button>"
            );
          })
          .join("");
        const focusMetaText = hasActiveStepFocus
          ? QUEUE_RECOVERY_CONTEXT_LABEL + ": " + focusContext
          : "Choose a step delta to enable context jump.";
        const focusModeNote = recoveryContextFocusModeNote(recoveryContextFocusMode);
        const editFocusLabel = recoveryContextActionLabel(activeStep);
        const clearFocusLabel = hasActiveStepFocus
          ? activeStep === "unknown"
            ? QUEUE_RECOVERY_CLEAR_FAILED_LABEL
            : QUEUE_RECOVERY_CLEAR_STEP_LABEL
          : QUEUE_RECOVERY_CLEAR_STEP_LABEL;
        const focusHintHtml =
          '<div class="trend-focus-hint"><span>' +
          (hasActiveStepFocus ? "Step focus active: " + activeStep : "Step focus inactive") +
          '</span><span class="trend-focus-meta">' +
          focusMetaText +
          '</span><span class="trend-focus-note">' +
          focusModeNote +
          '</span><div class="trend-focus-mode-group"><span class="mode-prefix">' +
          QUEUE_RECOVERY_FOCUS_MODE_PREFIX +
          ":</span>" +
          focusModeButtonsHtml +
          '</div><button type="button" class="secondary" id="editTrendFocusContextBtn"' +
          (hasActiveStepFocus ? "" : ' disabled aria-disabled="true"') +
          ">" +
          editFocusLabel +
          '</button><button type="button" id="clearTrendStepFocusBtn"' +
          (hasActiveStepFocus ? "" : ' disabled aria-disabled="true"') +
          ">" +
          clearFocusLabel +
          "</button></div>";
        const trendHtml = trend
          ? '<div id="recoveryRadarTrend" class="recovery-radar-trend">' +
            '<div class="trend-head">Trend vs previous · ' +
            trend.previous_label +
            "</div>" +
            '<div class="trend-status ' +
            trendStatus.tone +
            '">' +
            trendStatus.label +
            "</div>" +
            '<div class="trend-grid">' +
            '<div class="trend-cell">Targeted <span class="trend-delta ' +
            recoveryDeltaClass(trend.deltas.targeted) +
            '">' +
            recoveryDeltaText(trend.deltas.targeted) +
            '</span></div>' +
            '<div class="trend-cell">Queued <span class="trend-delta ' +
            recoveryDeltaClass(trend.deltas.queued) +
            '">' +
            recoveryDeltaText(trend.deltas.queued) +
            '</span></div>' +
            '<div class="trend-cell">Replayed <span class="trend-delta ' +
            recoveryDeltaClass(trend.deltas.replayed) +
            '">' +
            recoveryDeltaText(trend.deltas.replayed) +
            '</span></div>' +
            '<div class="trend-cell">Failed <span class="trend-delta ' +
            recoveryDeltaClass(trend.deltas.failed) +
            '">' +
            recoveryDeltaText(trend.deltas.failed) +
            "</span></div></div>" +
            '<div class="trend-subhead">Step failed delta</div>' +
            '<div class="trend-grid">' +
            '<button type="button" class="trend-cell trend-cell-action ' +
            (isFailedStepFilterActive("extract") ? "active" : "") +
            '" id="trendStepDeltaExtractBtn" title="' +
            trendStepActionTitle("extract") +
            '" aria-pressed="' +
            (isFailedStepFilterActive("extract") ? "true" : "false") +
            '">extract <span class="trend-delta ' +
            recoveryDeltaClass(stepFailedDelta?.extract ?? 0) +
            '">' +
            recoveryDeltaText(stepFailedDelta?.extract ?? 0) +
            '</span></button>' +
            '<button type="button" class="trend-cell trend-cell-action ' +
            (isFailedStepFilterActive("pipeline") ? "active" : "") +
            '" id="trendStepDeltaPipelineBtn" title="' +
            trendStepActionTitle("pipeline") +
            '" aria-pressed="' +
            (isFailedStepFilterActive("pipeline") ? "true" : "false") +
            '">pipeline <span class="trend-delta ' +
            recoveryDeltaClass(stepFailedDelta?.pipeline ?? 0) +
            '">' +
            recoveryDeltaText(stepFailedDelta?.pipeline ?? 0) +
            '</span></button>' +
            '<button type="button" class="trend-cell trend-cell-action ' +
            (isFailedStepFilterActive("export") ? "active" : "") +
            '" id="trendStepDeltaExportBtn" title="' +
            trendStepActionTitle("export") +
            '" aria-pressed="' +
            (isFailedStepFilterActive("export") ? "true" : "false") +
            '">export <span class="trend-delta ' +
            recoveryDeltaClass(stepFailedDelta?.export ?? 0) +
            '">' +
            recoveryDeltaText(stepFailedDelta?.export ?? 0) +
            '</span></button>' +
            '<button type="button" class="trend-cell trend-cell-action ' +
            (isFailedStepFilterActive("unknown") ? "active" : "") +
            '" id="trendStepDeltaUnknownBtn" title="' +
            trendStepActionTitle("unknown") +
            '" aria-pressed="' +
            (isFailedStepFilterActive("unknown") ? "true" : "false") +
            '">unknown <span class="trend-delta ' +
            recoveryDeltaClass(stepFailedDelta?.unknown ?? 0) +
            '">' +
            recoveryDeltaText(stepFailedDelta?.unknown ?? 0) +
            "</span></button></div>" +
            focusHintHtml +
            "</div>"
          : '<div id="recoveryRadarTrend" class="recovery-radar-trend muted">Trend vs previous: need at least two runs.<br/>Trend Status: need at least two runs.<br/>Step failed delta: need at least two runs.' +
            focusHintHtml +
            "</div>";
        recoveryRadarEl.innerHTML =
          '<div class="recovery-radar-head"><h4>Recovery Radar ' +
          historyBadge +
          '</h4><span class="muted">' +
          (activeSummary.label || "Latest recovery run") +
          "</span></div>" +
          '<div class="recovery-radar-kpi">' +
          '<div class="cell"><div class="label">Targeted</div><div class="value">' +
          (totals.targeted ?? 0) +
          '</div></div>' +
          '<div class="cell"><div class="label">Queued</div><div class="value">' +
          (totals.queued ?? 0) +
          '</div></div>' +
          '<div class="cell"><div class="label">Replayed</div><div class="value">' +
          (totals.replayed ?? 0) +
          '</div></div>' +
          '<div class="cell"><div class="label">Failed</div><div class="value">' +
          (totals.failed ?? 0) +
          "</div></div></div>" +
          '<div class="recovery-radar-actions">' +
          '<button type="button" id="copyRecoverySummaryBtn">' +
          QUEUE_RECOVERY_COPY_LABEL +
          '</button><button type="button" class="secondary" id="downloadRecoverySummaryBtn">' +
          QUEUE_RECOVERY_DOWNLOAD_LABEL +
          '</button><button type="button" class="secondary" id="prevRecoverySummaryBtn" ' +
          (hasPrevRun ? "" : "disabled") +
          ">" +
          QUEUE_RECOVERY_PREV_LABEL +
          '</button><button type="button" class="secondary" id="nextRecoverySummaryBtn" ' +
          (hasNextRun ? "" : "disabled") +
          ">" +
          QUEUE_RECOVERY_NEXT_LABEL +
          '</button><button type="button" class="secondary" id="latestRecoverySummaryBtn" ' +
          (hasLatestRun ? "" : "disabled") +
          ">" +
          QUEUE_RECOVERY_LATEST_LABEL +
          '</button><button type="button" class="secondary" id="clearRecoverySummaryBtn">' +
          QUEUE_RECOVERY_CLEAR_LABEL +
          "</button></div>" +
          trendHtml;

        const stepDefs = [
          { key: "extract", label: "extract" },
          { key: "pipeline", label: "pipeline" },
          { key: "export", label: "export" },
          { key: "unknown", label: "unknown" },
        ];
        const stepGrid = document.createElement("div");
        stepGrid.className = "recovery-step-grid";
        for (const def of stepDefs) {
          const bucket = stepBuckets[def.key] || { targeted: 0, queued: 0, replayed: 0, failed: 0, sample_item_ids: [], failed_item_ids: [] };
          const cell = document.createElement("div");
          cell.className = "recovery-step";
          cell.innerHTML =
            '<div class="title">' +
            def.label +
            '</div><div class="meta">targeted=' +
            bucket.targeted +
            ", queued=" +
            bucket.queued +
            ", failed=" +
            bucket.failed +
            "</div>";
          const failedSamples = Array.isArray(bucket.failed_item_ids) ? bucket.failed_item_ids : [];
          const allSamples = Array.isArray(bucket.sample_item_ids) ? bucket.sample_item_ids : [];
          const sampleId = failedSamples[0] || allSamples[0] || null;
          if (sampleId) {
            const sampleBtn = document.createElement("button");
            sampleBtn.type = "button";
            sampleBtn.textContent = "Open Sample";
            const op = {
              id: "recovery_radar_open_" + def.key,
              label: "Open " + def.label + " sample",
              action: async () => {
                await selectItem(sampleId);
                focusQueueItemCard(sampleId, { revealCollapsed: true });
              },
            };
            sampleBtn.addEventListener("click", async () => {
              await runActionWithFeedback(op, {
                button: sampleBtn,
                localFeedbackEl: queueActionBannerEl,
              });
            });
            cell.appendChild(sampleBtn);
          }
          if (def.key !== "unknown") {
            const filterBtn = document.createElement("button");
            filterBtn.type = "button";
            filterBtn.className = "secondary";
            filterBtn.textContent = "Filter Step";
            filterBtn.addEventListener("click", async () => {
              await applyListContextAndReload("Recovery Step: " + def.label, {
                button: filterBtn,
                mutate: () => {
                  statusFilter.value = "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT";
                  failureStepFilter.value = def.key;
                },
              });
            });
            cell.appendChild(filterBtn);
          }
          stepGrid.appendChild(cell);
        }
        recoveryRadarEl.appendChild(stepGrid);
        const copyBtn = recoveryRadarEl.querySelector("#copyRecoverySummaryBtn");
        copyBtn?.addEventListener("click", async () => {
          await copyRecoverySummary(activeSummary);
        });
        const downloadBtn = recoveryRadarEl.querySelector("#downloadRecoverySummaryBtn");
        downloadBtn?.addEventListener("click", () => {
          downloadRecoverySummary(activeSummary);
        });
        const prevBtn = recoveryRadarEl.querySelector("#prevRecoverySummaryBtn");
        prevBtn?.addEventListener("click", () => {
          if (!hasPrevRun) return;
          const target = recoveryRadarHistory[activeIndex + 1];
          if (!target) return;
          activateRecoverySummary(target.summary_id);
        });
        const nextBtn = recoveryRadarEl.querySelector("#nextRecoverySummaryBtn");
        nextBtn?.addEventListener("click", () => {
          if (!hasNextRun) return;
          const target = recoveryRadarHistory[activeIndex - 1];
          if (!target) return;
          activateRecoverySummary(target.summary_id);
        });
        const latestBtn = recoveryRadarEl.querySelector("#latestRecoverySummaryBtn");
        latestBtn?.addEventListener("click", () => {
          if (!hasLatestRun) return;
          const target = recoveryRadarHistory[0];
          if (!target) return;
          activateRecoverySummary(target.summary_id);
        });
        const trendStepBindings = [
          { id: "trendStepDeltaExtractBtn", step: "extract" },
          { id: "trendStepDeltaPipelineBtn", step: "pipeline" },
          { id: "trendStepDeltaExportBtn", step: "export" },
          { id: "trendStepDeltaUnknownBtn", step: "unknown" },
        ];
        for (const binding of trendStepBindings) {
          const trendBtn = recoveryRadarEl.querySelector("#" + binding.id);
          trendBtn?.addEventListener("click", async () => {
            await focusRecoveryStepFromTrend(binding.step, activeSummary, trendBtn);
          });
        }
        const editTrendFocusBtn = recoveryRadarEl.querySelector("#editTrendFocusContextBtn");
        editTrendFocusBtn?.addEventListener("click", async () => {
          if (!activeStep) return;
          const actionLabel = recoveryContextActionLabel(activeStep);
          await runActionWithFeedback(
            {
              id: "recovery_trend_edit_context",
              label: actionLabel,
              action: async () => {
                const resolved = focusRecoveryContextControl(activeStep);
                errorEl.textContent = "Focused control: " + resolved.label + ".";
              },
            },
            { button: editTrendFocusBtn, localFeedbackEl: queueActionBannerEl },
          );
        });
        for (const focusMode of recoveryContextFocusModes()) {
          const focusModeBtn = recoveryRadarEl.querySelector("#" + focusMode.id);
          focusModeBtn?.addEventListener("click", async () => {
            await runActionWithFeedback(
              {
                id: "recovery_trend_focus_mode_" + focusMode.key,
                label: QUEUE_RECOVERY_FOCUS_MODE_PREFIX + ": " + recoveryContextFocusModeLabel(focusMode.key),
                action: async () => {
                  const changed = setRecoveryContextFocusMode(focusMode.key);
                  if (!changed) {
                    errorEl.textContent = "Context focus mode already: " + recoveryContextFocusModeLabel(focusMode.key) + ".";
                    return;
                  }
                  persistControls();
                  renderRecoveryRadar(activeSummary);
                  errorEl.textContent = "Context focus mode: " + recoveryContextFocusModeLabel(focusMode.key) + ".";
                },
              },
              { button: focusModeBtn, localFeedbackEl: queueActionBannerEl },
            );
          });
        }
        const clearTrendFocusBtn = recoveryRadarEl.querySelector("#clearTrendStepFocusBtn");
        clearTrendFocusBtn?.addEventListener("click", async () => {
          if (!activeStep) return;
          await focusRecoveryStepFromTrend(activeStep, activeSummary, clearTrendFocusBtn);
        });
        const clearBtn = recoveryRadarEl.querySelector("#clearRecoverySummaryBtn");
        clearBtn?.addEventListener("click", () => {
          latestRecoverySummary = null;
          recoveryRadarHistory = [];
          activeRecoverySummaryId = null;
          persistRecoveryRadarState();
          renderRecoveryRadar(null);
        });
        const timelineEl = document.createElement("div");
        timelineEl.id = "recoveryRadarTimeline";
        timelineEl.className = "recovery-radar-timeline";
        if (recoveryRadarHistory.length <= 1) {
          const hint = document.createElement("span");
          hint.className = "muted";
          hint.textContent = QUEUE_RECOVERY_HISTORY_HINT;
          timelineEl.appendChild(hint);
        } else {
          recoveryRadarHistory.forEach((entry, index) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "timeline-chip";
            if (entry.summary_id === activeSummary.summary_id) {
              chip.classList.add("active");
            }
            chip.textContent = recoveryTimelineLabel(entry, index);
            chip.addEventListener("click", () => {
              activateRecoverySummary(entry.summary_id);
            });
            timelineEl.appendChild(chip);
          });
        }
        recoveryRadarEl.appendChild(timelineEl);
      }

      function setLatestRecoverySummary(summary) {
        const normalized = normalizeRecoverySummary(summary);
        if (!normalized) return;
        recoveryRadarHistory = [
          normalized,
          ...recoveryRadarHistory.filter((entry) => entry.summary_id !== normalized.summary_id),
        ].slice(0, RECOVERY_HISTORY_LIMIT);
        latestRecoverySummary = normalized;
        activeRecoverySummaryId = normalized.summary_id;
        persistRecoveryRadarState();
        renderRecoveryRadar(normalized);
      }

      function lastAttemptRetryCandidates(items) {
        return items
          .filter((item) => {
            if (!String(item?.status || "").startsWith("FAILED_")) return false;
            const info = retryInfo(item);
            return info.retryable && info.remaining === 1;
          })
          .sort((a, b) => Number(b.match_score ?? -1) - Number(a.match_score ?? -1));
      }

      function blockedFailedCandidates(items) {
        return items
          .filter((item) => {
            if (!String(item?.status || "").startsWith("FAILED_")) return false;
            const info = retryInfo(item);
            return !info.retryable || info.remaining === 0;
          })
          .sort((a, b) => Number(b.match_score ?? -1) - Number(a.match_score ?? -1));
      }

      async function retryItemsByIds(itemIds) {
        let queued = 0;
        let replayed = 0;
        let failed = 0;
        const stepBuckets = emptyRecoveryStepBuckets();
        for (const itemRef of itemIds) {
          const itemId =
            typeof itemRef === "object" && itemRef
              ? itemRef.id
              : itemRef;
          const step = recoveryStepKey(
            typeof itemRef === "object" && itemRef
              ? itemRef.failed_step || itemRef.failure_step || itemRef.failure?.failed_step
              : null,
          );
          stepBuckets[step].targeted += 1;
          appendRecoverySampleId(stepBuckets[step].sample_item_ids, itemId);
          try {
            const requestId = crypto.randomUUID();
            const response = await request("/items/" + itemId + "/process", {
              method: "POST",
              body: JSON.stringify({
                process_request_id: requestId,
                mode: "RETRY",
              }),
              headers: { "Idempotency-Key": requestId },
            });
            queued += 1;
            stepBuckets[step].queued += 1;
            if (response?.idempotent_replay === true) {
              replayed += 1;
              stepBuckets[step].replayed += 1;
            }
          } catch {
            failed += 1;
            stepBuckets[step].failed += 1;
            appendRecoverySampleId(stepBuckets[step].failed_item_ids, itemId);
          }
        }
        return { queued, replayed, failed, targeted: itemIds.length, step_buckets: stepBuckets };
      }

      function queueItemCardById(itemId) {
        if (itemId == null) return null;
        const cards = inboxEl.querySelectorAll(".item-card.clickable[data-item-id]");
        for (const card of cards) {
          if (card instanceof HTMLElement && card.dataset.itemId === String(itemId)) {
            return card;
          }
        }
        return null;
      }

      function visibleQueueItemIds() {
        const cards = inboxEl.querySelectorAll(".item-card.clickable[data-item-id]");
        const ids = [];
        for (const card of cards) {
          if (!(card instanceof HTMLElement)) continue;
          const rawId = card.dataset.itemId;
          if (!rawId) continue;
          ids.push(rawId);
        }
        return ids;
      }

      function visibleQueueItems() {
        const ids = new Set(visibleQueueItemIds());
        if (!ids.size) return [];
        return allItems.filter((item) => ids.has(String(item?.id)));
      }

      function revealCollapsedGroupForItem(itemId) {
        if (itemId == null) return false;
        const targetItem = allItems.find((item) => String(item?.id) === String(itemId));
        if (!targetItem) return false;
        const groupKey = groupKeyForItem(targetItem);
        if (!groupKey) return false;
        if (!collapsedGroups[groupKey]) return false;
        collapsedGroups[groupKey] = false;
        persistControls();
        renderInbox(allItems);
        return true;
      }

      function focusQueueItemCard(itemId, options = {}) {
        let card = queueItemCardById(itemId);
        if (!card && options.revealCollapsed === true) {
          const revealed = revealCollapsedGroupForItem(itemId);
          if (revealed) {
            card = queueItemCardById(itemId);
          }
        }
        if (!card) return false;
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.remove("focus-flash");
        // force reflow for repeat animation trigger
        void card.offsetWidth;
        card.classList.add("focus-flash");
        window.setTimeout(() => {
          card.classList.remove("focus-flash");
        }, 900);
        return true;
      }

      function countItemsByStatus(items) {
        const counts = {
          CAPTURED: 0,
          QUEUED: 0,
          PROCESSING: 0,
          READY: 0,
          FAILED: 0,
          SHIPPED: 0,
          ARCHIVED: 0,
        };
        for (const item of items) {
          const status = String(item?.status || "");
          if (status === "CAPTURED") counts.CAPTURED += 1;
          else if (status === "QUEUED") counts.QUEUED += 1;
          else if (status === "PROCESSING") counts.PROCESSING += 1;
          else if (status === "READY") counts.READY += 1;
          else if (status === "SHIPPED") counts.SHIPPED += 1;
          else if (status === "ARCHIVED") counts.ARCHIVED += 1;
          else if (status.startsWith("FAILED_")) counts.FAILED += 1;
        }
        return counts;
      }

      function renderQueueFlowPulse(items, counts) {
        if (!queueFlowPulseEl) return;
        const total = Math.max(items.length, 1);
        const failedBuckets = failedRetryBuckets(items);
        const flowHealth = Math.round(((counts.READY + counts.SHIPPED) / total) * 100);
        const stages = [
          { label: "Captured", status: "CAPTURED", tone: "captured", count: counts.CAPTURED },
          { label: "Queued", status: "QUEUED", tone: "queued", count: counts.QUEUED },
          { label: "Processing", status: "PROCESSING", tone: "processing", count: counts.PROCESSING },
          { label: "Ready", status: "READY", tone: "ready", count: counts.READY },
          { label: "Shipped", status: "SHIPPED", tone: "shipped", count: counts.SHIPPED },
        ];
        queueFlowPulseEl.innerHTML =
          '<div class="queue-flow-head"><h4 class="queue-flow-title">Pipeline Pulse</h4><span class="muted">' +
          items.length +
          " total items</span></div>";
        const track = document.createElement("div");
        track.className = "queue-flow-track";
        for (const stage of stages) {
          const segment = document.createElement("button");
          segment.type = "button";
          segment.className = "pulse-segment pulse-" + stage.tone;
          if (!stage.count) segment.classList.add("is-empty");
          if (statusFilter.value === stage.status) segment.classList.add("active");
          const stagePercent = Math.round((stage.count / total) * 100);
          segment.innerHTML =
            '<span class="label">' +
            stage.label +
            '</span><span class="value">' +
            stage.count +
            '</span><span class="meta">' +
            stagePercent +
            "%</span>";
          segment.title = stage.label + ": " + stage.count + " (" + stagePercent + "%)";
          segment.addEventListener("click", async () => {
            await applyListContextAndReload("Flow: " + stage.label, {
              button: segment,
              mutate: () => {
                statusFilter.value = stage.status;
              },
            });
          });
          track.appendChild(segment);
        }
        queueFlowPulseEl.appendChild(track);
        const meta = document.createElement("div");
        meta.className = "queue-flow-meta muted";
        meta.innerHTML =
          "Flow health: <strong>" +
          flowHealth +
          "%</strong> ready-or-shipped · Blocked now: <strong>" +
          failedBuckets.blocked +
          "</strong> hard-blocked · Retryable failed: <strong>" +
          failedBuckets.retryable +
          "</strong>";
        if (failedBuckets.last_attempt > 0) {
          meta.innerHTML += " · Last-attempt items: <strong>" + failedBuckets.last_attempt + "</strong>";
        }
        meta.innerHTML += " · Click stage to filter";
        if (counts.FAILED > 0) {
          const failedBtn = document.createElement("button");
          failedBtn.type = "button";
          failedBtn.textContent = "View Failed";
          if (statusFilter.value === "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT") {
            failedBtn.disabled = true;
          }
          failedBtn.addEventListener("click", async () => {
            await applyListContextAndReload("Flow: Failed", {
              button: failedBtn,
              mutate: () => {
                statusFilter.value = "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT";
              },
            });
          });
          meta.appendChild(failedBtn);
        }
        if (failedBuckets.blocked > 0) {
          const blockedBtn = document.createElement("button");
          blockedBtn.type = "button";
          blockedBtn.textContent = "View Blocked";
          if (statusFilter.value === "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT" && retryableFilter.value === "false") {
            blockedBtn.disabled = true;
          }
          blockedBtn.addEventListener("click", async () => {
            await applyListContextAndReload("Flow: Blocked", {
              button: blockedBtn,
              mutate: () => {
                statusFilter.value = "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT";
                retryableFilter.value = "false";
              },
            });
          });
          meta.appendChild(blockedBtn);
          const blockedDetailBtn = document.createElement("button");
          blockedDetailBtn.type = "button";
          blockedDetailBtn.textContent = "Open First Blocked";
          blockedDetailBtn.addEventListener("click", async () => {
            await runOpenFirstBlockedAction(blockedDetailBtn);
          });
          meta.appendChild(blockedDetailBtn);
        }
        if (failedBuckets.last_attempt > 0) {
          const lastRetryBtn = document.createElement("button");
          lastRetryBtn.type = "button";
          lastRetryBtn.textContent = "Rescue Last Retry";
          lastRetryBtn.addEventListener("click", async () => {
            await runRescueLastRetryAction(lastRetryBtn);
          });
          meta.appendChild(lastRetryBtn);
        }
        queueFlowPulseEl.appendChild(meta);
      }

      function renderQueueHighlights(items) {
        if (!queueHighlightsEl) return;
        const counts = countItemsByStatus(items);
        const readyCount = counts.READY;
        const shippedCount = counts.SHIPPED;
        const attentionCount = counts.FAILED;
        const failedBuckets = failedRetryBuckets(items);
        const retryableCount = failedBuckets.retryable;
        const candidate = topReadyItem(items);
        const momentum = readyCount + retryableCount;
        renderQueueFlowPulse(items, counts);

        queueHighlightsEl.innerHTML = "";
        const metrics = [
          { label: "Ready to Ship", value: String(readyCount), meta: "可直接导出" },
          { label: "Need Attention", value: String(attentionCount), meta: retryableCount + " 个可重试" },
          { label: "Shipped", value: String(shippedCount), meta: "已完成交付" },
          {
            label: "Next Best Move",
            value: candidate ? Number(candidate.match_score ?? 0).toFixed(1) : "—",
            meta: candidate ? (candidate.title || candidate.domain || candidate.url || "Ready item").slice(0, 44) : "等待新的 READY 项",
          },
        ];

        for (const metric of metrics) {
          const metricCard = document.createElement("div");
          metricCard.className = "aha-card";
          metricCard.innerHTML =
            '<div class="aha-label">' +
            metric.label +
            '</div><div class="aha-value">' +
            metric.value +
            '</div><div class="aha-meta">' +
            metric.meta +
            "</div>";
          queueHighlightsEl.appendChild(metricCard);
        }
        queueHighlightsEl.title = "Queue momentum: " + momentum;

        if (!ahaNudgeEl) return;
        const retryableFailed = items.find((item) => isRetryableFailedItem(item));
        const capturedCandidate = items.find((item) => item.status === "CAPTURED");
        let title = "Next Recommended Move";
        let message = "Capture or process more items to keep the decision queue active.";
        let nudgeTone = "ship";
        let nudgeItemId = null;
        let nudgeContext = "";
        let ctaOp = null;
        if (candidate) {
          title = "Ship momentum available";
          message = "Top ready item score " + Number(candidate.match_score ?? 0).toFixed(1) + ". Ship now to keep output velocity.";
          nudgeTone = "ship";
          nudgeItemId = candidate.id;
          nudgeContext = "Highest score READY item";
          ctaOp = {
            id: "nudge_export_top",
            label: "Open & Export Top Item",
            action: async () => {
              await selectItem(candidate.id);
              await exportItem(candidate.id);
            },
          };
        } else if (retryableFailed) {
          title = "Recover blocked value";
          message = "A retryable failed item is waiting. Recover it first to unblock downstream output.";
          nudgeTone = "recover";
          nudgeItemId = retryableFailed.id;
          nudgeContext = "Retryable failure with recoverable value";
          ctaOp = {
            id: "nudge_retry_failed",
            label: "Retry First Failed Item",
            action: async () => {
              await processItem(retryableFailed.id, "RETRY");
            },
          };
        } else if (capturedCandidate) {
          title = "Convert captured into artifacts";
          message = "You still have captured items not processed. Turn one into actionable artifacts now.";
          nudgeTone = "process";
          nudgeItemId = capturedCandidate.id;
          nudgeContext = "Fresh capture awaiting first process run";
          ctaOp = {
            id: "nudge_process_captured",
            label: "Process First Captured Item",
            action: async () => {
              await processItem(capturedCandidate.id, "PROCESS");
            },
          };
        }
        setQueueNudgeState({
          itemId: nudgeItemId,
          tone: nudgeTone,
          actionLabel: ctaOp?.label || "",
          context: nudgeContext,
        });
        const ahaPool = sortedAhaItems(items);
        const ahaCandidates = ahaPool.slice(0, 3);
        ahaNudgeEl.className = "aha-nudge" + (nudgeTone ? " nudge-" + nudgeTone : "");
        ahaNudgeEl.innerHTML = '<h4>' + title + '</h4><span class="muted">' + message + "</span>";
        setActionFeedback(queueActionBannerEl, "", "Ready.");
        if (ctaOp) {
          if (nudgeContext) {
            const context = document.createElement("div");
            context.className = "nudge-context muted";
            context.textContent = QUEUE_SPOTLIGHT_BADGE_TEXT + ": " + nudgeContext;
            ahaNudgeEl.appendChild(context);
          }
          const actionsEl = document.createElement("div");
          actionsEl.className = "nudge-actions";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "primary";
          btn.textContent = ctaOp.label;
          btn.addEventListener("click", async () => {
            await runActionWithFeedback(ctaOp, {
              button: btn,
              localFeedbackEl: queueActionBannerEl,
            });
          });
          actionsEl.appendChild(btn);
          if (nudgeItemId != null) {
            const focusBtn = document.createElement("button");
            focusBtn.type = "button";
            focusBtn.className = "secondary";
            focusBtn.textContent = QUEUE_NUDGE_FOCUS_LABEL;
            focusBtn.addEventListener("click", async () => {
              await runFocusRecommendedQueueAction(nudgeItemId, focusBtn);
            });
            actionsEl.appendChild(focusBtn);
          }
          const focusTopBtn = document.createElement("button");
          focusTopBtn.type = "button";
          focusTopBtn.className = "secondary";
          focusTopBtn.textContent = QUEUE_NUDGE_FOCUS_TOP_LABEL;
          focusTopBtn.addEventListener("click", async () => {
            await runFocusTopAhaQueueAction(focusTopBtn);
          });
          actionsEl.appendChild(focusTopBtn);
          if (ahaCandidates.length > 1) {
            const focusNextBtn = document.createElement("button");
            focusNextBtn.type = "button";
            focusNextBtn.className = "secondary";
            focusNextBtn.textContent = QUEUE_NUDGE_FOCUS_NEXT_LABEL;
            focusNextBtn.addEventListener("click", async () => {
              await runCycleAhaQueueAction("next", focusNextBtn);
            });
            actionsEl.appendChild(focusNextBtn);
            const focusPrevBtn = document.createElement("button");
            focusPrevBtn.type = "button";
            focusPrevBtn.className = "secondary";
            focusPrevBtn.textContent = QUEUE_NUDGE_FOCUS_PREV_LABEL;
            focusPrevBtn.addEventListener("click", async () => {
              await runCycleAhaQueueAction("previous", focusPrevBtn);
            });
            actionsEl.appendChild(focusPrevBtn);
            const resetCycleBtn = document.createElement("button");
            resetCycleBtn.type = "button";
            resetCycleBtn.className = "secondary";
            resetCycleBtn.textContent = QUEUE_NUDGE_RESET_CYCLE_LABEL;
            resetCycleBtn.addEventListener("click", async () => {
              await runResetAhaCycleAction(resetCycleBtn);
            });
            actionsEl.appendChild(resetCycleBtn);
          }
          if (ahaCandidates.length > 1) {
            const focusSecondBtn = document.createElement("button");
            focusSecondBtn.type = "button";
            focusSecondBtn.className = "secondary";
            focusSecondBtn.textContent = QUEUE_NUDGE_FOCUS_SECOND_LABEL;
            focusSecondBtn.addEventListener("click", async () => {
              await runFocusSecondAhaQueueAction(focusSecondBtn);
            });
            actionsEl.appendChild(focusSecondBtn);
          }
          const runTopBtn = document.createElement("button");
          runTopBtn.type = "button";
          runTopBtn.className = "secondary";
          runTopBtn.textContent = QUEUE_NUDGE_RUN_TOP_LABEL;
          runTopBtn.addEventListener("click", async () => {
            await runTopAhaPrimaryAction(runTopBtn);
          });
          actionsEl.appendChild(runTopBtn);
          const copySnapshotBtn = document.createElement("button");
          copySnapshotBtn.type = "button";
          copySnapshotBtn.className = "secondary";
          copySnapshotBtn.textContent = QUEUE_NUDGE_COPY_SNAPSHOT_LABEL;
          copySnapshotBtn.addEventListener("click", async () => {
            await runCopyAhaSnapshotAction(copySnapshotBtn);
          });
          actionsEl.appendChild(copySnapshotBtn);
          const copyStoryBtn = document.createElement("button");
          copyStoryBtn.type = "button";
          copyStoryBtn.className = "secondary";
          copyStoryBtn.textContent = QUEUE_NUDGE_COPY_STORY_LABEL;
          copyStoryBtn.addEventListener("click", async () => {
            await runCopyAhaStoryAction(copyStoryBtn);
          });
          actionsEl.appendChild(copyStoryBtn);
          const downloadSnapshotBtn = document.createElement("button");
          downloadSnapshotBtn.type = "button";
          downloadSnapshotBtn.className = "secondary";
          downloadSnapshotBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SNAPSHOT_LABEL;
          downloadSnapshotBtn.addEventListener("click", async () => {
            await runDownloadAhaSnapshotAction(downloadSnapshotBtn);
          });
          actionsEl.appendChild(downloadSnapshotBtn);
          ahaNudgeEl.appendChild(actionsEl);
        } else {
          setActionFeedback(queueActionBannerEl, "", "No immediate CTA. Capture or process new items.");
          if (ahaPool.length) {
            const actionsEl = document.createElement("div");
            actionsEl.className = "nudge-actions";
            const runTopBtn = document.createElement("button");
            runTopBtn.type = "button";
            runTopBtn.className = "secondary";
            runTopBtn.textContent = QUEUE_NUDGE_RUN_TOP_LABEL;
            runTopBtn.addEventListener("click", async () => {
              await runTopAhaPrimaryAction(runTopBtn);
            });
            actionsEl.appendChild(runTopBtn);
            const copySnapshotBtn = document.createElement("button");
            copySnapshotBtn.type = "button";
            copySnapshotBtn.className = "secondary";
            copySnapshotBtn.textContent = QUEUE_NUDGE_COPY_SNAPSHOT_LABEL;
            copySnapshotBtn.addEventListener("click", async () => {
              await runCopyAhaSnapshotAction(copySnapshotBtn);
            });
            actionsEl.appendChild(copySnapshotBtn);
            const copyStoryBtn = document.createElement("button");
            copyStoryBtn.type = "button";
            copyStoryBtn.className = "secondary";
            copyStoryBtn.textContent = QUEUE_NUDGE_COPY_STORY_LABEL;
            copyStoryBtn.addEventListener("click", async () => {
              await runCopyAhaStoryAction(copyStoryBtn);
            });
            actionsEl.appendChild(copyStoryBtn);
            const downloadSnapshotBtn = document.createElement("button");
            downloadSnapshotBtn.type = "button";
            downloadSnapshotBtn.className = "secondary";
            downloadSnapshotBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SNAPSHOT_LABEL;
            downloadSnapshotBtn.addEventListener("click", async () => {
              await runDownloadAhaSnapshotAction(downloadSnapshotBtn);
            });
            actionsEl.appendChild(downloadSnapshotBtn);
            ahaNudgeEl.appendChild(actionsEl);
          }
        }
        if (ahaCandidates.length > 1) {
          const candidatesEl = document.createElement("div");
          candidatesEl.className = "nudge-candidates";
          candidatesEl.innerHTML = '<span class="label">' + QUEUE_NUDGE_CANDIDATES_LABEL + "</span>";
          for (const [index, item] of ahaCandidates.entries()) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "nudge-candidate-chip";
            const rank = index + 1;
            if (rank === 1) {
              chip.classList.add("is-top");
            }
            const primary = primaryActionForItem(item);
            chip.textContent = QUEUE_NUDGE_CANDIDATE_OPEN_LABEL + " · " + ahaCandidateChipLabel(item, rank);
            chip.title =
              "Candidate #" +
              rank +
              " · " +
              (item.title || item.domain || item.url || "Untitled") +
              " · " +
              (primary?.label || "No action");
            chip.addEventListener("click", async () => {
              await runActionWithFeedback(
                {
                  id: "nudge_open_candidate_" + item.id,
                  label: "Open Aha Candidate #" + item.id,
                  action: async () => {
                    await selectItem(item.id);
                    focusQueueItemCard(item.id, { revealCollapsed: true });
                  },
                },
                { button: chip, localFeedbackEl: queueActionBannerEl },
              );
            });
            candidatesEl.appendChild(chip);
          }
          ahaNudgeEl.appendChild(candidatesEl);
        }
        if (ahaPool.length > 0) {
          const heatmapEl = document.createElement("div");
          heatmapEl.className = "nudge-heatmap";
          heatmapEl.innerHTML = '<span class="label">' + QUEUE_NUDGE_HEATMAP_LABEL + "</span>";
          const buckets = ahaHeatBuckets(ahaPool);
          const momentum = ahaHeatMomentumMeta(buckets);
          const momentumEl = document.createElement("span");
          momentumEl.className = "nudge-heat-momentum " + momentum.tone;
          momentumEl.textContent = QUEUE_NUDGE_HEAT_MOMENTUM_PREFIX + ": " + momentum.label;
          heatmapEl.appendChild(momentumEl);
          const trendPoints = ahaHeatTrendPoints();
          if (trendPoints.length) {
            const trendMeta = ahaHeatTrendMeta(trendPoints);
            const trendEl = document.createElement("div");
            trendEl.className = "nudge-heat-trend";
            trendEl.innerHTML =
              '<div class="meta"><span class="label">' +
              QUEUE_NUDGE_HEAT_TREND_LABEL +
              '</span><span class="nudge-heat-momentum ' +
              trendMeta.tone +
              '">' +
              QUEUE_NUDGE_HEAT_TREND_SERIES_LABEL +
              " · " +
              trendMeta.label +
              '</span></div><div class="trend-bars">' +
              ahaHeatTrendBarsHtml(trendPoints) +
              "</div>";
            heatmapEl.appendChild(trendEl);
          }
          for (const bucket of buckets) {
            const chip = document.createElement("span");
            chip.className = "nudge-heat-chip " + bucket.tone;
            chip.textContent = bucket.label + " " + bucket.count;
            const delta = ahaHeatDeltaMeta(bucket.key, bucket.count);
            const deltaEl = document.createElement("span");
            deltaEl.className = "nudge-heat-delta " + delta.tone;
            deltaEl.textContent = delta.label;
            chip.appendChild(deltaEl);
            if (bucket.firstItem) {
              const focusBtn = document.createElement("button");
              focusBtn.type = "button";
              focusBtn.textContent = QUEUE_NUDGE_HEAT_FOCUS_LABEL;
              focusBtn.title = "Focus first " + bucket.label + " Aha candidate";
              focusBtn.addEventListener("click", async () => {
                await runFocusAhaHeatBucket(bucket.key, focusBtn);
              });
              chip.appendChild(focusBtn);
            }
            heatmapEl.appendChild(chip);
          }
          ahaNudgeEl.appendChild(heatmapEl);
          const storyText = ahaStoryText(ahaPool, buckets);
          if (storyText) {
            const storyEl = document.createElement("div");
            storyEl.className = "nudge-story";
            const storyLabelEl = document.createElement("span");
            storyLabelEl.className = "label";
            storyLabelEl.textContent = QUEUE_NUDGE_STORY_LABEL;
            const storyBodyEl = document.createElement("span");
            storyBodyEl.className = "muted";
            storyBodyEl.textContent = storyText;
            storyEl.appendChild(storyLabelEl);
            storyEl.appendChild(storyBodyEl);
            ahaNudgeEl.appendChild(storyEl);
          }
          if (ahaPool.length > 1) {
            const duelText = ahaDuelText(ahaPool);
            if (duelText) {
              const duelEl = document.createElement("div");
              duelEl.className = "nudge-duel";
              duelEl.innerHTML = '<span class="label">' + QUEUE_NUDGE_DUEL_LABEL + '</span><span class="body">' + duelText + "</span>";
              const duelGap = ahaDuelGapMeta(ahaPool);
              if (duelGap) {
                const gapEl = document.createElement("span");
                gapEl.className = "nudge-duel-gap " + duelGap.tone;
                gapEl.innerHTML =
                  QUEUE_NUDGE_DUEL_GAP_LABEL +
                  ": " +
                  duelGap.label +
                  '<span class="muted">· ' +
                  duelGap.hint +
                  "</span>";
                duelEl.appendChild(gapEl);
              }
              const duelEdge = ahaDuelEdgeMeta(ahaPool);
              if (duelEdge) {
                const edgeEl = document.createElement("span");
                edgeEl.className = "nudge-duel-edge " + duelEdge.tone;
                edgeEl.innerHTML =
                  QUEUE_NUDGE_DUEL_EDGE_LABEL +
                  ": " +
                  duelEdge.label +
                  '<span class="muted">· ' +
                  duelEdge.hint +
                  "</span>";
                duelEl.appendChild(edgeEl);
              }
              const duelCall = ahaDuelCallMeta(ahaPool);
              if (duelCall) {
                const callEl = document.createElement("span");
                callEl.className = "nudge-duel-call " + duelCall.tone;
                callEl.innerHTML =
                  QUEUE_NUDGE_DUEL_CALL_LABEL +
                  ": " +
                  duelCall.label +
                  '<span class="muted">· ' +
                  duelCall.hint +
                  "</span>";
                duelEl.appendChild(callEl);
              }
              const duelCallTrend = ahaDuelCallTrendMeta();
              if (duelCallTrend) {
                const callTrendEl = document.createElement("span");
                callTrendEl.className = "nudge-duel-call-trend " + duelCallTrend.tone;
                callTrendEl.textContent = QUEUE_NUDGE_DUEL_CALL_TREND_LABEL + ": " + duelCallTrend.label;
                duelEl.appendChild(callTrendEl);
              }
              const duelCallConfidence = ahaDuelCallConfidenceMeta();
              if (duelCallConfidence) {
                const callConfidenceEl = document.createElement("span");
                callConfidenceEl.className = "nudge-duel-call-confidence " + duelCallConfidence.tone;
                callConfidenceEl.textContent =
                  QUEUE_NUDGE_DUEL_CALL_CONFIDENCE_LABEL + ": " + duelCallConfidence.label + " · " + duelCallConfidence.hint;
                duelEl.appendChild(callConfidenceEl);
              }
              const duelCallStability = ahaDuelCallStabilityMeta();
              if (duelCallStability) {
                const callStabilityEl = document.createElement("span");
                callStabilityEl.className = "nudge-duel-call-stability " + duelCallStability.tone;
                callStabilityEl.textContent =
                  QUEUE_NUDGE_DUEL_CALL_STABILITY_LABEL + ": " + duelCallStability.label + " · " + duelCallStability.hint;
                duelEl.appendChild(callStabilityEl);
              }
              const duelCallRisk = ahaDuelCallRiskMeta();
              if (duelCallRisk) {
                const callRiskEl = document.createElement("span");
                callRiskEl.className = "nudge-duel-call-risk " + duelCallRisk.tone;
                callRiskEl.textContent = QUEUE_NUDGE_DUEL_CALL_RISK_LABEL + ": " + duelCallRisk.label + " · " + duelCallRisk.hint;
                duelEl.appendChild(callRiskEl);
              }
              const duelCallSequence = ahaDuelCallSequenceMeta();
              if (duelCallSequence) {
                const callSequenceEl = document.createElement("span");
                callSequenceEl.className = "nudge-duel-call-sequence " + duelCallSequence.tone;
                callSequenceEl.textContent =
                  QUEUE_NUDGE_DUEL_CALL_SEQUENCE_LABEL + ": " + duelCallSequence.label + " · " + duelCallSequence.hint;
                duelEl.appendChild(callSequenceEl);
              }
              const duelSignal = ahaDuelSignalMeta(ahaPool);
              if (duelSignal) {
                const signalEl = document.createElement("span");
                signalEl.className = "nudge-duel-signal " + duelSignal.tone;
                signalEl.textContent = QUEUE_NUDGE_DUEL_SIGNAL_LABEL + ": " + duelSignal.label + " · " + duelSignal.hint;
                duelEl.appendChild(signalEl);
              }
              const duelSignalPulse = ahaDuelSignalPulseMeta();
              if (duelSignalPulse) {
                const signalPulseEl = document.createElement("span");
                signalPulseEl.className = "nudge-duel-signal-pulse " + duelSignalPulse.tone;
                signalPulseEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_PULSE_LABEL + ": " + duelSignalPulse.label + " · " + duelSignalPulse.hint;
                duelEl.appendChild(signalPulseEl);
                const signalPoints = ahaDuelSignalPulsePoints();
                if (signalPoints.length) {
                  const signalChartEl = document.createElement("div");
                  signalChartEl.className = "nudge-duel-signal-chart";
                  signalChartEl.innerHTML =
                    '<div class="meta">' +
                    QUEUE_NUDGE_DUEL_SIGNAL_SERIES_LABEL +
                    " · " +
                    duelSignalPulse.label +
                    '</div><div class="bars">' +
                    ahaDuelSignalPulseBarsHtml(signalPoints) +
                    "</div>";
                  duelEl.appendChild(signalChartEl);
                }
              }
              const duelSignalVolatility = ahaDuelSignalVolatilityMeta();
              if (duelSignalVolatility) {
                const signalVolatilityEl = document.createElement("span");
                signalVolatilityEl.className = "nudge-duel-signal-volatility " + duelSignalVolatility.tone;
                signalVolatilityEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_VOLATILITY_LABEL +
                  ": " +
                  duelSignalVolatility.label +
                  " · " +
                  duelSignalVolatility.hint;
                duelEl.appendChild(signalVolatilityEl);
              }
              const duelSignalOutlook = ahaDuelSignalOutlookMeta(ahaPool);
              if (duelSignalOutlook) {
                const signalOutlookEl = document.createElement("span");
                signalOutlookEl.className = "nudge-duel-signal-outlook " + duelSignalOutlook.tone;
                signalOutlookEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_OUTLOOK_LABEL + ": " + duelSignalOutlook.label + " · " + duelSignalOutlook.hint;
                duelEl.appendChild(signalOutlookEl);
              }
              const duelSignalRegime = ahaDuelSignalRegimeMeta(ahaPool);
              if (duelSignalRegime) {
                const signalRegimeEl = document.createElement("span");
                signalRegimeEl.className = "nudge-duel-signal-regime " + duelSignalRegime.tone;
                signalRegimeEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_REGIME_LABEL + ": " + duelSignalRegime.label + " · " + duelSignalRegime.hint;
                duelEl.appendChild(signalRegimeEl);
              }
              const duelSignalConviction = ahaDuelSignalConvictionMeta(ahaPool);
              if (duelSignalConviction) {
                const signalConvictionEl = document.createElement("span");
                signalConvictionEl.className = "nudge-duel-signal-conviction " + duelSignalConviction.tone;
                signalConvictionEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONVICTION_LABEL +
                  ": " +
                  duelSignalConviction.label +
                  " · " +
                  duelSignalConviction.hint;
                duelEl.appendChild(signalConvictionEl);
              }
              const duelSignalHandoff = ahaDuelSignalHandoffMeta(ahaPool);
              if (duelSignalHandoff) {
                const signalHandoffEl = document.createElement("span");
                signalHandoffEl.className = "nudge-duel-signal-handoff " + duelSignalHandoff.tone;
                signalHandoffEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_LABEL + ": " + duelSignalHandoff.label + " · " + duelSignalHandoff.hint;
                duelEl.appendChild(signalHandoffEl);
              }
              const duelSignalHandoffTrend = ahaDuelSignalHandoffTrendMeta();
              if (duelSignalHandoffTrend) {
                const signalHandoffTrendEl = document.createElement("span");
                signalHandoffTrendEl.className = "nudge-duel-signal-handoff-trend " + duelSignalHandoffTrend.tone;
                signalHandoffTrendEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_TREND_LABEL +
                  ": " +
                  duelSignalHandoffTrend.label +
                  " · " +
                  duelSignalHandoffTrend.hint;
                duelEl.appendChild(signalHandoffTrendEl);
                const handoffPoints = ahaDuelSignalHandoffTrendSeries();
                if (handoffPoints.length) {
                  const handoffChartEl = document.createElement("div");
                  handoffChartEl.className = "nudge-duel-signal-handoff-chart";
                  handoffChartEl.innerHTML =
                    '<div class="meta">' +
                    QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_SERIES_LABEL +
                    " · " +
                    duelSignalHandoffTrend.label +
                    '</div><div class="bars">' +
                    ahaDuelSignalHandoffTrendBarsHtml(handoffPoints) +
                    "</div>";
                  duelEl.appendChild(handoffChartEl);
                }
              }
              const duelSignalHandoffMomentum = ahaDuelSignalHandoffMomentumMeta();
              if (duelSignalHandoffMomentum) {
                const signalHandoffMomentumEl = document.createElement("span");
                signalHandoffMomentumEl.className = "nudge-duel-signal-handoff-momentum " + duelSignalHandoffMomentum.tone;
                signalHandoffMomentumEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_MOMENTUM_LABEL +
                  ": " +
                  duelSignalHandoffMomentum.label +
                  " · " +
                  duelSignalHandoffMomentum.hint;
                duelEl.appendChild(signalHandoffMomentumEl);
              }
              const duelSignalConsensus = ahaDuelSignalConsensusMeta(ahaPool);
              if (duelSignalConsensus) {
                const signalConsensusEl = document.createElement("span");
                signalConsensusEl.className = "nudge-duel-signal-consensus " + duelSignalConsensus.tone;
                signalConsensusEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_LABEL + ": " + duelSignalConsensus.label + " · " + duelSignalConsensus.hint;
                duelEl.appendChild(signalConsensusEl);
              }
              const duelSignalConsensusTrend = ahaDuelSignalConsensusTrendMeta();
              if (duelSignalConsensusTrend) {
                const signalConsensusTrendEl = document.createElement("span");
                signalConsensusTrendEl.className = "nudge-duel-signal-consensus-trend " + duelSignalConsensusTrend.tone;
                signalConsensusTrendEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TREND_LABEL +
                  ": " +
                  duelSignalConsensusTrend.label +
                  " · " +
                  duelSignalConsensusTrend.hint;
                duelEl.appendChild(signalConsensusTrendEl);
                const consensusPoints = ahaDuelSignalConsensusTrendSeries();
                if (consensusPoints.length) {
                  const consensusChartEl = document.createElement("div");
                  consensusChartEl.className = "nudge-duel-signal-consensus-chart";
                  consensusChartEl.innerHTML =
                    '<div class="meta">' +
                    QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_SERIES_LABEL +
                    " · " +
                    duelSignalConsensusTrend.label +
                    '</div><div class="bars">' +
                    ahaDuelSignalConsensusTrendBarsHtml(consensusPoints) +
                    "</div>";
                  duelEl.appendChild(consensusChartEl);
                }
              }
              const duelSignalConsensusMomentum = ahaDuelSignalConsensusMomentumMeta();
              if (duelSignalConsensusMomentum) {
                const signalConsensusMomentumEl = document.createElement("span");
                signalConsensusMomentumEl.className = "nudge-duel-signal-consensus-momentum " + duelSignalConsensusMomentum.tone;
                signalConsensusMomentumEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_MOMENTUM_LABEL +
                  ": " +
                  duelSignalConsensusMomentum.label +
                  " · " +
                  duelSignalConsensusMomentum.hint;
                duelEl.appendChild(signalConsensusMomentumEl);
              }
              const duelSignalConsensusRisk = ahaDuelSignalConsensusRiskMeta();
              if (duelSignalConsensusRisk) {
                const signalConsensusRiskEl = document.createElement("span");
                signalConsensusRiskEl.className = "nudge-duel-signal-consensus-risk " + duelSignalConsensusRisk.tone;
                signalConsensusRiskEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_RISK_LABEL + ": " + duelSignalConsensusRisk.label + " · " + duelSignalConsensusRisk.hint;
                duelEl.appendChild(signalConsensusRiskEl);
              }
              const duelSignalConsensusStability = ahaDuelSignalConsensusStabilityMeta();
              if (duelSignalConsensusStability) {
                const signalConsensusStabilityEl = document.createElement("span");
                signalConsensusStabilityEl.className = "nudge-duel-signal-consensus-stability " + duelSignalConsensusStability.tone;
                signalConsensusStabilityEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_STABILITY_LABEL +
                  ": " +
                  duelSignalConsensusStability.label +
                  " · " +
                  duelSignalConsensusStability.hint;
                duelEl.appendChild(signalConsensusStabilityEl);
              }
              const duelSignalConsensusReadiness = ahaDuelSignalConsensusReadinessMeta(ahaPool);
              if (duelSignalConsensusReadiness) {
                const signalConsensusReadinessEl = document.createElement("span");
                signalConsensusReadinessEl.className = "nudge-duel-signal-consensus-readiness " + duelSignalConsensusReadiness.tone;
                signalConsensusReadinessEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_READINESS_LABEL +
                  ": " +
                  duelSignalConsensusReadiness.label +
                  " · " +
                  duelSignalConsensusReadiness.hint;
                duelEl.appendChild(signalConsensusReadinessEl);
              }
              const duelSignalConsensusWindow = ahaDuelSignalConsensusWindowMeta(ahaPool);
              if (duelSignalConsensusWindow) {
                const signalConsensusWindowEl = document.createElement("span");
                signalConsensusWindowEl.className = "nudge-duel-signal-consensus-window " + duelSignalConsensusWindow.tone;
                signalConsensusWindowEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_WINDOW_LABEL +
                  ": " +
                  duelSignalConsensusWindow.label +
                  " · " +
                  duelSignalConsensusWindow.hint;
                duelEl.appendChild(signalConsensusWindowEl);
              }
              const duelSignalConsensusGuardrail = ahaDuelSignalConsensusGuardrailMeta(ahaPool);
              if (duelSignalConsensusGuardrail) {
                const signalConsensusGuardrailEl = document.createElement("span");
                signalConsensusGuardrailEl.className = "nudge-duel-signal-consensus-guardrail " + duelSignalConsensusGuardrail.tone;
                signalConsensusGuardrailEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_GUARDRAIL_LABEL +
                  ": " +
                  duelSignalConsensusGuardrail.label +
                  " · " +
                  duelSignalConsensusGuardrail.hint;
                duelEl.appendChild(signalConsensusGuardrailEl);
              }
              const duelSignalConsensusTrigger = ahaDuelSignalConsensusTriggerMeta(ahaPool);
              if (duelSignalConsensusTrigger) {
                const signalConsensusTriggerEl = document.createElement("span");
                signalConsensusTriggerEl.className = "nudge-duel-signal-consensus-trigger " + duelSignalConsensusTrigger.tone;
                signalConsensusTriggerEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL +
                  ": " +
                  duelSignalConsensusTrigger.label +
                  " · " +
                  duelSignalConsensusTrigger.hint;
                duelEl.appendChild(signalConsensusTriggerEl);
              }
              const duelSignalConsensusProtocol = ahaDuelSignalConsensusProtocolMeta(ahaPool);
              if (duelSignalConsensusProtocol) {
                const signalConsensusProtocolEl = document.createElement("span");
                signalConsensusProtocolEl.className = "nudge-duel-signal-consensus-protocol " + duelSignalConsensusProtocol.tone;
                signalConsensusProtocolEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL +
                  ": " +
                  duelSignalConsensusProtocol.label +
                  " · " +
                  duelSignalConsensusProtocol.hint;
                duelEl.appendChild(signalConsensusProtocolEl);
              }
              const duelSignalConsensusProtocolConfidence = ahaDuelSignalConsensusProtocolConfidenceMeta(ahaPool);
              if (duelSignalConsensusProtocolConfidence) {
                const signalConsensusProtocolConfidenceEl = document.createElement("span");
                signalConsensusProtocolConfidenceEl.className =
                  "nudge-duel-signal-consensus-protocol-confidence " + duelSignalConsensusProtocolConfidence.tone;
                signalConsensusProtocolConfidenceEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_LABEL +
                  ": " +
                  duelSignalConsensusProtocolConfidence.label +
                  " · " +
                  duelSignalConsensusProtocolConfidence.hint;
                duelEl.appendChild(signalConsensusProtocolConfidenceEl);
              }
              const duelSignalConsensusProtocolTrend = ahaDuelSignalConsensusProtocolTrendMeta();
              if (duelSignalConsensusProtocolTrend) {
                const signalConsensusProtocolTrendEl = document.createElement("span");
                signalConsensusProtocolTrendEl.className =
                  "nudge-duel-signal-consensus-protocol-trend " + duelSignalConsensusProtocolTrend.tone;
                signalConsensusProtocolTrendEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_TREND_LABEL +
                  ": " +
                  duelSignalConsensusProtocolTrend.label +
                  " · " +
                  duelSignalConsensusProtocolTrend.hint;
                duelEl.appendChild(signalConsensusProtocolTrendEl);
                const protocolPoints = ahaDuelSignalConsensusProtocolConfidencePoints();
                if (protocolPoints.length) {
                  const protocolChartEl = document.createElement("div");
                  protocolChartEl.className = "nudge-duel-signal-consensus-protocol-chart";
                  protocolChartEl.innerHTML =
                    '<div class="meta">' +
                    QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SERIES_LABEL +
                    " · " +
                    duelSignalConsensusProtocolTrend.label +
                    '</div><div class="bars">' +
                    ahaDuelSignalConsensusProtocolBarsHtml(protocolPoints) +
                    "</div>";
                  duelEl.appendChild(protocolChartEl);
                }
              }
              const duelSignalConsensusProtocolRisk = ahaDuelSignalConsensusProtocolRiskMeta();
              if (duelSignalConsensusProtocolRisk) {
                const signalConsensusProtocolRiskEl = document.createElement("span");
                signalConsensusProtocolRiskEl.className =
                  "nudge-duel-signal-consensus-protocol-risk " + duelSignalConsensusProtocolRisk.tone;
                signalConsensusProtocolRiskEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_RISK_LABEL +
                  ": " +
                  duelSignalConsensusProtocolRisk.label +
                  " · " +
                  duelSignalConsensusProtocolRisk.hint;
                duelEl.appendChild(signalConsensusProtocolRiskEl);
              }
              const duelSignalConsensusProtocolRegime = ahaDuelSignalConsensusProtocolRegimeMeta();
              if (duelSignalConsensusProtocolRegime) {
                const signalConsensusProtocolRegimeEl = document.createElement("span");
                signalConsensusProtocolRegimeEl.className =
                  "nudge-duel-signal-consensus-protocol-regime " + duelSignalConsensusProtocolRegime.tone;
                signalConsensusProtocolRegimeEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_REGIME_LABEL +
                  ": " +
                  duelSignalConsensusProtocolRegime.label +
                  " · " +
                  duelSignalConsensusProtocolRegime.hint;
                duelEl.appendChild(signalConsensusProtocolRegimeEl);
              }
              const duelSignalConsensusProtocolCadence = ahaDuelSignalConsensusProtocolCadenceMeta();
              if (duelSignalConsensusProtocolCadence) {
                const signalConsensusProtocolCadenceEl = document.createElement("span");
                signalConsensusProtocolCadenceEl.className =
                  "nudge-duel-signal-consensus-protocol-cadence " + duelSignalConsensusProtocolCadence.tone;
                signalConsensusProtocolCadenceEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL +
                  ": " +
                  duelSignalConsensusProtocolCadence.label +
                  " · " +
                  duelSignalConsensusProtocolCadence.hint;
                duelEl.appendChild(signalConsensusProtocolCadenceEl);
              }
              const duelSignalConsensusProtocolPressure = ahaDuelSignalConsensusProtocolPressureMeta();
              if (duelSignalConsensusProtocolPressure) {
                const signalConsensusProtocolPressureEl = document.createElement("span");
                signalConsensusProtocolPressureEl.className =
                  "nudge-duel-signal-consensus-protocol-pressure " + duelSignalConsensusProtocolPressure.tone;
                signalConsensusProtocolPressureEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL +
                  ": " +
                  duelSignalConsensusProtocolPressure.label +
                  " · " +
                  duelSignalConsensusProtocolPressure.hint;
                duelEl.appendChild(signalConsensusProtocolPressureEl);
              }
              const duelSignalConsensusProtocolCommand = ahaDuelSignalConsensusProtocolCommandMeta(ahaPool);
              if (duelSignalConsensusProtocolCommand) {
                const signalConsensusProtocolCommandEl = document.createElement("span");
                signalConsensusProtocolCommandEl.className =
                  "nudge-duel-signal-consensus-protocol-command " + duelSignalConsensusProtocolCommand.tone;
                signalConsensusProtocolCommandEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL +
                  ": " +
                  duelSignalConsensusProtocolCommand.label +
                  " · " +
                  duelSignalConsensusProtocolCommand.hint;
                duelEl.appendChild(signalConsensusProtocolCommandEl);
              }
              const duelSignalConsensusProtocolScript = ahaDuelSignalConsensusProtocolScriptMeta(
                ahaPool,
                duelSignalConsensusProtocolCommand,
                duelSignalConsensusProtocolCadence,
                duelSignalConsensusProtocolPressure,
              );
              const duelSignalConsensusProtocolScriptLane = ahaDuelSignalConsensusProtocolScriptLaneMeta(
                ahaPool,
                duelSignalConsensusProtocolScript,
                duelSignalConsensusProtocolCommand,
              );
              const duelSignalConsensusProtocolScriptChecklist = ahaDuelSignalConsensusProtocolScriptChecklistMeta(
                ahaPool,
                duelSignalConsensusProtocolScript,
                duelSignalConsensusProtocolScriptLane,
                duelSignalConsensusProtocolCommand,
              );
              if (duelSignalConsensusProtocolScript) {
                const signalConsensusProtocolScriptEl = document.createElement("span");
                signalConsensusProtocolScriptEl.className =
                  "nudge-duel-signal-consensus-protocol-script " + duelSignalConsensusProtocolScript.tone;
                signalConsensusProtocolScriptEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL +
                  ": " +
                  duelSignalConsensusProtocolScript.label +
                  " · " +
                  duelSignalConsensusProtocolScript.hint;
                duelEl.appendChild(signalConsensusProtocolScriptEl);
              }
              if (duelSignalConsensusProtocolScriptLane) {
                const signalConsensusProtocolScriptLaneEl = document.createElement("span");
                signalConsensusProtocolScriptLaneEl.className =
                  "nudge-duel-signal-consensus-protocol-script-lane " + duelSignalConsensusProtocolScriptLane.tone;
                signalConsensusProtocolScriptLaneEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LANE_LABEL +
                  ": " +
                  duelSignalConsensusProtocolScriptLane.label +
                  " · " +
                  duelSignalConsensusProtocolScriptLane.hint;
                duelEl.appendChild(signalConsensusProtocolScriptLaneEl);
              }
              if (duelSignalConsensusProtocolScriptChecklist) {
                const signalConsensusProtocolScriptChecklistEl = document.createElement("span");
                signalConsensusProtocolScriptChecklistEl.className =
                  "nudge-duel-signal-consensus-protocol-script-checklist " + duelSignalConsensusProtocolScriptChecklist.tone;
                signalConsensusProtocolScriptChecklistEl.textContent =
                  QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_CHECKLIST_LABEL +
                  ": " +
                  duelSignalConsensusProtocolScriptChecklist.label +
                  " · " +
                  duelSignalConsensusProtocolScriptChecklist.hint;
                duelEl.appendChild(signalConsensusProtocolScriptChecklistEl);
              }
              const duelSnapshot = ahaDuelSnapshotText(ahaPool);
              if (duelSnapshot) {
                const snapshotEl = document.createElement("div");
                snapshotEl.className = "nudge-duel-snapshot";
                snapshotEl.innerHTML =
                  '<span class="label">' +
                  QUEUE_NUDGE_DUEL_SNAPSHOT_LABEL +
                  '</span><span class="body">' +
                  duelSnapshot +
                  "</span>";
                duelEl.appendChild(snapshotEl);
              }
              const duelPlan = ahaDuelActionPlanMeta(ahaPool);
              if (duelPlan) {
                const planEl = document.createElement("div");
                planEl.className = "nudge-duel-plan " + duelPlan.tone;
                planEl.innerHTML =
                  '<span class="label">' +
                  QUEUE_NUDGE_DUEL_PLAN_LABEL +
                  '</span><span class="body">' +
                  duelPlan.summary +
                  '</span><span class="muted">' +
                  duelPlan.hint +
                  "</span>";
                duelEl.appendChild(planEl);
              }
              const duelTrendPoints = ahaDuelGapTrendPoints();
              if (duelTrendPoints.length) {
                const duelTrendMeta = ahaDuelGapTrendMeta(duelTrendPoints);
                const trendEl = document.createElement("div");
                trendEl.className = "nudge-duel-trend";
                trendEl.innerHTML =
                  '<div class="meta"><span class="label">' +
                  QUEUE_NUDGE_DUEL_TREND_LABEL +
                  '</span><span class="nudge-duel-edge ' +
                  duelTrendMeta.tone +
                  '">' +
                  QUEUE_NUDGE_DUEL_SERIES_LABEL +
                  " · " +
                  duelTrendMeta.label +
                  '</span></div><div class="bars">' +
                  ahaDuelGapTrendBarsHtml(duelTrendPoints) +
                  "</div>";
                duelEl.appendChild(trendEl);
              }
              const briefPreview = ahaDecisionBriefPreview(ahaPool, 3);
              if (briefPreview) {
                const briefEl = document.createElement("div");
                briefEl.className = "nudge-brief";
                briefEl.innerHTML =
                  '<span class="label">' +
                  QUEUE_NUDGE_BRIEF_LABEL +
                  '</span><span class="muted">' +
                  QUEUE_NUDGE_BRIEF_CONTEXT_LABEL +
                  ": " +
                  decisionBriefContextSummary() +
                  '</span><span class="body">' +
                  briefPreview +
                  "</span>";
                duelEl.appendChild(briefEl);
              }
              const actionsEl = document.createElement("div");
              actionsEl.className = "actions";
              const openRivalBtn = document.createElement("button");
              openRivalBtn.type = "button";
              openRivalBtn.className = "secondary";
              openRivalBtn.textContent = QUEUE_NUDGE_OPEN_RIVAL_LABEL;
              openRivalBtn.addEventListener("click", async () => {
                await runOpenAhaRivalAction(openRivalBtn);
              });
              actionsEl.appendChild(openRivalBtn);
              const toggleDuelBtn = document.createElement("button");
              toggleDuelBtn.type = "button";
              toggleDuelBtn.className = "secondary";
              toggleDuelBtn.textContent = QUEUE_NUDGE_TOGGLE_DUEL_LABEL;
              toggleDuelBtn.addEventListener("click", async () => {
                await runToggleAhaDuelPairAction(toggleDuelBtn);
              });
              actionsEl.appendChild(toggleDuelBtn);
              const copyDuelBtn = document.createElement("button");
              copyDuelBtn.type = "button";
              copyDuelBtn.className = "secondary";
              copyDuelBtn.textContent = QUEUE_NUDGE_COPY_DUEL_LABEL;
              copyDuelBtn.addEventListener("click", async () => {
                await runCopyAhaDuelAction(copyDuelBtn);
              });
              actionsEl.appendChild(copyDuelBtn);
              const copyDuelCallBtn = document.createElement("button");
              copyDuelCallBtn.type = "button";
              copyDuelCallBtn.className = "secondary";
              copyDuelCallBtn.textContent = QUEUE_NUDGE_COPY_DUEL_CALL_LABEL;
              copyDuelCallBtn.addEventListener("click", async () => {
                await runCopyAhaDuelCallAction(copyDuelCallBtn);
              });
              actionsEl.appendChild(copyDuelCallBtn);
              const copyDuelSignalsBtn = document.createElement("button");
              copyDuelSignalsBtn.type = "button";
              copyDuelSignalsBtn.className = "secondary";
              copyDuelSignalsBtn.textContent = QUEUE_NUDGE_COPY_DUEL_SIGNALS_LABEL;
              copyDuelSignalsBtn.addEventListener("click", async () => {
                await runCopyAhaDuelSignalsAction(copyDuelSignalsBtn);
              });
              actionsEl.appendChild(copyDuelSignalsBtn);
              const copySignalHandoffBtn = document.createElement("button");
              copySignalHandoffBtn.type = "button";
              copySignalHandoffBtn.className = "secondary";
              copySignalHandoffBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_HANDOFF_LABEL;
              copySignalHandoffBtn.addEventListener("click", async () => {
                await runCopyAhaDuelSignalHandoffAction(copySignalHandoffBtn);
              });
              actionsEl.appendChild(copySignalHandoffBtn);
              const copySignalConsensusBtn = document.createElement("button");
              copySignalConsensusBtn.type = "button";
              copySignalConsensusBtn.className = "secondary";
              copySignalConsensusBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_CONSENSUS_LABEL;
              copySignalConsensusBtn.addEventListener("click", async () => {
                await runCopyAhaDuelSignalConsensusAction(copySignalConsensusBtn);
              });
              actionsEl.appendChild(copySignalConsensusBtn);
              const copySignalProtocolBtn = document.createElement("button");
              copySignalProtocolBtn.type = "button";
              copySignalProtocolBtn.className = "secondary";
              copySignalProtocolBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_PROTOCOL_LABEL;
              copySignalProtocolBtn.addEventListener("click", async () => {
                await runCopyAhaDuelSignalProtocolAction(copySignalProtocolBtn);
              });
              actionsEl.appendChild(copySignalProtocolBtn);
              const copySignalCommandBtn = document.createElement("button");
              copySignalCommandBtn.type = "button";
              copySignalCommandBtn.className = "secondary";
              copySignalCommandBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_COMMAND_LABEL;
              copySignalCommandBtn.addEventListener("click", async () => {
                await runCopyAhaDuelSignalCommandAction(copySignalCommandBtn);
              });
              actionsEl.appendChild(copySignalCommandBtn);
              const copySignalScriptBtn = document.createElement("button");
              copySignalScriptBtn.type = "button";
              copySignalScriptBtn.className = "secondary";
              copySignalScriptBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_SCRIPT_LABEL;
              copySignalScriptBtn.addEventListener("click", async () => {
                await runCopyAhaDuelSignalScriptAction(copySignalScriptBtn);
              });
              actionsEl.appendChild(copySignalScriptBtn);
              const copySignalChecklistBtn = document.createElement("button");
              copySignalChecklistBtn.type = "button";
              copySignalChecklistBtn.className = "secondary";
              copySignalChecklistBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_CHECKLIST_LABEL;
              copySignalChecklistBtn.addEventListener("click", async () => {
                await runCopyAhaDuelSignalChecklistAction(copySignalChecklistBtn);
              });
              actionsEl.appendChild(copySignalChecklistBtn);
              const downloadSignalHandoffBtn = document.createElement("button");
              downloadSignalHandoffBtn.type = "button";
              downloadSignalHandoffBtn.className = "secondary";
              downloadSignalHandoffBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_HANDOFF_LABEL;
              downloadSignalHandoffBtn.addEventListener("click", async () => {
                await runDownloadAhaDuelSignalHandoffAction(downloadSignalHandoffBtn);
              });
              actionsEl.appendChild(downloadSignalHandoffBtn);
              const downloadSignalConsensusBtn = document.createElement("button");
              downloadSignalConsensusBtn.type = "button";
              downloadSignalConsensusBtn.className = "secondary";
              downloadSignalConsensusBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_CONSENSUS_LABEL;
              downloadSignalConsensusBtn.addEventListener("click", async () => {
                await runDownloadAhaDuelSignalConsensusAction(downloadSignalConsensusBtn);
              });
              actionsEl.appendChild(downloadSignalConsensusBtn);
              const downloadSignalProtocolBtn = document.createElement("button");
              downloadSignalProtocolBtn.type = "button";
              downloadSignalProtocolBtn.className = "secondary";
              downloadSignalProtocolBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_PROTOCOL_LABEL;
              downloadSignalProtocolBtn.addEventListener("click", async () => {
                await runDownloadAhaDuelSignalProtocolAction(downloadSignalProtocolBtn);
              });
              actionsEl.appendChild(downloadSignalProtocolBtn);
              const downloadSignalCommandBtn = document.createElement("button");
              downloadSignalCommandBtn.type = "button";
              downloadSignalCommandBtn.className = "secondary";
              downloadSignalCommandBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_COMMAND_LABEL;
              downloadSignalCommandBtn.addEventListener("click", async () => {
                await runDownloadAhaDuelSignalCommandAction(downloadSignalCommandBtn);
              });
              actionsEl.appendChild(downloadSignalCommandBtn);
              const downloadSignalScriptBtn = document.createElement("button");
              downloadSignalScriptBtn.type = "button";
              downloadSignalScriptBtn.className = "secondary";
              downloadSignalScriptBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_SCRIPT_LABEL;
              downloadSignalScriptBtn.addEventListener("click", async () => {
                await runDownloadAhaDuelSignalScriptAction(downloadSignalScriptBtn);
              });
              actionsEl.appendChild(downloadSignalScriptBtn);
              const downloadSignalChecklistBtn = document.createElement("button");
              downloadSignalChecklistBtn.type = "button";
              downloadSignalChecklistBtn.className = "secondary";
              downloadSignalChecklistBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_CHECKLIST_LABEL;
              downloadSignalChecklistBtn.addEventListener("click", async () => {
                await runDownloadAhaDuelSignalChecklistAction(downloadSignalChecklistBtn);
              });
              actionsEl.appendChild(downloadSignalChecklistBtn);
              const copyDuelSnapshotBtn = document.createElement("button");
              copyDuelSnapshotBtn.type = "button";
              copyDuelSnapshotBtn.className = "secondary";
              copyDuelSnapshotBtn.textContent = QUEUE_NUDGE_COPY_DUEL_SNAPSHOT_LABEL;
              copyDuelSnapshotBtn.addEventListener("click", async () => {
                await runCopyAhaDuelSnapshotAction(copyDuelSnapshotBtn);
              });
              actionsEl.appendChild(copyDuelSnapshotBtn);
              const copyDuelPlanBtn = document.createElement("button");
              copyDuelPlanBtn.type = "button";
              copyDuelPlanBtn.className = "secondary";
              copyDuelPlanBtn.textContent = QUEUE_NUDGE_COPY_DUEL_PLAN_LABEL;
              copyDuelPlanBtn.addEventListener("click", async () => {
                await runCopyAhaDuelPlanAction(copyDuelPlanBtn);
              });
              actionsEl.appendChild(copyDuelPlanBtn);
              const copyBriefBtn = document.createElement("button");
              copyBriefBtn.type = "button";
              copyBriefBtn.className = "secondary";
              copyBriefBtn.textContent = QUEUE_NUDGE_COPY_BRIEF_LABEL;
              copyBriefBtn.addEventListener("click", async () => {
                await runCopyAhaDecisionBriefAction(copyBriefBtn);
              });
              actionsEl.appendChild(copyBriefBtn);
              const downloadBriefBtn = document.createElement("button");
              downloadBriefBtn.type = "button";
              downloadBriefBtn.className = "secondary";
              downloadBriefBtn.textContent = QUEUE_NUDGE_DOWNLOAD_BRIEF_LABEL;
              downloadBriefBtn.addEventListener("click", async () => {
                await runDownloadAhaDecisionBriefAction(downloadBriefBtn);
              });
              actionsEl.appendChild(downloadBriefBtn);
              const runRivalBtn = document.createElement("button");
              runRivalBtn.type = "button";
              runRivalBtn.className = "secondary";
              runRivalBtn.textContent = QUEUE_NUDGE_RUN_RIVAL_LABEL;
              runRivalBtn.addEventListener("click", async () => {
                await runRivalAhaPrimaryAction(runRivalBtn);
              });
              actionsEl.appendChild(runRivalBtn);
              const runDuelBtn = document.createElement("button");
              runDuelBtn.type = "button";
              runDuelBtn.className = "secondary";
              runDuelBtn.textContent = QUEUE_NUDGE_RUN_DUEL_LABEL;
              runDuelBtn.addEventListener("click", async () => {
                await runDuelPairPrimaryActions(runDuelBtn);
              });
              actionsEl.appendChild(runDuelBtn);
              const runDuelCallBtn = document.createElement("button");
              runDuelCallBtn.type = "button";
              runDuelCallBtn.className = "secondary";
              runDuelCallBtn.textContent = QUEUE_NUDGE_RUN_DUEL_CALL_LABEL;
              runDuelCallBtn.addEventListener("click", async () => {
                await runDuelCallAction(runDuelCallBtn);
              });
              actionsEl.appendChild(runDuelCallBtn);
              const runSignalHandoffBtn = document.createElement("button");
              runSignalHandoffBtn.type = "button";
              runSignalHandoffBtn.className = "secondary";
              runSignalHandoffBtn.textContent = QUEUE_NUDGE_RUN_SIGNAL_HANDOFF_LABEL;
              runSignalHandoffBtn.addEventListener("click", async () => {
                await runDuelSignalHandoffAction(runSignalHandoffBtn);
              });
              actionsEl.appendChild(runSignalHandoffBtn);
              const runSignalConsensusBtn = document.createElement("button");
              runSignalConsensusBtn.type = "button";
              runSignalConsensusBtn.className = "secondary";
              runSignalConsensusBtn.textContent = QUEUE_NUDGE_RUN_SIGNAL_CONSENSUS_LABEL;
              runSignalConsensusBtn.addEventListener("click", async () => {
                await runDuelSignalConsensusAction(runSignalConsensusBtn);
              });
              actionsEl.appendChild(runSignalConsensusBtn);
              const runSignalProtocolBtn = document.createElement("button");
              runSignalProtocolBtn.type = "button";
              runSignalProtocolBtn.className = "secondary";
              runSignalProtocolBtn.textContent = QUEUE_NUDGE_RUN_SIGNAL_PROTOCOL_LABEL;
              runSignalProtocolBtn.addEventListener("click", async () => {
                await runDuelSignalProtocolAction(runSignalProtocolBtn);
              });
              actionsEl.appendChild(runSignalProtocolBtn);
              const runSignalCommandBtn = document.createElement("button");
              runSignalCommandBtn.type = "button";
              runSignalCommandBtn.className = "secondary";
              runSignalCommandBtn.textContent = QUEUE_NUDGE_RUN_SIGNAL_COMMAND_LABEL;
              runSignalCommandBtn.addEventListener("click", async () => {
                await runDuelSignalCommandAction(runSignalCommandBtn);
              });
              actionsEl.appendChild(runSignalCommandBtn);
              const runSignalScriptBtn = document.createElement("button");
              runSignalScriptBtn.type = "button";
              runSignalScriptBtn.className = "secondary";
              runSignalScriptBtn.textContent = QUEUE_NUDGE_RUN_SIGNAL_SCRIPT_LABEL;
              runSignalScriptBtn.addEventListener("click", async () => {
                await runDuelSignalScriptAction(runSignalScriptBtn);
              });
              actionsEl.appendChild(runSignalScriptBtn);
              duelEl.appendChild(actionsEl);
              ahaNudgeEl.appendChild(duelEl);
            }
          }
          const poolEl = document.createElement("div");
          poolEl.className = "nudge-pool muted";
          poolEl.textContent =
            QUEUE_NUDGE_POOL_PREFIX +
            ": showing " +
            ahaCandidates.length +
            "/" +
            ahaPool.length +
            " · " +
            QUEUE_NUDGE_CYCLE_HINT +
            ".";
          ahaNudgeEl.appendChild(poolEl);
        }
      }

      function renderStatusLegend(items) {
        if (!statusLegendEl) return;
        const counts = countItemsByStatus(items);
        statusLegendEl.innerHTML = "";
        const entries = [
          { label: "Captured", dot: "captured", count: counts.CAPTURED, status: "CAPTURED" },
          { label: "Queued", dot: "processing", count: counts.QUEUED, status: "QUEUED" },
          { label: "Processing", dot: "processing", count: counts.PROCESSING, status: "PROCESSING" },
          { label: "Ready", dot: "ready", count: counts.READY, status: "READY" },
          { label: "Failed", dot: "failed", count: counts.FAILED, status: "FAILED_EXTRACTION,FAILED_AI,FAILED_EXPORT" },
          { label: "Shipped", dot: "shipped", count: counts.SHIPPED, status: "SHIPPED" },
          { label: "Archived", dot: "archived", count: counts.ARCHIVED, status: "ARCHIVED" },
        ];
        for (const entry of entries) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "legend-item";
          if (statusFilter.value === entry.status) {
            btn.classList.add("active");
          }
          btn.innerHTML =
            '<span class="legend-dot ' +
            entry.dot +
            '"></span><span>' +
            entry.label +
            " " +
            entry.count +
            "</span>";
          btn.addEventListener("click", async () => {
            const op = {
              id: "legend_filter_" + entry.label.toLowerCase(),
              label: "Filter: " + entry.label,
              action: async () => {
                statusFilter.value = entry.status;
                syncFocusChips();
                persistControls();
                resetPreviewOffset();
                clearPreviewState();
                await loadItems();
              },
            };
            await runActionWithFeedback(op, { button: btn, localFeedbackEl: queueActionBannerEl });
          });
          statusLegendEl.appendChild(btn);
        }
      }

      async function request(path, options = {}) {
        const response = await fetch(API_BASE + path, {
          headers: { "content-type": "application/json", ...(options.headers || {}) },
          ...options
        });
        const raw = await response.text();
        let data = {};
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = {};
          }
        }
        if (!response.ok) {
          const fallbackBody = raw && raw.trim() ? raw.trim().slice(0, 200) : "";
          const message = data?.error?.message || fallbackBody || ("Request failed: " + response.status);
          const code = data?.error?.code || "UNKNOWN_ERROR";
          const err = new Error(message);
          err.code = code;
          throw err;
        }
        return data || {};
      }

      function retryInfo(item) {
        const failure = item?.failure || {};
        const retryLimit = Number(failure.retry_limit ?? 0);
        const retryAttempts = Number(failure.retry_attempts ?? 0);
        const retryable = failure.retryable !== false;
        const remaining = retryLimit > 0 ? Math.max(retryLimit - retryAttempts, 0) : null;
        return { retryLimit, retryAttempts, retryable, remaining };
      }

      function recoveryPriorityMeta(failure) {
        if (!failure) return null;
        const retryLimit = Number(failure.retry_limit ?? 0);
        const retryAttempts = Number(failure.retry_attempts ?? 0);
        const retryable = failure.retryable !== false;
        const remaining = retryLimit > 0 ? Math.max(retryLimit - retryAttempts, 0) : null;
        if (!retryable || remaining === 0) {
          return {
            tone: "blocked",
            label: "Recovery Priority: Blocked",
            shortLabel: "Blocked Recovery",
            note: "Manual edit before rerun.",
          };
        }
        if (remaining === 1) {
          return {
            tone: "urgent",
            label: "Recovery Priority: Last Retry",
            shortLabel: "Last Retry",
            note: "Retry budget almost exhausted.",
          };
        }
        return {
          tone: "normal",
          label: "Recovery Priority: Recoverable",
          shortLabel: "Recoverable",
          note: "Safe to retry with playbook steps.",
        };
      }

      function isRetryableFailedItem(item) {
        if (!String(item?.status || "").startsWith("FAILED_")) return false;
        return retryInfo(item).retryable;
      }

      function buttonsFor(item) {
        const ops = [];
        ops.push({ id: "detail", label: "Detail", action: () => selectItem(item.id), group: "view", priority: 100 });
        let primaryActionId = null;
        if (item.status === "CAPTURED") primaryActionId = "process";
        else if (item.status === "READY") primaryActionId = "export";
        else if (item.status === "SHIPPED") primaryActionId = "reexport";
        else if (item.status === "ARCHIVED") primaryActionId = "unarchive";
        else if (["FAILED_EXTRACTION", "FAILED_AI", "FAILED_EXPORT"].includes(item.status)) primaryActionId = "retry";
        if (item.status === "READY") {
          ops.push({ id: "regenerate", label: "Regenerate", action: () => processItem(item.id, "REGENERATE"), group: "process", priority: 30 });
        } else if (["FAILED_EXTRACTION", "FAILED_AI", "FAILED_EXPORT"].includes(item.status)) {
          const info = retryInfo(item);
          if (info.retryable) {
            const suffix = info.remaining == null ? "" : " (" + info.remaining + " left)";
            ops.push({ id: "retry", label: "Retry" + suffix, action: () => processItem(item.id, "RETRY"), group: "process", priority: 10 });
          } else {
            ops.push({ id: "retry_blocked", label: "Retry Limit Reached", action: () => {}, disabled: true, group: "process", priority: 50 });
            if (item.status === "FAILED_EXPORT") {
              primaryActionId = "export";
            } else {
              primaryActionId = "regenerate";
            }
          }
        } else if (item.status === "CAPTURED") {
          ops.push({ id: "process", label: "Process", action: () => processItem(item.id, "PROCESS"), group: "process", priority: 10 });
        }
        if (["READY", "SHIPPED", "FAILED_EXPORT"].includes(item.status)) {
          const isReExport = item.status === "SHIPPED";
          ops.push({
            id: isReExport ? "reexport" : "export",
            label: isReExport ? "Re-export" : "Export",
            action: () => exportItem(item.id),
            group: "ship",
            priority: isReExport ? 20 : 15,
          });
        }
        if (item.status === "ARCHIVED") {
          ops.push({ id: "unarchive", label: "Unarchive", action: () => unarchiveItem(item.id), group: "maintain", priority: 20 });
        } else if (item.status !== "PROCESSING") {
          ops.push({ id: "archive", label: "Archive", action: () => archiveItem(item.id), group: "maintain", priority: 80 });
        }
        if (primaryActionId === "regenerate" && !ops.find((op) => op.id === "regenerate")) {
          if (ops.find((op) => op.id === "process")) primaryActionId = "process";
          else if (ops.find((op) => op.id === "export")) primaryActionId = "export";
        }
        return ops
          .map((op) => ({ ...op, is_primary: op.id === primaryActionId }))
          .sort((a, b) => Number(a.priority ?? 100) - Number(b.priority ?? 100));
      }

      function detailOpsFor(item) {
        return buttonsFor(item).filter((op) => op.id !== "detail");
      }

      function detailActionBannerEl() {
        return document.getElementById("detailActionBanner");
      }

      function setActionFeedback(targetEl, state, text) {
        if (!targetEl) return;
        targetEl.textContent = text;
        targetEl.className = "muted action-feedback" + (state ? " " + state : "");
      }

      function setActionFeedbackPair(state, text, localFeedbackEl = null) {
        setActionFeedback(detailActionBannerEl(), state, text);
        setActionFeedback(localFeedbackEl, state, text);
      }

      function actionFeedbackText(state, label, message = "") {
        if (state === "pending") return "Running: " + label;
        if (state === "done") return "Completed: " + label;
        if (state === "error") return "Failed: " + label + " — " + message;
        return String(label || "");
      }

      async function runActionWithFeedback(op, options = {}) {
        if (op.disabled) return;
        const button = options.button;
        const label = options.label || op.label || "Action";
        const localFeedbackEl = options.localFeedbackEl || null;
        const actionId = typeof op?.id === "string" ? op.id : "";
        const disableAll = typeof options.disableAll === "function" ? options.disableAll : null;
        const onStart = typeof options.onStart === "function" ? options.onStart : null;
        const onFinally = typeof options.onFinally === "function" ? options.onFinally : null;
        if (actionId && inFlightActionIds.has(actionId)) {
          setActionFeedbackPair("pending", "Already running: " + label, localFeedbackEl);
          return;
        }
        if (actionId) {
          inFlightActionIds.add(actionId);
        }
        if (disableAll) disableAll(true);
        const previousDisabled = button ? button.disabled : false;
        if (button) {
          button.disabled = true;
        }
        try {
          if (onStart) {
            onStart();
          }
          setActionFeedbackPair("pending", actionFeedbackText("pending", label), localFeedbackEl);
          errorEl.textContent = "";
          await op.action();
          setActionFeedbackPair("done", actionFeedbackText("done", label), localFeedbackEl);
        } catch (err) {
          const message = String(err);
          setActionFeedbackPair("error", actionFeedbackText("error", label, message), localFeedbackEl);
          errorEl.textContent = message;
        } finally {
          if (actionId) {
            inFlightActionIds.delete(actionId);
          }
          if (button) {
            button.disabled = previousDisabled;
          }
          if (disableAll) disableAll(false);
          if (onFinally) {
            try {
              await onFinally();
            } catch (finalErr) {
              const finalMessage = "Post-action cleanup failed: " + String(finalErr);
              setActionFeedbackPair("error", finalMessage, localFeedbackEl);
              errorEl.textContent = finalMessage;
            }
          }
        }
      }

      async function applyListContextAndReload(label, options = {}) {
        const button = options.button;
        const mutate = typeof options.mutate === "function" ? options.mutate : null;
        const op = {
          id: "list_ctx_" + String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          label,
          action: async () => {
            if (mutate) mutate();
            syncFocusChips();
            persistControls();
            resetPreviewOffset();
            clearPreviewState();
            await loadItems();
          },
        };
        await runActionWithFeedback(op, { button, localFeedbackEl: queueActionBannerEl });
      }

      async function applyQueueControlMutation(label, mutate, options = {}) {
        await runActionWithFeedback(
          {
            id: "queue_ctrl_" + String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_"),
            label,
            action: async () => {
              if (typeof mutate === "function") {
                mutate();
              }
              if (options.refresh_worker_stats) {
                await loadWorkerStats();
              }
            },
          },
          { localFeedbackEl: queueActionBannerEl },
        );
      }

      function renderItem(item) {
        const card = document.createElement("div");
        card.dataset.itemId = String(item.id);
        const isSelected = selectedId === item.id;
        const spotlight = queueNudgeForItem(item);
        card.className =
          "item-card clickable priority-" +
          priorityTone(item.priority) +
          (isSelected ? " is-selected" : "") +
          (spotlight ? " is-spotlight spotlight-" + spotlight.tone : "");
        const title = item.title || item.url;
        const score = item.match_score != null ? Number(item.match_score).toFixed(1) : "—";
        const retry = retryInfo(item);
        const spotlightNoteHtml = spotlight
          ? '<div class="spotlight-note"><span class="spotlight-badge">' +
            QUEUE_SPOTLIGHT_BADGE_TEXT +
            "</span>" +
            spotlight.actionLabel +
            " · " +
            spotlight.context +
            "</div>"
          : "";
        let failureNoteHtml = "";
        if (item.status.startsWith("FAILED_") && retry.retryLimit > 0) {
          if (retry.retryable) {
            failureNoteHtml =
              '<div class="failure-note">retry: ' +
              retry.retryAttempts +
              "/" +
              retry.retryLimit +
              " used, " +
              retry.remaining +
              " left</div>";
          } else {
            failureNoteHtml = '<div class="failure-note">retry limit reached (' + retry.retryAttempts + "/" + retry.retryLimit + ")</div>";
          }
        }
        const ops = buttonsFor(item);
        const flowRailHtml = queueFlowRailHtml(item);
        const insightPillsHtml = queueInsightPillsHtml(item);
        const ahaRank = ahaRankFromMap(item);
        const ahaDelta = ahaRankDeltaFromMap(item, ahaRank);
        const ahaGap = ahaLeadGapMeta(item, ahaRank);
        const ahaDeltaHtml = ahaDelta
          ? '<span class="aha-rank-delta ' + ahaDelta.tone + '">' + ahaDelta.label + "</span>"
          : "";
        const ahaRankTone =
          ahaRank?.rank === 1 ? " rank-top" : ahaRank?.rank && ahaRank.rank <= 3 ? " rank-strong" : "";
        const ahaRankHtml = ahaRank
          ? '<span class="aha-rank-chip' + ahaRankTone + '">Aha #' + ahaRank.rank + ahaDeltaHtml + "</span>"
          : "";
        const duelRoleHtml = ahaDuelRoleHtml(item);
        const scoreMeter = scoreMeterHtml(item.match_score);
        const freshnessChip = freshnessChipHtml(item.updated_at);
        const ahaIndex = ahaIndexHtml(item);
        const gapHtml = ahaLeadGapHtml(item, ahaRank);
        const nextMoveHtml = queueNextMoveHtml(item, ops, spotlight);
        if (ahaGap?.cardTone) {
          card.classList.add(ahaGap.cardTone);
        }
        card.innerHTML = \`
          <div class="item-head">
            <div class="status-cluster">
              <span class="status status-\${statusTone(item.status)}">\${item.status}</span>
              \${ahaRankHtml}
              \${duelRoleHtml}
            </div>
            <span class="muted">\${item.priority || "N/A"} · \${score}</span>
          </div>
          <div class="intent">\${item.intent_text}</div>
          <div>\${title}</div>
          <div class="muted">\${item.domain || ""}</div>
          \${scoreMeter}
          \${freshnessChip}
          \${ahaIndex}
          \${gapHtml}
          \${insightPillsHtml}
          \${flowRailHtml}
          \${nextMoveHtml}
          \${spotlightNoteHtml}
          \${failureNoteHtml}
          <div class="actions"></div>
        \`;
        const actionEl = card.querySelector(".actions");
        card.addEventListener("click", (event) => {
          const target = event.target;
          if (target instanceof HTMLElement && (target.closest("button") || target.closest("a"))) {
            return;
          }
          void selectItem(item.id).catch((err) => {
            errorEl.textContent = String(err);
          });
        });
        for (const op of ops) {
          const btn = document.createElement("button");
          btn.textContent = op.label;
          if (op.is_primary) {
            btn.classList.add("primary");
            btn.title = "Recommended action";
          }
          btn.disabled = Boolean(op.disabled);
          btn.addEventListener("click", async () => {
            await runActionWithFeedback(op, {
              button: btn,
              localFeedbackEl: queueActionBannerEl,
            });
          });
          actionEl.appendChild(btn);
        }
        return card;
      }

      function renderDetailAha(detail) {
        const summaryPayload = detail.artifacts?.summary?.payload ?? {};
        const scorePayload = detail.artifacts?.score?.payload ?? {};
        const todosPayload = detail.artifacts?.todos?.payload ?? {};
        const todos = Array.isArray(todosPayload.todos) ? todosPayload.todos : [];
        const reasons = Array.isArray(scorePayload.reasons) ? scorePayload.reasons.filter((x) => typeof x === "string") : [];
        const scoreRaw = Number(scorePayload.match_score ?? detail.item.match_score ?? 0);
        const score = Number.isFinite(scoreRaw) ? Math.min(Math.max(scoreRaw, 0), 100) : 0;
        const insight =
          typeof summaryPayload.insight === "string" && summaryPayload.insight.trim()
            ? summaryPayload.insight.trim()
            : "No insight yet. Run process/regenerate to build a stronger snapshot.";
        const nextTodo = todos[0] || null;

        const card = document.createElement("div");
        card.className = "item-card detail-aha";
        card.innerHTML = \`
          <h3>Aha Snapshot</h3>
          <div class="panel-subtitle">把内容价值压缩成“为什么现在做、先做什么、做完看到什么”。</div>
          <div class="aha-insight"></div>
          <div class="detail-aha-grid">
            <div class="detail-aha-kpi">
              <div class="label">Match Score</div>
              <div class="value">\${score.toFixed(1)} · \${scorePayload.priority || detail.item.priority || "N/A"}</div>
              <div class="score-meter"><div class="score-meter-fill" style="width:\${score}%;"></div></div>
            </div>
            <div class="detail-aha-kpi">
              <div class="label">Best Next Task</div>
              <div class="value" id="nextTaskValue">—</div>
            </div>
            <div class="detail-aha-kpi">
              <div class="label">Effort & Throughput</div>
              <div class="value" id="effortValue">—</div>
            </div>
          </div>
          <ul class="aha-reasons" id="ahaReasonsList"></ul>
        \`;
        const insightEl = card.querySelector(".aha-insight");
        const nextTaskValueEl = card.querySelector("#nextTaskValue");
        const effortValueEl = card.querySelector("#effortValue");
        const reasonsListEl = card.querySelector("#ahaReasonsList");
        insightEl.textContent = insight;
        nextTaskValueEl.textContent = nextTodo ? (nextTodo.title || "Untitled task") : "No task yet";
        if (nextTodo?.eta) {
          effortValueEl.textContent = nextTodo.eta + " first step · " + todos.length + " tasks total";
        } else {
          effortValueEl.textContent = todos.length + " tasks total";
        }
        const showReasons = reasons.length ? reasons.slice(0, 3) : ["No score reasons yet. Process this item to generate explainable reasons."];
        for (const reason of showReasons) {
          const li = document.createElement("li");
          li.textContent = reason;
          reasonsListEl.appendChild(li);
        }
        card.id = "detail-snapshot";
        detailEl.appendChild(card);
        addDetailSectionNav("Snapshot", "detail-snapshot");
      }

      function renderDetailQuickActions(detail, detailOps, hiddenActionIds = new Set()) {
        const ops = detailOps.filter((op) => !hiddenActionIds.has(op.id));
        if (!ops.length) {
          const emptyCard = document.createElement("div");
          emptyCard.className = "item-card";
          emptyCard.innerHTML = \`
            <h3>Quick Actions</h3>
            <div class="muted">Top actions are pinned in the header. Open Advanced Panels for deeper controls.</div>
          \`;
          emptyCard.id = "detail-quick-actions";
          detailEl.appendChild(emptyCard);
          addDetailSectionNav("Quick Actions", "detail-quick-actions");
          return;
        }

        const card = document.createElement("div");
        card.className = "item-card";
        const primaryOp = ops.find((op) => op.is_primary) || null;
        card.innerHTML = \`
          <h3>Quick Actions</h3>
          <div class="muted">无需回到列表，直接在详情完成处理、导出与归档。</div>
          <div class="hint">Recommended Action: \${primaryOp?.label || "Choose any action below based on your goal."}</div>
          <div class="quick-action-grid" id="detailQuickActions"></div>
          <div class="muted action-feedback" id="detailQuickActionMsg">Mirrors global action status.</div>
        \`;
        const actionEl = card.querySelector("#detailQuickActions");
        const msgEl = card.querySelector("#detailQuickActionMsg");
        const groupDefs = [
          { key: "process", title: "Process & Regenerate", hint: "生成或重试核心产物" },
          { key: "ship", title: "Ship & Export", hint: "导出可交付文件" },
          { key: "maintain", title: "Maintain Queue", hint: "归档与状态维护" },
        ];
        const quickButtons = [];
        function setButtonsDisabled(nextDisabled) {
          for (const button of quickButtons) {
            button.disabled = nextDisabled || button.dataset.locked === "true";
          }
        }
        for (const groupDef of groupDefs) {
          const groupOps = ops.filter((op) => (op.group || "maintain") === groupDef.key);
          if (!groupOps.length) continue;
          const groupEl = document.createElement("div");
          groupEl.className = "quick-action-group";
          groupEl.innerHTML = '<h4>' + groupDef.title + '</h4><span class="muted">' + groupDef.hint + '</span><div class="actions"></div>';
          const groupActionEl = groupEl.querySelector(".actions");
          for (const op of groupOps) {
            const btn = document.createElement("button");
            btn.textContent = op.label;
            if (op.is_primary) {
              btn.classList.add("primary");
            }
            const locked = Boolean(op.disabled);
            btn.disabled = locked;
            btn.dataset.locked = locked ? "true" : "false";
            quickButtons.push(btn);
            btn.addEventListener("click", async () => {
              const initialLabel = btn.textContent;
              await runActionWithFeedback(op, {
                button: btn,
                label: initialLabel,
                localFeedbackEl: msgEl,
                disableAll: setButtonsDisabled,
                onStart: () => {
                  btn.textContent = "Working…";
                },
                onFinally: () => {
                  btn.textContent = initialLabel;
                },
              });
            });
            groupActionEl.appendChild(btn);
          }
          actionEl.appendChild(groupEl);
        }
        card.id = "detail-quick-actions";
        detailEl.appendChild(card);
        addDetailSectionNav("Quick Actions", "detail-quick-actions");
      }

      function appendGroup(target, key, title, items) {
        if (!items.length) return;
        const isCollapsed = Boolean(collapsedGroups[key]);
        const label = document.createElement("div");
        label.className = "group-title";
        label.innerHTML = '<span>' + title + " (" + items.length + ")</span>";
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "section-chip";
        toggleBtn.textContent = isCollapsed ? "Expand" : "Collapse";
        toggleBtn.addEventListener("click", () => {
          collapsedGroups[key] = !Boolean(collapsedGroups[key]);
          persistControls();
          renderInbox(allItems);
        });
        label.appendChild(toggleBtn);
        target.appendChild(label);
        if (isCollapsed) return;
        for (const item of items) {
          target.appendChild(renderItem(item));
        }
      }

      function renderInbox(items) {
        inboxEl.innerHTML = "";
        refreshAhaRankMap(items);
        refreshAhaHeatMap(items);
        refreshAhaHeatHistory(items);
        refreshAhaDuelGapHistory(items);
        refreshAhaDuelCallHistory(items);
        refreshAhaDuelSignalHandoffHistory(items);
        refreshAhaDuelSignalConsensusHistory(items);
        refreshAhaDuelSignalConsensusProtocolConfidenceHistory(items);
        refreshAhaSnapshot(items);
        renderQueueHighlights(items);
        updateAhaPulseHint(items);
        renderStatusLegend(items);
        if (!items.length) {
          inboxEl.innerHTML = '<div class="empty">No items yet. Use the extension to capture links.</div>';
          return;
        }
        const groups = groupedItems(items);
        appendGroup(inboxEl, "read_next", "Read Next", groups.read_next);
        appendGroup(inboxEl, "worth_it", "Worth It", groups.worth_it);
        appendGroup(inboxEl, "if_time", "If Time", groups.if_time);
        appendGroup(inboxEl, "in_progress", "In Progress", groups.in_progress);
        appendGroup(inboxEl, "needs_attention", "Needs Attention", groups.needs_attention);
        appendGroup(inboxEl, "skip", "Skip", groups.skip);
        appendGroup(inboxEl, "shipped", "Shipped", groups.shipped);
        appendGroup(inboxEl, "archived", "Archived", groups.archived);
      }

      async function loadItems() {
        if (isLoadingItems) return;
        isLoadingItems = true;
        try {
          syncFocusChips();
          persistControls();
          const query = queryInput.value.trim();
          const status = statusFilter.value;
          const retryable = retryableFilter.value;
          const failureStep = failureStepFilter.value;
          const params = new URLSearchParams({
            sort: "priority_score_desc",
            limit: "100"
          });
          if (query) params.set("q", query);
          if (status) params.set("status", status);
          if (retryable) params.set("retryable", retryable);
          if (failureStep) params.set("failure_step", failureStep);

          const payload = await request("/items?" + params.toString());
          allItems = payload.items || [];
          ahaCandidateCycleCursor = -1;
          updateSelectionHint();
          renderInbox(allItems);
          const retryableCount = allItems.filter((item) => isRetryableFailedItem(item)).length;
          retryFailedBtn.textContent = retryableCount > 0 ? "Retry Failed (" + retryableCount + ")" : "Retry Failed";
          await loadWorkerStats();
          if (selectedId) {
            await selectItem(selectedId);
            updateSelectionHint();
          }
        } finally {
          isLoadingItems = false;
        }
      }

      async function loadWorkerStats() {
        try {
          const stats = await request("/system/worker");
          const queueQueued = stats?.queue?.QUEUED ?? 0;
          const queueLeased = stats?.queue?.LEASED ?? 0;
          const processing = stats?.items?.PROCESSING ?? 0;
          const failedExtract = stats?.failure_steps?.extract ?? 0;
          const failedPipeline = stats?.failure_steps?.pipeline ?? 0;
          const failedExport = stats?.failure_steps?.export ?? 0;
          const retryable = stats?.retry?.retryable_items ?? 0;
          const blocked = stats?.retry?.non_retryable_items ?? 0;
          const archivedCount = stats?.items?.ARCHIVED ?? 0;
          workerStatsEl.textContent =
            "Queue: " +
            queueQueued +
            " | Leased: " +
            queueLeased +
            " | Processing: " +
            processing +
            " | Failed(e/p/x): " +
            failedExtract +
            "/" +
            failedPipeline +
            "/" +
            failedExport +
            " | Retryable: " +
            retryable +
            " | Retry blocked: " +
            blocked;
          if (archiveRetryableFilter.value === "false") {
            archiveBlockedBtn.textContent = blocked > 0 ? "Archive Failed (blocked " + blocked + ")" : "Archive Failed";
          } else {
            archiveBlockedBtn.textContent = "Archive Failed";
          }
          previewUnarchiveBtn.textContent = archivedCount > 0 ? "Preview Unarchive (" + archivedCount + ")" : "Preview Unarchive";
          unarchiveBatchBtn.textContent = archivedCount > 0 ? "Unarchive Archived (" + archivedCount + ")" : "Unarchive Archived";
        } catch {
          workerStatsEl.textContent = "Queue: unavailable";
          archiveBlockedBtn.textContent = "Archive Failed";
          previewUnarchiveBtn.textContent = "Preview Unarchive";
          unarchiveBatchBtn.textContent = "Unarchive Archived";
        }
      }

      function renderRawDebugPanel(detail) {
        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = \`
          <h3>Raw Debug JSON</h3>
          <details class="raw-panel">
            <summary>Artifacts JSON</summary>
            <pre>\${JSON.stringify(detail.artifacts || {}, null, 2)}</pre>
          </details>
          <details class="raw-panel">
            <summary>Artifact History JSON</summary>
            <pre>\${JSON.stringify(detail.artifact_history || {}, null, 2)}</pre>
          </details>
          <details class="raw-panel">
            <summary>Failure JSON</summary>
            <pre>\${JSON.stringify(detail.failure || null, null, 2)}</pre>
          </details>
        \`;
        appendDetailSection("detail-raw-json", "Raw JSON", "调试与排障专用视图", card, false);
      }

      function renderDetailHeroActions(detail, hostEl, detailOps) {
        const actionHost = hostEl.querySelector("#detailHeroActions");
        const usedIds = new Set();
        if (!actionHost) return usedIds;
        const ops = detailOps;
        if (!ops.length) return usedIds;
        const spotlight = queueNudgeForItem(detail.item);
        actionHost.innerHTML = '<div class="muted">Primary Next Step</div>';
        const primaryOp = ops.find((op) => op.is_primary) || ops[0];
        const secondaryOp = ops.find((op) => op.id === "archive" || op.id === "unarchive");
        const heroOps = [primaryOp];
        if (secondaryOp && secondaryOp.id !== primaryOp.id) {
          heroOps.push(secondaryOp);
        }
        for (const op of heroOps) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = op.label;
          if (op.is_primary) btn.classList.add("primary");
          if (spotlight && op.label === spotlight.actionLabel) {
            btn.classList.add("recommended");
          }
          btn.disabled = Boolean(op.disabled);
          btn.addEventListener("click", async () => {
            await runActionWithFeedback(op, { button: btn });
          });
          actionHost.appendChild(btn);
          usedIds.add(op.id);
        }
        if (spotlight) {
          const recommendation = document.createElement("div");
          recommendation.className = "hero-recommendation";
          recommendation.innerHTML = "<strong>Queue Recommended</strong>: " + spotlight.actionLabel + " · " + spotlight.context;
          actionHost.appendChild(recommendation);
        }
        return usedIds;
      }

      function renderDetailHeroStory(item, hostEl) {
        const storyHost = hostEl.querySelector("#detailHeroStory");
        if (!storyHost || !item) return;
        const visibleItems = visibleQueueItems();
        const pool = visibleItems.length ? visibleItems : allItems;
        const rankedPool = sortedAhaItems(pool);
        if (!rankedPool.length) {
          storyHost.innerHTML = '<span class="muted">' + DETAIL_STORY_LABEL + " unavailable.</span>";
          return;
        }
        const top = rankedPool[0];
        const story = detailStoryText(item, rankedPool);
        const duel = ahaDuelText(rankedPool);
        const duelGap = ahaDuelGapMeta(rankedPool);
        const duelEdge = ahaDuelEdgeMeta(rankedPool);
        const duelCall = ahaDuelCallMeta(rankedPool);
        const duelCallTrend = ahaDuelCallTrendMeta();
        const duelCallConfidence = ahaDuelCallConfidenceMeta();
        const duelCallStability = ahaDuelCallStabilityMeta();
        const duelCallRisk = ahaDuelCallRiskMeta();
        const duelCallSequence = ahaDuelCallSequenceMeta();
        const duelSignal = ahaDuelSignalMeta(rankedPool);
        const duelSignalPulse = ahaDuelSignalPulseMeta();
        const duelSignalVolatility = ahaDuelSignalVolatilityMeta();
        const duelSignalOutlook = ahaDuelSignalOutlookMeta(rankedPool);
        const duelSignalRegime = ahaDuelSignalRegimeMeta(rankedPool);
        const duelSignalConviction = ahaDuelSignalConvictionMeta(rankedPool);
        const duelSignalHandoff = ahaDuelSignalHandoffMeta(rankedPool);
        const duelSignalHandoffTrend = ahaDuelSignalHandoffTrendMeta();
        const duelSignalHandoffMomentum = ahaDuelSignalHandoffMomentumMeta();
        const duelSignalConsensus = ahaDuelSignalConsensusMeta(rankedPool);
        const duelSignalConsensusTrend = ahaDuelSignalConsensusTrendMeta();
        const duelSignalConsensusMomentum = ahaDuelSignalConsensusMomentumMeta();
        const duelSignalConsensusRisk = ahaDuelSignalConsensusRiskMeta();
        const duelSignalConsensusStability = ahaDuelSignalConsensusStabilityMeta();
        const duelSignalConsensusReadiness = ahaDuelSignalConsensusReadinessMeta(rankedPool);
        const duelSignalConsensusWindow = ahaDuelSignalConsensusWindowMeta(rankedPool);
        const duelSignalConsensusGuardrail = ahaDuelSignalConsensusGuardrailMeta(rankedPool);
        const duelSignalConsensusTrigger = ahaDuelSignalConsensusTriggerMeta(rankedPool);
        const duelSignalConsensusProtocol = ahaDuelSignalConsensusProtocolMeta(rankedPool);
        const duelSignalConsensusProtocolConfidence = ahaDuelSignalConsensusProtocolConfidenceMeta(rankedPool);
        const duelSignalConsensusProtocolTrend = ahaDuelSignalConsensusProtocolTrendMeta();
        const duelSignalConsensusProtocolRisk = ahaDuelSignalConsensusProtocolRiskMeta();
        const duelSignalConsensusProtocolRegime = ahaDuelSignalConsensusProtocolRegimeMeta();
        const duelSignalConsensusProtocolCadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const duelSignalConsensusProtocolPressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const duelSignalConsensusProtocolCommand = ahaDuelSignalConsensusProtocolCommandMeta(rankedPool);
        const duelSignalConsensusProtocolScript = ahaDuelSignalConsensusProtocolScriptMeta(
          rankedPool,
          duelSignalConsensusProtocolCommand,
          duelSignalConsensusProtocolCadence,
          duelSignalConsensusProtocolPressure,
        );
        const duelSignalConsensusProtocolScriptLane = ahaDuelSignalConsensusProtocolScriptLaneMeta(
          rankedPool,
          duelSignalConsensusProtocolScript,
          duelSignalConsensusProtocolCommand,
        );
        const duelSignalConsensusProtocolScriptChecklist = ahaDuelSignalConsensusProtocolScriptChecklistMeta(
          rankedPool,
          duelSignalConsensusProtocolScript,
          duelSignalConsensusProtocolScriptLane,
          duelSignalConsensusProtocolCommand,
        );
        const duelSnapshot = ahaDuelSnapshotText(rankedPool);
        const duelPlan = ahaDuelActionPlanMeta(rankedPool);
        const duelTrend = ahaDuelGapTrendMeta();
        const briefPreview = ahaDecisionBriefPreview(rankedPool, 4);
        const rival = rankedPool[1] || null;
        storyHost.innerHTML =
          '<div class="label">' +
          DETAIL_STORY_LABEL +
          '</div><div class="body">' +
          (story || "No storyline available.") +
          "</div>";
        if (duel) {
          const duelEl = document.createElement("div");
          duelEl.className = "hero-duel";
          duelEl.textContent = duel;
          storyHost.appendChild(duelEl);
          if (duelGap) {
            const duelGapEl = document.createElement("span");
            duelGapEl.className = "duel-gap-pill " + duelGap.tone;
            duelGapEl.innerHTML =
              QUEUE_NUDGE_DUEL_GAP_LABEL +
              ": " +
              duelGap.label +
              '<span class="muted">· ' +
              duelGap.hint +
              "</span>";
            storyHost.appendChild(duelGapEl);
          }
          if (duelEdge) {
            const duelEdgeEl = document.createElement("span");
            duelEdgeEl.className = "duel-edge-pill " + duelEdge.tone;
            duelEdgeEl.innerHTML =
              QUEUE_NUDGE_DUEL_EDGE_LABEL +
              ": " +
              duelEdge.label +
              '<span class="muted">· ' +
              duelEdge.hint +
              "</span>";
            storyHost.appendChild(duelEdgeEl);
          }
          if (duelCall) {
            const duelCallEl = document.createElement("span");
            duelCallEl.className = "duel-call-pill " + duelCall.tone;
            duelCallEl.innerHTML =
              QUEUE_NUDGE_DUEL_CALL_LABEL +
              ": " +
              duelCall.label +
              '<span class="muted">· ' +
              duelCall.hint +
              "</span>";
            storyHost.appendChild(duelCallEl);
          }
          if (duelCallTrend) {
            const duelCallTrendEl = document.createElement("span");
            duelCallTrendEl.className = "duel-call-trend-inline " + duelCallTrend.tone;
            duelCallTrendEl.textContent = QUEUE_NUDGE_DUEL_CALL_TREND_LABEL + ": " + duelCallTrend.label;
            storyHost.appendChild(duelCallTrendEl);
          }
          if (duelCallConfidence) {
            const duelCallConfidenceEl = document.createElement("span");
            duelCallConfidenceEl.className = "duel-call-confidence-inline " + duelCallConfidence.tone;
            duelCallConfidenceEl.textContent =
              QUEUE_NUDGE_DUEL_CALL_CONFIDENCE_LABEL + ": " + duelCallConfidence.label + " · " + duelCallConfidence.hint;
            storyHost.appendChild(duelCallConfidenceEl);
          }
          if (duelCallStability) {
            const duelCallStabilityEl = document.createElement("span");
            duelCallStabilityEl.className = "duel-call-stability-inline " + duelCallStability.tone;
            duelCallStabilityEl.textContent =
              QUEUE_NUDGE_DUEL_CALL_STABILITY_LABEL + ": " + duelCallStability.label + " · " + duelCallStability.hint;
            storyHost.appendChild(duelCallStabilityEl);
          }
          if (duelCallRisk) {
            const duelCallRiskEl = document.createElement("span");
            duelCallRiskEl.className = "duel-call-risk-inline " + duelCallRisk.tone;
            duelCallRiskEl.textContent = QUEUE_NUDGE_DUEL_CALL_RISK_LABEL + ": " + duelCallRisk.label + " · " + duelCallRisk.hint;
            storyHost.appendChild(duelCallRiskEl);
          }
          if (duelCallSequence) {
            const duelCallSequenceEl = document.createElement("span");
            duelCallSequenceEl.className = "duel-call-sequence-inline " + duelCallSequence.tone;
            duelCallSequenceEl.textContent =
              QUEUE_NUDGE_DUEL_CALL_SEQUENCE_LABEL + ": " + duelCallSequence.label + " · " + duelCallSequence.hint;
            storyHost.appendChild(duelCallSequenceEl);
          }
          if (duelSignal) {
            const duelSignalEl = document.createElement("span");
            duelSignalEl.className = "duel-signal-inline " + duelSignal.tone;
            duelSignalEl.textContent = QUEUE_NUDGE_DUEL_SIGNAL_LABEL + ": " + duelSignal.label + " · " + duelSignal.hint;
            storyHost.appendChild(duelSignalEl);
          }
          if (duelSignalPulse) {
            const duelSignalPulseEl = document.createElement("span");
            duelSignalPulseEl.className = "duel-signal-pulse-inline " + duelSignalPulse.tone;
            duelSignalPulseEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_PULSE_LABEL + ": " + duelSignalPulse.label + " · " + duelSignalPulse.hint;
            storyHost.appendChild(duelSignalPulseEl);
            const signalPoints = ahaDuelSignalPulsePoints();
            if (signalPoints.length) {
              const signalChartEl = document.createElement("div");
              signalChartEl.className = "duel-signal-chart-inline";
              signalChartEl.innerHTML =
                '<div class="meta">' +
                QUEUE_NUDGE_DUEL_SIGNAL_SERIES_LABEL +
                " · " +
                duelSignalPulse.label +
                '</div><div class="bars">' +
                ahaDuelSignalPulseBarsHtml(signalPoints) +
                "</div>";
              storyHost.appendChild(signalChartEl);
            }
          }
          if (duelSignalVolatility) {
            const duelSignalVolatilityEl = document.createElement("span");
            duelSignalVolatilityEl.className = "duel-signal-volatility-inline " + duelSignalVolatility.tone;
            duelSignalVolatilityEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_VOLATILITY_LABEL +
              ": " +
              duelSignalVolatility.label +
              " · " +
              duelSignalVolatility.hint;
            storyHost.appendChild(duelSignalVolatilityEl);
          }
          if (duelSignalOutlook) {
            const duelSignalOutlookEl = document.createElement("span");
            duelSignalOutlookEl.className = "duel-signal-outlook-inline " + duelSignalOutlook.tone;
            duelSignalOutlookEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_OUTLOOK_LABEL + ": " + duelSignalOutlook.label + " · " + duelSignalOutlook.hint;
            storyHost.appendChild(duelSignalOutlookEl);
          }
          if (duelSignalRegime) {
            const duelSignalRegimeEl = document.createElement("span");
            duelSignalRegimeEl.className = "duel-signal-regime-inline " + duelSignalRegime.tone;
            duelSignalRegimeEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_REGIME_LABEL + ": " + duelSignalRegime.label + " · " + duelSignalRegime.hint;
            storyHost.appendChild(duelSignalRegimeEl);
          }
          if (duelSignalConviction) {
            const duelSignalConvictionEl = document.createElement("span");
            duelSignalConvictionEl.className = "duel-signal-conviction-inline " + duelSignalConviction.tone;
            duelSignalConvictionEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONVICTION_LABEL +
              ": " +
              duelSignalConviction.label +
              " · " +
              duelSignalConviction.hint;
            storyHost.appendChild(duelSignalConvictionEl);
          }
          if (duelSignalHandoff) {
            const duelSignalHandoffEl = document.createElement("span");
            duelSignalHandoffEl.className = "duel-signal-handoff-inline " + duelSignalHandoff.tone;
            duelSignalHandoffEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_LABEL + ": " + duelSignalHandoff.label + " · " + duelSignalHandoff.hint;
            storyHost.appendChild(duelSignalHandoffEl);
          }
          if (duelSignalHandoffTrend) {
            const duelSignalHandoffTrendEl = document.createElement("span");
            duelSignalHandoffTrendEl.className = "duel-signal-handoff-trend-inline " + duelSignalHandoffTrend.tone;
            duelSignalHandoffTrendEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_TREND_LABEL +
              ": " +
              duelSignalHandoffTrend.label +
              " · " +
              duelSignalHandoffTrend.hint;
            storyHost.appendChild(duelSignalHandoffTrendEl);
            const handoffPoints = ahaDuelSignalHandoffTrendSeries();
            if (handoffPoints.length) {
              const handoffChartEl = document.createElement("div");
              handoffChartEl.className = "duel-signal-handoff-chart-inline";
              handoffChartEl.innerHTML =
                '<div class="meta">' +
                QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_SERIES_LABEL +
                " · " +
                duelSignalHandoffTrend.label +
                '</div><div class="bars">' +
                ahaDuelSignalHandoffTrendBarsHtml(handoffPoints) +
                "</div>";
              storyHost.appendChild(handoffChartEl);
            }
          }
          if (duelSignalHandoffMomentum) {
            const duelSignalHandoffMomentumEl = document.createElement("span");
            duelSignalHandoffMomentumEl.className = "duel-signal-handoff-momentum-inline " + duelSignalHandoffMomentum.tone;
            duelSignalHandoffMomentumEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_HANDOFF_MOMENTUM_LABEL +
              ": " +
              duelSignalHandoffMomentum.label +
              " · " +
              duelSignalHandoffMomentum.hint;
            storyHost.appendChild(duelSignalHandoffMomentumEl);
          }
          if (duelSignalConsensus) {
            const duelSignalConsensusEl = document.createElement("span");
            duelSignalConsensusEl.className = "duel-signal-consensus-inline " + duelSignalConsensus.tone;
            duelSignalConsensusEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_LABEL + ": " + duelSignalConsensus.label + " · " + duelSignalConsensus.hint;
            storyHost.appendChild(duelSignalConsensusEl);
          }
          if (duelSignalConsensusTrend) {
            const duelSignalConsensusTrendEl = document.createElement("span");
            duelSignalConsensusTrendEl.className = "duel-signal-consensus-trend-inline " + duelSignalConsensusTrend.tone;
            duelSignalConsensusTrendEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TREND_LABEL +
              ": " +
              duelSignalConsensusTrend.label +
              " · " +
              duelSignalConsensusTrend.hint;
            storyHost.appendChild(duelSignalConsensusTrendEl);
            const consensusPoints = ahaDuelSignalConsensusTrendSeries();
            if (consensusPoints.length) {
              const consensusChartEl = document.createElement("div");
              consensusChartEl.className = "duel-signal-consensus-chart-inline";
              consensusChartEl.innerHTML =
                '<div class="meta">' +
                QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_SERIES_LABEL +
                " · " +
                duelSignalConsensusTrend.label +
                '</div><div class="bars">' +
                ahaDuelSignalConsensusTrendBarsHtml(consensusPoints) +
                "</div>";
              storyHost.appendChild(consensusChartEl);
            }
          }
          if (duelSignalConsensusMomentum) {
            const duelSignalConsensusMomentumEl = document.createElement("span");
            duelSignalConsensusMomentumEl.className = "duel-signal-consensus-momentum-inline " + duelSignalConsensusMomentum.tone;
            duelSignalConsensusMomentumEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_MOMENTUM_LABEL +
              ": " +
              duelSignalConsensusMomentum.label +
              " · " +
              duelSignalConsensusMomentum.hint;
            storyHost.appendChild(duelSignalConsensusMomentumEl);
          }
          if (duelSignalConsensusRisk) {
            const duelSignalConsensusRiskEl = document.createElement("span");
            duelSignalConsensusRiskEl.className = "duel-signal-consensus-risk-inline " + duelSignalConsensusRisk.tone;
            duelSignalConsensusRiskEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_RISK_LABEL + ": " + duelSignalConsensusRisk.label + " · " + duelSignalConsensusRisk.hint;
            storyHost.appendChild(duelSignalConsensusRiskEl);
          }
          if (duelSignalConsensusStability) {
            const duelSignalConsensusStabilityEl = document.createElement("span");
            duelSignalConsensusStabilityEl.className = "duel-signal-consensus-stability-inline " + duelSignalConsensusStability.tone;
            duelSignalConsensusStabilityEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_STABILITY_LABEL +
              ": " +
              duelSignalConsensusStability.label +
              " · " +
              duelSignalConsensusStability.hint;
            storyHost.appendChild(duelSignalConsensusStabilityEl);
          }
          if (duelSignalConsensusReadiness) {
            const duelSignalConsensusReadinessEl = document.createElement("span");
            duelSignalConsensusReadinessEl.className = "duel-signal-consensus-readiness-inline " + duelSignalConsensusReadiness.tone;
            duelSignalConsensusReadinessEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_READINESS_LABEL +
              ": " +
              duelSignalConsensusReadiness.label +
              " · " +
              duelSignalConsensusReadiness.hint;
            storyHost.appendChild(duelSignalConsensusReadinessEl);
          }
          if (duelSignalConsensusWindow) {
            const duelSignalConsensusWindowEl = document.createElement("span");
            duelSignalConsensusWindowEl.className = "duel-signal-consensus-window-inline " + duelSignalConsensusWindow.tone;
            duelSignalConsensusWindowEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_WINDOW_LABEL +
              ": " +
              duelSignalConsensusWindow.label +
              " · " +
              duelSignalConsensusWindow.hint;
            storyHost.appendChild(duelSignalConsensusWindowEl);
          }
          if (duelSignalConsensusGuardrail) {
            const duelSignalConsensusGuardrailEl = document.createElement("span");
            duelSignalConsensusGuardrailEl.className = "duel-signal-consensus-guardrail-inline " + duelSignalConsensusGuardrail.tone;
            duelSignalConsensusGuardrailEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_GUARDRAIL_LABEL +
              ": " +
              duelSignalConsensusGuardrail.label +
              " · " +
              duelSignalConsensusGuardrail.hint;
            storyHost.appendChild(duelSignalConsensusGuardrailEl);
          }
          if (duelSignalConsensusTrigger) {
            const duelSignalConsensusTriggerEl = document.createElement("span");
            duelSignalConsensusTriggerEl.className = "duel-signal-consensus-trigger-inline " + duelSignalConsensusTrigger.tone;
            duelSignalConsensusTriggerEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_TRIGGER_LABEL +
              ": " +
              duelSignalConsensusTrigger.label +
              " · " +
              duelSignalConsensusTrigger.hint;
            storyHost.appendChild(duelSignalConsensusTriggerEl);
          }
          if (duelSignalConsensusProtocol) {
            const duelSignalConsensusProtocolEl = document.createElement("span");
            duelSignalConsensusProtocolEl.className = "duel-signal-consensus-protocol-inline " + duelSignalConsensusProtocol.tone;
            duelSignalConsensusProtocolEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_LABEL +
              ": " +
              duelSignalConsensusProtocol.label +
              " · " +
              duelSignalConsensusProtocol.hint;
            storyHost.appendChild(duelSignalConsensusProtocolEl);
          }
          if (duelSignalConsensusProtocolConfidence) {
            const duelSignalConsensusProtocolConfidenceEl = document.createElement("span");
            duelSignalConsensusProtocolConfidenceEl.className =
              "duel-signal-consensus-protocol-confidence-inline " + duelSignalConsensusProtocolConfidence.tone;
            duelSignalConsensusProtocolConfidenceEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CONFIDENCE_LABEL +
              ": " +
              duelSignalConsensusProtocolConfidence.label +
              " · " +
              duelSignalConsensusProtocolConfidence.hint;
            storyHost.appendChild(duelSignalConsensusProtocolConfidenceEl);
          }
          if (duelSignalConsensusProtocolTrend) {
            const duelSignalConsensusProtocolTrendEl = document.createElement("span");
            duelSignalConsensusProtocolTrendEl.className =
              "duel-signal-consensus-protocol-trend-inline " + duelSignalConsensusProtocolTrend.tone;
            duelSignalConsensusProtocolTrendEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_TREND_LABEL +
              ": " +
              duelSignalConsensusProtocolTrend.label +
              " · " +
              duelSignalConsensusProtocolTrend.hint;
            storyHost.appendChild(duelSignalConsensusProtocolTrendEl);
            const protocolPoints = ahaDuelSignalConsensusProtocolConfidencePoints();
            if (protocolPoints.length) {
              const protocolChartEl = document.createElement("div");
              protocolChartEl.className = "duel-signal-consensus-protocol-chart-inline";
              protocolChartEl.innerHTML =
                '<div class="meta">' +
                QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SERIES_LABEL +
                " · " +
                duelSignalConsensusProtocolTrend.label +
                '</div><div class="bars">' +
                ahaDuelSignalConsensusProtocolBarsHtml(protocolPoints) +
                "</div>";
              storyHost.appendChild(protocolChartEl);
            }
          }
          if (duelSignalConsensusProtocolRisk) {
            const duelSignalConsensusProtocolRiskEl = document.createElement("span");
            duelSignalConsensusProtocolRiskEl.className =
              "duel-signal-consensus-protocol-risk-inline " + duelSignalConsensusProtocolRisk.tone;
            duelSignalConsensusProtocolRiskEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_RISK_LABEL +
              ": " +
              duelSignalConsensusProtocolRisk.label +
              " · " +
              duelSignalConsensusProtocolRisk.hint;
            storyHost.appendChild(duelSignalConsensusProtocolRiskEl);
          }
          if (duelSignalConsensusProtocolRegime) {
            const duelSignalConsensusProtocolRegimeEl = document.createElement("span");
            duelSignalConsensusProtocolRegimeEl.className =
              "duel-signal-consensus-protocol-regime-inline " + duelSignalConsensusProtocolRegime.tone;
            duelSignalConsensusProtocolRegimeEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_REGIME_LABEL +
              ": " +
              duelSignalConsensusProtocolRegime.label +
              " · " +
              duelSignalConsensusProtocolRegime.hint;
            storyHost.appendChild(duelSignalConsensusProtocolRegimeEl);
          }
          if (duelSignalConsensusProtocolCadence) {
            const duelSignalConsensusProtocolCadenceEl = document.createElement("span");
            duelSignalConsensusProtocolCadenceEl.className =
              "duel-signal-consensus-protocol-cadence-inline " + duelSignalConsensusProtocolCadence.tone;
            duelSignalConsensusProtocolCadenceEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_CADENCE_LABEL +
              ": " +
              duelSignalConsensusProtocolCadence.label +
              " · " +
              duelSignalConsensusProtocolCadence.hint;
            storyHost.appendChild(duelSignalConsensusProtocolCadenceEl);
          }
          if (duelSignalConsensusProtocolPressure) {
            const duelSignalConsensusProtocolPressureEl = document.createElement("span");
            duelSignalConsensusProtocolPressureEl.className =
              "duel-signal-consensus-protocol-pressure-inline " + duelSignalConsensusProtocolPressure.tone;
            duelSignalConsensusProtocolPressureEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_PRESSURE_LABEL +
              ": " +
              duelSignalConsensusProtocolPressure.label +
              " · " +
              duelSignalConsensusProtocolPressure.hint;
            storyHost.appendChild(duelSignalConsensusProtocolPressureEl);
          }
          if (duelSignalConsensusProtocolCommand) {
            const duelSignalConsensusProtocolCommandEl = document.createElement("span");
            duelSignalConsensusProtocolCommandEl.className =
              "duel-signal-consensus-protocol-command-inline " + duelSignalConsensusProtocolCommand.tone;
            duelSignalConsensusProtocolCommandEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_COMMAND_LABEL +
              ": " +
              duelSignalConsensusProtocolCommand.label +
              " · " +
              duelSignalConsensusProtocolCommand.hint;
            storyHost.appendChild(duelSignalConsensusProtocolCommandEl);
          }
          if (duelSignalConsensusProtocolScript) {
            const duelSignalConsensusProtocolScriptEl = document.createElement("span");
            duelSignalConsensusProtocolScriptEl.className =
              "duel-signal-consensus-protocol-script-inline " + duelSignalConsensusProtocolScript.tone;
            duelSignalConsensusProtocolScriptEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LABEL +
              ": " +
              duelSignalConsensusProtocolScript.label +
              " · " +
              duelSignalConsensusProtocolScript.hint;
            storyHost.appendChild(duelSignalConsensusProtocolScriptEl);
          }
          if (duelSignalConsensusProtocolScriptLane) {
            const duelSignalConsensusProtocolScriptLaneEl = document.createElement("span");
            duelSignalConsensusProtocolScriptLaneEl.className =
              "duel-signal-consensus-protocol-script-lane-inline " + duelSignalConsensusProtocolScriptLane.tone;
            duelSignalConsensusProtocolScriptLaneEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_LANE_LABEL +
              ": " +
              duelSignalConsensusProtocolScriptLane.label +
              " · " +
              duelSignalConsensusProtocolScriptLane.hint;
            storyHost.appendChild(duelSignalConsensusProtocolScriptLaneEl);
          }
          if (duelSignalConsensusProtocolScriptChecklist) {
            const duelSignalConsensusProtocolScriptChecklistEl = document.createElement("span");
            duelSignalConsensusProtocolScriptChecklistEl.className =
              "duel-signal-consensus-protocol-script-checklist-inline " + duelSignalConsensusProtocolScriptChecklist.tone;
            duelSignalConsensusProtocolScriptChecklistEl.textContent =
              QUEUE_NUDGE_DUEL_SIGNAL_CONSENSUS_PROTOCOL_SCRIPT_CHECKLIST_LABEL +
              ": " +
              duelSignalConsensusProtocolScriptChecklist.label +
              " · " +
              duelSignalConsensusProtocolScriptChecklist.hint;
            storyHost.appendChild(duelSignalConsensusProtocolScriptChecklistEl);
          }
          if (duelSnapshot) {
            const duelSnapshotEl = document.createElement("div");
            duelSnapshotEl.className = "duel-snapshot-inline";
            duelSnapshotEl.textContent = QUEUE_NUDGE_DUEL_SNAPSHOT_LABEL + ": " + duelSnapshot;
            storyHost.appendChild(duelSnapshotEl);
          }
          if (duelTrend) {
            const duelTrendEl = document.createElement("span");
            duelTrendEl.className = "duel-trend-inline " + duelTrend.tone;
            duelTrendEl.textContent = QUEUE_NUDGE_DUEL_TREND_LABEL + ": " + duelTrend.label;
            storyHost.appendChild(duelTrendEl);
          }
          if (duelPlan) {
            const duelPlanEl = document.createElement("div");
            duelPlanEl.className = "duel-plan-inline " + duelPlan.tone;
            duelPlanEl.innerHTML =
              QUEUE_NUDGE_DUEL_PLAN_LABEL +
              ": " +
              duelPlan.summary +
              '<span class="muted"> · ' +
              duelPlan.hint +
              "</span>";
            storyHost.appendChild(duelPlanEl);
          }
        }
        if (briefPreview) {
          const briefEl = document.createElement("div");
          briefEl.className = "hero-brief";
          briefEl.textContent = QUEUE_NUDGE_BRIEF_CONTEXT_LABEL + ": " + decisionBriefContextSummary() + "\\n" + briefPreview;
          storyHost.appendChild(briefEl);
        }
        const actionsEl = document.createElement("div");
        actionsEl.className = "hero-story-actions";
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "secondary";
        copyBtn.textContent = QUEUE_NUDGE_COPY_STORY_LABEL;
        copyBtn.addEventListener("click", async () => {
          const copied = await copyTextToClipboard(story, {
            success: "Copied detail storyline.",
            failure: "Copy detail storyline failed.",
          });
          if (!copied) {
            errorEl.textContent = "Copy detail storyline failed.";
          }
        });
        actionsEl.appendChild(copyBtn);
        if (duel) {
          const copyDuelBtn = document.createElement("button");
          copyDuelBtn.type = "button";
          copyDuelBtn.className = "secondary";
          copyDuelBtn.textContent = QUEUE_NUDGE_COPY_DUEL_LABEL;
          copyDuelBtn.addEventListener("click", async () => {
            const copied = await copyTextToClipboard(duel, {
              success: "Copied detail duel.",
              failure: "Copy detail duel failed.",
            });
            if (!copied) {
              errorEl.textContent = "Copy detail duel failed.";
            }
          });
          actionsEl.appendChild(copyDuelBtn);
          const copyDuelCallBtn = document.createElement("button");
          copyDuelCallBtn.type = "button";
          copyDuelCallBtn.className = "secondary";
          copyDuelCallBtn.textContent = QUEUE_NUDGE_COPY_DUEL_CALL_LABEL;
          copyDuelCallBtn.addEventListener("click", async () => {
            await runCopyAhaDuelCallAction(copyDuelCallBtn);
          });
          actionsEl.appendChild(copyDuelCallBtn);
          const copyDuelSignalsBtn = document.createElement("button");
          copyDuelSignalsBtn.type = "button";
          copyDuelSignalsBtn.className = "secondary";
          copyDuelSignalsBtn.textContent = QUEUE_NUDGE_COPY_DUEL_SIGNALS_LABEL;
          copyDuelSignalsBtn.addEventListener("click", async () => {
            await runCopyAhaDuelSignalsAction(copyDuelSignalsBtn);
          });
          actionsEl.appendChild(copyDuelSignalsBtn);
          const copySignalHandoffBtn = document.createElement("button");
          copySignalHandoffBtn.type = "button";
          copySignalHandoffBtn.className = "secondary";
          copySignalHandoffBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_HANDOFF_LABEL;
          copySignalHandoffBtn.addEventListener("click", async () => {
            await runCopyAhaDuelSignalHandoffAction(copySignalHandoffBtn);
          });
          actionsEl.appendChild(copySignalHandoffBtn);
          const copySignalConsensusBtn = document.createElement("button");
          copySignalConsensusBtn.type = "button";
          copySignalConsensusBtn.className = "secondary";
          copySignalConsensusBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_CONSENSUS_LABEL;
          copySignalConsensusBtn.addEventListener("click", async () => {
            await runCopyAhaDuelSignalConsensusAction(copySignalConsensusBtn);
          });
          actionsEl.appendChild(copySignalConsensusBtn);
          const copySignalProtocolBtn = document.createElement("button");
          copySignalProtocolBtn.type = "button";
          copySignalProtocolBtn.className = "secondary";
          copySignalProtocolBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_PROTOCOL_LABEL;
          copySignalProtocolBtn.addEventListener("click", async () => {
            await runCopyAhaDuelSignalProtocolAction(copySignalProtocolBtn);
          });
          actionsEl.appendChild(copySignalProtocolBtn);
          const copySignalCommandBtn = document.createElement("button");
          copySignalCommandBtn.type = "button";
          copySignalCommandBtn.className = "secondary";
          copySignalCommandBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_COMMAND_LABEL;
          copySignalCommandBtn.addEventListener("click", async () => {
            await runCopyAhaDuelSignalCommandAction(copySignalCommandBtn);
          });
          actionsEl.appendChild(copySignalCommandBtn);
          const copySignalScriptBtn = document.createElement("button");
          copySignalScriptBtn.type = "button";
          copySignalScriptBtn.className = "secondary";
          copySignalScriptBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_SCRIPT_LABEL;
          copySignalScriptBtn.addEventListener("click", async () => {
            await runCopyAhaDuelSignalScriptAction(copySignalScriptBtn);
          });
          actionsEl.appendChild(copySignalScriptBtn);
          const copySignalChecklistBtn = document.createElement("button");
          copySignalChecklistBtn.type = "button";
          copySignalChecklistBtn.className = "secondary";
          copySignalChecklistBtn.textContent = QUEUE_NUDGE_COPY_SIGNAL_CHECKLIST_LABEL;
          copySignalChecklistBtn.addEventListener("click", async () => {
            await runCopyAhaDuelSignalChecklistAction(copySignalChecklistBtn);
          });
          actionsEl.appendChild(copySignalChecklistBtn);
          const downloadSignalHandoffBtn = document.createElement("button");
          downloadSignalHandoffBtn.type = "button";
          downloadSignalHandoffBtn.className = "secondary";
          downloadSignalHandoffBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_HANDOFF_LABEL;
          downloadSignalHandoffBtn.addEventListener("click", async () => {
            await runDownloadAhaDuelSignalHandoffAction(downloadSignalHandoffBtn);
          });
          actionsEl.appendChild(downloadSignalHandoffBtn);
          const downloadSignalConsensusBtn = document.createElement("button");
          downloadSignalConsensusBtn.type = "button";
          downloadSignalConsensusBtn.className = "secondary";
          downloadSignalConsensusBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_CONSENSUS_LABEL;
          downloadSignalConsensusBtn.addEventListener("click", async () => {
            await runDownloadAhaDuelSignalConsensusAction(downloadSignalConsensusBtn);
          });
          actionsEl.appendChild(downloadSignalConsensusBtn);
          const downloadSignalProtocolBtn = document.createElement("button");
          downloadSignalProtocolBtn.type = "button";
          downloadSignalProtocolBtn.className = "secondary";
          downloadSignalProtocolBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_PROTOCOL_LABEL;
          downloadSignalProtocolBtn.addEventListener("click", async () => {
            await runDownloadAhaDuelSignalProtocolAction(downloadSignalProtocolBtn);
          });
          actionsEl.appendChild(downloadSignalProtocolBtn);
          const downloadSignalCommandBtn = document.createElement("button");
          downloadSignalCommandBtn.type = "button";
          downloadSignalCommandBtn.className = "secondary";
          downloadSignalCommandBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_COMMAND_LABEL;
          downloadSignalCommandBtn.addEventListener("click", async () => {
            await runDownloadAhaDuelSignalCommandAction(downloadSignalCommandBtn);
          });
          actionsEl.appendChild(downloadSignalCommandBtn);
          const downloadSignalScriptBtn = document.createElement("button");
          downloadSignalScriptBtn.type = "button";
          downloadSignalScriptBtn.className = "secondary";
          downloadSignalScriptBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_SCRIPT_LABEL;
          downloadSignalScriptBtn.addEventListener("click", async () => {
            await runDownloadAhaDuelSignalScriptAction(downloadSignalScriptBtn);
          });
          actionsEl.appendChild(downloadSignalScriptBtn);
          const downloadSignalChecklistBtn = document.createElement("button");
          downloadSignalChecklistBtn.type = "button";
          downloadSignalChecklistBtn.className = "secondary";
          downloadSignalChecklistBtn.textContent = QUEUE_NUDGE_DOWNLOAD_SIGNAL_CHECKLIST_LABEL;
          downloadSignalChecklistBtn.addEventListener("click", async () => {
            await runDownloadAhaDuelSignalChecklistAction(downloadSignalChecklistBtn);
          });
          actionsEl.appendChild(downloadSignalChecklistBtn);
          const copyDuelSnapshotBtn = document.createElement("button");
          copyDuelSnapshotBtn.type = "button";
          copyDuelSnapshotBtn.className = "secondary";
          copyDuelSnapshotBtn.textContent = QUEUE_NUDGE_COPY_DUEL_SNAPSHOT_LABEL;
          copyDuelSnapshotBtn.addEventListener("click", async () => {
            await runCopyAhaDuelSnapshotAction(copyDuelSnapshotBtn);
          });
          actionsEl.appendChild(copyDuelSnapshotBtn);
          const copyDuelPlanBtn = document.createElement("button");
          copyDuelPlanBtn.type = "button";
          copyDuelPlanBtn.className = "secondary";
          copyDuelPlanBtn.textContent = QUEUE_NUDGE_COPY_DUEL_PLAN_LABEL;
          copyDuelPlanBtn.addEventListener("click", async () => {
            await runCopyAhaDuelPlanAction(copyDuelPlanBtn);
          });
          actionsEl.appendChild(copyDuelPlanBtn);
          const copyBriefBtn = document.createElement("button");
          copyBriefBtn.type = "button";
          copyBriefBtn.className = "secondary";
          copyBriefBtn.textContent = QUEUE_NUDGE_COPY_BRIEF_LABEL;
          copyBriefBtn.addEventListener("click", async () => {
            await runCopyAhaDecisionBriefAction(copyBriefBtn);
          });
          actionsEl.appendChild(copyBriefBtn);
          const downloadBriefBtn = document.createElement("button");
          downloadBriefBtn.type = "button";
          downloadBriefBtn.className = "secondary";
          downloadBriefBtn.textContent = QUEUE_NUDGE_DOWNLOAD_BRIEF_LABEL;
          downloadBriefBtn.addEventListener("click", async () => {
            await runDownloadAhaDecisionBriefAction(downloadBriefBtn);
          });
          actionsEl.appendChild(downloadBriefBtn);
          const toggleDuelBtn = document.createElement("button");
          toggleDuelBtn.type = "button";
          toggleDuelBtn.className = "secondary";
          toggleDuelBtn.textContent = QUEUE_NUDGE_TOGGLE_DUEL_LABEL;
          toggleDuelBtn.addEventListener("click", async () => {
            await runToggleAhaDuelPairAction(toggleDuelBtn);
          });
          actionsEl.appendChild(toggleDuelBtn);
          const runDuelBtn = document.createElement("button");
          runDuelBtn.type = "button";
          runDuelBtn.className = "secondary";
          runDuelBtn.textContent = QUEUE_NUDGE_RUN_DUEL_LABEL;
          runDuelBtn.addEventListener("click", async () => {
            await runDuelPairPrimaryActions(runDuelBtn);
          });
          actionsEl.appendChild(runDuelBtn);
          const runDuelCallBtn = document.createElement("button");
          runDuelCallBtn.type = "button";
          runDuelCallBtn.className = "secondary";
          runDuelCallBtn.textContent = QUEUE_NUDGE_RUN_DUEL_CALL_LABEL;
          runDuelCallBtn.addEventListener("click", async () => {
            await runDuelCallAction(runDuelCallBtn);
          });
          actionsEl.appendChild(runDuelCallBtn);
          const runSignalHandoffBtn = document.createElement("button");
          runSignalHandoffBtn.type = "button";
          runSignalHandoffBtn.className = "secondary";
          runSignalHandoffBtn.textContent = QUEUE_NUDGE_RUN_SIGNAL_HANDOFF_LABEL;
          runSignalHandoffBtn.addEventListener("click", async () => {
            await runDuelSignalHandoffAction(runSignalHandoffBtn);
          });
          actionsEl.appendChild(runSignalHandoffBtn);
          const runSignalConsensusBtn = document.createElement("button");
          runSignalConsensusBtn.type = "button";
          runSignalConsensusBtn.className = "secondary";
          runSignalConsensusBtn.textContent = QUEUE_NUDGE_RUN_SIGNAL_CONSENSUS_LABEL;
          runSignalConsensusBtn.addEventListener("click", async () => {
            await runDuelSignalConsensusAction(runSignalConsensusBtn);
          });
          actionsEl.appendChild(runSignalConsensusBtn);
          const runSignalProtocolBtn = document.createElement("button");
          runSignalProtocolBtn.type = "button";
          runSignalProtocolBtn.className = "secondary";
          runSignalProtocolBtn.textContent = QUEUE_NUDGE_RUN_SIGNAL_PROTOCOL_LABEL;
          runSignalProtocolBtn.addEventListener("click", async () => {
            await runDuelSignalProtocolAction(runSignalProtocolBtn);
          });
          actionsEl.appendChild(runSignalProtocolBtn);
          const runSignalCommandBtn = document.createElement("button");
          runSignalCommandBtn.type = "button";
          runSignalCommandBtn.className = "secondary";
          runSignalCommandBtn.textContent = QUEUE_NUDGE_RUN_SIGNAL_COMMAND_LABEL;
          runSignalCommandBtn.addEventListener("click", async () => {
            await runDuelSignalCommandAction(runSignalCommandBtn);
          });
          actionsEl.appendChild(runSignalCommandBtn);
          const runSignalScriptBtn = document.createElement("button");
          runSignalScriptBtn.type = "button";
          runSignalScriptBtn.className = "secondary";
          runSignalScriptBtn.textContent = QUEUE_NUDGE_RUN_SIGNAL_SCRIPT_LABEL;
          runSignalScriptBtn.addEventListener("click", async () => {
            await runDuelSignalScriptAction(runSignalScriptBtn);
          });
          actionsEl.appendChild(runSignalScriptBtn);
        }
        if (String(top?.id) !== String(item?.id)) {
          const leadBtn = document.createElement("button");
          leadBtn.type = "button";
          leadBtn.className = "secondary";
          leadBtn.textContent = DETAIL_STORY_OPEN_LEAD_PREFIX + " #" + top.id;
          leadBtn.addEventListener("click", async () => {
            await runActionWithFeedback(
              {
                id: "detail_story_open_lead_" + top.id,
                label: DETAIL_STORY_OPEN_LEAD_PREFIX + " #" + top.id,
                action: async () => {
                  await selectItem(top.id);
                  focusQueueItemCard(top.id, { revealCollapsed: true });
                },
              },
              { button: leadBtn },
            );
          });
          actionsEl.appendChild(leadBtn);
        }
        if (rival && String(rival.id) !== String(item.id)) {
          const rivalBtn = document.createElement("button");
          rivalBtn.type = "button";
          rivalBtn.className = "secondary";
          rivalBtn.textContent = QUEUE_NUDGE_OPEN_RIVAL_LABEL + " #" + rival.id;
          rivalBtn.addEventListener("click", async () => {
            await runActionWithFeedback(
              {
                id: "detail_story_open_rival_" + rival.id,
                label: QUEUE_NUDGE_OPEN_RIVAL_LABEL + " #" + rival.id,
                action: async () => {
                  await selectItem(rival.id);
                  focusQueueItemCard(rival.id, { revealCollapsed: true });
                },
              },
              { button: rivalBtn },
            );
          });
          actionsEl.appendChild(rivalBtn);
          const runRivalBtn = document.createElement("button");
          runRivalBtn.type = "button";
          runRivalBtn.className = "secondary";
          runRivalBtn.textContent = QUEUE_NUDGE_RUN_RIVAL_LABEL;
          runRivalBtn.addEventListener("click", async () => {
            await runRivalAhaPrimaryAction(runRivalBtn);
          });
          actionsEl.appendChild(runRivalBtn);
        }
        storyHost.appendChild(actionsEl);
      }

      function renderAdvancedHintCard() {
        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = \`
          <h3>Advanced Panels Hidden</h3>
          <div class="muted">当前为 Focus Mode。版本对比、意图编辑、工件编辑与原始 JSON 已收起。</div>
          <div class="editor-row">
            <button id="enableAdvancedPanelsBtn" type="button">Enable Advanced Panels</button>
          </div>
        \`;
        const enableBtn = card.querySelector("#enableAdvancedPanelsBtn");
        enableBtn?.addEventListener("click", () => {
          setDetailAdvancedEnabled(true);
        });
        card.id = "detail-advanced-hint";
        detailEl.appendChild(card);
        addDetailSectionNav("Advanced", "detail-advanced-hint");
      }

      function renderDetailFromPayload(detail) {
        selectedDetail = detail;
        clearDetailSectionNav();
        detailEl.innerHTML = "";
        const recoveryPriority = recoveryPriorityMeta(detail.failure || null);
        const recoveryChipHtml = recoveryPriority
          ? '<span class="status-chip ' + recoveryPriority.tone + '">' + recoveryPriority.shortLabel + "</span>"
          : "";

        const wrap = document.createElement("div");
        const heroImpactMeta = impactMetaForItem(detail.item);
        const heroUrgencyMeta = urgencyMetaForItem(detail.item);
        const heroAhaRank = ahaRankFromMap(detail.item) || ahaRankForItem(detail.item);
        const heroAhaDelta = ahaRankDeltaFromMap(detail.item, heroAhaRank);
        const heroAhaDeltaLabel = heroAhaDelta ? " " + heroAhaDelta.label : "";
        const heroAhaRankTone =
          heroAhaRank?.rank === 1 ? " rank-top" : heroAhaRank?.rank && heroAhaRank.rank <= 3 ? " rank-strong" : "";
        const heroAhaRankHtml = heroAhaRank
          ? '<span class="aha-rank-chip' + heroAhaRankTone + '">Aha Rank #' + heroAhaRank.rank + "/" + heroAhaRank.total + heroAhaDeltaLabel + "</span>"
          : '<span class="aha-rank-chip">Aha Rank —</span>';
        const heroDuelRoleHtml = ahaDuelRoleHtml(detail.item);
        const heroScoreMeter = scoreMeterHtml(detail.item.match_score);
        const heroFreshnessChip = freshnessChipHtml(detail.item.updated_at);
        const heroAhaIndex = ahaIndexHtml(detail.item);
        wrap.innerHTML = \`
          <div class="item-card detail-hero \${detailHeroTone(detail.item.status)} priority-\${priorityTone(detail.item.priority)}">
            <div class="item-head">
              <div class="status-cluster">
                <span class="status status-\${statusTone(detail.item.status)}">\${detail.item.status}</span>
                \${recoveryChipHtml}
              </div>
              <span class="muted">\${detail.item.priority || "N/A"} · \${detail.item.match_score ?? "—"}</span>
            </div>
            <div class="hero-kicker">\${detailMomentumLabel(detail.item.status)}</div>
            <div class="insight-pills">
              <span class="insight-pill \${heroImpactMeta.tone}">\${heroImpactMeta.label}</span>
              <span class="insight-pill \${heroUrgencyMeta.tone}">\${heroUrgencyMeta.label}</span>
              \${heroAhaRankHtml}
              \${heroDuelRoleHtml}
            </div>
            \${heroScoreMeter}
            \${heroFreshnessChip}
            \${heroAhaIndex}
            <div id="detailHeroStory" class="hero-story"></div>
            <div class="intent">\${detail.item.intent_text}</div>
            <div>\${detail.item.title || detail.item.url}</div>
            <div class="muted">\${detail.item.domain || ""}</div>
            <div id="detailHeroActions" class="hero-actions"></div>
            <div id="detailActionBanner" class="muted action-feedback">Ready.</div>
          </div>
        \`;
        detailEl.appendChild(wrap);
        const detailOps = detailOpsFor(detail.item);
        const heroActionIds = renderDetailHeroActions(detail, wrap, detailOps);
        renderDetailHeroStory(detail.item, wrap);
        renderDetailAha(detail);
        renderDetailQuickActions(detail, detailOps, heroActionIds);
        renderFailureGuidance(detail, heroActionIds, detailOps);
        renderExportPanel(detail, heroActionIds, detailOps);

        if (detailAdvancedEnabled) {
          renderArtifactVersionViewer(detail);
          renderIntentEditor(detail);
          renderArtifactEditor(detail);
          renderRawDebugPanel(detail);
        } else {
          renderAdvancedHintCard();
        }
        syncDetailModeChips();
      }

      async function selectItem(id) {
        selectedId = id;
        updateSelectionHint();
        if (allItems.length) {
          renderInbox(allItems);
        }
        detailEl.innerHTML = '<div class="item-card"><div class="muted">Loading detail…</div></div>';
        let detail;
        try {
          detail = await request("/items/" + id + "?include_history=true");
        } catch (err) {
          detailEl.innerHTML = '<div class="empty">Failed to load detail. Try refresh.</div>';
          throw err;
        }
        renderDetailFromPayload(detail);
        updateSelectionHint(detail?.item || null);
      }

      function renderFailureGuidance(detail, heroActionIds = new Set(), detailOps = []) {
        const failure = detail.failure || null;
        if (!failure) return;

        const card = document.createElement("div");
        card.className = "item-card";
        const retryAttempts = Number(failure.retry_attempts ?? 0);
        const retryLimit = Number(failure.retry_limit ?? 0);
        const retryable = failure.retryable !== false;
        const remaining = retryLimit > 0 ? Math.max(retryLimit - retryAttempts, 0) : null;
        const recoveryPriority = recoveryPriorityMeta(failure) || {
          tone: "normal",
          label: "Recovery Priority: Recoverable",
          note: "Safe to retry with playbook steps.",
        };

        let actionGuide = "You can retry processing from Inbox.";
        if (failure.failed_step === "extract") {
          actionGuide = "Extraction failed. Verify URL accessibility/content length, then retry.";
        } else if (failure.failed_step === "pipeline") {
          actionGuide = "Pipeline failed. Review intent and content quality, then retry/regenerate.";
        } else if (failure.failed_step === "export") {
          actionGuide = "Export failed. Try md+caption export first, then retry png.";
        }
        if (!retryable) {
          actionGuide = "Retry is blocked. Edit intent/artifact first, then run regenerate if needed.";
        }

        card.innerHTML = \`
          <h3>Failure Guidance</h3>
          <div class="muted">step: \${failure.failed_step || "unknown"} · code: \${failure.error_code || "UNKNOWN"}</div>
          <div class="hint">\${actionGuide}</div>
          <div class="failure-priority \${recoveryPriority.tone}">\${recoveryPriority.label} · \${recoveryPriority.note}</div>
          <div class="muted">retry: \${retryAttempts}/\${retryLimit || "N/A"} used\${remaining == null ? "" : ", remaining: " + remaining}</div>
          <div class="coach-card \${recoveryPriority.tone === "blocked" ? "blocked" : ""}">
            <h4>Recovery Playbook</h4>
            <ul class="coach-list" id="failureCoachList"></ul>
            <div class="actions" id="failureCoachActions"></div>
          </div>
        \`;
        const coachListEl = card.querySelector("#failureCoachList");
        const coachActionsEl = card.querySelector("#failureCoachActions");
        const actionMap = new Map(detailOps.map((op) => [op.id, op]));
        const steps = [];
        let primaryAction = null;
        if (failure.failed_step === "extract") {
          steps.push("Check whether the source URL is reachable and has readable content.");
          steps.push("If content is dynamic, try another source URL or capture again.");
          steps.push("Retry after confirming network accessibility.");
          if (retryable) {
            primaryAction = actionMap.get("retry") || { id: "retry", label: "Retry Extraction", action: () => processItem(detail.item.id, "RETRY") };
          }
        } else if (failure.failed_step === "pipeline") {
          steps.push("Refine intent so the expected output is concrete and narrow.");
          steps.push("Use Regenerate to re-run the structured pipeline.");
          steps.push("If repeatedly failing, edit artifact in Advanced mode.");
          if (retryable) {
            primaryAction = actionMap.get("retry") || { id: "retry", label: "Retry Pipeline", action: () => processItem(detail.item.id, "RETRY") };
          }
        } else if (failure.failed_step === "export") {
          steps.push("Keep md/caption output available while PNG rendering recovers.");
          steps.push("Re-export to regenerate missing files.");
          steps.push("Open latest export artifact to verify render output.");
          if (retryable) {
            primaryAction = actionMap.get("export") || { id: "export", label: "Retry Export", action: () => exportItem(detail.item.id) };
          }
        } else {
          steps.push("Inspect failure code and message for immediate cause.");
          steps.push("Try retry/regenerate depending on current item status.");
        }
        if (!retryable) {
          steps.push("Retry is blocked. Switch to Advanced Panels and edit intent/artifacts before rerun.");
          primaryAction = { id: "open_advanced", label: "Open Advanced Panels", action: () => setDetailAdvancedEnabled(true) };
        }
        for (const step of steps) {
          const li = document.createElement("li");
          li.textContent = step;
          coachListEl.appendChild(li);
        }
        if (primaryAction && !heroActionIds.has(primaryAction.id)) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = primaryAction.label;
          if (primaryAction.id === "open_advanced") {
            btn.classList.add("primary");
          }
          btn.addEventListener("click", async () => {
            await runActionWithFeedback(primaryAction, { button: btn });
          });
          coachActionsEl.appendChild(btn);
        } else if (primaryAction) {
          coachActionsEl.innerHTML = '<span class="muted">Primary action is already pinned in header: ' + primaryAction.label + ".</span>";
        }
        appendDetailSection("detail-failure", "Failure Guidance", "失败原因与恢复建议", card, true);
      }

      function renderExportPanel(detail, heroActionIds = new Set(), detailOps = []) {
        const exportHistory = detail.artifact_history?.export ?? [];
        const panel = document.createElement("div");
        panel.className = "item-card";

        const status = detail.item.status;
        const failure = detail.failure || null;
        const latestExport = exportHistory[0] ?? null;
        const latestFiles = Array.isArray(latestExport?.payload?.files) ? latestExport.payload.files : [];
        const latestFirstFile = latestFiles[0] ?? null;
        const latestTheme = latestExport?.payload?.options?.theme || "AUTO";
        const formatCounts = latestFiles.reduce((acc, file) => {
          const type = String(file?.type || "unknown").toUpperCase();
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {});
        const formatPillsHtml = Object.entries(formatCounts)
          .map(([type, count]) => '<span class="file-pill">' + type + " × " + count + "</span>")
          .join("");

        let statusHint = "";
        if (status === "FAILED_EXPORT") {
          statusHint = "Export failed. Try re-export with md/caption fallback first, then retry png.";
        } else if (status === "SHIPPED") {
          statusHint = "Item is shipped. You can re-export to get latest files.";
        } else if (status === "READY") {
          statusHint = "Item is ready to export.";
        }
        const statusHintHtml = statusHint ? '<div class="hint">' + statusHint + "</div>" : "";

        panel.innerHTML = \`
          <h3>Export Records</h3>
          <div class="muted">Current status: \${status}</div>
          \${statusHintHtml}
          <div class="coach-card">
            <h4>Shipping Playbook</h4>
            <ul class="coach-list" id="exportCoachList"></ul>
            <div class="actions" id="exportCoachActions"></div>
          </div>
          <div class="export-snapshot">
            <div class="muted">Export Snapshot</div>
            <div class="export-kpi-grid">
              <div class="export-kpi">
                <div class="label">Total Exports</div>
                <div class="value">\${exportHistory.length}</div>
              </div>
              <div class="export-kpi">
                <div class="label">Latest Version</div>
                <div class="value">\${latestExport ? "v" + latestExport.version : "—"}</div>
              </div>
              <div class="export-kpi">
                <div class="label">Latest Theme</div>
                <div class="value">\${latestTheme}</div>
              </div>
              <div class="export-kpi">
                <div class="label">Latest Created</div>
                <div class="value">\${latestExport?.created_at || "—"}</div>
              </div>
            </div>
            <div class="file-pills">\${formatPillsHtml || '<span class="muted">No latest files yet.</span>'}</div>
            <div class="editor-row">
              <button id="copyLatestPathsBtn" type="button" \${latestFiles.length ? "" : "disabled"}>Copy Latest Paths</button>
              <button id="openLatestFileBtn" type="button" \${latestFirstFile ? "" : "disabled"}>Open Latest File</button>
            </div>
          </div>
          <div id="exportRecordList"></div>
          <div id="exportFailureHint"></div>
        \`;

        const listEl = panel.querySelector("#exportRecordList");
        const exportCoachListEl = panel.querySelector("#exportCoachList");
        const exportCoachActionsEl = panel.querySelector("#exportCoachActions");
        const actionMap = new Map(detailOps.map((op) => [op.id, op]));
        const copyLatestBtn = panel.querySelector("#copyLatestPathsBtn");
        const openLatestBtn = panel.querySelector("#openLatestFileBtn");
        const exportSteps = [];
        let exportPrimaryAction = null;
        if (status === "READY") {
          exportSteps.push("Run export now to produce shareable PNG/MD/CAPTION assets.");
          exportSteps.push("Review generated files and copy paths for downstream sharing.");
          exportPrimaryAction = actionMap.get("export") || { id: "export", label: "Export Now", action: () => exportItem(detail.item.id) };
        } else if (status === "FAILED_EXPORT") {
          exportSteps.push("Retry export to regenerate missing artifacts.");
          exportSteps.push("Open latest file to inspect renderer output differences.");
          exportPrimaryAction = actionMap.get("export") || { id: "export", label: "Retry Export", action: () => exportItem(detail.item.id) };
        } else if (status === "SHIPPED") {
          exportSteps.push("Use latest file link for immediate sharing.");
          exportSteps.push("Re-export if intent/artifacts changed and you need a fresh card.");
          exportPrimaryAction = actionMap.get("reexport") || { id: "reexport", label: "Re-export", action: () => exportItem(detail.item.id) };
        } else {
          exportSteps.push("Generate artifacts first, then export from READY state.");
          exportSteps.push("Use Quick Actions to process/regenerate before shipping.");
        }
        for (const step of exportSteps) {
          const li = document.createElement("li");
          li.textContent = step;
          exportCoachListEl.appendChild(li);
        }
        if (exportPrimaryAction && !heroActionIds.has(exportPrimaryAction.id)) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = exportPrimaryAction.label;
          btn.addEventListener("click", async () => {
            await runActionWithFeedback(exportPrimaryAction, { button: btn });
          });
          exportCoachActionsEl.appendChild(btn);
        } else if (exportPrimaryAction) {
          exportCoachActionsEl.innerHTML = '<span class="muted">Primary shipping action is already pinned in header: ' + exportPrimaryAction.label + ".</span>";
        }
        if (copyLatestBtn) {
          copyLatestBtn.addEventListener("click", async () => {
            await copyTextToClipboard(
              latestFiles.map((file) => String(file.path || "")).filter(Boolean).join("\\n"),
              { success: "Copied latest export file paths.", failure: "Copy latest paths failed." },
            );
          });
        }
        if (openLatestBtn) {
          openLatestBtn.addEventListener("click", () => {
            if (!latestFirstFile?.path) return;
            const fileHref = "/" + String(latestFirstFile.path).replace(/^\\/+/, "");
            window.open(encodeURI(fileHref), "_blank", "noopener,noreferrer");
          });
        }

        if (!exportHistory.length) {
          listEl.innerHTML = '<div class="empty">No export artifacts yet.</div>';
        } else {
          for (const exp of exportHistory) {
            const card = document.createElement("div");
            card.className = "item-card export-row";
            const files = exp?.payload?.files ?? [];
            card.innerHTML = \`
              <div class="item-head">
                <span class="status status-default">export v\${exp.version}</span>
                <span class="muted">\${exp.created_by} · \${exp.created_at}</span>
              </div>
              <div class="muted">renderer: \${exp?.payload?.renderer?.name || "N/A"}</div>
              <div class="muted">export_key: \${exp?.payload?.export_key || "N/A"}</div>
              <div class="file-list"></div>
            \`;
            const fileListEl = card.querySelector(".file-list");
            for (const file of files) {
              const row = document.createElement("div");
              row.className = "file-row";
              const fileHref = "/" + String(file.path || "").replace(/^\\/+/, "");
              row.innerHTML = \`
                <span class="status status-default">\${String(file.type || "file").toUpperCase()}</span>
                <span class="file-path">\${file.path}</span>
                <button type="button">Copy Path</button>
                <a href="\${encodeURI(fileHref)}" target="_blank" rel="noopener noreferrer">Open</a>
              \`;
              const copyBtn = row.querySelector("button");
              copyBtn.addEventListener("click", async () => {
                await copyTextToClipboard(file.path, {
                  success: "Copied path: " + file.path,
                  failure: "Copy failed for path: " + file.path,
                });
              });
              fileListEl.appendChild(row);
            }
            listEl.appendChild(card);
          }
        }

        const failureEl = panel.querySelector("#exportFailureHint");
        if (failure?.failed_step === "export") {
          failureEl.innerHTML = \`
            <div class="hint">
              Export failure code: <b>\${failure.error_code || "UNKNOWN"}</b><br/>
              Message: \${failure.message || "No details"}
            </div>
          \`;
        }

        appendDetailSection("detail-export", "Export Records", "导出快照、历史记录与文件快捷操作", panel, true);
      }

      function renderArtifactVersionViewer(detail) {
        const historyMap = detail.artifact_history || {};
        const artifactTypes = Object.keys(historyMap).filter((type) => Array.isArray(historyMap[type]) && historyMap[type].length > 0);
        if (!artifactTypes.length) return;

        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = \`
          <h3>Version Viewer</h3>
          <div class="editor-row">
            <label for="versionTypeSelect">Artifact:</label>
            <select id="versionTypeSelect"></select>
            <label for="baseVersionSelect">Base:</label>
            <select id="baseVersionSelect"></select>
            <label for="targetVersionSelect">Target:</label>
            <select id="targetVersionSelect"></select>
            <button id="loadVersionBtn" type="button">Compare Versions</button>
            <button id="copyDiffBtn" type="button" disabled>Copy Diff Summary</button>
            <button id="exportDiffBtn" type="button" disabled>Export Diff JSON</button>
          </div>
          <div class="diff" id="versionDiffSummary">Select base/target versions to compare.</div>
          <div class="diff-grid">
            <div class="diff-column">
              <h4>Changed Paths</h4>
              <ul id="changedPathsList"><li>—</li></ul>
            </div>
            <div class="diff-column">
              <h4>Added Paths</h4>
              <ul id="addedPathsList"><li>—</li></ul>
            </div>
            <div class="diff-column">
              <h4>Removed Paths</h4>
              <ul id="removedPathsList"><li>—</li></ul>
            </div>
          </div>
          <div class="editor-row">
            <div style="flex:1;">
              <div class="muted">Base payload</div>
              <pre id="baseArtifactPreview"></pre>
            </div>
            <div style="flex:1;">
              <div class="muted">Target payload</div>
              <pre id="targetArtifactPreview"></pre>
            </div>
          </div>
        \`;

        const typeSelect = card.querySelector("#versionTypeSelect");
        const baseVersionSelect = card.querySelector("#baseVersionSelect");
        const targetVersionSelect = card.querySelector("#targetVersionSelect");
        const loadBtn = card.querySelector("#loadVersionBtn");
        const copyDiffBtn = card.querySelector("#copyDiffBtn");
        const exportDiffBtn = card.querySelector("#exportDiffBtn");
        const basePreviewEl = card.querySelector("#baseArtifactPreview");
        const targetPreviewEl = card.querySelector("#targetArtifactPreview");
        const diffEl = card.querySelector("#versionDiffSummary");
        const changedListEl = card.querySelector("#changedPathsList");
        const addedListEl = card.querySelector("#addedPathsList");
        const removedListEl = card.querySelector("#removedPathsList");
        let lastCompareResult = null;

        function setDiffActionButtons(enabled) {
          copyDiffBtn.disabled = !enabled;
          exportDiffBtn.disabled = !enabled;
        }

        for (const type of artifactTypes) {
          const opt = document.createElement("option");
          opt.value = type;
          opt.textContent = type;
          typeSelect.appendChild(opt);
        }

        function renderPathList(targetEl, paths) {
          targetEl.innerHTML = "";
          if (!paths.length) {
            targetEl.innerHTML = "<li>—</li>";
            return;
          }
          for (const path of paths.slice(0, 20)) {
            const li = document.createElement("li");
            li.textContent = path;
            targetEl.appendChild(li);
          }
          if (paths.length > 20) {
            const li = document.createElement("li");
            li.textContent = "... +" + (paths.length - 20) + " more";
            targetEl.appendChild(li);
          }
        }

        function fillVersionOptions() {
          const selectedType = typeSelect.value;
          baseVersionSelect.innerHTML = "";
          targetVersionSelect.innerHTML = "";
          const versions = historyMap[selectedType] || [];
          for (const row of versions) {
            const opt = document.createElement("option");
            opt.value = String(row.version);
            opt.textContent = "v" + row.version + " · " + row.created_by;
            baseVersionSelect.appendChild(opt.cloneNode(true));
            targetVersionSelect.appendChild(opt);
          }
          if (versions.length > 0) {
            targetVersionSelect.value = String(versions[0].version);
            baseVersionSelect.value = String(versions[Math.min(1, versions.length - 1)].version);
            basePreviewEl.textContent = "{}";
            targetPreviewEl.textContent = "{}";
            renderPathList(changedListEl, []);
            renderPathList(addedListEl, []);
            renderPathList(removedListEl, []);
            setDiffActionButtons(false);
            lastCompareResult = null;
          } else {
            basePreviewEl.textContent = "{}";
            targetPreviewEl.textContent = "{}";
            setDiffActionButtons(false);
            lastCompareResult = null;
          }
        }

        typeSelect.addEventListener("change", fillVersionOptions);
        fillVersionOptions();

        loadBtn.addEventListener("click", async () => {
          const type = typeSelect.value;
          const baseVersion = Number(baseVersionSelect.value);
          const targetVersion = Number(targetVersionSelect.value);
          if (!type || !baseVersion || !targetVersion) return;
          try {
            const baseQuery = encodeURIComponent(JSON.stringify({ [type]: baseVersion }));
            const targetQuery = encodeURIComponent(JSON.stringify({ [type]: targetVersion }));
            const [baseDetail, targetDetail] = await Promise.all([
              request("/items/" + detail.item.id + "?artifact_versions=" + baseQuery),
              request("/items/" + detail.item.id + "?artifact_versions=" + targetQuery),
            ]);
            const baseArtifact = baseDetail.artifacts?.[type] ?? null;
            const targetArtifact = targetDetail.artifacts?.[type] ?? null;
            basePreviewEl.textContent = JSON.stringify(baseArtifact, null, 2);
            targetPreviewEl.textContent = JSON.stringify(targetArtifact, null, 2);

            if (baseVersion === targetVersion) {
              diffEl.textContent = "No payload difference: base and target versions are identical.";
              renderPathList(changedListEl, []);
              renderPathList(addedListEl, []);
              renderPathList(removedListEl, []);
              lastCompareResult = {
                item_id: detail.item.id,
                artifact_type: type,
                base_version: baseVersion,
                target_version: targetVersion,
                summary: {
                  changed_paths: [],
                  added_paths: [],
                  removed_paths: [],
                  changed_line_count: 0,
                  compared_line_count: 0
                }
              };
              setDiffActionButtons(true);
            } else {
              const compare = await request(
                "/items/" +
                  detail.item.id +
                  "/artifacts/" +
                  type +
                  "/compare?base_version=" +
                  baseVersion +
                  "&target_version=" +
                  targetVersion,
              );
              const changedPaths = compare?.summary?.changed_paths ?? [];
              const addedPaths = compare?.summary?.added_paths ?? [];
              const removedPaths = compare?.summary?.removed_paths ?? [];
              renderPathList(changedListEl, changedPaths);
              renderPathList(addedListEl, addedPaths);
              renderPathList(removedListEl, removedPaths);
              diffEl.textContent =
                "Diff summary for v" + baseVersion + " -> v" + targetVersion + "\\n" +
                "changed_lines=" + (compare?.summary?.changed_line_count ?? "N/A") +
                " / compared_lines=" + (compare?.summary?.compared_line_count ?? "N/A") + "\\n" +
                "changed_paths=" + changedPaths.length +
                ", added_paths=" + addedPaths.length +
                ", removed_paths=" + removedPaths.length;
              lastCompareResult = compare;
              setDiffActionButtons(true);
            }
          } catch (err) {
            basePreviewEl.textContent = "Load failed: " + String(err);
            targetPreviewEl.textContent = "Load failed: " + String(err);
            renderPathList(changedListEl, []);
            renderPathList(addedListEl, []);
            renderPathList(removedListEl, []);
            diffEl.textContent = "Diff unavailable due to load failure.";
            setDiffActionButtons(false);
            lastCompareResult = null;
          }
        });

        copyDiffBtn.addEventListener("click", async () => {
          if (!lastCompareResult) return;
          await copyTextToClipboard(JSON.stringify(lastCompareResult, null, 2), {
            success: "Copied diff summary to clipboard.",
            failure: "Copy diff summary failed.",
          });
        });

        exportDiffBtn.addEventListener("click", () => {
          if (!lastCompareResult) return;
          const payload = JSON.stringify(lastCompareResult, null, 2);
          const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const artifactType = lastCompareResult.artifact_type || "artifact";
          const baseVersion = lastCompareResult.base?.version ?? baseVersionSelect.value;
          const targetVersion = lastCompareResult.target?.version ?? targetVersionSelect.value;
          a.href = url;
          a.download = "diff_" + artifactType + "_v" + baseVersion + "_to_v" + targetVersion + ".json";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        });

        appendDetailSection("detail-versions", "Version Viewer", "比较不同 artifact 版本差异", card, false);
      }

      function renderIntentEditor(detail) {
        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = \`
          <h3>Edit Intent</h3>
          <textarea id="intentEditor">\${detail.item.intent_text || ""}</textarea>
          <div class="editor-row">
            <button id="saveIntentBtn" type="button">Save Intent</button>
            <button id="saveIntentRegenerateBtn" class="primary" type="button">Save + Regenerate</button>
          </div>
          <div id="intentEditorMsg" class="muted"></div>
        \`;

        const intentEl = card.querySelector("#intentEditor");
        const saveBtn = card.querySelector("#saveIntentBtn");
        const saveRegenBtn = card.querySelector("#saveIntentRegenerateBtn");
        const msgEl = card.querySelector("#intentEditorMsg");

        async function submitIntent(regenerate) {
          const intentText = intentEl.value.trim();
          if (!intentText) {
            msgEl.textContent = "Intent cannot be empty.";
            return;
          }
          try {
            await request("/items/" + detail.item.id + "/intent", {
              method: "POST",
              body: JSON.stringify({
                intent_text: intentText,
                regenerate
              })
            });
            msgEl.textContent = regenerate ? "Saved and queued for regenerate." : "Intent saved.";
            await loadItems();
            await selectItem(detail.item.id);
          } catch (err) {
            msgEl.textContent = "Intent update failed: " + String(err);
          }
        }

        saveBtn.addEventListener("click", () => {
          void submitIntent(false);
        });
        saveRegenBtn.addEventListener("click", () => {
          void submitIntent(true);
        });

        appendDetailSection("detail-intent-editor", "Edit Intent", "调整意图并按需触发重新生成", card, false);
      }

      function renderArtifactEditor(detail) {
        const editableTypes = ["summary", "score", "todos", "card"].filter((type) => detail.artifacts?.[type]);
        if (!editableTypes.length) {
          return;
        }

        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = \`
          <h3>Edit Artifact (Create User Version)</h3>
          <div class="editor-row">
            <label for="artifactTypeSelect">Artifact:</label>
            <select id="artifactTypeSelect"></select>
            <button id="loadHistoryBtn" type="button">Load History For Type</button>
          </div>
          <textarea id="artifactPayloadEditor"></textarea>
          <div class="editor-row">
            <button class="primary" id="saveArtifactBtn" type="button">Save User Version</button>
          </div>
          <div id="artifactEditorMsg" class="muted"></div>
          <pre id="artifactTypeHistory" style="display:none;"></pre>
        \`;

        const selectEl = card.querySelector("#artifactTypeSelect");
        const editorEl = card.querySelector("#artifactPayloadEditor");
        const saveBtn = card.querySelector("#saveArtifactBtn");
        const msgEl = card.querySelector("#artifactEditorMsg");
        const historyBtn = card.querySelector("#loadHistoryBtn");
        const historyEl = card.querySelector("#artifactTypeHistory");

        for (const type of editableTypes) {
          const option = document.createElement("option");
          option.value = type;
          option.textContent = type;
          selectEl.appendChild(option);
        }

        function renderCurrentPayload() {
          const type = selectEl.value;
          const payload = detail.artifacts?.[type]?.payload ?? {};
          editorEl.value = JSON.stringify(payload, null, 2);
          msgEl.textContent = "Editing latest payload. Saving will create created_by=user new version.";
          historyEl.style.display = "none";
        }

        selectEl.addEventListener("change", renderCurrentPayload);
        renderCurrentPayload();

        historyBtn.addEventListener("click", () => {
          const type = selectEl.value;
          const history = detail.artifact_history?.[type] ?? [];
          historyEl.textContent = JSON.stringify(history, null, 2);
          historyEl.style.display = "block";
        });

        saveBtn.addEventListener("click", async () => {
          const type = selectEl.value;
          let payload;
          try {
            payload = JSON.parse(editorEl.value);
          } catch (err) {
            msgEl.textContent = "Invalid JSON: " + String(err);
            return;
          }

          try {
            await request("/items/" + detail.item.id + "/artifacts/" + type, {
              method: "POST",
              body: JSON.stringify({
                payload,
                template_version: "user." + type + ".edit.v1"
              })
            });
            msgEl.textContent = "Saved. Reloading latest detail...";
            await loadItems();
            await selectItem(detail.item.id);
          } catch (err) {
            msgEl.textContent = "Save failed: " + String(err);
          }
        });

        appendDetailSection("detail-artifact-editor", "Edit Artifact", "创建用户版本并保留历史", card, false);
      }

      async function processItem(id, mode) {
        const requestId = crypto.randomUUID();
        const response = await request("/items/" + id + "/process", {
          method: "POST",
          body: JSON.stringify({
            process_request_id: requestId,
            mode
          }),
          headers: { "Idempotency-Key": requestId }
        });
        if (response?.idempotent_replay === true) {
          errorEl.textContent = "Process request replayed by idempotency key.";
        }
        await loadItems();
      }

      async function exportItem(id) {
        try {
          const requestId = crypto.randomUUID();
          const response = await request("/items/" + id + "/export", {
            method: "POST",
            body: JSON.stringify({
              export_key: "web_" + requestId,
              formats: ["png", "md", "caption"]
            }),
            headers: { "Idempotency-Key": requestId }
          });
          if (response?.idempotent_replay === true) {
            errorEl.textContent = "Export request replayed by idempotency key.";
          }
        } catch (err) {
          if (err?.code === "EXPORT_RENDER_FAILED") {
            const fallbackRequestId = crypto.randomUUID();
            const fallbackResponse = await request("/items/" + id + "/export", {
              method: "POST",
              body: JSON.stringify({
                export_key: "web_fallback_" + fallbackRequestId,
                formats: ["md", "caption"]
              }),
              headers: { "Idempotency-Key": fallbackRequestId }
            });
            errorEl.textContent =
              fallbackResponse?.idempotent_replay === true
                ? "PNG failed; fallback export replayed by idempotency key."
                : "PNG failed; fallback export (md+caption) succeeded.";
          } else {
            throw err;
          }
        }
        await loadItems();
        await selectItem(id);
      }

      async function archiveItem(id) {
        await request("/items/" + id + "/archive", {
          method: "POST",
          body: JSON.stringify({ reason: "USER_ARCHIVE" })
        });
        await loadItems();
      }

      async function unarchiveItem(id) {
        await request("/items/" + id + "/unarchive", {
          method: "POST",
          body: JSON.stringify({ regenerate: false })
        });
        await loadItems();
      }

      async function runRefreshQueueAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_refresh",
            label: "Refresh Queue",
            action: async () => {
              clearPreviewState();
              await loadItems();
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runResetControlsAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_reset_controls",
            label: "Reset Controls",
            action: async () => {
              clearPreviewState();
              applyControlDefaults();
              localStorage.removeItem(controlsStorageKey);
              localStorage.removeItem(recoveryRadarStorageKey);
              latestRecoverySummary = null;
              recoveryRadarHistory = [];
              activeRecoverySummaryId = null;
              renderRecoveryRadar(null);
              setAutoRefresh(false);
              await loadItems();
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runClearFiltersAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_clear_filters",
            label: "Clear Filters",
            action: async () => {
              clearListFilters();
              resetPreviewOffset();
              clearPreviewState();
              persistControls();
              await loadItems();
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runWorkerOnceQueueAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_run_worker_once",
            label: "Run Worker Once",
            action: async () => {
              await request("/system/worker/run-once", { method: "POST", body: JSON.stringify({}) });
              await loadItems();
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runToggleAutoRefreshAction() {
        await runActionWithFeedback(
          {
            id: "queue_toggle_auto_refresh",
            label: "Toggle Auto Refresh",
            action: async () => {
              autoRefreshToggle.checked = !Boolean(autoRefreshToggle.checked);
              persistControls();
              setAutoRefresh(Boolean(autoRefreshToggle.checked));
              errorEl.textContent = "Auto refresh: " + (autoRefreshToggle.checked ? "on." : "off.");
            },
          },
          { localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runFocusRecommendedQueueAction(itemId = queueNudgeState.itemId, button = null) {
        if (itemId == null) {
          const hint = "No recommended item available right now.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        await runActionWithFeedback(
          {
            id: "queue_focus_recommended_item",
            label: QUEUE_NUDGE_FOCUS_LABEL,
            action: async () => {
              await selectItem(itemId);
              const focused = focusQueueItemCard(itemId, { revealCollapsed: true });
              if (!focused) {
                errorEl.textContent = "Recommended item selected, but hidden by current list filters.";
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaSnapshotAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_snapshot",
            label: "Copy Aha Snapshot",
            action: async () => {
              const snapshotText = ahaSnapshotText();
              if (!snapshotText) {
                errorEl.textContent = "No Aha snapshot available yet.";
                return;
              }
              const copied = await copyTextToClipboard(snapshotText, {
                success: "Copied Aha snapshot.",
                failure: "Copy Aha snapshot failed.",
              });
              if (!copied) {
                throw new Error("Copy Aha snapshot failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaStoryAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_story",
            label: "Copy Aha Story",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const rankedPool = sortedAhaItems(pool);
              if (!rankedPool.length) {
                errorEl.textContent = "No Aha story available yet.";
                return;
              }
              const buckets = ahaHeatBuckets(rankedPool);
              const story = ahaStoryText(rankedPool, buckets);
              if (!story) {
                errorEl.textContent = "No Aha story available yet.";
                return;
              }
              const copied = await copyTextToClipboard(story, {
                success: "Copied Aha story.",
                failure: "Copy Aha story failed.",
              });
              if (!copied) {
                throw new Error("Copy Aha story failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDuelAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_duel",
            label: "Copy Aha Duel",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const duel = ahaDuelText(pool);
              if (!duel) {
                errorEl.textContent = "Aha duel is unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(duel, {
                success: "Copied Aha duel.",
                failure: "Copy Aha duel failed.",
              });
              if (!copied) {
                throw new Error("Copy Aha duel failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDuelCallAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_duel_call",
            label: "Copy Duel Call",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelCallText(pool);
              if (!text) {
                errorEl.textContent = "Aha duel call is unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(text, {
                success: "Copied duel call.",
                failure: "Copy duel call failed.",
              });
              if (!copied) {
                throw new Error("Copy duel call failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDuelSignalsAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_duel_signals",
            label: "Copy Duel Signals",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalsText(pool);
              if (!text) {
                errorEl.textContent = "Aha duel signals are unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(text, {
                success: "Copied duel signals.",
                failure: "Copy duel signals failed.",
              });
              if (!copied) {
                throw new Error("Copy duel signals failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDuelSignalHandoffAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_duel_signal_handoff",
            label: "Copy Signal Handoff",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalHandoffText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal handoff is unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(text, {
                success: "Copied duel signal handoff.",
                failure: "Copy duel signal handoff failed.",
              });
              if (!copied) {
                throw new Error("Copy duel signal handoff failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDuelSignalConsensusAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_duel_signal_consensus",
            label: "Copy Signal Consensus",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalConsensusText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal consensus is unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(text, {
                success: "Copied duel signal consensus.",
                failure: "Copy duel signal consensus failed.",
              });
              if (!copied) {
                throw new Error("Copy duel signal consensus failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDuelSignalProtocolAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_duel_signal_protocol",
            label: "Copy Signal Protocol",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalConsensusProtocolText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal protocol is unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(text, {
                success: "Copied duel signal protocol.",
                failure: "Copy duel signal protocol failed.",
              });
              if (!copied) {
                throw new Error("Copy duel signal protocol failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDuelSignalCommandAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_duel_signal_command",
            label: "Copy Signal Command",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalConsensusCommandText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal command is unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(text, {
                success: "Copied duel signal command.",
                failure: "Copy duel signal command failed.",
              });
              if (!copied) {
                throw new Error("Copy duel signal command failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDuelSignalScriptAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_duel_signal_script",
            label: "Copy Signal Script",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalConsensusScriptText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal script is unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(text, {
                success: "Copied duel signal script.",
                failure: "Copy duel signal script failed.",
              });
              if (!copied) {
                throw new Error("Copy duel signal script failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDuelSignalChecklistAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_duel_signal_checklist",
            label: "Copy Signal Checklist",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalConsensusChecklistText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal checklist is unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(text, {
                success: "Copied duel signal checklist.",
                failure: "Copy duel signal checklist failed.",
              });
              if (!copied) {
                throw new Error("Copy duel signal checklist failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDownloadAhaDuelSignalHandoffAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_download_aha_duel_signal_handoff",
            label: "Download Signal Handoff",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalHandoffText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal handoff is unavailable under current filters.";
                return;
              }
              const fileName = "aha_signal_handoff_" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt";
              const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = fileName;
              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);
              URL.revokeObjectURL(url);
              errorEl.textContent = "Downloaded duel signal handoff.";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDownloadAhaDuelSignalConsensusAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_download_aha_duel_signal_consensus",
            label: "Download Signal Consensus",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalConsensusText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal consensus is unavailable under current filters.";
                return;
              }
              const fileName = "aha_signal_consensus_" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt";
              const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = fileName;
              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);
              URL.revokeObjectURL(url);
              errorEl.textContent = "Downloaded duel signal consensus.";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDownloadAhaDuelSignalProtocolAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_download_aha_duel_signal_protocol",
            label: "Download Signal Protocol",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalConsensusProtocolText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal protocol is unavailable under current filters.";
                return;
              }
              const fileName = "aha_signal_protocol_" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt";
              const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = fileName;
              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);
              URL.revokeObjectURL(url);
              errorEl.textContent = "Downloaded duel signal protocol.";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDownloadAhaDuelSignalCommandAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_download_aha_duel_signal_command",
            label: "Download Signal Command",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalConsensusCommandText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal command is unavailable under current filters.";
                return;
              }
              const fileName = "aha_signal_command_" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt";
              const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = fileName;
              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);
              URL.revokeObjectURL(url);
              errorEl.textContent = "Downloaded duel signal command.";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDownloadAhaDuelSignalScriptAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_download_aha_duel_signal_script",
            label: "Download Signal Script",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalConsensusScriptText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal script is unavailable under current filters.";
                return;
              }
              const fileName = "aha_signal_script_" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt";
              const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = fileName;
              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);
              URL.revokeObjectURL(url);
              errorEl.textContent = "Downloaded duel signal script.";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDownloadAhaDuelSignalChecklistAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_download_aha_duel_signal_checklist",
            label: "Download Signal Checklist",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSignalConsensusChecklistText(pool);
              if (!text) {
                errorEl.textContent = "Duel signal checklist is unavailable under current filters.";
                return;
              }
              const fileName = "aha_signal_checklist_" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt";
              const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = fileName;
              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);
              URL.revokeObjectURL(url);
              errorEl.textContent = "Downloaded duel signal checklist.";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDuelSnapshotAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_duel_snapshot",
            label: "Copy Duel Snapshot",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelSnapshotText(pool);
              if (!text) {
                errorEl.textContent = "Aha duel snapshot is unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(text, {
                success: "Copied duel snapshot.",
                failure: "Copy duel snapshot failed.",
              });
              if (!copied) {
                throw new Error("Copy duel snapshot failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDuelPlanAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_duel_plan",
            label: "Copy Duel Action Plan",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const text = ahaDuelActionPlanText(pool);
              if (!text) {
                errorEl.textContent = "Aha duel plan is unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(text, {
                success: "Copied duel action plan.",
                failure: "Copy duel action plan failed.",
              });
              if (!copied) {
                throw new Error("Copy duel action plan failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopyAhaDecisionBriefAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_copy_aha_decision_brief",
            label: "Copy Decision Brief",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const brief = ahaDecisionBriefText(pool);
              if (!brief) {
                errorEl.textContent = "Decision brief is unavailable under current filters.";
                return;
              }
              const copied = await copyTextToClipboard(brief, {
                success: "Copied decision brief.",
                failure: "Copy decision brief failed.",
              });
              if (!copied) {
                throw new Error("Copy decision brief failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDownloadAhaDecisionBriefAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_download_aha_decision_brief",
            label: "Download Decision Brief",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const brief = ahaDecisionBriefText(pool);
              if (!brief) {
                errorEl.textContent = "Decision brief is unavailable under current filters.";
                return;
              }
              const fileName = "aha_decision_brief_" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt";
              const blob = new Blob([brief], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = fileName;
              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);
              URL.revokeObjectURL(url);
              errorEl.textContent = "Downloaded decision brief.";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runOpenAhaRivalAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_open_aha_rival",
            label: "Open Aha Rival",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const rival = topAhaCandidates(pool, 2)[1] || null;
              if (!rival) {
                errorEl.textContent = "No rival candidate available.";
                return;
              }
              await selectItem(rival.id);
              focusQueueItemCard(rival.id, { revealCollapsed: true });
              const meta = ahaIndexMetaForItem(rival);
              errorEl.textContent = "Opened rival candidate #" + rival.id + " (" + meta.value + ").";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runToggleAhaDuelPairAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_toggle_aha_duel_pair",
            label: "Toggle Duel Pair",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const candidates = topAhaCandidates(pool, 2);
              if (!candidates.length) {
                errorEl.textContent = "No Aha candidates available to toggle.";
                return;
              }
              if (candidates.length === 1) {
                await selectItem(candidates[0].id);
                focusQueueItemCard(candidates[0].id, { revealCollapsed: true });
                const soloMeta = ahaIndexMetaForItem(candidates[0]);
                errorEl.textContent = "Only one duel candidate available: #" + candidates[0].id + " (" + soloMeta.value + ").";
                return;
              }
              const lead = candidates[0];
              const rival = candidates[1];
              const target = String(selectedId) === String(lead.id) ? rival : lead;
              await selectItem(target.id);
              focusQueueItemCard(target.id, { revealCollapsed: true });
              const meta = ahaIndexMetaForItem(target);
              const role = String(target.id) === String(lead.id) ? "Lead" : "Rival";
              errorEl.textContent = "Toggled duel pair → " + role + " #" + target.id + " (" + meta.value + ").";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runTopAhaPrimaryAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_run_top_aha_primary",
            label: "Run Top Aha Action",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              if (!pool.length) {
                errorEl.textContent = "No items available to run.";
                return;
              }
              const target = topAhaItem(pool);
              if (!target) {
                errorEl.textContent = "No top Aha candidate available to run.";
                return;
              }
              await selectItem(target.id);
              focusQueueItemCard(target.id, { revealCollapsed: true });
              const primary = primaryActionForItem(target);
              if (!primary || primary.disabled) {
                errorEl.textContent = "Top Aha candidate has no runnable primary action.";
                return;
              }
              await primary.action();
              const meta = ahaIndexMetaForItem(target);
              errorEl.textContent = "Ran top Aha action (" + primary.label + ") on #" + target.id + " (" + meta.value + ").";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runRivalAhaPrimaryAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_run_rival_aha_primary",
            label: "Run Rival Action",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              if (!pool.length) {
                errorEl.textContent = "No items available to run.";
                return;
              }
              const rival = topAhaCandidates(pool, 2)[1] || null;
              if (!rival) {
                errorEl.textContent = "No rival candidate available to run.";
                return;
              }
              await selectItem(rival.id);
              focusQueueItemCard(rival.id, { revealCollapsed: true });
              const primary = primaryActionForItem(rival);
              if (!primary || primary.disabled) {
                errorEl.textContent = "Rival candidate has no runnable primary action.";
                return;
              }
              await primary.action();
              const meta = ahaIndexMetaForItem(rival);
              errorEl.textContent = "Ran rival action (" + primary.label + ") on #" + rival.id + " (" + meta.value + ").";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDuelPairPrimaryActions(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_run_duel_pair",
            label: "Run Duel Pair Actions",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const pair = topAhaCandidates(pool, 2);
              if (!pair.length) {
                errorEl.textContent = "No Aha candidates available to run.";
                return;
              }
              if (pair.length < 2) {
                errorEl.textContent = "Need at least two Aha candidates for duel run.";
                return;
              }
              const outcomes = [];
              for (const [index, item] of pair.entries()) {
                await selectItem(item.id);
                focusQueueItemCard(item.id, { revealCollapsed: true });
                const primary = primaryActionForItem(item);
                if (!primary || primary.disabled) {
                  outcomes.push((index === 0 ? "Lead" : "Rival") + " #" + item.id + ": no runnable action");
                  continue;
                }
                await primary.action();
                outcomes.push((index === 0 ? "Lead" : "Rival") + " #" + item.id + ": " + primary.label);
              }
              errorEl.textContent = "Duel run completed · " + outcomes.join(" · ");
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDuelCallAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_run_duel_call",
            label: "Run Duel Call",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const call = ahaDuelCallMeta(pool);
              if (!call) {
                errorEl.textContent = "No duel call available under current filters.";
                return;
              }
              if (!call.target || !call.primary) {
                errorEl.textContent = "Duel call suggests hold: " + call.hint + ".";
                return;
              }
              await selectItem(call.target.id);
              focusQueueItemCard(call.target.id, { revealCollapsed: true });
              await call.primary.action();
              const meta = ahaIndexMetaForItem(call.target);
              errorEl.textContent =
                "Duel call executed → " +
                call.role +
                " #" +
                call.target.id +
                " (" +
                meta.value +
                ") · " +
                call.primary.label +
                ".";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDuelSignalHandoffAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_run_duel_signal_handoff",
            label: "Run Duel Signal Handoff",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const handoff = ahaDuelSignalHandoffMeta(pool);
              if (!handoff) {
                errorEl.textContent = "No duel signal handoff available under current filters.";
                return;
              }
              const handoffRole = normalizeHandoffRole(handoff.role);
              const ranked = sortedAhaItems(pool);
              const lead = ranked[0] || null;
              const rival = ranked[1] || null;
              if (handoffRole === "hold") {
                errorEl.textContent = "Signal handoff suggests hold: " + handoff.hint + ".";
                return;
              }
              if (handoffRole === "split") {
                if (!lead || !rival) {
                  errorEl.textContent = "Signal handoff split test requires both lead and rival candidates.";
                  return;
                }
                const outcomes = [];
                for (const [index, item] of [lead, rival].entries()) {
                  await selectItem(item.id);
                  focusQueueItemCard(item.id, { revealCollapsed: true });
                  const primary = primaryActionForItem(item);
                  if (!primary || primary.disabled) {
                    outcomes.push((index === 0 ? "Lead" : "Rival") + " #" + item.id + ": no runnable action");
                    continue;
                  }
                  await primary.action();
                  outcomes.push((index === 0 ? "Lead" : "Rival") + " #" + item.id + ": " + primary.label);
                }
                errorEl.textContent = "Signal handoff executed → Split test · " + outcomes.join(" · ");
                return;
              }
              const role = handoffRole === "rival" ? "Rival" : "Lead";
              const target = handoffRole === "rival" ? rival : lead;
              if (!target) {
                errorEl.textContent = "Signal handoff target is unavailable under current filters.";
                return;
              }
              await selectItem(target.id);
              focusQueueItemCard(target.id, { revealCollapsed: true });
              const primary = primaryActionForItem(target);
              if (!primary || primary.disabled) {
                errorEl.textContent = "Signal handoff target #" + target.id + " has no runnable action.";
                return;
              }
              await primary.action();
              const meta = ahaIndexMetaForItem(target);
              errorEl.textContent =
                "Signal handoff executed → " +
                handoff.label +
                " · " +
                role +
                " #" +
                target.id +
                " (" +
                meta.value +
                ") · " +
                primary.label +
                ".";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDuelSignalConsensusAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_run_duel_signal_consensus",
            label: "Run Duel Signal Consensus",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              const consensus = ahaDuelSignalConsensusMeta(pool);
              if (!consensus) {
                errorEl.textContent = "No duel signal consensus available under current filters.";
                return;
              }
              const readiness = ahaDuelSignalConsensusReadinessMeta(pool);
              const consensusWindow = ahaDuelSignalConsensusWindowMeta(pool);
              const guardrail = ahaDuelSignalConsensusGuardrailMeta(pool);
              const trigger = ahaDuelSignalConsensusTriggerMeta(pool);
              const protocol = ahaDuelSignalConsensusProtocolMeta(pool);
              const consensusRole = String(consensus.role || "conflict");
              const ranked = sortedAhaItems(pool);
              const lead = ranked[0] || null;
              const rival = ranked[1] || null;
              if (consensusRole === "hold" || consensusRole === "mixed" || consensusRole === "conflict") {
                errorEl.textContent =
                  "Signal consensus suggests hold: " +
                  consensus.hint +
                  (readiness ? " · " + readiness.label + " · " + readiness.hint : "") +
                  (consensusWindow ? " · " + consensusWindow.label : "") +
                  (guardrail ? " · " + guardrail.label : "") +
                  (trigger ? " · " + trigger.label : "") +
                  (protocol ? " · " + protocol.label : "") +
                  ".";
                return;
              }
              if (readiness && readiness.label === "Delay execution") {
                errorEl.textContent =
                  "Signal consensus paused: " +
                  readiness.hint +
                  (consensusWindow ? " · " + consensusWindow.label : "") +
                  (guardrail ? " · " + guardrail.hint : "") +
                  (trigger ? " · " + trigger.hint : "") +
                  (protocol ? " · " + protocol.hint : "") +
                  ".";
                return;
              }
              if (consensusRole === "split") {
                if (!lead || !rival) {
                  errorEl.textContent = "Signal consensus split execution requires both lead and rival candidates.";
                  return;
                }
                const outcomes = [];
                for (const [index, item] of [lead, rival].entries()) {
                  await selectItem(item.id);
                  focusQueueItemCard(item.id, { revealCollapsed: true });
                  const primary = primaryActionForItem(item);
                  if (!primary || primary.disabled) {
                    outcomes.push((index === 0 ? "Lead" : "Rival") + " #" + item.id + ": no runnable action");
                    continue;
                  }
                  await primary.action();
                  outcomes.push((index === 0 ? "Lead" : "Rival") + " #" + item.id + ": " + primary.label);
                }
                errorEl.textContent =
                  "Signal consensus executed → Split consensus · " +
                  outcomes.join(" · ") +
                  (readiness ? " · " + readiness.label : "") +
                  (consensusWindow ? " · " + consensusWindow.label : "") +
                  (guardrail ? " · " + guardrail.label : "") +
                  (trigger ? " · " + trigger.label : "") +
                  (protocol ? " · " + protocol.label : "");
                return;
              }
              const target = consensusRole === "rival" ? rival : lead;
              const roleLabel = consensusRole === "rival" ? "Rival" : "Lead";
              if (!target) {
                errorEl.textContent = "Signal consensus target is unavailable under current filters.";
                return;
              }
              await selectItem(target.id);
              focusQueueItemCard(target.id, { revealCollapsed: true });
              const primary = primaryActionForItem(target);
              if (!primary || primary.disabled) {
                errorEl.textContent = "Signal consensus target #" + target.id + " has no runnable action.";
                return;
              }
              await primary.action();
              const meta = ahaIndexMetaForItem(target);
              errorEl.textContent =
                "Signal consensus executed → " +
                consensus.label +
                " · " +
                roleLabel +
                " #" +
                target.id +
                " (" +
                meta.value +
                ") · " +
                primary.label +
                (readiness ? " · " + readiness.label : "") +
                (consensusWindow ? " · " + consensusWindow.label : "") +
                (guardrail ? " · " + guardrail.label : "") +
                (trigger ? " · " + trigger.label : "") +
                (protocol ? " · " + protocol.label : "") +
                ".";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runDuelSignalProtocolAction(button = null) {
        const visibleItems = visibleQueueItems();
        const pool = visibleItems.length ? visibleItems : allItems;
        const trigger = ahaDuelSignalConsensusTriggerMeta(pool);
        const protocol = ahaDuelSignalConsensusProtocolMeta(pool);
        const protocolRisk = ahaDuelSignalConsensusProtocolRiskMeta();
        const protocolRegime = ahaDuelSignalConsensusProtocolRegimeMeta();
        const protocolCadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const protocolPressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const protocolCommand = ahaDuelSignalConsensusProtocolCommandMeta(pool, trigger, protocol, protocolCadence, protocolPressure);
        const protocolScript = ahaDuelSignalConsensusProtocolScriptMeta(pool, protocolCommand, protocolCadence, protocolPressure);
        const protocolScriptLane = ahaDuelSignalConsensusProtocolScriptLaneMeta(pool, protocolScript, protocolCommand);
        const protocolScriptChecklist = ahaDuelSignalConsensusProtocolScriptChecklistMeta(
          pool,
          protocolScript,
          protocolScriptLane,
          protocolCommand,
        );
        if (!trigger || !protocol) {
          errorEl.textContent = "No duel signal protocol available under current filters.";
          return;
        }
        if (trigger.label === "No trigger") {
          errorEl.textContent =
            "Signal protocol pending: " +
            trigger.hint +
            " · " +
            protocol.label +
            (protocolRisk ? " · " + protocolRisk.label + " · " + protocolRisk.hint : "") +
            (protocolRegime ? " · " + protocolRegime.label + " · " + protocolRegime.hint : "") +
            (protocolCadence ? " · " + protocolCadence.label + " · " + protocolCadence.hint : "") +
            (protocolPressure ? " · " + protocolPressure.label + " · " + protocolPressure.hint : "") +
            (protocolCommand ? " · " + protocolCommand.label + " · " + protocolCommand.hint : "") +
            (protocolScript ? " · " + protocolScript.label + " · " + protocolScript.hint : "") +
            (protocolScriptLane ? " · " + protocolScriptLane.label + " · " + protocolScriptLane.hint : "") +
            (protocolScriptChecklist ? " · " + protocolScriptChecklist.label + " · " + protocolScriptChecklist.hint : "") +
            ".";
          return;
        }
        await runDuelSignalConsensusAction(button);
        if (errorEl.textContent) {
          const base = errorEl.textContent.replace(/\.$/, "");
          errorEl.textContent =
            base +
            " · " +
            protocol.label +
            (protocolRisk ? " · " + protocolRisk.label + " · " + protocolRisk.hint : "") +
            (protocolRegime ? " · " + protocolRegime.label + " · " + protocolRegime.hint : "") +
            (protocolCadence ? " · " + protocolCadence.label + " · " + protocolCadence.hint : "") +
            (protocolPressure ? " · " + protocolPressure.label + " · " + protocolPressure.hint : "") +
            (protocolCommand ? " · " + protocolCommand.label + " · " + protocolCommand.hint : "") +
            (protocolScript ? " · " + protocolScript.label + " · " + protocolScript.hint : "") +
            (protocolScriptLane ? " · " + protocolScriptLane.label + " · " + protocolScriptLane.hint : "") +
            (protocolScriptChecklist ? " · " + protocolScriptChecklist.label + " · " + protocolScriptChecklist.hint : "") +
            ".";
        }
      }

      async function runDuelSignalCommandAction(button = null) {
        const visibleItems = visibleQueueItems();
        const pool = visibleItems.length ? visibleItems : allItems;
        const trigger = ahaDuelSignalConsensusTriggerMeta(pool);
        const protocol = ahaDuelSignalConsensusProtocolMeta(pool);
        const cadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const pressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const command = ahaDuelSignalConsensusProtocolCommandMeta(pool, trigger, protocol, cadence, pressure);
        const script = ahaDuelSignalConsensusProtocolScriptMeta(pool, command, cadence, pressure);
        const scriptLane = ahaDuelSignalConsensusProtocolScriptLaneMeta(pool, script, command);
        const scriptChecklist = ahaDuelSignalConsensusProtocolScriptChecklistMeta(pool, script, scriptLane, command);
        if (!command || !trigger || !protocol) {
          errorEl.textContent = "No duel signal command available under current filters.";
          return;
        }
        if (command.label === "Hold command") {
          errorEl.textContent =
            "Signal command hold: " +
            command.hint +
            (script ? " · " + script.label + " · " + script.hint : "") +
            (scriptLane ? " · " + scriptLane.label + " · " + scriptLane.hint : "") +
            (scriptChecklist ? " · " + scriptChecklist.label + " · " + scriptChecklist.hint : "") +
            " · " +
            trigger.label +
            ".";
          return;
        }
        if (command.label === "Split command") {
          await runDuelSignalConsensusAction(button);
        } else {
          await runDuelSignalProtocolAction(button);
        }
        const base = errorEl.textContent ? errorEl.textContent.replace(/\.$/, "") : "Signal command executed";
        errorEl.textContent =
          base +
          " · " +
          command.label +
          " · " +
          command.hint +
          (script ? " · " + script.label + " · " + script.hint : "") +
          (scriptLane ? " · " + scriptLane.label + " · " + scriptLane.hint : "") +
          (scriptChecklist ? " · " + scriptChecklist.label + " · " + scriptChecklist.hint : "") +
          ".";
      }

      async function runDuelSignalScriptAction(button = null) {
        const visibleItems = visibleQueueItems();
        const pool = visibleItems.length ? visibleItems : allItems;
        const trigger = ahaDuelSignalConsensusTriggerMeta(pool);
        const protocol = ahaDuelSignalConsensusProtocolMeta(pool);
        const cadence = ahaDuelSignalConsensusProtocolCadenceMeta();
        const pressure = ahaDuelSignalConsensusProtocolPressureMeta();
        const command = ahaDuelSignalConsensusProtocolCommandMeta(pool, trigger, protocol, cadence, pressure);
        const script = ahaDuelSignalConsensusProtocolScriptMeta(pool, command, cadence, pressure);
        const scriptLane = ahaDuelSignalConsensusProtocolScriptLaneMeta(pool, script, command);
        const scriptChecklist = ahaDuelSignalConsensusProtocolScriptChecklistMeta(pool, script, scriptLane, command);
        if (!script || !command) {
          errorEl.textContent = "No duel signal script available under current filters.";
          return;
        }
        if (script.label === "Hold and wait script" || script.label === "Watch refresh script") {
          errorEl.textContent =
            "Signal script standby: " +
            script.hint +
            " · " +
            command.label +
            (scriptLane ? " · " + scriptLane.label + " · " + scriptLane.hint : "") +
            (scriptChecklist ? " · " + scriptChecklist.label + " · " + scriptChecklist.hint : "") +
            ".";
          return;
        }
        if (script.label === "Split replay script") {
          await runDuelSignalConsensusAction(button);
        } else {
          await runDuelSignalProtocolAction(button);
        }
        const base = errorEl.textContent ? errorEl.textContent.replace(/\.$/, "") : "Signal script executed";
        errorEl.textContent =
          base +
          " · " +
          script.label +
          " · " +
          script.hint +
          " · " +
          command.label +
          (scriptLane ? " · " + scriptLane.label + " · " + scriptLane.hint : "") +
          (scriptChecklist ? " · " + scriptChecklist.label + " · " + scriptChecklist.hint : "") +
          ".";
      }

      async function runDownloadAhaSnapshotAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_download_aha_snapshot",
            label: "Download Aha Snapshot",
            action: async () => {
              const snapshotText = ahaSnapshotText();
              if (!snapshotText) {
                errorEl.textContent = "No Aha snapshot available yet.";
                return;
              }
              const fileName = "aha_snapshot_" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt";
              const blob = new Blob([snapshotText], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = fileName;
              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);
              URL.revokeObjectURL(url);
              errorEl.textContent = "Downloaded Aha snapshot.";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runFocusTopAhaQueueAction(button = null) {
        await runFocusAhaCandidateByRank(1, button);
      }

      async function runCycleAhaQueueAction(direction = "next", button = null) {
        await runActionWithFeedback(
          {
            id: "queue_focus_aha_cycle_" + direction,
            label: direction === "previous" ? "Focus Previous Aha Candidate" : "Focus Next Aha Candidate",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              if (!pool.length) {
                errorEl.textContent = "No items available to focus.";
                return;
              }
              const candidates = topAhaCandidates(pool, 5);
              if (!candidates.length) {
                errorEl.textContent = "No Aha candidates available right now.";
                return;
              }
              const step = direction === "previous" ? -1 : 1;
              const baseIndex =
                ahaCandidateCycleCursor < 0
                  ? direction === "previous"
                    ? 0
                    : -1
                  : ahaCandidateCycleCursor;
              ahaCandidateCycleCursor = (baseIndex + step + candidates.length) % candidates.length;
              const target = candidates[ahaCandidateCycleCursor];
              await selectItem(target.id);
              focusQueueItemCard(target.id, { revealCollapsed: true });
              const meta = ahaIndexMetaForItem(target);
              errorEl.textContent =
                "Focused Aha candidate cycle " +
                String(ahaCandidateCycleCursor + 1) +
                "/" +
                String(candidates.length) +
                ": #" +
                target.id +
                " (" +
                meta.value +
                ").";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runResetAhaCycleAction(button = null) {
        await runActionWithFeedback(
          {
            id: "queue_reset_aha_cycle",
            label: "Reset Aha Cycle",
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              if (!pool.length) {
                errorEl.textContent = "No items available to reset Aha cycle.";
                return;
              }
              const target = topAhaItem(pool);
              if (!target) {
                errorEl.textContent = "No Aha candidate available to reset.";
                return;
              }
              ahaCandidateCycleCursor = 0;
              await selectItem(target.id);
              focusQueueItemCard(target.id, { revealCollapsed: true });
              const meta = ahaIndexMetaForItem(target);
              errorEl.textContent = "Aha cycle reset to top candidate: #" + target.id + " (" + meta.value + ").";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runFocusSecondAhaQueueAction(button = null) {
        await runFocusAhaCandidateByRank(2, button);
      }

      async function runFocusAhaCandidateByRank(rank = 1, button = null) {
        const rankIndex = Math.max(Number(rank) - 1, 0);
        const label = rankIndex === 0 ? "Focus Top Aha Item" : "Focus Aha Candidate #" + (rankIndex + 1);
        await runActionWithFeedback(
          {
            id: "queue_focus_aha_rank_" + (rankIndex + 1),
            label,
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              if (!pool.length) {
                errorEl.textContent = "No items available to focus.";
                return;
              }
              const candidates = topAhaCandidates(pool, rankIndex + 1);
              const target = candidates[rankIndex] || null;
              if (!target) {
                if (rankIndex === 0) {
                  errorEl.textContent = "No Aha candidate available right now.";
                } else {
                  errorEl.textContent = "Aha candidate #" + (rankIndex + 1) + " not available under current filters.";
                }
                return;
              }
              await selectItem(target.id);
              focusQueueItemCard(target.id, { revealCollapsed: true });
              const meta = ahaIndexMetaForItem(target);
              ahaCandidateCycleCursor = rankIndex;
              errorEl.textContent = "Focused Aha candidate #" + (rankIndex + 1) + ": item #" + target.id + " (" + meta.value + ").";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runFocusAhaHeatBucket(bucketKey = "hot", button = null) {
        await runActionWithFeedback(
          {
            id: "queue_focus_aha_heat_" + bucketKey,
            label: "Focus Aha Heat " + bucketKey,
            action: async () => {
              const visibleItems = visibleQueueItems();
              const pool = visibleItems.length ? visibleItems : allItems;
              if (!pool.length) {
                errorEl.textContent = "No items available to focus.";
                return;
              }
              const rankedPool = sortedAhaItems(pool);
              const bucket = ahaHeatBuckets(rankedPool).find((entry) => entry.key === bucketKey) || null;
              if (!bucket || !bucket.firstItem) {
                errorEl.textContent = "No " + bucketKey + " Aha candidates under current filters.";
                return;
              }
              await selectItem(bucket.firstItem.id);
              focusQueueItemCard(bucket.firstItem.id, { revealCollapsed: true });
              const meta = ahaIndexMetaForItem(bucket.firstItem);
              errorEl.textContent =
                "Focused " + bucket.label + " Aha candidate: #" + bucket.firstItem.id + " (" + meta.value + ").";
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      function selectedQueueItem() {
        if (selectedId == null) return null;
        const fromList = allItems.find((item) => String(item?.id) === String(selectedId)) || null;
        if (fromList) return fromList;
        if (selectedDetail?.item && String(selectedDetail.item.id) === String(selectedId)) {
          return selectedDetail.item;
        }
        return null;
      }

      function truncateSelectionLabel(text, max = 44) {
        const value = String(text || "").trim();
        if (!value) return "Untitled";
        return value.length > max ? value.slice(0, max - 1) + "…" : value;
      }

      function primaryActionForItem(item) {
        if (!item) return null;
        const ops = buttonsFor(item).filter((op) => op.id !== "detail" && !op.disabled);
        return ops.find((op) => op.is_primary) || ops[0] || null;
      }

      function updateSelectionHint(item = selectedQueueItem()) {
        if (!selectionHintEl) return;
        if (!item) {
          selectionHintEl.textContent = "Selected: none";
          return;
        }
        const primary = primaryActionForItem(item);
        const ahaRank = ahaRankForItem(item);
        const title = truncateSelectionLabel(item.title || item.url || "Untitled");
        const actionLabel = primary?.label || "No action";
        const ahaDelta = ahaRankDeltaFromMap(item, ahaRank);
        const ahaDeltaLabel = ahaDelta ? " " + ahaDelta.label : "";
        const ahaLabel = ahaRank ? "Aha #" + ahaRank.rank + "/" + ahaRank.total + " (" + ahaRank.value + ")" + ahaDeltaLabel : "Aha —";
        const gap = ahaLeadGapMeta(item, ahaRank);
        const gapLabel = gap ? " · " + QUEUE_LEAD_GAP_LABEL_PREFIX + " " + gap.label : "";
        const duel = ahaDuelRoleMeta(item, null);
        const duelLabel = duel ? " · " + QUEUE_DUEL_ROLE_LABEL_PREFIX + " " + duel.role : "";
        selectionHintEl.textContent =
          "Selected: #" +
          String(item.id ?? "—") +
          " " +
          String(item.status || "UNKNOWN") +
          " · " +
          ahaLabel +
          gapLabel +
          duelLabel +
          " · " +
          actionLabel +
          " · " +
          title;
      }

      function updateAhaPulseHint(items = allItems) {
        if (!ahaPulseBtn) return;
        ahaPulseBtn.classList.remove("heat-up", "heat-down", "heat-flat");
        const clickHint = "Click focus lead · Shift+Click run lead action · Alt+Click focus #2.";
        const ranked = sortedAhaItems(items);
        if (!ranked.length) {
          ahaPulseBtn.textContent = "Aha Pulse: —";
          ahaPulseBtn.title = "Aha Pulse: no active candidates. " + clickHint;
          ahaPulseBtn.disabled = true;
          return;
        }
        const trend = ahaHeatTrendMeta();
        const top = ranked[0];
        const topMeta = ahaIndexMetaForItem(top);
        const topPrimary = primaryActionForItem(top);
        const story = ahaStoryText(ranked, ahaHeatBuckets(ranked));
        ahaPulseBtn.classList.add(trend.tone);
        ahaPulseBtn.disabled = false;
        ahaPulseBtn.textContent = "Aha Pulse: " + trend.label + " · #" + top.id + " " + topMeta.value;
        ahaPulseBtn.title =
          "Lead #" +
          top.id +
          " · " +
          (topPrimary?.label || "No action") +
          " · " +
          (story || "No storyline available.") +
          " · " +
          clickHint;
      }

      async function runSelectedPrimaryItemAction(button = null) {
        const item = selectedQueueItem();
        if (!item) {
          const hint = "No selected item. Use J/K to pick one first.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        const candidateOps = buttonsFor(item).filter((op) => op.id !== "detail" && !op.disabled);
        if (!candidateOps.length) {
          const hint = "Selected item has no available primary action.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        const primaryOp = candidateOps.find((op) => op.is_primary) || candidateOps[0];
        await runActionWithFeedback(
          {
            id: "queue_selected_primary_" + String(item.id) + "_" + primaryOp.id,
            label: "Primary Action: " + primaryOp.label,
            action: async () => {
              await primaryOp.action();
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runOpenSelectedSourceAction(button = null) {
        const item = selectedQueueItem();
        if (!item) {
          const hint = "No selected item. Use J/K to pick one first.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        const url = String(item.url || "").trim();
        if (!/^https?:\\/\\//i.test(url)) {
          const hint = "Selected item has no valid http(s) source URL.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        await runActionWithFeedback(
          {
            id: "queue_open_source_" + String(item.id),
            label: "Open Selected Source",
            action: async () => {
              const opened = window.open(url, "_blank", "noopener,noreferrer");
              if (!opened) {
                throw new Error("Popup blocked. Please allow popups for this site.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopySelectedSourceAction(button = null) {
        const item = selectedQueueItem();
        if (!item) {
          const hint = "No selected item. Use J/K to pick one first.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        const url = String(item.url || "").trim();
        if (!/^https?:\\/\\//i.test(url)) {
          const hint = "Selected item has no valid http(s) source URL.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        await runActionWithFeedback(
          {
            id: "queue_copy_source_" + String(item.id),
            label: "Copy Selected Source",
            action: async () => {
              const copied = await copyTextToClipboard(url, {
                success: "Copied source URL.",
                failure: "Copy source URL failed.",
              });
              if (!copied) {
                throw new Error("Copy source URL failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runCopySelectedContextAction(button = null) {
        const item = selectedQueueItem();
        if (!item) {
          const hint = "No selected item. Use J/K to pick one first.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        const contextLines = [
          "Title: " + String(item.title || "N/A"),
          "Intent: " + String(item.intent_text || "N/A"),
          "URL: " + String(item.url || "N/A"),
          "Status: " + String(item.status || "N/A"),
          "Priority: " + String(item.priority || "N/A"),
        ];
        await runActionWithFeedback(
          {
            id: "queue_copy_context_" + String(item.id),
            label: "Copy Selected Context",
            action: async () => {
              const copied = await copyTextToClipboard(contextLines.join("\\n"), {
                success: "Copied selected item context.",
                failure: "Copy selected item context failed.",
              });
              if (!copied) {
                throw new Error("Copy selected item context failed.");
              }
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runOpenFirstBlockedAction(button = null) {
        await runActionWithFeedback(
          {
            id: "flow_open_first_blocked",
            label: "Open First Blocked",
            action: async () => {
              const firstBlocked = blockedFailedCandidates(allItems)[0] || null;
              if (!firstBlocked) {
                errorEl.textContent = "No blocked failed item under current filters.";
                return;
              }
              setDetailAdvancedEnabled(true, false);
              await selectItem(firstBlocked.id);
              focusQueueItemCard(firstBlocked.id, { revealCollapsed: true });
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runRescueLastRetryAction(button = null) {
        await runActionWithFeedback(
          {
            id: "flow_rescue_last_retry",
            label: "Rescue Last Retry",
            action: async () => {
              const limit = normalizedBatchLimit();
              const candidates = lastAttemptRetryCandidates(allItems).slice(0, limit);
              if (!candidates.length) {
                errorEl.textContent = "No last-attempt retry candidates under current filters.";
                return;
              }
              const confirmed = confirm(
                "Retry " +
                  candidates.length +
                  " last-attempt failed items now? (sorted by score desc, limit=" +
                  limit +
                  ")",
              );
              if (!confirmed) {
                errorEl.textContent = "Rescue Last Retry cancelled.";
                return;
              }
              const result = await retryItemsByIds(
                candidates.map((item) => ({ id: item.id, failed_step: item.failure?.failed_step || null })),
              );
              errorEl.textContent =
                "Rescue Last Retry done. queued=" +
                result.queued +
                ", replayed=" +
                result.replayed +
                ", failed=" +
                result.failed +
                ".";
              setLatestRecoverySummary({
                label: "Rescue Last Retry",
                totals: {
                  targeted: result.targeted ?? candidates.length,
                  queued: result.queued ?? 0,
                  replayed: result.replayed ?? 0,
                  failed: result.failed ?? 0,
                },
                step_buckets: result.step_buckets,
              });
              await loadItems();
            },
          },
          { button, localFeedbackEl: queueActionBannerEl },
        );
      }

      async function runQueueSelectionNavigationAction(direction) {
        const visibleIds = visibleQueueItemIds();
        if (!visibleIds.length) {
          const hint = "No visible items to navigate.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        }
        const currentIndex = selectedId == null ? -1 : visibleIds.findIndex((id) => id === String(selectedId));
        const isNext = direction === "next";
        let targetIndex = 0;
        let wrapped = false;
        if (currentIndex < 0) {
          targetIndex = isNext ? 0 : visibleIds.length - 1;
        } else if (visibleIds.length <= 1) {
          const hint = "Only one visible item available.";
          setActionFeedbackPair("done", hint, queueActionBannerEl);
          errorEl.textContent = hint;
          return;
        } else if (isNext) {
          targetIndex = currentIndex + 1;
          if (targetIndex >= visibleIds.length) {
            targetIndex = 0;
            wrapped = true;
          }
        } else {
          targetIndex = currentIndex - 1;
          if (targetIndex < 0) {
            targetIndex = visibleIds.length - 1;
            wrapped = true;
          }
        }
        const targetId = visibleIds[targetIndex];
        await runActionWithFeedback(
          {
            id: "queue_nav_" + direction,
            label:
              (direction === "next" ? "Select next item" : "Select previous item") +
              (wrapped ? " (wrapped)" : ""),
            action: async () => {
              await selectItem(targetId);
              focusQueueItemCard(targetId, { revealCollapsed: true });
              errorEl.textContent =
                "Selected item " +
                String(targetIndex + 1) +
                "/" +
                String(visibleIds.length) +
                (wrapped ? " (wrapped)." : ".");
            },
          },
          { localFeedbackEl: queueActionBannerEl },
        );
      }

      refreshBtn.addEventListener("click", async () => {
        await runRefreshQueueAction(refreshBtn);
      });

      resetControlsBtn.addEventListener("click", async () => {
        await runResetControlsAction(resetControlsBtn);
      });

      clearFiltersBtn.addEventListener("click", async () => {
        await runClearFiltersAction(clearFiltersBtn);
      });

      runWorkerBtn.addEventListener("click", async () => {
        await runWorkerOnceQueueAction(runWorkerBtn);
      });

      function retryFailedPayload(dryRun, offset = 0) {
        const payload = { limit: normalizedBatchLimit(), offset, dry_run: dryRun };
        const q = queryInput.value.trim();
        if (q) {
          Object.assign(payload, { q });
        }
        if (failureStepFilter.value) {
          return { ...payload, failure_step: failureStepFilter.value };
        }
        return payload;
      }

      function archiveBlockedPayload(dryRun, offset = 0) {
        const retryableValue = archiveRetryableFilter.value;
        const retryableFilter = retryableValue === "true" ? true : retryableValue === "false" ? false : null;
        const payload = { limit: normalizedBatchLimit(), offset, dry_run: dryRun, retryable: retryableFilter };
        const q = queryInput.value.trim();
        if (q) {
          Object.assign(payload, { q });
        }
        if (failureStepFilter.value) {
          return { ...payload, failure_step: failureStepFilter.value };
        }
        return payload;
      }

      function unarchiveBatchPayload(dryRun, offset = 0) {
        const regenerate = unarchiveModeFilter.value === "regenerate";
        const payload = { limit: normalizedBatchLimit(), offset, dry_run: dryRun, regenerate };
        const q = queryInput.value.trim();
        if (q) {
          return { ...payload, q };
        }
        return payload;
      }

      function normalizedBatchLimit() {
        const raw = Number(batchLimitInput.value);
        if (!Number.isInteger(raw)) return 100;
        return Math.min(Math.max(raw, 1), 200);
      }

      function normalizedPreviewOffset() {
        const raw = Number(previewOffsetInput.value);
        if (!Number.isInteger(raw)) return 0;
        return Math.max(raw, 0);
      }

      function normalizeBatchLimitInputValue() {
        batchLimitInput.value = String(normalizedBatchLimit());
      }

      function normalizePreviewOffsetInputValue() {
        previewOffsetInput.value = String(normalizedPreviewOffset());
      }

      function normalizeRecoveryFocusModeFilterValue() {
        if (!isRecoveryContextFocusMode(recoveryFocusModeFilter.value)) {
          syncRecoveryFocusModeFilterControl();
          return;
        }
        const changed = setRecoveryContextFocusMode(recoveryFocusModeFilter.value);
        if (!changed) {
          errorEl.textContent = "Context focus mode already: " + recoveryContextFocusModeLabel(recoveryContextFocusMode) + ".";
          return;
        }
        if (activeRecoverySummary()) {
          renderRecoveryRadar(activeRecoverySummary());
        }
        errorEl.textContent = "Context focus mode: " + recoveryContextFocusModeLabel(recoveryContextFocusMode) + ".";
      }

      function resetPreviewOffset() {
        previewOffsetInput.value = String(controlDefaults.preview_offset);
        persistControls();
      }

      function syncPreviewOffsetFromResponse(preview) {
        const requestedOffset = Number(preview?.requested_offset ?? 0);
        previewOffsetInput.value = String(Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0);
        persistControls();
      }

      function scanCountSummary(payload) {
        return String(payload.scanned ?? 0) + "/" + String(payload.scanned_total ?? payload.scanned ?? 0);
      }

      function scanWindowSummary(payload) {
        return (
          "scanned=" +
          scanCountSummary(payload) +
          ", limit=" +
          (payload.requested_limit ?? normalizedBatchLimit()) +
          ", offset=" +
          (payload.requested_offset ?? 0)
        );
      }

      function scanContinuationSummary(payload) {
        return (
          "truncated=" +
          (payload.scan_truncated ? "yes" : "no") +
          ", next_offset=" +
          (payload.next_offset == null ? "null" : String(payload.next_offset))
        );
      }

      function failureFilterSummary(payload) {
        return "q=" + (payload.q_filter || "all") + ", filter=" + (payload.failure_step_filter || "all");
      }

      function qFilterSummary(payload) {
        return "q=" + (payload.q_filter || "all");
      }

      function retryableFilterLabel(payload) {
        return payload.retryable_filter == null ? "all" : String(payload.retryable_filter);
      }

      function unarchiveModeLabel(payload) {
        return payload.regenerate ? "regenerate" : "smart";
      }

      function renderArchivePreviewOutput(preview) {
        errorEl.textContent =
          "Archive preview: " +
          scanWindowSummary(preview) +
          ", retryable=" +
          retryableFilterLabel(preview) +
          ", " +
          failureFilterSummary(preview) +
          ", " +
          scanContinuationSummary(preview) +
          ", eligible=" +
          (preview.eligible ?? 0) +
          ", skipped_retryable_mismatch=" +
          (preview.skipped_retryable_mismatch ?? 0) +
          ".";
        retryPreviewOutputEl.style.display = "block";
        retryPreviewOutputEl.textContent = JSON.stringify(
          {
            preview_type: "archive_blocked",
            retryable_filter: retryableFilterLabel(preview),
            q_filter: preview.q_filter || null,
            filter: preview.failure_step_filter || "all",
            scanned: preview.scanned ?? 0,
            scanned_total: preview.scanned_total ?? preview.scanned ?? 0,
            scan_truncated: Boolean(preview.scan_truncated),
            requested_offset: preview.requested_offset ?? 0,
            next_offset: preview.next_offset ?? null,
            eligible_item_ids: preview.eligible_item_ids || [],
            skipped_retryable_mismatch: preview.skipped_retryable_mismatch || 0,
          },
          null,
          2,
        );
      }

      function renderRetryPreviewOutput(preview) {
        errorEl.textContent =
          "Retry preview: " +
          scanWindowSummary(preview) +
          ", " +
          failureFilterSummary(preview) +
          ", " +
          scanContinuationSummary(preview) +
          ", eligible_pipeline=" +
          (preview.eligible_pipeline ?? 0) +
          ", eligible_export=" +
          (preview.eligible_export ?? 0) +
          ", skipped_non_retryable=" +
          (preview.skipped_non_retryable ?? 0) +
          ".";
        retryPreviewOutputEl.style.display = "block";
        retryPreviewOutputEl.textContent = JSON.stringify(
          {
            q_filter: preview.q_filter || null,
            filter: preview.failure_step_filter || "all",
            scanned: preview.scanned ?? 0,
            scanned_total: preview.scanned_total ?? preview.scanned ?? 0,
            scan_truncated: Boolean(preview.scan_truncated),
            requested_offset: preview.requested_offset ?? 0,
            next_offset: preview.next_offset ?? null,
            eligible_pipeline_item_ids: preview.eligible_pipeline_item_ids || [],
            eligible_export_item_ids: preview.eligible_export_item_ids || [],
            skipped_non_retryable: preview.skipped_non_retryable || 0,
          },
          null,
          2,
        );
      }

      function renderUnarchivePreviewOutput(preview) {
        errorEl.textContent =
          "Unarchive preview: " +
          scanWindowSummary(preview) +
          ", mode=" +
          unarchiveModeLabel(preview) +
          ", " +
          qFilterSummary(preview) +
          ", " +
          scanContinuationSummary(preview) +
          ", eligible_ready=" +
          (preview.eligible_ready ?? 0) +
          ", eligible_queued=" +
          (preview.eligible_queued ?? 0) +
          ".";
        retryPreviewOutputEl.style.display = "block";
        retryPreviewOutputEl.textContent = JSON.stringify(
          {
            preview_type: "unarchive_batch",
            mode: unarchiveModeLabel(preview),
            q_filter: preview.q_filter || null,
            scanned: preview.scanned ?? 0,
            scanned_total: preview.scanned_total ?? preview.scanned ?? 0,
            scan_truncated: Boolean(preview.scan_truncated),
            requested_offset: preview.requested_offset ?? 0,
            next_offset: preview.next_offset ?? null,
            eligible_ready_item_ids: preview.eligible_ready_item_ids || [],
            eligible_queued_item_ids: preview.eligible_queued_item_ids || [],
          },
          null,
          2,
        );
      }

      function renderRetryNoEligibleOutput(preview) {
        errorEl.textContent =
          "No retryable failed items matching current filters. " +
          scanWindowSummary(preview) +
          ", " +
          failureFilterSummary(preview) +
          ".";
      }

      function renderArchiveNoEligibleOutput(preview) {
        errorEl.textContent =
          "No failed items matching archive filter. " +
          scanWindowSummary(preview) +
          ", retryable=" +
          retryableFilterLabel(preview) +
          ", " +
          failureFilterSummary(preview) +
          ".";
      }

      function renderUnarchiveNoEligibleOutput(preview) {
        errorEl.textContent =
          "No archived items to unarchive. " +
          scanWindowSummary(preview) +
          ", mode=" +
          unarchiveModeLabel(preview) +
          ", " +
          qFilterSummary(preview) +
          ".";
      }

      function renderRetryBatchDoneOutput(batchRes, exportSummary) {
        errorEl.textContent =
          "Batch retry done. queued=" +
          (batchRes.queued ?? 0) +
          ", " +
          scanWindowSummary(batchRes) +
          ", " +
          failureFilterSummary(batchRes) +
          ", " +
          scanContinuationSummary(batchRes) +
          ", skipped_non_retryable=" +
          (batchRes.skipped_non_retryable ?? 0) +
          ", eligible_export=" +
          (batchRes.eligible_export ?? 0) +
          ", export_success=" +
          (exportSummary.success ?? 0) +
          ", export_replayed=" +
          (exportSummary.replayed ?? 0) +
          ", export_failed=" +
          (exportSummary.failed ?? 0) +
          ".";
      }

      function renderArchiveBatchDoneOutput(result) {
        errorEl.textContent =
          "Archive blocked done. archived=" +
          (result.archived ?? 0) +
          ", " +
          scanWindowSummary(result) +
          ", " +
          qFilterSummary(result) +
          ", retryable=" +
          retryableFilterLabel(result) +
          ", filter=" +
          (result.failure_step_filter || "all") +
          ", " +
          scanContinuationSummary(result) +
          ", skipped_retryable_mismatch=" +
          (result.skipped_retryable_mismatch ?? 0) +
          ".";
      }

      function renderUnarchiveBatchDoneOutput(result) {
        errorEl.textContent =
          "Unarchive done. unarchived=" +
          (result.unarchived ?? 0) +
          ", " +
          scanWindowSummary(result) +
          ", mode=" +
          unarchiveModeLabel(result) +
          ", " +
          qFilterSummary(result) +
          ", " +
          scanContinuationSummary(result) +
          ", queued_jobs_created=" +
          (result.queued_jobs_created ?? 0) +
          ".";
      }

      function buildRetryBatchConfirmMessage(preview, eligiblePipeline, eligibleExport) {
        return (
          "Retry failed items [" +
          failureFilterSummary(preview) +
          "]? pipeline=" +
          eligiblePipeline +
          ", export=" +
          eligibleExport +
          ", scanned=" +
          scanCountSummary(preview)
        );
      }

      function buildArchiveBatchConfirmMessage(preview, eligible) {
        return (
          "Archive " +
          eligible +
          " failed items" +
          " [retryable=" +
          retryableFilterLabel(preview) +
          ", " +
          qFilterSummary(preview) +
          "]" +
          (preview.failure_step_filter ? " (failure_step=" + preview.failure_step_filter + ")" : "") +
          "?"
        );
      }

      function buildUnarchiveBatchConfirmMessage(preview, eligible) {
        return (
          "Unarchive " +
          eligible +
          " archived items [mode=" +
          unarchiveModeLabel(preview) +
          ", " +
          qFilterSummary(preview) +
          "]?"
        );
      }

      function isPreviewKind(kind) {
        return kind === "retry" || kind === "archive" || kind === "unarchive";
      }

      const batchPayloadBuilderByKind = {
        retry: retryFailedPayload,
        archive: archiveBlockedPayload,
        unarchive: unarchiveBatchPayload,
      };

      const batchEndpointByKind = {
        retry: "/items/retry-failed",
        archive: "/items/archive-failed",
        unarchive: "/items/unarchive-batch",
      };

      const previewRendererByKind = {
        retry: renderRetryPreviewOutput,
        archive: renderArchivePreviewOutput,
        unarchive: renderUnarchivePreviewOutput,
      };

      function batchPayloadByKind(kind, dryRun, offset) {
        const payloadBuilder = batchPayloadBuilderByKind[kind];
        if (typeof payloadBuilder === "function") {
          return payloadBuilder(dryRun, offset);
        }
        throw new Error("Unsupported batch payload kind: " + String(kind));
      }

      async function requestBatchByKind(kind, dryRun, offset) {
        const payload = batchPayloadByKind(kind, dryRun, offset);
        const endpoint = batchEndpointByKind[kind];
        if (typeof endpoint === "string") {
          return request(endpoint, {
            method: "POST",
            body: JSON.stringify(payload)
          });
        }
        throw new Error("Unsupported batch request kind: " + String(kind));
      }

      async function requestPreviewByKind(kind, offset) {
        return requestBatchByKind(kind, true, offset);
      }

      function renderPreviewByKind(kind, preview) {
        const renderer = previewRendererByKind[kind];
        if (typeof renderer === "function") {
          renderer(preview);
          return;
        }
        throw new Error("Unsupported preview renderer kind: " + String(kind));
      }

      async function loadAndRenderPreview(kind, offset) {
        const preview = await requestPreviewByKind(kind, offset);
        syncPreviewOffsetFromResponse(preview);
        renderPreviewByKind(kind, preview);
        setPreviewContinuation(kind, preview.next_offset);
        return preview;
      }

      async function loadBatchPreview(kind) {
        const previewOffset = normalizedPreviewOffset();
        const preview = await requestPreviewByKind(kind, previewOffset);
        syncPreviewOffsetFromResponse(preview);
        return preview;
      }

      function handleBatchConfirmation(confirmed, cancelledMessage) {
        if (confirmed) return true;
        errorEl.textContent = cancelledMessage;
        return false;
      }

      async function executeBatchByKind(kind) {
        const executeOffset = normalizedPreviewOffset();
        const result = await requestBatchByKind(kind, false, executeOffset);
        syncPreviewOffsetFromResponse(result);
        return result;
      }

      async function exportItemsForRetry(itemIds) {
        let success = 0;
        let failed = 0;
        let replayed = 0;
        const failedItemIds = [];
        const sampleItemIds = [];
        for (const itemId of itemIds || []) {
          appendRecoverySampleId(sampleItemIds, itemId);
          try {
            const requestId = crypto.randomUUID();
            const response = await request("/items/" + itemId + "/export", {
              method: "POST",
              body: JSON.stringify({
                export_key: "batch_retry_" + requestId,
                formats: ["png", "md", "caption"]
              }),
              headers: { "Idempotency-Key": requestId }
            });
            success += 1;
            if (response?.idempotent_replay === true) {
              replayed += 1;
            }
          } catch {
            failed += 1;
            appendRecoverySampleId(failedItemIds, itemId);
          }
        }
        return { success, failed, replayed, failed_item_ids: failedItemIds, sample_item_ids: sampleItemIds };
      }

      async function runBatchFlow(config) {
        clearPreviewState();
        const preview = await loadBatchPreview(config.kind);
        const eligible = Number(
          typeof config.selectEligible === "function" ? config.selectEligible(preview) : (preview.eligible ?? 0),
        );
        if (!eligible) {
          config.renderNoEligible(preview);
          return;
        }
        if (typeof config.renderPreview === "function") {
          config.renderPreview(preview);
        }
        const confirmed = confirm(config.buildConfirm(preview, eligible));
        if (!handleBatchConfirmation(confirmed, config.cancelledMessage)) return;
        if (typeof config.beforeExecute === "function") {
          await config.beforeExecute(preview, eligible);
        }
        const result = await executeBatchByKind(config.kind);
        if (typeof config.afterExecute === "function") {
          await config.afterExecute(result, preview, eligible);
          return;
        }
        if (typeof config.renderDone === "function") {
          config.renderDone(result);
        }
      }

      function retryEligibleCounts(preview) {
        const pipelineEligible = Number(preview.eligible_pipeline ?? 0);
        const exportEligible = Number(preview.eligible_export ?? 0);
        return { pipeline: pipelineEligible, exportable: exportEligible, total: pipelineEligible + exportEligible };
      }

      async function runRetryBatchFlow() {
        await runBatchFlow({
          kind: "retry",
          selectEligible: (preview) => {
            return retryEligibleCounts(preview).total;
          },
          renderNoEligible: renderRetryNoEligibleOutput,
          buildConfirm: (preview) => {
            const eligible = retryEligibleCounts(preview);
            return buildRetryBatchConfirmMessage(preview, eligible.pipeline, eligible.exportable);
          },
          cancelledMessage: queueActionCopy.batch_cancelled.retry,
          beforeExecute: () => {
            errorEl.textContent = queueActionCopy.batch_progress.retry;
          },
          afterExecute: async (batchRes) => {
            const exportSummary = await exportItemsForRetry(batchRes.eligible_export_item_ids);
            renderRetryBatchDoneOutput(batchRes, exportSummary);
            setLatestRecoverySummary({
              label: "Batch Retry Flow",
              totals: {
                targeted: Number(batchRes.eligible_pipeline ?? 0) + Number(batchRes.eligible_export ?? 0),
                queued: Number(batchRes.queued ?? 0),
                replayed: 0,
                failed: Number(exportSummary.failed ?? 0),
              },
              step_buckets: {
                ...emptyRecoveryStepBuckets(),
                pipeline: {
                  targeted: Number(batchRes.eligible_pipeline ?? 0),
                  queued: Number(batchRes.queued ?? 0),
                  replayed: 0,
                  failed: 0,
                  sample_item_ids: (batchRes.eligible_pipeline_item_ids || []).slice(0, 3).map((x) => String(x)),
                  failed_item_ids: [],
                },
                export: {
                  targeted: Number(batchRes.eligible_export ?? 0),
                  queued: Number(exportSummary.success ?? 0),
                  replayed: Number(exportSummary.replayed ?? 0),
                  failed: Number(exportSummary.failed ?? 0),
                  sample_item_ids: Array.isArray(exportSummary.sample_item_ids) ? exportSummary.sample_item_ids : [],
                  failed_item_ids: Array.isArray(exportSummary.failed_item_ids) ? exportSummary.failed_item_ids : [],
                },
              },
            });
          },
        });
      }

      async function runQueueAction(op, options = {}) {
        await runActionWithFeedback(op, {
          button: options.button,
          localFeedbackEl: queueActionBannerEl,
          onFinally: options.onFinally,
        });
      }

      async function runQueueBatchAction(op, button) {
        await runQueueAction(op, {
          button,
          onFinally: async () => {
            await loadItems();
          },
        });
      }

      function syncControlsWithPreviewState(options = {}) {
        persistControls();
        if (options.resetOffset !== false) {
          resetPreviewOffset();
        }
        clearPreviewState();
      }

      function bindQueueControlChange(config) {
        config.element.addEventListener("change", () => {
          void applyQueueControlMutation(
            config.label,
            () => {
              if (typeof config.beforeSync === "function") {
                config.beforeSync();
              }
              if (config.skipPreviewSync) {
                persistControls();
              } else {
                syncControlsWithPreviewState(config.syncOptions || {});
              }
            },
            config.options || {},
          );
        });
      }

      function bindListFilterChange(element, label) {
        element.addEventListener("change", () => {
          void applyListContextAndReload(label);
        });
      }

      function bindListFilterChangeConfig(config) {
        bindListFilterChange(config.element, config.label);
      }

      function bindConfigList(configs, binder) {
        configs.forEach((config) => {
          binder(config);
        });
      }

      function bindSearchInputActions(inputEl) {
        inputEl.addEventListener("keydown", async (event) => {
          if (event.key !== "Enter") return;
          await applyListContextAndReload("Search");
        });
        inputEl.addEventListener("input", () => {
          syncControlsWithPreviewState();
        });
      }

      function bindFocusChipActions(containerEl) {
        if (!containerEl) return;
        containerEl.querySelectorAll("[data-focus]").forEach((button) => {
          button.addEventListener("click", async () => {
            const focus = button.getAttribute("data-focus") || "all";
            await applyListContextAndReload("Focus: " + focus, {
              button,
              mutate: () => {
                statusFilter.value = statusByFocusChip(focus);
              },
            });
          });
        });
      }

      function bindShortcutHintAction(button) {
        if (!button) return;
        button.addEventListener("click", () => {
          showShortcutHint();
        });
      }

      function bindAhaPulseAction(button) {
        if (!button) return;
        button.addEventListener("click", async (event) => {
          if (event.altKey) {
            await runFocusSecondAhaQueueAction(button);
            return;
          }
          if (event.shiftKey) {
            await runTopAhaPrimaryAction(button);
            return;
          }
          await runFocusTopAhaQueueAction(button);
        });
      }

      function bindShortcutPanelDismissActions() {
        shortcutPanelCloseBtn?.addEventListener("click", () => {
          hideShortcutHint({ restoreFocus: true });
        });
        shortcutPanelBackdropEl?.addEventListener("click", (event) => {
          if (event.target !== shortcutPanelBackdropEl) return;
          hideShortcutHint({ restoreFocus: true });
        });
      }

      function bindDetailModeActions() {
        detailFocusModeBtn?.addEventListener("click", () => {
          setDetailAdvancedEnabled(false);
        });
        detailAdvancedModeBtn?.addEventListener("click", () => {
          setDetailAdvancedEnabled(true);
        });
      }

      function toggleDetailModeFromShortcut() {
        const nextEnabled = !detailAdvancedEnabled;
        setDetailAdvancedEnabled(nextEnabled);
        errorEl.textContent = "Detail mode: " + (nextEnabled ? "Advanced Panels." : "Focus Mode.");
      }

      function isTextEditingTarget(target) {
        if (!(target instanceof HTMLElement)) return false;
        const tag = target.tagName.toLowerCase();
        return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
      }

      function refreshItemsWithErrorHandling() {
        loadItems().catch((err) => {
          errorEl.textContent = String(err);
        });
      }

      function isShortcutPanelOpen() {
        return Boolean(shortcutPanelBackdropEl && !shortcutPanelBackdropEl.hidden);
      }

      function setShortcutPanelOpen(open, options = {}) {
        if (!shortcutPanelBackdropEl) return;
        shortcutPanelBackdropEl.hidden = !open;
        shortcutHintBtn?.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) {
          if (options.focusPanel !== false) {
            shortcutPanelCloseBtn?.focus();
          }
          return;
        }
        if (options.restoreFocus) {
          shortcutHintBtn?.focus();
        }
      }

      function hideShortcutHint(options = {}) {
        setShortcutPanelOpen(false, options);
      }

      function showShortcutHint() {
        const hint = ${JSON.stringify(shortcutSummaryText)};
        setShortcutPanelOpen(true);
        setActionFeedbackPair("done", hint, queueActionBannerEl);
      }

      function bindGlobalKeyboardShortcuts() {
        document.addEventListener("keydown", (event) => {
          if (event.defaultPrevented) return;
          if (isTextEditingTarget(event.target)) return;
          handleGlobalShortcutKey(event);
        });
      }

      function hasReservedShortcutModifier(event) {
        return Boolean(event.ctrlKey || event.metaKey);
      }

      function shortcutChordByEvent(event) {
        const key = event.key.toLowerCase();
        if (event.altKey && event.shiftKey && key === "l") return "alt+shift+l";
        if (event.altKey && event.shiftKey && key === "p") return "alt+shift+p";
        if (event.altKey && (key === "1" || key === "2" || key === "3")) {
          return "alt+" + key;
        }
        if (event.altKey && key === "n") return "alt+n";
        if (event.altKey && key === "z") return "alt+z";
        if (event.altKey && key === "q") return "alt+q";
        if (event.altKey && key === "e") return "alt+e";
        if (event.altKey && key === "d") return "alt+d";
        if (event.altKey && key === "c") return "alt+c";
        if (event.altKey && key === "s") return "alt+s";
        if (event.altKey && key === "m") return "alt+m";
        if (event.altKey && key === "p") return "alt+p";
        if (event.altKey && key === "l") return "alt+l";
        if (event.shiftKey && key === "q") return "shift+q";
        if (event.shiftKey && key === "s") return "shift+s";
        if (event.shiftKey && key === "d") return "shift+d";
        if (event.shiftKey && key === "e") return "shift+e";
        if (event.shiftKey && key === "u") return "shift+u";
        if (event.shiftKey && key === "p") return "shift+p";
        if (event.shiftKey && key === "n") return "shift+n";
        if (event.shiftKey && key === "r") return "shift+r";
        if (event.shiftKey && key === "g") return "shift+g";
        if (event.shiftKey && key === "z") return "shift+z";
        if (event.shiftKey && key === "c") return "shift+c";
        return key;
      }

      const shortcutActionMap = {
        [SHORTCUT_TRIGGER_KEY]: () => {
          if (isShortcutPanelOpen()) {
            hideShortcutHint();
            return;
          }
          showShortcutHint();
        },
        h: () => {
          if (isShortcutPanelOpen()) {
            hideShortcutHint();
            return;
          }
          showShortcutHint();
        },
        "/": () => {
          queryInput.focus();
          queryInput.select();
        },
        j: () => {
          void runQueueSelectionNavigationAction("next");
        },
        k: () => {
          void runQueueSelectionNavigationAction("prev");
        },
        f: () => {
          setDetailAdvancedEnabled(false);
        },
        a: () => {
          setDetailAdvancedEnabled(true);
        },
        v: () => {
          toggleDetailModeFromShortcut();
        },
        p: () => {
          cycleRecoveryContextFocusMode();
        },
        "shift+p": () => {
          cycleRecoveryContextFocusMode("previous");
        },
        "alt+1": () => {
          setRecoveryContextFocusModeFromShortcut("smart");
        },
        "alt+2": () => {
          setRecoveryContextFocusModeFromShortcut("query_first");
        },
        "alt+3": () => {
          setRecoveryContextFocusModeFromShortcut("step_first");
        },
        "[": () => {
          runRecoverySummaryNavigationAction("prev");
        },
        "]": () => {
          runRecoverySummaryNavigationAction("next");
        },
        l: () => {
          runRecoverySummaryNavigationAction("latest");
        },
        g: () => {
          focusRecoveryContextFromShortcut();
        },
        n: () => {
          void runFocusRecommendedQueueAction();
        },
        q: () => {
          void runTopAhaPrimaryAction();
        },
        "alt+q": () => {
          void runDuelPairPrimaryActions();
        },
        "alt+c": () => {
          void runCopyAhaDuelCallAction();
        },
        "alt+s": () => {
          void runCopyAhaDuelSignalsAction();
        },
        "alt+m": () => {
          void runDuelCallAction();
        },
        "alt+p": () => {
          void runDuelSignalProtocolAction();
        },
        "alt+l": () => {
          void runDuelSignalCommandAction();
        },
        "alt+shift+l": () => {
          void runCopyAhaDuelSignalCommandAction();
        },
        "alt+shift+p": () => {
          void runCopyAhaDuelSignalProtocolAction();
        },
        "shift+q": () => {
          void runCopyAhaDuelPlanAction();
        },
        "shift+s": () => {
          void runCopyAhaDuelSnapshotAction();
        },
        e: () => {
          void runOpenAhaRivalAction();
        },
        "shift+e": () => {
          void runCopyAhaDuelAction();
        },
        "alt+e": () => {
          void runRivalAhaPrimaryAction();
        },
        "shift+d": () => {
          void runCopyAhaDecisionBriefAction();
        },
        "alt+d": () => {
          void runDownloadAhaDecisionBriefAction();
        },
        z: () => {
          void runFocusTopAhaQueueAction();
        },
        "shift+n": () => {
          void runCycleAhaQueueAction();
        },
        "alt+n": () => {
          void runCycleAhaQueueAction("previous");
        },
        "shift+r": () => {
          void runResetAhaCycleAction();
        },
        "shift+z": () => {
          void runFocusSecondAhaQueueAction();
        },
        "alt+z": () => {
          void runToggleAhaDuelPairAction();
        },
        m: () => {
          void runSelectedPrimaryItemAction();
        },
        o: () => {
          void runOpenSelectedSourceAction();
        },
        y: () => {
          void runCopySelectedSourceAction();
        },
        i: () => {
          void runCopySelectedContextAction();
        },
        u: () => {
          void runCopyAhaSnapshotAction();
        },
        "shift+u": () => {
          void runDownloadAhaSnapshotAction();
        },
        b: () => {
          void runOpenFirstBlockedAction();
        },
        x: () => {
          void runRescueLastRetryAction();
        },
        "shift+g": () => {
          clearRecoveryFocusFromShortcut();
        },
        c: () => {
          void runClearFiltersAction();
        },
        "shift+c": () => {
          void runResetControlsAction();
        },
        t: () => {
          void runToggleAutoRefreshAction();
        },
        w: () => {
          void runWorkerOnceQueueAction();
        },
        escape: () => {
          clearRecoveryFocusFromShortcut({ silent_when_empty: true });
        },
        "1": () => {
          focusRecoveryStepFromShortcut("extract");
        },
        "2": () => {
          focusRecoveryStepFromShortcut("pipeline");
        },
        "3": () => {
          focusRecoveryStepFromShortcut("export");
        },
        "0": () => {
          focusRecoveryStepFromShortcut("unknown");
        },
        r: () => {
          void runRefreshQueueAction();
        },
      };

      function shortcutActionByKey(key) {
        return shortcutActionMap[key] || null;
      }

      function handleGlobalShortcutKey(event) {
        const key = event.key.toLowerCase();
        if (isShortcutPanelOpen()) {
          if (key === "escape" || key === SHORTCUT_TRIGGER_KEY.toLowerCase() || key === "h") {
            event.preventDefault();
            hideShortcutHint();
          }
          return;
        }
        if (hasReservedShortcutModifier(event)) return;
        const chord = shortcutChordByEvent(event);
        if (chord === "escape" && !activeFailedStepKey()) return;
        const action = shortcutActionByKey(chord);
        if (!action) return;
        event.preventDefault();
        action();
      }

      function bindAutoRefreshToggle(toggleEl) {
        toggleEl.addEventListener("change", () => {
          persistControls();
          setAutoRefresh(Boolean(toggleEl.checked));
        });
      }

      function initializeQueueBootstrap() {
        restoreControls();
        restoreRecoveryRadarState();
        setAutoRefresh(Boolean(autoRefreshToggle.checked));
        refreshItemsWithErrorHandling();
      }

      function startQueueRuntime() {
        initializeQueueBootstrap();
        bindAutoRefreshToggle(autoRefreshToggle);
        bindGlobalKeyboardShortcuts();
      }

      async function withActionError(errorPrefix, action, onError = null) {
        try {
          return await action();
        } catch (err) {
          if (typeof onError === "function") {
            onError();
          }
          throw new Error(errorPrefix + String(err));
        }
      }

      function bindQueueAction(config, options = {}) {
        const button = config.button;
        const run = typeof options.run === "function" ? options.run : config.run;
        const onError = typeof options.onError === "function" ? options.onError : null;
        button.addEventListener("click", async () => {
          const op = {
            id: config.id,
            label: config.label,
            action: async () => {
              await withActionError(config.errorPrefix, run, onError);
            },
          };
          if (options.useBatchRunner) {
            await runQueueBatchAction(op, button);
            return;
          }
          await runQueueAction(op, { button });
        });
      }

      function bindPreviewAction(config) {
        bindQueueAction(config, {
          run: async () => {
            clearPreviewContinuation();
            const previewOffset = normalizedPreviewOffset();
            await loadAndRenderPreview(config.kind, previewOffset);
          },
          onError: () => {
            clearPreviewState();
          },
        });
      }

      function bindQueueBatchAction(config) {
        bindQueueAction(config, {
          useBatchRunner: true,
        });
      }

      function createSimpleBatchRunner(config) {
        return () => runBatchFlow(config);
      }

      function resolvePreviewContinuation() {
        if (!previewContinuation || previewContinuation.next_offset == null) return null;
        const continuationKind = previewContinuation.kind;
        if (!isPreviewKind(continuationKind)) {
          clearPreviewContinuation();
          return null;
        }
        return { kind: continuationKind, nextOffset: Number(previewContinuation.next_offset) };
      }

      function bindPreviewNextAction(button) {
        bindQueueAction(
          {
            button,
            id: queueActionMeta.preview.next.id,
            label: queueActionMeta.preview.next.label,
            errorPrefix: queueActionCopy.preview_error_prefix.next,
          },
          {
            run: async () => {
              const continuation = resolvePreviewContinuation();
              if (!continuation) return;
              await loadAndRenderPreview(continuation.kind, continuation.nextOffset);
            },
            onError: () => {
              clearPreviewState();
            },
          },
        );
      }

      function queueActionMetaByKind(group, kind) {
        const groupMeta = queueActionMeta[group];
        const meta = groupMeta?.[kind];
        if (!meta) throw new Error("Unsupported queue action kind: " + String(group) + "." + String(kind));
        return meta;
      }

      function createPreviewActionConfig(button, kind) {
        const meta = queueActionMetaByKind("preview", kind);
        return {
          button,
          id: meta.id,
          label: meta.label,
          kind,
          errorPrefix: queueActionCopy.preview_error_prefix[kind],
        };
      }

      function createBatchActionConfig(button, kind, run) {
        const meta = queueActionMetaByKind("batch", kind);
        return {
          button,
          id: meta.id,
          label: meta.label,
          run,
          errorPrefix: queueActionCopy.batch_error_prefix[kind],
        };
      }

      function createSimpleBatchActionConfig(button, kind, flowConfig) {
        return createBatchActionConfig(
          button,
          kind,
          createSimpleBatchRunner({
            kind,
            cancelledMessage: queueActionCopy.batch_cancelled[kind],
            ...flowConfig,
          }),
        );
      }

      function queueFilterLabelByKey(group, key) {
        const groupMeta = queueFilterMeta[group];
        const label = groupMeta?.[key];
        if (!label) throw new Error("Unsupported queue filter key: " + String(group) + "." + String(key));
        return label;
      }

      function createQueueFilterConfigByKey(group, key, element, options = {}) {
        return { element, label: queueFilterLabelByKey(group, key), ...options };
      }

      function createQueueFilterSeed(key, element, options = {}) {
        return { key, element, ...options };
      }

      function expandSeedConfigs(seeds, mapSeed) {
        return seeds.map((seed) => mapSeed(seed));
      }

      function createQueueActionSeed(button, kind, options = {}) {
        return { button, kind, ...options };
      }

      function createBatchActionFromSeed(seed) {
        if (seed.mode === "simple") {
          return createSimpleBatchActionConfig(seed.button, seed.kind, seed.flowConfig || {});
        }
        return createBatchActionConfig(seed.button, seed.kind, seed.run);
      }

      function createPreviewActionFromSeed(seed) {
        return createPreviewActionConfig(seed.button, seed.kind);
      }

      function createQueueFilterConfigMapper(group) {
        return (seed) => {
          const { key, element, ...options } = seed;
          return createQueueFilterConfigByKey(group, key, element, options);
        };
      }

      const previewActionConfigs = expandSeedConfigs(
        [
          createQueueActionSeed(previewArchiveBtn, "archive"),
          createQueueActionSeed(previewRetryBtn, "retry"),
          createQueueActionSeed(previewUnarchiveBtn, "unarchive"),
        ],
        createPreviewActionFromSeed,
      );

      const batchActionConfigs = expandSeedConfigs(
        [
          createQueueActionSeed(retryFailedBtn, "retry", { run: runRetryBatchFlow }),
          createQueueActionSeed(archiveBlockedBtn, "archive", {
            mode: "simple",
            flowConfig: {
              renderNoEligible: renderArchiveNoEligibleOutput,
              renderPreview: renderArchivePreviewOutput,
              buildConfirm: buildArchiveBatchConfirmMessage,
              renderDone: renderArchiveBatchDoneOutput,
            },
          }),
          createQueueActionSeed(unarchiveBatchBtn, "unarchive", {
            mode: "simple",
            flowConfig: {
              renderNoEligible: renderUnarchiveNoEligibleOutput,
              buildConfirm: buildUnarchiveBatchConfirmMessage,
              renderDone: renderUnarchiveBatchDoneOutput,
            },
          }),
        ],
        createBatchActionFromSeed,
      );

      const queueControlChangeConfigs = expandSeedConfigs([
        createQueueFilterSeed("focus_priority", recoveryFocusModeFilter, {
          beforeSync: normalizeRecoveryFocusModeFilterValue,
          skipPreviewSync: true,
          syncOptions: { resetOffset: false },
        }),
        createQueueFilterSeed("archive_scope", archiveRetryableFilter, {
          options: { refresh_worker_stats: true },
        }),
        createQueueFilterSeed("unarchive_mode", unarchiveModeFilter),
        createQueueFilterSeed("batch_limit", batchLimitInput, {
          beforeSync: normalizeBatchLimitInputValue,
        }),
        createQueueFilterSeed("preview_offset", previewOffsetInput, {
          beforeSync: normalizePreviewOffsetInputValue,
          syncOptions: { resetOffset: false },
        }),
      ], createQueueFilterConfigMapper("controls"));

      const listFilterChangeConfigs = expandSeedConfigs([
        createQueueFilterSeed("status", statusFilter),
        createQueueFilterSeed("retryable", retryableFilter),
        createQueueFilterSeed("failure_step", failureStepFilter),
      ], createQueueFilterConfigMapper("list"));

      function setupQueueActionBindings() {
        bindConfigList(previewActionConfigs, bindPreviewAction);
        bindConfigList(batchActionConfigs, bindQueueBatchAction);
        bindPreviewNextAction(previewNextBtn);
      }

      function setupQueueInteractionBindings() {
        bindConfigList(queueControlChangeConfigs, bindQueueControlChange);
        bindSearchInputActions(queryInput);
        bindShortcutHintAction(shortcutHintBtn);
        bindAhaPulseAction(ahaPulseBtn);
        bindShortcutPanelDismissActions();
        bindFocusChipActions(focusChipsEl);
        bindDetailModeActions();
        bindConfigList(listFilterChangeConfigs, bindListFilterChangeConfig);
      }

      function runQueueSetupStages(stages) {
        for (const stage of stages) {
          if (typeof stage === "function") {
            stage();
          }
        }
      }

      function setupQueueShell() {
        runQueueSetupStages([setupQueueActionBindings, setupQueueInteractionBindings, startQueueRuntime]);
      }

      function setAutoRefresh(enabled) {
        if (autoRefreshTimer) {
          clearInterval(autoRefreshTimer);
          autoRefreshTimer = null;
        }
        if (enabled) {
          autoRefreshTimer = setInterval(() => {
            refreshItemsWithErrorHandling();
          }, 5000);
        }
      }
      setupQueueShell();
    </script>
  </body>
</html>`;

function contentTypeForFile(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function resolveExportPath(pathname: string): string | null {
  if (!pathname.startsWith("/exports/")) return null;
  const relativePath = pathname.replace(/^\/+/, "");
  const absolutePath = resolve(repoRoot, relativePath);
  if (!(absolutePath === exportsRoot || absolutePath.startsWith(exportsRoot + "/"))) {
    return null;
  }
  return absolutePath;
}

export function handleWebRequest(req: IncomingMessage, res: ServerResponse): void {
  const rawPathname = (req.url ?? "/").split("?")[0] || "/";
  let pathname = rawPathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    pathname = rawPathname;
  }
  const exportPath = resolveExportPath(pathname);

  if (pathname.startsWith("/exports/")) {
    if (!exportPath) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }
    if (!existsSync(exportPath) || !statSync(exportPath).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": contentTypeForFile(exportPath) });
    res.end(readFileSync(exportPath));
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

export function startWebServer(listenPort = port) {
  const server = createServer(handleWebRequest);
  return server.listen(listenPort, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`Web shell running on http://localhost:${listenPort}`);
  });
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  startWebServer();
}
