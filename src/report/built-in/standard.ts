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
  reportDocument,
  reportSection,
  reportStatus,
  reportTable,
  type ReportDocument,
} from "../semantic/document.ts";

const niceevalLink = Object.freeze({
  label: "GitHub",
  href: "https://github.com/NiceEval/NiceEval",
});

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
    title: "Attempts",
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
        description: "Evaluation reports for AI agents.",
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
    title: experimentId === undefined ? "Experiment" : experimentId,
    presentation: "classic-dashboard",
    metadataOrigin: sample.metadataOrigin,
    children,
  });
}

export const standardAttemptsPage = {
  id: "attempts",
  title: "Attempts",
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
  title: "Traces",
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
  const rows = sample.attempts.flatMap((attempt) => {
    if (attempt.attemptId === undefined) {
      return [];
    }
    return [Object.freeze({
      attempt: classicAttemptLocator(attempt) ?? null,
      eval: attempt.evalId,
      experiment: attempt.experimentId,
      conversation: conversationState(conversations, attempt),
    })];
  });
  return reportDocument({
    title: "Traces",
    presentation: "classic-dashboard",
    metadataOrigin: sample.metadataOrigin,
    children: [
      reportSection({
        heading: "Conversation traces",
        children: rows.length === 0
          ? [reportStatus({
            tone: "neutral",
            label: "No selected Attempt has a closed conversation projection",
          })]
          : [reportTable({
            caption: "Conversation traces",
            columns: [
              { key: "attempt", label: "Attempt" },
              { key: "experiment", label: "Experiment" },
              { key: "eval", label: "Eval" },
              { key: "conversation", label: "Conversation" },
            ],
            rows,
          })],
      }),
    ],
  });
}

function conversationState(
  conversations: ProjectedSample<"attempt-slot", ConversationView>,
  attempt: ClassicAttemptRow,
): string {
  for (const entry of conversations.entries) {
    if (entry.state !== "attachment-result") {
      continue;
    }
    if (entry.slot.state !== "included" || entry.slot.attempt.attemptId !== attempt.attemptId) {
      continue;
    }
    return conversationLabel(entry.attachment);
  }
  return "not recorded";
}

function conversationLabel(
  attachment: ProjectedRecordAttachmentResult<ConversationView>,
): string {
  if (attachment.state === "available") {
    const count = attachment.value.turns.length;
    return count === 0 ? "available" : `${count} turn(s)`;
  }
  return attachment.state;
}

function attemptDocument(attempt: ClassicAttemptRow, sample: Sample): ReportDocument {
  return reportDocument({
    title: attempt.target?.locator ?? `attempt ${attempt.attempt}`,
    presentation: "classic-dashboard",
    metadataOrigin: sample.metadataOrigin,
    children: [
      reportSection({
        heading: attempt.evalId,
        children: [
          reportTable({
            caption: "Attempt",
            columns: [
              { key: "field", label: "Field" },
              { key: "value", label: "Value" },
            ],
            rows: [
              { field: "experiment", value: attempt.experimentId },
              { field: "eval", value: attempt.evalId },
              { field: "evaluation", value: attempt.evaluationKind },
              ...(attempt.evaluationKind === "score"
                ? [
                  { field: "score status", value: scoreStatus(attempt) ?? "errored" },
                  {
                    field: "score",
                    value: attempt.score?.state === "complete"
                      ? attempt.score.earned
                      : attempt.score?.state ?? "unavailable",
                  },
                ]
                : [{ field: "verdict", value: attempt.verdict ?? "unknown" }]),
              { field: "durationMs", value: attempt.durationMs },
              { field: "costUSD", value: attempt.costUSD },
              { field: "tokens", value: attempt.tokens },
              { field: "record", value: attempt.target?.locator ?? attempt.runId },
            ],
          }),
        ],
      }),
    ],
  });
}
