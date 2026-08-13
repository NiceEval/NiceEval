import { Either } from "effect";
import {
  attemptConversationProjector,
  attemptSlotProjection,
  evaluationPlanProjector,
  selectedRunProjection,
  verdictProjector,
  type ConversationView,
  type ProjectedRecordAttachmentResult,
  type ProjectedSample,
} from "../../projection/index.ts";
import {
  definePage,
  definePageFamily,
  reportComponentId,
  reportInputs,
  reportRoute,
} from "../author/index.ts";
import { classicDataPlan } from "../classic/define.ts";
import { classicSampleFromProjectedInputs } from "../classic/from-context.ts";
import { ExperimentTable } from "../classic/components.ts";
import { evaluateClassicTree } from "../classic/jsx.ts";
import {
  classicAttemptInstanceKey,
  classicAttemptRoute,
  classicExperimentIds,
  classicExperimentInstanceKey,
  classicExperimentRoute,
  narrowClassicSampleToExperiment,
} from "../classic/routes.ts";
import type { ClassicAttemptRow, Sample } from "../classic/sample.ts";
import {
  reportDocument,
  reportSection,
  reportStatus,
  reportTable,
  type ReportDocument,
} from "../semantic/document.ts";

const tracesInputs = reportInputs({
  "evaluation-plan": selectedRunProjection(evaluationPlanProjector),
  verdict: attemptSlotProjection(verdictProjector),
  conversation: attemptSlotProjection(attemptConversationProjector),
});

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

export const standardTracesPage = definePage({
  id: Either.getOrThrow(reportComponentId("traces")),
  route: Either.getOrThrow(reportRoute("/traces")),
  inputs: tracesInputs,
  completeness: "allow-partial",
  render: ({ sample, inputs }) => tracesDocument(classicSampleFromProjectedInputs({
    sample,
    inputs,
  }), inputs.conversation),
});

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

function tracesDocument(
  sample: Sample,
  conversations: ProjectedSample<"attempt-slot", ConversationView>,
): ReportDocument {
  const rows = sample.attempts.flatMap((attempt) => {
    if (attempt.attemptId === undefined) {
      return [];
    }
    return [Object.freeze({
      attempt: attempt.target?.locator ?? attempt.attemptId,
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
              { field: "verdict", value: attempt.verdict ?? "unknown" },
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
