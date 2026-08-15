import { Either } from "effect";
import {
  attemptConversationProjector,
  attemptSlotProjection,
  verdictProjector,
  type ConversationView,
  type ProjectedRecordAttachmentResult,
  type ProjectedSample,
} from "../../projection/index.ts";
import { reportEvaluationPlanProjection } from "../evaluation-projections.ts";
import {
  definePage,
  definePageFamily,
  reportComponentId,
  reportInputs,
  reportRoute,
} from "../author/index.ts";
import { authorInternalSetPageNavigation } from "../author/model.ts";
import {
  classicDataPlan,
  defineReport as defineClassicReport,
} from "../classic/define.ts";
import { scoreStatus } from "../classic/aggregate.ts";
import { classicSampleFromProjectedInputs } from "../classic/from-context.ts";
import { markClassicIdentityInput } from "../classic/identity.ts";
import {
  Col,
  ExperimentScatter,
  ExperimentTable,
  Hero,
  SampleSummary,
} from "../classic/components.ts";
import { evaluateClassicTree } from "../classic/jsx.ts";
import {
  classicTableCopy,
  resolveLocalizedText,
  type LocalizedText,
} from "../classic/localize.ts";
import {
  classicAttemptInstanceKey,
  classicAttemptRoute,
  classicExperimentIds,
  classicExperimentInstanceKey,
  classicExperimentRoute,
  narrowClassicSampleToExperiment,
} from "../classic/routes.ts";
import {
  classicAttemptLocator,
  type ClassicAttemptRow,
  type Sample,
} from "../classic/sample.ts";
import {
  reportCellTable,
  reportDocument,
  reportSection,
  reportStat,
  reportStatus,
  type ReportDocument,
} from "../semantic/document.ts";

const niceevalLink = Object.freeze({
  label: "GitHub",
  href: "https://github.com/NiceEval/NiceEval",
});

const STANDARD_COPY = {
  attempts: { en: "Attempts", "zh-CN": "尝试" },
  traces: { en: "Traces", "zh-CN": "追踪" },
  attempt: { en: "Attempt", "zh-CN": "尝试" },
  experimentTitle: { en: "Experiment", "zh-CN": "实验" },
  heroDescription: {
    en: "Evaluation reports for AI agents.",
    "zh-CN": "面向 AI Agent 的评测报告。",
  },
  conversationTraces: { en: "Conversation traces", "zh-CN": "会话追踪" },
  noClosedConversation: {
    en: "No selected Attempt has a closed conversation projection",
    "zh-CN": "所选 Attempt 没有已闭合的会话投影",
  },
  conversation: { en: "Conversation", "zh-CN": "会话" },
  notRecorded: { en: "not recorded", "zh-CN": "未记录" },
  available: { en: "available", "zh-CN": "可用" },
  experiment: { en: "experiment", "zh-CN": "实验" },
  eval: { en: "eval", "zh-CN": "题目" },
  evalColumn: { en: "Eval", "zh-CN": "题目" },
  evaluation: { en: "evaluation", "zh-CN": "评测" },
  scoreStatus: { en: "score status", "zh-CN": "分数状态" },
  score: { en: "score", "zh-CN": "分数" },
  verdict: { en: "verdict", "zh-CN": "判定" },
  durationMs: { en: "durationMs", "zh-CN": "耗时" },
  costUSD: { en: "costUSD", "zh-CN": "成本" },
  tokens: { en: "tokens", "zh-CN": "Tokens" },
  record: { en: "record", "zh-CN": "记录" },
  unknown: { en: "unknown", "zh-CN": "未知" },
  unsupported: { en: "unsupported", "zh-CN": "不支持" },
  invalid: { en: "invalid", "zh-CN": "无效" },
  migrationRequired: { en: "migration-required", "zh-CN": "需要迁移" },
  migrationUnavailable: { en: "migration-unavailable", "zh-CN": "无法迁移" },
} as const satisfies Record<string, LocalizedText>;

const tracesInputs = reportInputs({
  "evaluation-plan": reportEvaluationPlanProjection,
  verdict: attemptSlotProjection(verdictProjector),
  conversation: attemptSlotProjection(attemptConversationProjector),
});
markClassicIdentityInput(tracesInputs, "evaluation-plan");

export async function standardAttemptsRender(sample: Sample): Promise<ReportDocument> {
  const children = await evaluateClassicTree(ExperimentTable({ input: sample }), {
    scope: sample,
  });
  return reportDocument({
    title: copyOf(sample, "attempts"),
    presentation: "classic-dashboard",
    metadataOrigin: sample.metadataOrigin,
    children,
  });
}

export function standardOverviewRender(sample: Sample) {
  return Col({
    children: [
      Hero({
        title: "NiceEval",
        description: STANDARD_COPY.heroDescription,
        links: [niceevalLink],
      }),
      SampleSummary({ input: sample }),
      ExperimentScatter({ input: sample }),
      ExperimentTable({ input: sample }),
    ],
  });
}

export async function standardExperimentRender(sample: Sample): Promise<ReportDocument> {
  const children = await evaluateClassicTree(ExperimentTable({ input: sample }), {
    scope: sample,
  });
  const experimentId = sample.units[0]?.experimentId;
  return reportDocument({
    title: experimentId === undefined ? copyOf(sample, "experimentTitle") : experimentId,
    presentation: "classic-dashboard",
    metadataOrigin: sample.metadataOrigin,
    children,
  });
}

export const standardAttemptsPage = {
  id: "attempts",
  title: STANDARD_COPY.attempts,
  render: async (sample: Sample) => ExperimentTable({ input: sample }),
};

export const standardOverviewPage = {
  id: "report",
  title: { en: "Report", "zh-CN": "报告" },
  render: standardOverviewRender,
};

/**
 * Experiment detail family: one instance per experiment id already on the
 * closed Sample. Render receives that experiment's narrowed Sample.
 */
export const standardExperimentPage = definePageFamily({
  id: Either.getOrThrow(reportComponentId("experiment")),
  inputs: classicDataPlan,
  completeness: "allow-partial",
  instances: (context) =>
    classicExperimentIds(classicSampleFromProjectedInputs({
      sample: context.sample,
      inputs: context.inputs,
    })),
  key: classicExperimentInstanceKey,
  route: classicExperimentRoute,
  render: async ({ instance, sample, inputs }) =>
    standardExperimentRender(
      narrowClassicSampleToExperiment(
        classicSampleFromProjectedInputs({ sample, inputs }),
        instance,
      ),
    ),
});

const standardTracesPageDefinition = definePage({
  id: Either.getOrThrow(reportComponentId("traces")),
  route: Either.getOrThrow(reportRoute("/traces")),
  inputs: tracesInputs,
  completeness: "allow-partial",
  render: ({ sample, inputs }) => tracesDocument(classicSampleFromProjectedInputs({
    sample,
    inputs,
  }), inputs.conversation),
});
authorInternalSetPageNavigation(standardTracesPageDefinition, {
  title: STANDARD_COPY.traces,
  visible: true,
});
export const standardTracesPage = standardTracesPageDefinition;

/** Attempt detail family: one instance per recorded locator / attempt id. */
export const standardAttemptPage = definePageFamily({
  id: Either.getOrThrow(reportComponentId("attempt")),
  inputs: classicDataPlan,
  completeness: "allow-partial",
  instances: (context) =>
    classicSampleFromProjectedInputs({
      sample: context.sample,
      inputs: context.inputs,
    }).attempts.filter((attempt): attempt is ClassicAttemptRow & {
      readonly attemptId: NonNullable<ClassicAttemptRow["attemptId"]>;
    } => attempt.attemptId !== undefined),
  key: (attempt) => classicAttemptInstanceKey(attempt.attemptId),
  route: (attempt) => classicAttemptRoute(attempt.attemptId),
  render: ({ instance, sample, inputs }) =>
    attemptDocument(
      instance,
      classicSampleFromProjectedInputs({ sample, inputs }),
    ),
});

/** The 0.12 zero-configuration Report used by show, view, and the built-in default export. */
export const standard = defineClassicReport({
  title: "NiceEval",
  pages: [
    standardOverviewPage,
    standardAttemptsPage,
    standardTracesPage,
    standardAttemptPage,
    standardExperimentPage,
  ],
});

export default standard;

function tracesDocument(
  sample: Sample,
  conversations: ProjectedSample<"attempt-slot", ConversationView>,
): ReportDocument {
  const locale = sample.locale;
  const attemptHeading = copyOf(sample, "attempt");
  const experimentHeading = copyOf(sample, "experimentTitle");
  const evalHeading = copyOf(sample, "evalColumn");
  const conversationHeading = copyOf(sample, "conversation");
  const rows = sample.attempts.flatMap((attempt) => {
    if (attempt.attemptId === undefined) {
      return [];
    }
    const locator = classicAttemptLocator(attempt);
    return [Object.freeze({
      key: locator ?? attempt.attemptId,
      cells: Object.freeze({
        [attemptHeading]: locator ?? "—",
        [experimentHeading]: attempt.experimentId,
        [evalHeading]: attempt.evalId,
        [conversationHeading]: conversationState(conversations, attempt, locale),
      }),
    })];
  });
  return reportDocument({
    title: copyOf(sample, "traces"),
    presentation: "classic-dashboard",
    metadataOrigin: sample.metadataOrigin,
    children: [
      reportSection({
        heading: copyOf(sample, "conversationTraces"),
        children: rows.length === 0
          ? [reportStatus({
            tone: "neutral",
            label: copyOf(sample, "noClosedConversation"),
          })]
          : [reportCellTable({
            columns: [attemptHeading, experimentHeading, evalHeading, conversationHeading],
            rows,
          })],
      }),
    ],
  });
}

function conversationState(
  conversations: ProjectedSample<"attempt-slot", ConversationView>,
  attempt: ClassicAttemptRow,
  locale: Sample["locale"],
): string {
  for (const entry of conversations.entries) {
    if (entry.state !== "attachment-result") {
      continue;
    }
    if (entry.slot.state !== "included" || entry.slot.attempt.attemptId !== attempt.attemptId) {
      continue;
    }
    return conversationLabel(entry.attachment, locale);
  }
  return resolveLocalizedText(STANDARD_COPY.notRecorded, locale);
}

function conversationLabel(
  attachment: ProjectedRecordAttachmentResult<ConversationView>,
  locale: Sample["locale"],
): string {
  switch (attachment.state) {
    case "available": {
      const count = attachment.value.turns.length;
      return count === 0
        ? resolveLocalizedText(STANDARD_COPY.available, locale)
        : locale === "zh-CN"
        ? `${count} 轮`
        : `${count} turn(s)`;
    }
    case "unavailable":
      return classicTableCopy(locale, "unavailable");
    case "unsupported":
      return resolveLocalizedText(STANDARD_COPY.unsupported, locale);
    case "invalid":
      return resolveLocalizedText(STANDARD_COPY.invalid, locale);
    case "migration-required":
      return resolveLocalizedText(STANDARD_COPY.migrationRequired, locale);
    case "migration-unavailable":
      return resolveLocalizedText(STANDARD_COPY.migrationUnavailable, locale);
    default: {
      const _exhaustive: never = attachment;
      return resolveLocalizedText(STANDARD_COPY.unknown, locale);
    }
  }
}

function attemptDocument(attempt: ClassicAttemptRow, sample: Sample): ReportDocument {
  const locale = sample.locale;
  const unavailable = classicTableCopy(locale, "unavailable");
  const status = scoreStatus(attempt);
  const stats = [
    reportStat({ label: copyOf(sample, "experiment"), value: attempt.experimentId }),
    reportStat({ label: copyOf(sample, "eval"), value: attempt.evalId }),
    reportStat({ label: copyOf(sample, "evaluation"), value: attempt.evaluationKind }),
    ...(attempt.evaluationKind === "score"
      ? [
        reportStat({
          label: copyOf(sample, "scoreStatus"),
          value: status === undefined ? unavailable : classicTableCopy(locale, status),
        }),
        reportStat({
          label: copyOf(sample, "score"),
          value: attempt.score?.state === "complete"
            ? String(attempt.score.earned)
            : attempt.score?.state === "unavailable"
            ? unavailable
            : attempt.score?.state ?? unavailable,
        }),
      ]
      : [reportStat({
        label: copyOf(sample, "verdict"),
        value: attempt.verdict === undefined
          ? copyOf(sample, "unknown")
          : classicTableCopy(locale, attempt.verdict),
      })]),
    reportStat({ label: copyOf(sample, "durationMs"), value: scalarLabel(attempt.durationMs) }),
    reportStat({ label: copyOf(sample, "costUSD"), value: scalarLabel(attempt.costUSD) }),
    reportStat({ label: copyOf(sample, "tokens"), value: scalarLabel(attempt.tokens) }),
    reportStat({
      label: copyOf(sample, "record"),
      value: attempt.target?.locator ?? attempt.runId,
    }),
  ];
  return reportDocument({
    title: attempt.target?.locator ?? (
      locale === "zh-CN" ? `尝试 ${attempt.attempt}` : `attempt ${attempt.attempt}`
    ),
    presentation: "classic-dashboard",
    metadataOrigin: sample.metadataOrigin,
    children: [
      reportSection({
        heading: attempt.evalId,
        children: [
          reportSection({
            heading: copyOf(sample, "attempt"),
            children: stats,
          }),
        ],
      }),
    ],
  });
}

function copyOf(sample: Sample, key: keyof typeof STANDARD_COPY): string {
  return resolveLocalizedText(STANDARD_COPY[key], sample.locale);
}

function scalarLabel(value: number | null): string {
  return value === null ? "—" : String(value);
}
