import { Effect } from "effect";

import { TraceSelectorAmbiguous, TraceSelectorMissing } from "./errors.js";
import type { FeatureListInput, FeatureListReceipt, FeatureShowReceipt, TestListInput, TestListReceipt, TestShowReceipt, TraceMemory, TraceNode, TraceSnapshot, TraceTest } from "./model.js";
export { compileTrace } from "./compiler.js";
export * from "./errors.js";
export type * from "./model.js";
export { renderTraceError, renderTraceReceipt, type TraceReceipt } from "./presentation.js";

const byPath = <A extends { readonly path: string }>(values: readonly A[]): readonly A[] => [...values].sort((a, b) => a.path.localeCompare(b.path));
const featureId = (path: string): string => path.replace(/^docs\/feature\//u, "").replace(/\/README\.md$/u, "");
const pathOf = (reference: string): string => reference.split("#", 1)[0] ?? reference;
const featureOfPath = (snapshot: TraceSnapshot, path: string): TraceNode | undefined => {
  const exact = snapshot.nodes.find((node) => node.kind === "feature" && node.path === path);
  if (exact !== undefined) return exact;
  const candidates = snapshot.nodes.filter((node) =>
    node.kind === "feature" && path.startsWith(node.path.slice(0, -"README.md".length))
  );
  return candidates.sort((a, b) => b.path.length - a.path.length)[0];
};
const memoryFor = (snapshot: TraceSnapshot, paths: readonly string[]): readonly TraceMemory[] => byPath(snapshot.memory.filter((item) => paths.includes(item.path)));
const selectors = (snapshot: TraceSnapshot, selector: string): readonly TraceNode[] => snapshot.nodes.filter((node) =>
  node.kind === "feature" && (node.path === selector || featureId(node.path) === selector)
);

function uniqueFeatures(snapshot: TraceSnapshot, paths: readonly string[]): readonly TraceNode[] {
  return byPath([
    ...new Map(
      paths
        .map((path) => featureOfPath(snapshot, pathOf(path)))
        .filter((feature): feature is TraceNode => feature !== undefined)
        .map((feature) => [feature.path, feature]),
    ).values(),
  ]);
}

export function listFeatures(snapshot: TraceSnapshot, input: FeatureListInput = {}): FeatureListReceipt {
  const pattern = input.pattern?.toLocaleLowerCase();
  const features = snapshot.nodes
    .filter((node) => node.kind === "feature")
    .map((node) => ({ id: featureId(node.path), path: node.path, title: node.title }))
    .filter((feature) => pattern === undefined || [feature.id, feature.path, feature.title].some((value) => value.toLocaleLowerCase().includes(pattern)))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { format: "niceeval.docs-trace/list-v1", operation: "feature-list", snapshotDigest: snapshot.digest, generation: snapshot.generation, features };
}

export function listTests(snapshot: TraceSnapshot, input: TestListInput = {}): TestListReceipt {
  const pattern = input.pattern?.toLocaleLowerCase();
  const tests = snapshot.tests
    .filter((test) => pattern === undefined || [test.path, test.repo, test.owner].some((value) => value.toLocaleLowerCase().includes(pattern)))
    .map((test) => ({ path: test.path, repo: test.repo, owner: test.owner }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { format: "niceeval.docs-trace/list-v1", operation: "test-list", snapshotDigest: snapshot.digest, generation: snapshot.generation, tests };
}

export function showFeature(snapshot: TraceSnapshot, selector: string): Effect.Effect<FeatureShowReceipt, TraceSelectorMissing | TraceSelectorAmbiguous> {
  const matches = selectors(snapshot, selector);
  if (matches.length === 0) return Effect.fail(new TraceSelectorMissing({ selector, subject: "feature" }));
  if (matches.length !== 1) return Effect.fail(new TraceSelectorAmbiguous({ selector, candidates: matches.map((item) => item.path).sort() }));
  const subject = matches[0]!;
  const packageRoot = subject.path.slice(0, -"README.md".length);
  const children = snapshot.nodes.filter((node) => {
    if (node.kind !== "feature" || node.path === subject.path || !node.path.startsWith(packageRoot)) return false;
    const child = node.path.slice(packageRoot.length);
    return child.split("/").length === 2 && child.endsWith("/README.md");
  });
  const localUseCases = snapshot.nodes.filter((node) =>
    node.kind === "use-case" && featureOfPath(snapshot, node.path)?.path === subject.path
  );
  const localUseCasePaths = new Set(localUseCases.map((useCase) => useCase.path));
  const composed = snapshot.nodes.filter((node) => node.kind === "use-case" &&
    (node.relations.composes ?? []).some((target) => {
      const targetPath = pathOf(target);
      return localUseCasePaths.has(targetPath) || featureOfPath(snapshot, targetPath)?.path === subject.path;
    })
  );
  const useCases = byPath([...new Map([...localUseCases, ...composed].map((node) => [node.path, node])).values()]);
  const targets = new Set([subject.path, ...useCases.map((node) => node.path)]);
  const owners = snapshot.owners
    .filter((owner) => {
      const contractPath = pathOf(owner.contract);
      return targets.has(contractPath) || featureOfPath(snapshot, contractPath)?.path === subject.path;
    })
    .sort((a, b) => a.ref.localeCompare(b.ref));
  const ownersByRef = new Map(owners.map((owner) => [owner.ref, owner]));
  const ownerRefs = new Set(ownersByRef.keys());
  const tests = byPath(snapshot.tests.filter((test) => ownerRefs.has(test.owner)));
  const regressions = memoryFor(snapshot, tests.flatMap((test) => test.regressions.map(pathOf)));
  const testsByUseCase = useCases.map((useCase) => ({
    useCase: { path: useCase.path, title: useCase.title },
    tests: byPath(tests.filter((test) => pathOf(ownersByRef.get(test.owner)?.contract ?? "") === useCase.path)),
  }));
  const relatesToSubject = (target: string): boolean => {
    const targetPath = pathOf(target);
    return targetPath === subject.path || featureOfPath(snapshot, targetPath)?.path === subject.path;
  };
  const related = (relation: string, kind: TraceNode["kind"]): readonly TraceNode[] => byPath(
    snapshot.nodes.filter((node) => node.kind === kind && (node.relations[relation] ?? []).some(relatesToSubject)),
  );
  const currentMemory = byPath(snapshot.memory.filter((item) => item.currentPromotions.some(relatesToSubject)));
  return Effect.succeed({
    format: "niceeval.docs-trace/show-v1",
    operation: "feature-show",
    snapshotDigest: snapshot.digest,
    generation: snapshot.generation,
    subject: { kind: "feature", id: featureId(subject.path), path: subject.path, title: subject.title },
    children: byPath(children).map((node) => ({ id: featureId(node.path), path: node.path, title: node.title })),
    useCases: useCases.map((node) => ({ path: node.path, title: node.title })),
    owners,
    tests,
    testsByUseCase,
    roadmaps: related("buildsOn", "roadmap"),
    designs: related("decides", "design"),
    engineering: related("supports", "engineering"),
    currentMemory,
    regressions,
  });
}

export function showTest(snapshot: TraceSnapshot, selector: string): Effect.Effect<TestShowReceipt, TraceSelectorMissing | TraceSelectorAmbiguous> {
  const matches = snapshot.tests.filter((test) => test.path === selector);
  if (matches.length === 0) return Effect.fail(new TraceSelectorMissing({ selector, subject: "test" }));
  if (matches.length !== 1) return Effect.fail(new TraceSelectorAmbiguous({ selector, candidates: matches.map((item) => item.path).sort() }));
  const test = matches[0]!;
  const owner = snapshot.owners.find((item) => item.ref === test.owner);
  if (owner === undefined) return Effect.fail(new TraceSelectorMissing({ selector: test.owner, subject: "test" }));
  const contractPath = pathOf(owner.contract);
  const exactUseCase = snapshot.nodes.find((item) => item.kind === "use-case" && item.path === contractPath);
  const contract = exactUseCase === undefined ? { ref: owner.contract, kind: "feature" as const } : { ref: owner.contract, kind: "use-case" as const };
  const features = uniqueFeatures(snapshot, [
    contractPath,
    ...(exactUseCase?.relations.composes ?? []),
  ]);
  if (features.length === 0) {
    return Effect.fail(new TraceSelectorMissing({ selector: owner.contract, subject: "feature" }));
  }
  return Effect.succeed({
    format: "niceeval.docs-trace/show-v1",
    operation: "test-show",
    snapshotDigest: snapshot.digest,
    generation: snapshot.generation,
    subject: { kind: "test", path: test.path },
    test,
    owner,
    contract,
    features,
    regressions: memoryFor(snapshot, test.regressions.map(pathOf)),
  });
}
