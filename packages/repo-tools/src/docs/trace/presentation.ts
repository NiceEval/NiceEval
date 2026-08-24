import type {
  FeatureListReceipt,
  FeatureShowReceipt,
  TestListReceipt,
  TestShowReceipt,
  TraceRelationsByTarget,
} from "./model.js";
import type { TraceError } from "./errors.js";

export type TraceReceipt = FeatureListReceipt | TestListReceipt | FeatureShowReceipt | TestShowReceipt;

interface TreeNode {
  readonly label: string;
  readonly children?: readonly TreeNode[];
}

function renderTree(root: TreeNode): string {
  const lines = [root.label];
  const visit = (nodes: readonly TreeNode[], prefix: string): void => {
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      lines.push(`${prefix}${last ? "└─" : "├─"} ${node.label}`);
      if ((node.children?.length ?? 0) > 0) visit(node.children ?? [], `${prefix}${last ? "   " : "│  "}`);
    });
  };
  visit(root.children ?? [], "");
  return lines.join("\n");
}

const none = (label = "None"): TreeNode => ({ label });
const section = (label: string, children: readonly TreeNode[], emptyLabel = "None"): TreeNode => ({
  label,
  children: children.length === 0 ? [none(emptyLabel)] : children,
});

function featureListTree(receipt: FeatureListReceipt): string {
  const featureById = new Map(receipt.features.map((feature) => [feature.id, feature]));
  const children = new Map<string | undefined, string[]>();
  for (const feature of receipt.features) {
    let parent: string | undefined;
    let cursor = feature.id;
    while (cursor.includes("/")) {
      cursor = cursor.slice(0, cursor.lastIndexOf("/"));
      if (featureById.has(cursor)) {
        parent = cursor;
        break;
      }
    }
    children.set(parent, [...(children.get(parent) ?? []), feature.id]);
  }
  const nodeFor = (id: string): TreeNode => {
    const feature = featureById.get(id);
    if (feature === undefined) return { label: id };
    return {
      label: `${feature.id} — ${feature.title} [selector: ${feature.id}; path: ${feature.path}]`,
      children: (children.get(id) ?? []).sort().map(nodeFor),
    };
  };
  const roots = (children.get(undefined) ?? []).sort().map(nodeFor);
  return renderTree({ label: "Features", children: roots.length === 0 ? [none()] : roots });
}

interface MutableTreeNode {
  label: string;
  children: Map<string, MutableTreeNode>;
  leaves: TreeNode[];
}

function testListTree(receipt: TestListReceipt, details: readonly TestShowReceipt[] = []): string {
  const root: MutableTreeNode = { label: "Tests", children: new Map(), leaves: [] };
  const detailByPath = new Map(details.map((detail) => [detail.subject.path, detail]));
  for (const test of receipt.tests) {
    let cursor = root;
    const parts = test.path.split("/");
    const directories = parts.slice(parts[0] === "e2e" ? 1 : 0, -1).filter((part) => part !== "test");
    for (const directory of directories) {
      let child = cursor.children.get(directory);
      if (child === undefined) {
        child = { label: directory, children: new Map(), leaves: [] };
        cursor.children.set(directory, child);
      }
      cursor = child;
    }
    const detail = detailByPath.get(test.path);
    const relationChildren: TreeNode[] = detail === undefined ? [] : [
      {
        label: `${detail.contract.kind === "use-case" ? "Use Case" : "Feature Contract"}: ${detail.contract.ref}`,
      },
      {
        label: `Features: ${detail.features.length === 0
          ? "None"
          : detail.features.map((feature) => `${feature.id} — ${feature.title}`).join("; ")}`,
      },
      section("Regression / Bug Memory", detail.regressions.map((relation) => ({
        label: `${relation.memory.path} — ${relation.memory.title} [${relation.memory.kind}${relation.memory.state === undefined ? "" : `/${relation.memory.state}`}]`,
      }))),
      section("Issues", detail.issueProvenance.map((issue) => issue.via === "test"
        ? { label: issue.issue }
        : { label: `${issue.repository}#${issue.number} ${issue.url}` })),
    ];
    cursor.leaves.push({
      label: `${test.path} [repo: ${test.repo}]`,
      children: detail === undefined ? relationChildren : [
        { label: `Description: ${detail.owner.description}` },
        ...relationChildren,
      ],
    });
  }
  const freeze = (node: MutableTreeNode): TreeNode => ({
    label: node.label,
    children: [
      ...[...node.children.values()].sort((left, right) => left.label.localeCompare(right.label)).map(freeze),
      ...node.leaves.sort((left, right) => left.label.localeCompare(right.label)),
    ],
  });
  const tree = freeze(root);
  const children = tree.children ?? [];
  return renderTree({ label: tree.label, children: children.length === 0 ? [none()] : children });
}

function targetRelations(group: TraceRelationsByTarget): readonly TreeNode[] {
  const tests = group.tests.map((test) => ({
    label: `${test.path} [repo: ${test.repo}]`,
    children: [{ label: `Description: ${test.description}` }],
  }));
  const feedback = group.feedbackAdoptions.map((relation) => ({
    label: `${relation.feedback.id} — ${relation.feedback.title} [${relation.feedback.state}; exact target: ${relation.target}; via: ${relation.via}]`,
  }));
  const memory = [
    ...group.feedbackMemoryRelations.map((relation) => ({
      label: `${relation.kind}: ${relation.memory.path} [feedback: ${relation.feedback.id}; exact target: ${relation.target}; via: ${relation.via}]`,
    })),
    ...group.memoryPromotions.map((relation) => ({
      label: `${relation.promotionKind} promotion: ${relation.memory.path} [exact target: ${relation.target}; via: ${relation.via}]`,
    })),
    ...group.regressions.map((relation) => ({
      label: `regression: ${relation.memory.path} (${relation.memory.kind}) [test: ${relation.test}; exact target: ${relation.target}; via: ${relation.via}]`,
    })),
  ].sort((left, right) => left.label.localeCompare(right.label));
  const issues = group.issueProvenance.map((issue) => issue.via === "feedback"
    ? {
        label: `${issue.repository}#${issue.number} ${issue.url} [feedback: ${issue.feedback.id}; exact target: ${issue.target}; via: feedback]`,
      }
    : { label: `${issue.issue} [test: ${issue.test}; exact target: ${issue.target}; via: test]` });
  if (tests.length === 0 && feedback.length === 0 && memory.length === 0 && issues.length === 0) {
    return [none("No linked tests, Feedback, Memory, or Issues")];
  }
  return [
    section("Tests", tests, "No long-term automated owner"),
    ...(feedback.length === 0 ? [] : [section("Feedback", feedback)]),
    ...(memory.length === 0 ? [] : [section("Memory", memory)]),
    ...(issues.length === 0 ? [] : [section("Issues", issues)]),
  ];
}

function featureShowTree(receipt: FeatureShowReceipt): string {
  const featureGroup = receipt.relationsByTarget.find((group) => group.scope === "feature");
  const useCaseGroups = receipt.useCases.map((useCase): TreeNode => {
    const group = receipt.relationsByTarget.find((candidate) =>
      candidate.scope === "use-case" && candidate.target === useCase.path
    );
    return {
      label: `${useCase.title} [${useCase.path}; via: ${useCase.via}]`,
      children: group === undefined ? targetRelations({
        target: useCase.path,
        scope: "use-case",
        title: useCase.title,
        tests: [],
        feedbackAdoptions: [],
        feedbackMemoryRelations: [],
        memoryPromotions: [],
        regressions: [],
        issueProvenance: [],
      }) : targetRelations(group),
    };
  });
  const related = [
    ...receipt.roadmaps.map((relation) => ({
      label: `Roadmap: ${relation.source.title} [${relation.source.path}; exact target: ${relation.target}; via: ${relation.via}]`,
    })),
    ...receipt.designs.map((relation) => ({
      label: `Design: ${relation.source.title} [${relation.source.path}; exact target: ${relation.target}; via: ${relation.via}]`,
    })),
    ...receipt.engineering.map((relation) => ({
      label: `Engineering: ${relation.source.title} [${relation.source.path}; exact target: ${relation.target}; via: ${relation.via}]`,
    })),
  ].sort((left, right) => left.label.localeCompare(right.label));
  const history = receipt.adoptionHistory.map((relation) => ({
    label: `${relation.feedback.id} [exact target: ${relation.target}; scope: ${relation.scope}; commit: ${relation.commit}; via: ${relation.via}]`,
  }));
  return renderTree({
    label: `Feature ${receipt.subject.id} — ${receipt.subject.title} [${receipt.subject.path}]`,
    children: [
      section("Pages", receipt.pages.map((page) => ({
        label: `${page.role}: ${page.title} [${page.path}]`,
      }))),
      ...(receipt.children.length === 0 ? [] : [section("Child Features", receipt.children.map((child) => ({
        label: `${child.id} — ${child.title} [selector: ${child.id}; path: ${child.path}]`,
      })))]),
      {
        label: "Feature-level Relations",
        children: featureGroup === undefined ? targetRelations({
          target: receipt.subject.path,
          scope: "feature",
          title: receipt.subject.title,
          tests: [],
          feedbackAdoptions: [],
          feedbackMemoryRelations: [],
          memoryPromotions: [],
          regressions: [],
          issueProvenance: [],
        }) : targetRelations(featureGroup),
      },
      section("Use Cases", useCaseGroups),
      ...(history.length === 0 ? [] : [section("Adoption History", history)]),
      ...(related.length === 0 ? [] : [section("Related Docs", related)]),
      ...(receipt.findings.length === 0 ? [] : [section("Findings", receipt.findings.map((finding) => ({
        label: `${finding.code}: ${finding.subject}: ${finding.message}`,
      })))]),
    ],
  });
}

function testShowTree(receipt: TestShowReceipt): string {
  const metadata: TreeNode[] = [
    { label: `Lanes: ${receipt.test.lane.join(", ") || "None"}` },
    { label: `Areas: ${receipt.test.areas.join(", ") || "None"}` },
    { label: `Executor: ${receipt.test.executor.kind}` },
  ];
  return renderTree({
    label: `Test ${receipt.subject.path}`,
    children: [
      { label: `Repository: ${receipt.test.repo}` },
      section("Metadata", metadata),
      {
        label: `Owner: ${receipt.owner.ref}`,
        children: [
          { label: `Description: ${receipt.owner.description}` },
          { label: `Contract (${receipt.contract.kind}): ${receipt.contract.ref}` },
        ],
      },
      section("Features", receipt.features.map((feature) => ({
        label: `${feature.id} — ${feature.title} [${feature.path}]`,
      }))),
      section("Regression Memory", receipt.regressions.map((relation) => ({
        label: `${relation.memory.path} (${relation.memory.kind}) [exact target: ${relation.target}; via: ${relation.via}]`,
      }))),
      section("Issues", receipt.issueProvenance.map((issue) => issue.via === "test"
        ? { label: `${issue.issue} [via: test]` }
        : { label: `${issue.repository}#${issue.number} ${issue.url} [via: feedback]` })),
      section("Findings", receipt.findings.map((finding) => ({
        label: `${finding.code}: ${finding.subject}: ${finding.message}`,
      }))),
    ],
  });
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
    case "TraceSnapshotChanged":
      return `${error._tag}: docs trace generation changed from ${error.before} to ${error.after} while compiling ${error.path} after ${error.attempts} attempts; retry after the active relation mutation finishes`;
    case "TraceMutationActive":
      return `${error._tag}: docs trace mutation is active at ${error.path} after ${error.attempts} attempts; retry after it finishes`;
    case "TraceInputChanged":
      return `${error._tag}: trace inputs changed while compiling ${error.path} after ${error.attempts} attempts (${error.changed.join(", ")}); retry after the files stop changing`;
    case "TraceRecoveryRequired":
      return `${error._tag}: unfinished Trace publication at ${error.path}; run ${error.nextStep}`;
    case "TraceRecoveryConflict":
      return `${error._tag}: ${error.path}: ${error.message}`;
  }
}

/** The CLI owns output; this pure renderer consumes the same receipt as JSON. */
export function renderTraceReceipt(receipt: TraceReceipt): string {
  switch (receipt.operation) {
    case "feature-list":
      return featureListTree(receipt);
    case "test-list":
      return testListTree(receipt);
    case "feature-show":
      return featureShowTree(receipt);
    case "test-show":
      return testShowTree(receipt);
  }
}

/** Human-only enriched list; its details never alter the stable list-v1 JSON receipt. */
export function renderTestListReceipt(receipt: TestListReceipt, details: readonly TestShowReceipt[]): string {
  return testListTree(receipt, details);
}
