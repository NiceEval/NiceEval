import type { FeatureListReceipt, FeatureShowReceipt, TestListReceipt, TestShowReceipt } from "./model.js";
import type { TraceError } from "./errors.js";

export type TraceReceipt = FeatureListReceipt | TestListReceipt | FeatureShowReceipt | TestShowReceipt;

function appendSection(
  lines: string[],
  label: string,
  values: readonly string[],
): void {
  lines.push(`${label}:`, ...(values.length === 0 ? ["  None"] : values.map((value) => `  ${value}`)));
}

export function renderTraceError(error: TraceError): string {
  switch (error._tag) {
    case "TraceIoError":
      return `${error._tag}: ${error.operation} ${error.path}: ${error.message}`;
    case "TraceFormatError":
      return `${error._tag}: ${error.path} (${error.subject}): ${error.message}`;
    case "TraceSelectorMissing":
      return `${error._tag}: no ${error.subject} matches ${JSON.stringify(error.selector)}; run pnpm ${error.subject} list`;
    case "TraceSelectorAmbiguous":
      return `${error._tag}: ${JSON.stringify(error.selector)} is ambiguous:\n${error.candidates.map((candidate) => `  ${candidate}`).join("\n")}`;
  }
}

/** The CLI owns output; this pure renderer consumes the same receipt as JSON. */
export function renderTraceReceipt(receipt: TraceReceipt): string {
  if (receipt.operation === "feature-list") {
    return receipt.features.map((feature) => `${feature.id}\t${feature.title}\t${feature.path}`).join("\n");
  }
  if (receipt.operation === "test-list") {
    return receipt.tests.map((test) => `${test.path}\t${test.repo}\t${test.owner}`).join("\n");
  }
  if (receipt.operation === "feature-show") {
    const lines = [
      `Feature: ${receipt.subject.id}`,
      `Title: ${receipt.subject.title}`,
      `Path: ${receipt.subject.path}`,
    ];
    appendSection(lines, "Children", receipt.children.map((child) => `${child.id} — ${child.title}`));
    lines.push("Use Cases:");
    if (receipt.testsByUseCase.length === 0) lines.push("  None");
    for (const group of receipt.testsByUseCase) {
      lines.push(`  ${group.useCase.title}`, `    Contract: ${group.useCase.path}`, "    Tests:");
      lines.push(...(group.tests.length === 0
        ? ["      No long-term automated owner"]
        : group.tests.map((test) => `      ${test.path}`)));
    }
    const grouped = new Set(receipt.testsByUseCase.flatMap((group) => group.tests.map((test) => test.path)));
    const direct = receipt.tests.filter((test) => !grouped.has(test.path));
    appendSection(lines, "Feature-level Tests", direct.map((test) => test.path));
    appendSection(lines, "Roadmaps", receipt.roadmaps.map((node) => `${node.title} — ${node.path}`));
    appendSection(lines, "Designs", receipt.designs.map((node) => `${node.title} — ${node.path}`));
    appendSection(lines, "Engineering", receipt.engineering.map((node) => `${node.title} — ${node.path}`));
    appendSection(lines, "Current Memory", receipt.currentMemory.map((memory) => `${memory.path} (${memory.kind})`));
    appendSection(lines, "Regression Memory", receipt.regressions.map((memory) => `${memory.path} (${memory.kind})`));
    return lines.join("\n");
  }
  const lines = [
    `Test: ${receipt.test.path}`,
    `Repository: ${receipt.test.repo}`,
    `Lanes: ${receipt.test.lane.join(", ")}`,
    `Areas: ${receipt.test.areas.join(", ")}`,
    `Executor: ${receipt.test.executor.kind}`,
    `Owner: ${receipt.owner.ref}`,
    `Contract (${receipt.contract.kind}): ${receipt.contract.ref}`,
  ];
  appendSection(lines, "Features", receipt.features.map((feature) => `${feature.title} — ${feature.path}`));
  appendSection(lines, "Regression Memory", receipt.regressions.map((memory) => `${memory.path} (${memory.kind})`));
  appendSection(lines, "Issues", receipt.test.issues);
  return lines.join("\n");
}
