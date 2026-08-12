import { Either } from "effect";
import {
  assembleAttemptSourceTree,
  assertionSourceSitesProjector,
  assertionsProjector,
  attemptOriginRunProjection,
  attemptSlotProjection,
  sourcesProjector,
  type AttemptSourceTreeAssemblyResult,
  type AttemptSourceTreeNode,
  type AttemptSourceTreeSlot,
  type ProjectedRecordAttachmentResult,
} from "../../projection/index.ts";
import {
  definePage,
  defineReport,
  reportComponentId,
  reportId,
  reportInputs,
  reportRoute,
  type Report,
} from "../author/index.ts";
import {
  reportCodeBlock,
  reportDocument,
  reportSection,
  reportStatus,
  reportText,
  type ReportBlock,
} from "../semantic/index.ts";

const sourceInputs = reportInputs({
  assertions: attemptSlotProjection(assertionsProjector),
  "source-sites": attemptSlotProjection(assertionSourceSitesProjector),
  sources: attemptOriginRunProjection(sourcesProjector),
});

/**
 * A normal Author-API Report over the three public source-navigation
 * projections. It never receives a Record reader, path, or source filesystem
 * capability; the captured Run Attachment supplies all displayed text.
 */
export function sourceEvidenceReport(input: { readonly path?: string } = {}): Report {
  const sourcePath = input.path;
  const page = definePage({
    id: Either.getOrThrow(reportComponentId("source-evidence")),
    route: Either.getOrThrow(reportRoute("/")),
    inputs: sourceInputs,
    completeness: "allow-partial",
    render: ({ inputs }) => sourceEvidenceDocument(
      assembleAttemptSourceTree({
        assertions: inputs.assertions,
        sourceSites: inputs["source-sites"],
        sources: inputs.sources,
      }),
      sourcePath,
    ),
  });
  return defineReport({
    id: Either.getOrThrow(reportId("source-evidence")),
    pages: [page],
  });
}

/** A reusable no-filter declaration for hosts that surface recorded source. */
export const defaultSourceEvidenceReport = sourceEvidenceReport();

function sourceEvidenceDocument(
  assembly: AttemptSourceTreeAssemblyResult,
  sourcePath: string | undefined,
) {
  if (assembly.state === "input-invalid") {
    return reportDocument({
      title: "Recorded source",
      children: [reportStatus({
        tone: "negative",
        label: "Source projection inputs are not aligned",
        detail: [reportText(assembly.issues.map((issue) => issue.code).join(", "))],
      })],
    });
  }

  const slots = assembly.value.slots.filter(
    (slot): slot is Extract<AttemptSourceTreeSlot, { readonly state: "attachment-result" }> =>
      slot.state === "attachment-result",
  );
  return reportDocument({
    title: "Recorded source",
    children: slots.length === 0
      ? [reportStatus({
        tone: "warning",
        label: "No selected Slot has a recorded source attachment result",
      })]
      : slots.flatMap((slot) => sourceSlotBlocks(slot, sourcePath)),
  });
}

function sourceSlotBlocks(
  slot: Extract<AttemptSourceTreeSlot, { readonly state: "attachment-result" }>,
  sourcePath: string | undefined,
): readonly ReportBlock[] {
  const tree = sourceTreeBlocks(slot.tree.roots, sourcePath);
  return [reportSection({
    heading: `Slot ${slot.slot.slotId}`,
    children: [
      attachmentStatus("Assertions", slot.assertions.attachment),
      attachmentStatus("Source sites", slot.sourceSites.attachment),
      attachmentStatus("Sources", slot.sources.attachment),
      ...(tree.length === 0
        ? [reportStatus({
          tone: "warning",
          label: sourcePath === undefined
            ? "No source tree could be mapped from this recorded evidence"
            : `No recorded source matches ${sourcePath}`,
        })]
        : tree),
    ],
  })];
}

function attachmentStatus<Value>(
  name: string,
  result: ProjectedRecordAttachmentResult<Value>,
): ReportBlock {
  switch (result.state) {
    case "available":
      return reportStatus({ tone: "positive", label: `${name}: available` });
    case "unavailable":
      return reportStatus({ tone: "warning", label: `${name}: unavailable` });
    case "migration-required":
      return reportStatus({
        tone: "warning",
        label: `${name}: migration required`,
        detail: [reportText(`${result.from} → ${result.to}; ${result.command}`)],
      });
    case "migration-unavailable":
      return reportStatus({
        tone: "warning",
        label: `${name}: migration unavailable`,
        detail: [reportText(result.reason)],
      });
    case "unsupported":
      return reportStatus({
        tone: "warning",
        label: `${name}: unsupported`,
        detail: [reportText(result.schemaId)],
      });
    case "invalid":
      return reportStatus({
        tone: "negative",
        label: `${name}: invalid`,
        detail: [reportText(result.issues.map((issue) => issue.code).join(", "))],
      });
  }
}

function sourceTreeBlocks(
  nodes: readonly AttemptSourceTreeNode[],
  sourcePath: string | undefined,
): readonly ReportBlock[] {
  return nodes.flatMap((node) => sourceTreeNodeBlocks(node, sourcePath));
}

function sourceTreeNodeBlocks(
  node: AttemptSourceTreeNode,
  sourcePath: string | undefined,
): readonly ReportBlock[] {
  if (node.kind === "package") {
    const calls = sourceTreeBlocks(node.calls, sourcePath);
    return calls.length === 0
      ? []
      : [reportSection({
        heading: `package ${node.package.label}`,
        children: calls,
      })];
  }

  const calls = node.lines.flatMap((line) => sourceTreeBlocks(line.calls, sourcePath));
  const matches = sourcePath === undefined || node.file.path === sourcePath;
  if (!matches && calls.length === 0) return [];
  return [reportSection({
    heading: `source ${node.file.path}`,
    children: [
      ...(matches
        ? [reportCodeBlock({
          value: node.file.text,
          language: sourceLanguage(node.file.path),
        })]
        : []),
      reportSection({
        heading: "calls",
        children: calls.length === 0
          ? [reportStatus({ tone: "neutral", label: "No captured calls" })]
          : calls,
      }),
    ],
  })];
}

function sourceLanguage(path: string): string | undefined {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  return undefined;
}
