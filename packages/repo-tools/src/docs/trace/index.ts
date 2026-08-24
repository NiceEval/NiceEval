import { Effect, Either } from "effect";

import { TraceSelectorAmbiguous, TraceSelectorMissing } from "./errors.js";
import type {
  FeatureListInput,
  FeatureListReceipt,
  FeatureShowReceipt,
  TestListInput,
  TestListReceipt,
  TestShowReceipt,
  TraceAdoptionHistory,
  TraceFeedback,
  TraceFeedbackAdoption,
  TraceFeedbackMemoryRelation,
  TraceFeedbackSummary,
  TraceIssueProvenance,
  TraceMemory,
  TraceMemoryPromotionRelation,
  TraceMemorySummary,
  TraceNode,
  TraceNodeRelation,
  TraceRegression,
  TraceRelationsByTarget,
  TraceScope,
  TraceScopedTest,
  TraceSnapshot,
} from "./model.js";
import { parseRepoRef, resolveRepoRefScope } from "./ref.js";

export { compileTrace, compileTraceUnderLease } from "./compiler.js";
export * from "./errors.js";
export * from "./ref.js";
export * from "./relation-mutation.js";
export type * from "./model.js";
export { renderTestListReceipt, renderTraceError, renderTraceReceipt, type TraceReceipt } from "./presentation.js";

const byKey = <A>(values: readonly A[], key: (value: A) => string): readonly A[] =>
  [...values].sort((left, right) => key(left).localeCompare(key(right)));
const byPath = <A extends { readonly path: string }>(values: readonly A[]): readonly A[] =>
  byKey(values, (value) => value.path);
const featureId = (path: string): string => path.replace(/^docs\/feature\//u, "").replace(/\/README\.md$/u, "");
const pathOf = (reference: string): string => {
  const parsed = parseRepoRef(reference);
  return Either.isRight(parsed) ? parsed.right.path : reference;
};
const pageRoleOrder = ["overview", "library", "cli", "architecture", "lifecycle", "reference", "supporting"] as const;

const featureOfPath = (snapshot: TraceSnapshot, path: string): TraceNode | undefined => {
  const exact = snapshot.nodes.find((node) => node.kind === "feature" && node.path === path);
  if (exact !== undefined) return exact;
  return snapshot.nodes
    .filter((node) => node.kind === "feature" && path.startsWith(node.path.slice(0, -"README.md".length)))
    .sort((left, right) => right.path.length - left.path.length)[0];
};

const parentFeature = (snapshot: TraceSnapshot, child: TraceNode): TraceNode | undefined => snapshot.nodes
  .filter((node) => node.kind === "feature" && node.path !== child.path &&
    child.path.startsWith(node.path.slice(0, -"README.md".length)))
  .sort((left, right) => right.path.length - left.path.length)[0];

const insideUseCaseBoundary = (snapshot: TraceSnapshot, path: string): boolean => snapshot.nodes.some((node) =>
  node.kind === "use-case" && node.path.endsWith("/README.md") && path !== node.path &&
  path.startsWith(node.path.slice(0, -"README.md".length))
);

function relationTarget(
  snapshot: TraceSnapshot,
  reference: string,
): { readonly target: string; readonly scope: TraceScope } | undefined {
  const targetPath = pathOf(reference);
  const directNode = snapshot.nodes.some((node) => node.path === targetPath);
  const supportingPage = snapshot.pages.some((page) => page.path === targetPath);
  if (!directNode && !supportingPage) return undefined;
  const resolved = resolveRepoRefScope(snapshot, reference, supportingPage ? "compiled target source" : undefined);
  if (Either.isLeft(resolved)) return undefined;
  if (resolved.right.kind === "use-case" && resolved.right.directNode) {
    return { target: reference, scope: "use-case" };
  }
  return resolved.right.kind === "feature" && !insideUseCaseBoundary(snapshot, targetPath)
    ? { target: reference, scope: "feature" }
    : undefined;
}

function featuresForTarget(snapshot: TraceSnapshot, reference: string): readonly TraceNode[] {
  const targetPath = pathOf(reference);
  const useCase = snapshot.nodes.find((node) => node.kind === "use-case" && node.path === targetPath);
  const paths = useCase?.relations.composes ?? [targetPath];
  return byPath([
    ...new Map(
      paths
        .map((path) => featureOfPath(snapshot, pathOf(path)))
        .filter((feature): feature is TraceNode => feature !== undefined)
        .map((feature) => [feature.path, feature]),
    ).values(),
  ]);
}

const feedbackSummary = (feedback: TraceFeedback): TraceFeedbackSummary => ({
  id: feedback.id,
  path: feedback.path,
  title: feedback.title,
  state: feedback.state,
});

const memorySummary = (memory: TraceMemory): TraceMemorySummary => ({
  id: memory.id,
  path: memory.path,
  title: memory.title,
  kind: memory.kind,
  ...(memory.state === undefined ? {} : { state: memory.state }),
});

const relationKey = (relation: { readonly target: string; readonly via: string }): string =>
  `${relation.target}\0${relation.via}\0${JSON.stringify(relation)}`;

function selectorMatches(snapshot: TraceSnapshot, selector: string): readonly TraceNode[] {
  return snapshot.nodes.filter((node) =>
    node.kind === "feature" && (node.path === selector || featureId(node.path) === selector)
  );
}

export function listFeatures(snapshot: TraceSnapshot, input: FeatureListInput = {}): FeatureListReceipt {
  const pattern = input.pattern?.toLocaleLowerCase();
  const features = snapshot.nodes
    .filter((node) => node.kind === "feature")
    .map((node) => ({ id: featureId(node.path), path: node.path, title: node.title }))
    .filter((feature) => pattern === undefined ||
      [feature.id, feature.path, feature.title].some((value) => value.toLocaleLowerCase().includes(pattern)))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    format: "niceeval.docs-trace/list-v1",
    operation: "feature-list",
    snapshotDigest: snapshot.digest,
    generation: snapshot.generation,
    features,
  };
}

export function listTests(snapshot: TraceSnapshot, input: TestListInput = {}): TestListReceipt {
  const pattern = input.pattern?.toLocaleLowerCase();
  const owners = new Map(snapshot.owners.map((owner) => [owner.ref, owner]));
  const memory = new Map(snapshot.memory.map((entry) => [entry.path, entry]));
  const tests = snapshot.tests
    .filter((test) => {
      if (pattern === undefined) return true;
      const contract = owners.get(test.owner)?.contract;
      const features = contract === undefined ? [] : featuresForTarget(snapshot, contract);
      const regressionValues = test.regressions.flatMap((reference) => {
        const entry = memory.get(pathOf(reference));
        return entry === undefined ? [reference] : [reference, entry.id, entry.path, entry.title, entry.kind, entry.state ?? ""];
      });
      return [
        test.path,
        test.repo,
        test.owner,
        contract ?? "",
        ...features.flatMap((feature) => [featureId(feature.path), feature.path, feature.title]),
        ...regressionValues,
        ...test.issues,
      ].some((value) => value.toLocaleLowerCase().includes(pattern));
    })
    .map((test) => ({ path: test.path, repo: test.repo, owner: test.owner }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    format: "niceeval.docs-trace/list-v1",
    operation: "test-list",
    snapshotDigest: snapshot.digest,
    generation: snapshot.generation,
    tests,
  };
}

export function showFeature(
  snapshot: TraceSnapshot,
  selector: string,
): Effect.Effect<FeatureShowReceipt, TraceSelectorMissing | TraceSelectorAmbiguous> {
  const matches = selectorMatches(snapshot, selector);
  if (matches.length === 0) return Effect.fail(new TraceSelectorMissing({ selector, subject: "feature" }));
  if (matches.length !== 1) {
    return Effect.fail(new TraceSelectorAmbiguous({
      selector,
      candidates: matches.map((item) => item.path).sort(),
    }));
  }
  const subject = matches[0];
  if (subject === undefined) return Effect.fail(new TraceSelectorMissing({ selector, subject: "feature" }));
  const children = byPath(snapshot.nodes.filter((node) =>
    node.kind === "feature" && parentFeature(snapshot, node)?.path === subject.path
  ));

  const localUseCases = snapshot.nodes.filter((node) =>
    node.kind === "use-case" && featureOfPath(snapshot, node.path)?.path === subject.path
  );
  const localUseCasePaths = new Set(localUseCases.map((node) => node.path));
  const composedUseCases = snapshot.nodes.filter((node) => node.kind === "use-case" &&
    (node.relations.composes ?? []).some((reference) => {
      const target = relationTarget(snapshot, reference);
      return target?.scope === "use-case"
        ? localUseCasePaths.has(pathOf(target.target))
        : target?.scope === "feature" && featureOfPath(snapshot, pathOf(target.target))?.path === subject.path;
    }));
  const useCaseVia = new Map<string, "containment" | "composes">([
    ...composedUseCases.map((node) => [node.path, "composes" as const] as const),
    ...localUseCases.map((node) => [node.path, "containment" as const] as const),
  ]);
  const useCaseNodes = byPath(snapshot.nodes.filter((node) => node.kind === "use-case" && useCaseVia.has(node.path)));
  const useCasePaths = new Set(useCaseNodes.map((node) => node.path));
  const includedTarget = (reference: string): { readonly target: string; readonly scope: TraceScope } | undefined => {
    const relation = relationTarget(snapshot, reference);
    if (relation?.scope === "use-case") {
      return useCasePaths.has(pathOf(relation.target)) ? relation : undefined;
    }
    return relation?.scope === "feature" && featureOfPath(snapshot, pathOf(relation.target))?.path === subject.path
      ? relation
      : undefined;
  };

  const ownersByRef = new Map(snapshot.owners.map((owner) => [owner.ref, owner]));
  const scopedTests: TraceScopedTest[] = [];
  for (const test of snapshot.tests) {
    const owner = ownersByRef.get(test.owner);
    if (owner === undefined) continue;
    const target = includedTarget(owner.contract);
    if (target === undefined) continue;
    scopedTests.push({
      ...target,
      via: "owner",
      path: test.path,
      repo: test.repo,
      owner: test.owner,
      lane: test.lane,
      areas: test.areas,
      executor: test.executor,
    });
  }
  const tests = byKey(scopedTests, relationKey);

  const feedbackAdoptions: TraceFeedbackAdoption[] = [];
  const feedbackMemoryRelations: TraceFeedbackMemoryRelation[] = [];
  const adoptionHistory: TraceAdoptionHistory[] = [];
  const issueProvenance: TraceIssueProvenance[] = [];
  const memoryById = new Map(snapshot.memory.map((memory) => [memory.id, memory]));

  for (const feedback of snapshot.feedback) {
    const summary = feedbackSummary(feedback);
    for (const reference of feedback.adoptions.current) {
      const target = includedTarget(reference);
      if (target === undefined) continue;
      feedbackAdoptions.push({ ...target, via: "feedback-adoption", feedback: summary });
      for (const relation of feedback.memoryRelations) {
        const memory = memoryById.get(relation.memory);
        if (memory === undefined) continue;
        feedbackMemoryRelations.push({
          ...target,
          via: "feedback-memory-relation",
          kind: relation.kind,
          feedback: summary,
          memory: memorySummary(memory),
        });
      }
      if (feedback.source.kind === "issue") {
        issueProvenance.push({
          ...target,
          via: "feedback",
          feedback: summary,
          repository: feedback.source.repository,
          number: feedback.source.number,
          url: feedback.source.url,
        });
      }
    }
    for (const history of feedback.adoptions.history) {
      const target = includedTarget(history.target);
      if (target === undefined) continue;
      adoptionHistory.push({
        ...target,
        via: "feedback-adoption-history",
        feedback: summary,
        commit: history.commit,
      });
    }
  }

  const memoryPromotions: TraceMemoryPromotionRelation[] = [];
  for (const memory of snapshot.memory) {
    for (const promotion of memory.promotions) {
      for (const reference of promotion.current) {
        const target = includedTarget(reference);
        if (target === undefined) continue;
        memoryPromotions.push({
          ...target,
          via: "memory-promotion",
          promotionKind: promotion.kind,
          memory: memorySummary(memory),
        });
      }
    }
  }

  const regressions: TraceRegression[] = [];
  for (const relation of tests) {
    const test = snapshot.tests.find((item) => item.path === relation.path);
    if (test === undefined) continue;
    for (const reference of test.regressions) {
      const memory = snapshot.memory.find((item) => item.path === pathOf(reference));
      if (memory === undefined) continue;
      regressions.push({
        target: relation.target,
        scope: relation.scope,
        via: "test-regression",
        test: test.path,
        memory: memorySummary(memory),
      });
    }
    for (const issue of test.issues) {
      issueProvenance.push({
        target: relation.target,
        scope: relation.scope,
        via: "test",
        test: test.path,
        issue,
      });
    }
  }

  const stableFeedbackAdoptions = byKey(feedbackAdoptions, relationKey);
  const stableFeedbackMemoryRelations = byKey(feedbackMemoryRelations, relationKey);
  const stableMemoryPromotions = byKey(memoryPromotions, relationKey);
  const stableRegressions = byKey(regressions, relationKey);
  const stableIssueProvenance = byKey(issueProvenance, relationKey);

  const belongsToGroup = (
    relation: { readonly target: string; readonly scope: TraceScope },
    group: { readonly target: string; readonly scope: TraceScope },
  ): boolean => relation.scope === group.scope && (group.scope === "use-case"
    ? pathOf(relation.target) === group.target
    : featureOfPath(snapshot, pathOf(relation.target))?.path === group.target);
  const relationGroups = [
    { target: subject.path, scope: "feature" as const, title: subject.title },
    ...useCaseNodes.map((node) => ({ target: node.path, scope: "use-case" as const, title: node.title })),
  ];
  const relationsByTarget: readonly TraceRelationsByTarget[] = relationGroups
    .map((group): TraceRelationsByTarget => ({
      ...group,
      tests: tests.filter((relation) => belongsToGroup(relation, group)),
      feedbackAdoptions: stableFeedbackAdoptions.filter((relation) => belongsToGroup(relation, group)),
      feedbackMemoryRelations: stableFeedbackMemoryRelations.filter((relation) => belongsToGroup(relation, group)),
      memoryPromotions: stableMemoryPromotions.filter((relation) => belongsToGroup(relation, group)),
      regressions: stableRegressions.filter((relation) => belongsToGroup(relation, group)),
      issueProvenance: stableIssueProvenance.filter((relation) => belongsToGroup(relation, group)),
    }))
    .filter((group) => group.tests.length > 0 || group.feedbackAdoptions.length > 0 ||
      group.feedbackMemoryRelations.length > 0 || group.memoryPromotions.length > 0 ||
      group.regressions.length > 0 || group.issueProvenance.length > 0);

  const related = (relationName: string, kind: TraceNode["kind"]): readonly TraceNodeRelation[] => byKey(
    snapshot.nodes.flatMap((node): TraceNodeRelation[] => {
      if (node.kind !== kind) return [];
      return (node.relations[relationName] ?? []).flatMap((reference): TraceNodeRelation[] => {
        const target = includedTarget(reference);
        return target?.scope === "feature"
          ? [{
              ...target,
              via: relationName,
              source: { kind: node.kind, path: node.path, title: node.title },
            }]
          : [];
      });
    }),
    relationKey,
  );

  return Effect.succeed({
    format: "niceeval.docs-trace/show-v2",
    operation: "feature-show",
    snapshotDigest: snapshot.digest,
    generation: snapshot.generation,
    subject: { kind: "feature", id: featureId(subject.path), path: subject.path, title: subject.title },
    pages: byKey(snapshot.pages.filter((page) => page.feature === subject.path), (page) =>
      `${String(pageRoleOrder.indexOf(page.role)).padStart(2, "0")}\0${page.path}`)
      .map(({ feature: _feature, ...page }) => page),
    children: children.map((node) => ({ id: featureId(node.path), path: node.path, title: node.title })),
    useCases: useCaseNodes.map((node) => ({
      path: node.path,
      title: node.title,
      via: useCaseVia.get(node.path) ?? "containment",
    })),
    relationsByTarget,
    tests,
    feedbackAdoptions: stableFeedbackAdoptions,
    feedbackMemoryRelations: stableFeedbackMemoryRelations,
    memoryPromotions: stableMemoryPromotions,
    regressions: stableRegressions,
    issueProvenance: stableIssueProvenance,
    adoptionHistory: byKey(adoptionHistory, relationKey),
    findings: [],
    roadmaps: related("buildsOn", "roadmap"),
    designs: related("decides", "design"),
    engineering: related("supports", "engineering"),
  });
}

export function showTest(
  snapshot: TraceSnapshot,
  selector: string,
): Effect.Effect<TestShowReceipt, TraceSelectorMissing | TraceSelectorAmbiguous> {
  const matches = snapshot.tests.filter((test) => test.path === selector);
  if (matches.length === 0) return Effect.fail(new TraceSelectorMissing({ selector, subject: "test" }));
  if (matches.length !== 1) {
    return Effect.fail(new TraceSelectorAmbiguous({
      selector,
      candidates: matches.map((item) => item.path).sort(),
    }));
  }
  const test = matches[0];
  if (test === undefined) return Effect.fail(new TraceSelectorMissing({ selector, subject: "test" }));
  const owner = snapshot.owners.find((item) => item.ref === test.owner);
  if (owner === undefined) return Effect.fail(new TraceSelectorMissing({ selector: test.owner, subject: "test" }));
  const target = relationTarget(snapshot, owner.contract);
  if (target === undefined) {
    return Effect.fail(new TraceSelectorMissing({ selector: owner.contract, subject: "feature" }));
  }
  const features = featuresForTarget(snapshot, owner.contract);
  if (features.length === 0) {
    return Effect.fail(new TraceSelectorMissing({ selector: owner.contract, subject: "feature" }));
  }

  const regressions = byKey(test.regressions.flatMap((reference): TraceRegression[] => {
    const memory = snapshot.memory.find((item) => item.path === pathOf(reference));
    return memory === undefined ? [] : [{
      ...target,
      via: "test-regression",
      test: test.path,
      memory: memorySummary(memory),
    }];
  }), relationKey);
  const issueProvenance = byKey(test.issues.map((issue): TraceIssueProvenance => ({
    ...target,
    via: "test",
    test: test.path,
    issue,
  })), relationKey);

  return Effect.succeed({
    format: "niceeval.docs-trace/show-v2",
    operation: "test-show",
    snapshotDigest: snapshot.digest,
    generation: snapshot.generation,
    subject: { kind: "test", path: test.path },
    test: {
      path: test.path,
      repo: test.repo,
      lane: test.lane,
      areas: test.areas,
      executor: test.executor,
    },
    owner,
    contract: { ref: owner.contract, kind: target.scope },
    features: features.map((feature) => ({
      id: featureId(feature.path),
      path: feature.path,
      title: feature.title,
    })),
    regressions,
    issueProvenance,
    findings: [],
  });
}
