import { ensureSchema } from "@readdo/contracts";
import { Priority } from "@readdo/shared";

export type EngineProfile = "engineer" | "creator" | "manager";

export type EngineInput = {
  intent_text: string;
  extracted_text: string;
  profile: EngineProfile;
  title?: string;
  domain?: string;
  source_type?: "web" | "youtube" | "newsletter" | "other";
  engine_version: string;
  run_id: string;
};

export type EngineOutput = {
  meta: {
    run_id: string;
    engine_version: string;
    model_id?: string;
    template_versions: {
      summary: string;
      score: string;
      todos: string;
      card: string;
    };
  };
  artifacts: {
    summary: unknown;
    score: unknown;
    todos: unknown;
    card: unknown;
  };
};

type ScorePayload = {
  match_score: number;
  priority: Priority;
  reasons: string[];
  confidence: number;
  signals: {
    intent_match: number;
    content_signal: number;
    novelty: number;
    effort_fit: number;
  };
};

const SPLIT_SENTENCE = /(?<=[。！？.!?])\s+/u;

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function sentenceFragments(input: string): string[] {
  const normalized = normalizeText(input);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(SPLIT_SENTENCE)
    .map((s) => s.trim())
    .filter(Boolean);
}

function intentKeywords(intent: string): string[] {
  return intent
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter((x) => x.length >= 3)
    .slice(0, 5);
}

function scorePriority(score: number): Priority {
  if (score >= 80) return "READ_NEXT";
  if (score >= 60) return "WORTH_IT";
  if (score >= 40) return "IF_TIME";
  return "SKIP";
}

function detectFeature(text: string): string {
  const lower = text.toLowerCase();
  if (/(step|步骤|checklist|清单)/u.test(lower)) return "步骤/清单结构";
  if (/(compare|comparison|对比)/u.test(lower)) return "对比分析结构";
  if (/(data|metric|数字|指标)/u.test(lower)) return "数据与指标证据";
  if (/(framework|模型|架构)/u.test(lower)) return "框架化方法";
  if (/(example|案例|demo)/u.test(lower)) return "案例示例";
  return "可执行建议";
}

function generateSummary(intent: string, extracted: string): Record<string, unknown> {
  const sentences = sentenceFragments(extracted);
  const picked = sentences.slice(0, 3);

  while (picked.length < 3) {
    picked.push(`围绕“${intent.slice(0, 40)}”补充了可执行信息。`);
  }

  const bullets = picked.map((item) => item.slice(0, 170));
  const insight = `该内容可作为“${intent.slice(0, 60)}”的执行蓝图，重点是把信息转成可复用动作。`.slice(0, 220);

  const payload = {
    bullets,
    insight,
  };
  ensureSchema("summary", payload);
  return payload;
}

function generateScore(intent: string, extracted: string, summary: Record<string, unknown>): ScorePayload {
  const intentWords = intentKeywords(intent);
  const lowerText = extracted.toLowerCase();
  const hitCount = intentWords.filter((w) => lowerText.includes(w)).length;

  const intentMatch = Math.min(100, 35 + hitCount * 12);
  const contentSignal = /(step|checklist|framework|template|对比|步骤|清单|框架|模板)/iu.test(extracted) ? 82 : 64;
  const novelty = 58;
  const effortFit = extracted.length > 2200 ? 54 : 74;

  const score = Math.max(
    0,
    Math.min(100, Math.round(intentMatch * 0.4 + contentSignal * 0.25 + novelty * 0.2 + effortFit * 0.15)),
  );
  const priority = scorePriority(score);
  const feature = detectFeature(extracted);

  const topIntent = intentWords[0] ?? "你的目标";
  const bullets = (summary.bullets as string[]) ?? [];
  const leadBullet = bullets[0] ?? "内容给出了具体建议。";

  const reasons = [
    `与 intent 的关键词“${topIntent}”直接对齐，内容不是泛读而是问题导向。`,
    `文本包含${feature}，并且在“${leadBullet.slice(0, 36)}”处给出可落地线索。`,
    `按当前长度与密度评估，约 20-45 分钟可提炼出可执行动作，投入产出比合理。`,
  ];

  const payload: ScorePayload = {
    match_score: score,
    priority,
    reasons,
    confidence: 0.78,
    signals: {
      intent_match: intentMatch,
      content_signal: contentSignal,
      novelty: novelty,
      effort_fit: effortFit,
    },
  };
  ensureSchema("score", payload);
  return payload;
}

function generateTodos(intent: string, score: ScorePayload): Record<string, unknown> {
  const todos = [
    {
      title: "Extract 3 decision signals from the article",
      eta: "20m",
      type: "READ",
      why: `先快速提炼与“${intent.slice(0, 30)}”直接相关的判断依据。`,
    },
    {
      title: "Compare current workflow against the proposed framework",
      eta: "30m",
      type: "REVIEW",
      why: "通过差异分析确定哪些步骤可以立刻替换。",
    },
    {
      title: "Draft a one-page action plan with milestones",
      eta: "45m",
      type: "WRITE",
      why: "把信息转成可以执行与复盘的计划文档。",
    },
    {
      title: "Share the plan and collect implementation feedback",
      eta: score.priority === "READ_NEXT" ? "20m" : "30m",
      type: "SHARE",
      why: "输出后快速校准方向，减少后续返工。",
    },
  ];

  const payload = { todos };
  ensureSchema("todos", payload);
  return payload;
}

function generateCard(
  summary: Record<string, unknown>,
  score: ScorePayload,
  title?: string,
  domain?: string,
): Record<string, unknown> {
  const bullets = (summary.bullets as string[]) ?? [];
  const insight = String(summary.insight ?? "把阅读转成可交付行动。");

  const headline = (title ? `${title}：从阅读到行动` : "把内容输入转成可执行输出").slice(0, 90);
  const points = [
    `优先级：${score.priority}（${score.match_score.toFixed(0)}分），先做高价值动作。`,
    bullets[0] ?? "先提炼关键观点，再进入执行。",
    domain ? `结合 ${domain} 场景，形成可复用实施模板。` : "将洞察沉淀为可复用模板与流程。",
  ].map((x) => x.slice(0, 160));

  const action = "今天先写一页行动计划并分享给团队，明确下一个 45 分钟内要交付的具体输出物。";

  const payload = {
    headline,
    points,
    insight,
    action,
    hashtags: ["#ReadDo", "#Productivity", "#Execution"],
    caption: `${headline}\n\n${points.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\n行动：${action}`,
    render_spec: {
      format: "HTML_V1",
      width: 1080,
      height: 1350,
      theme: "LIGHT",
      payload: {
        brand: { watermark: "Read→Do" },
        layout: { variant: "CARD_4x5_V1", padding: 48 },
        content: {
          headline,
          points,
          insight,
          action,
        },
      },
    },
  };
  ensureSchema("card", payload);
  return payload;
}

function summaryTemplateVersion(profile: EngineProfile): string {
  if (profile === "creator") {
    return "summary.creator.v1";
  }
  return "summary.engineer.v1";
}

export async function runEngine(input: EngineInput): Promise<EngineOutput> {
  const summary = generateSummary(input.intent_text, input.extracted_text);
  const score = generateScore(input.intent_text, input.extracted_text, summary);
  const todos = generateTodos(input.intent_text, score);
  const card = generateCard(summary, score, input.title, input.domain);

  return {
    meta: {
      run_id: input.run_id,
      engine_version: input.engine_version,
      model_id: "heuristic:local-v1",
      template_versions: {
        summary: summaryTemplateVersion(input.profile),
        score: "score.v1",
        todos: "todos.v1",
        card: "card.v1",
      },
    },
    artifacts: {
      summary,
      score,
      todos,
      card,
    },
  };
}
