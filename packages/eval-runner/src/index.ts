import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema } from "@readdo/contracts";
import { EngineProfile, runEngine } from "@readdo/core";
import { PRIORITIES } from "@readdo/shared";
import fg from "fast-glob";

type EvalCase = {
  id: string;
  title?: string;
  source_type?: "web" | "youtube" | "newsletter" | "other";
  intent_text: string;
  extracted_text: string;
};

type CheckLevel = "P0" | "P1" | "P2";

type CheckResult = {
  level: CheckLevel;
  name: string;
  pass: boolean;
  message?: string;
};

type CaseReport = {
  id: string;
  checks: CheckResult[];
  preview: {
    priority?: string;
    score?: number;
    reasons?: string[];
    todo_titles?: string[];
    headline?: string;
  };
};

function repoRoot(): string {
  let current = resolve(process.cwd());
  while (true) {
    try {
      readdirSync(resolve(current, "docs/evals/cases"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        throw new Error(`Cannot locate repository root from ${process.cwd()}`);
      }
      current = parent;
    }
  }
}

type CliOptions = {
  cases: string;
  out: string;
  format: "json" | "text";
  failOn: "P0" | "P1" | "P2";
  profile: EngineProfile;
};

export function parseCliOptions(args: string[] = process.argv.slice(2)): CliOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    const next = args[i + 1];
    if (current?.startsWith("--") && next && !next.startsWith("--")) {
      values.set(current.slice(2), next);
      i += 1;
    }
  }

  const format = values.get("format") === "json" ? "json" : "text";
  const failOn = (values.get("fail-on") as "P0" | "P1" | "P2" | undefined) ?? "P1";
  const profile = (values.get("profile") as EngineProfile | undefined) ?? "engineer";
  const failOnSafe: "P0" | "P1" | "P2" = ["P0", "P1", "P2"].includes(failOn) ? failOn : "P1";
  const profileSafe: EngineProfile = ["engineer", "creator", "manager"].includes(profile) ? profile : "engineer";

  return {
    cases: values.get("cases") ?? "docs/evals/cases/*.json",
    out: values.get("out") ?? "docs/evals/reports/latest.json",
    format,
    failOn: failOnSafe,
    profile: profileSafe,
  };
}

function readCases(casesGlob: string): EvalCase[] {
  const root = repoRoot();
  const absoluteGlob = resolve(root, casesGlob);
  const files = fg.sync(absoluteGlob, { onlyFiles: true, absolute: true }).sort();
  if (!files.length) {
    throw new Error(`No eval cases matched: ${casesGlob}`);
  }
  return files.map((file) => JSON.parse(readFileSync(file, "utf-8")) as EvalCase);
}

function scoreMatchesPriority(priority: string, score: number): boolean {
  if (priority === "READ_NEXT") return score >= 79.5;
  if (priority === "WORTH_IT") return score >= 59.5 && score < 80.5;
  if (priority === "IF_TIME") return score >= 39.5 && score < 60.5;
  if (priority === "SKIP") return score < 40.5;
  return false;
}

function isGenericReason(input: string): boolean {
  const text = input.toLowerCase();
  return /(很有用|值得一读|信息量大|讲得很好|very useful|good content|worth reading)/u.test(text);
}

function hasSpecificSignal(input: string, intent: string): boolean {
  const lower = input.toLowerCase();
  const intentWords = intent
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter((x) => x.length >= 3);
  const featureHit = /(步骤|清单|框架|对比|数据|案例|step|checklist|framework|comparison|data|example)/u.test(lower);
  const intentHit = intentWords.some((w) => lower.includes(w));
  const effortHit = /(分钟|小时|time|effort|成本|收益)/u.test(lower);
  return featureHit || intentHit || effortHit;
}

function startsWithVerb(title: string): boolean {
  return /^(?:[A-Z][a-z]+|写|做|整理|对比|制定|实现|输出|复盘|提炼)/u.test(title.trim());
}

function actionSpecific(action: string): boolean {
  const lower = action.toLowerCase();
  if (/(去做|去试试|去看看|try it|check it)/u.test(lower)) {
    return false;
  }
  return /(写|列|实现|比较|制定|分享|draft|list|implement|compare|ship|plan)/u.test(lower);
}

async function runCase(inputCase: EvalCase, profile: EngineProfile): Promise<CaseReport> {
  const engineInput = {
    intent_text: inputCase.intent_text,
    extracted_text: inputCase.extracted_text,
    profile,
    source_type: inputCase.source_type ?? "web",
    engine_version: "0.1.0",
    run_id: `eval_${inputCase.id}`,
  } as const;

  const run = await runEngine(
    inputCase.title
      ? {
          ...engineInput,
          title: inputCase.title,
        }
      : engineInput,
  );

  const summary = run.artifacts.summary as { bullets: string[]; insight: string };
  const score = run.artifacts.score as { match_score: number; priority: string; reasons: string[] };
  const todos = run.artifacts.todos as { todos: Array<{ title: string; eta: string; type?: string }> };
  const card = run.artifacts.card as { points: string[]; headline: string; insight: string; action: string };

  const checks: CheckResult[] = [];

  // P0 schema
  for (const [name, payload] of [
    ["summary", summary],
    ["score", score],
    ["todos", todos],
    ["card", card],
  ] as const) {
    const schemaResult = validateSchema(name, payload);
    const check: CheckResult = schemaResult.ok
      ? {
          level: "P0",
          name: `schema:${name}`,
          pass: true,
        }
      : {
          level: "P0",
          name: `schema:${name}`,
          pass: false,
          message: JSON.stringify(schemaResult.errors),
        };
    checks.push(check);
  }

  checks.push({
    level: "P0",
    name: "score:reasons>=3",
    pass: score.reasons.length >= 3,
  });
  checks.push({
    level: "P0",
    name: "score:priority-range",
    pass: scoreMatchesPriority(score.priority, score.match_score),
  });
  checks.push({
    level: "P0",
    name: "todos:count+eta+title",
    pass: todos.todos.length >= 3 && todos.todos.length <= 7 && todos.todos.every((x) => x.eta && x.title.length >= 8),
  });
  checks.push({
    level: "P0",
    name: "card:points+required",
    pass: card.points.length === 3 && Boolean(card.headline && card.insight && card.action),
  });

  // P1
  const nonGenericReasons = score.reasons.filter((x) => !isGenericReason(x));
  const specificReasons = score.reasons.filter((x) => hasSpecificSignal(x, inputCase.intent_text));

  checks.push({
    level: "P1",
    name: "reasons:non-generic",
    pass: nonGenericReasons.length === score.reasons.length && specificReasons.length >= 2,
  });

  const verbLedCount = todos.todos.filter((x) => startsWithVerb(x.title)).length;
  const outputCount = todos.todos.filter((x) => ["WRITE", "SHARE", "BUILD", "DECIDE"].includes(x.type ?? "")).length;
  checks.push({
    level: "P1",
    name: "todos:verb-led+output",
    pass: verbLedCount >= 2 && outputCount >= 2,
  });

  checks.push({
    level: "P1",
    name: "card:action-specific",
    pass: actionSpecific(card.action),
  });

  // P2
  const bulletSet = new Set(summary.bullets.map((x) => x.toLowerCase()));
  checks.push({
    level: "P2",
    name: "summary:non-redundant",
    pass: bulletSet.size >= 2,
  });
  checks.push({
    level: "P2",
    name: "summary:insight-adds-value",
    pass: !summary.bullets.some((x) => x.toLowerCase() === summary.insight.toLowerCase()),
  });
  checks.push({
    level: "P2",
    name: "card:headline-specific",
    pass: !/关于|思考|tips|insights/i.test(card.headline),
  });

  return {
    id: inputCase.id,
    checks,
    preview: {
      priority: score.priority,
      score: score.match_score,
      reasons: score.reasons,
      todo_titles: todos.todos.map((x) => x.title),
      headline: card.headline,
    },
  };
}

function summarize(caseReports: CaseReport[]): { p0_fail: number; p1_fail: number; p2_fail: number } {
  return caseReports.reduce(
    (acc, item) => {
      for (const check of item.checks) {
        if (!check.pass) {
          if (check.level === "P0") acc.p0_fail += 1;
          if (check.level === "P1") acc.p1_fail += 1;
          if (check.level === "P2") acc.p2_fail += 1;
        }
      }
      return acc;
    },
    { p0_fail: 0, p1_fail: 0, p2_fail: 0 },
  );
}

async function main(): Promise<void> {
  const opts = parseCliOptions();
  const cases = readCases(opts.cases);

  const reports: CaseReport[] = [];
  for (const c of cases) {
    // eslint-disable-next-line no-await-in-loop
    reports.push(await runCase(c, opts.profile));
  }

  const totals = summarize(reports);
  const output = {
    run: {
      profile: opts.profile,
      engine_version: "0.1.0",
      priority_values: PRIORITIES,
      timestamp: new Date().toISOString(),
      cases: reports.length,
    },
    totals,
    cases: reports,
  };

  const reportPath = resolve(repoRoot(), opts.out);
  const reportDir = dirname(reportPath);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(output, null, 2), "utf-8");

  const gatePass =
    opts.failOn === "P0"
      ? totals.p0_fail === 0
      : opts.failOn === "P1"
        ? totals.p0_fail === 0 && totals.p1_fail === 0
        : totals.p0_fail === 0 && totals.p1_fail === 0 && totals.p2_fail === 0;

  if (opts.format === "json") {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(
      `Eval finished. cases=${reports.length} fail_on=${opts.failOn} P0_fail=${totals.p0_fail} P1_fail=${totals.p1_fail} P2_fail=${totals.p2_fail}`,
    );
  }

  if (!gatePass) {
    process.exitCode = 1;
  }
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  void main();
}
