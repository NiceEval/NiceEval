export type DocsNodeKind = "feature" | "roadmap" | "engineering" | "design" | "design-plan" | "use-case";

export interface TraceNode {
  readonly kind: DocsNodeKind;
  readonly path: string;
  readonly title: string;
  readonly relations: Readonly<Record<string, readonly string[]>>;
}

export interface TraceOwner {
  readonly ref: string;
  readonly path: string;
  readonly anchor: string;
  readonly contract: string;
}

export interface TraceTest {
  readonly path: string;
  readonly repo: string;
  readonly owner: string;
  readonly regressions: readonly string[];
  readonly issues: readonly string[];
  readonly lane: readonly string[];
  readonly areas: readonly string[];
  readonly executor: { readonly kind: string };
}

export interface TraceMemory {
  readonly path: string;
  readonly kind: "problem" | "decision" | "insight" | "legacy/unstructured";
  readonly currentPromotions: readonly string[];
}

export interface TraceSnapshot {
  readonly digest: string;
  readonly generation: number;
  readonly nodes: readonly TraceNode[];
  readonly owners: readonly TraceOwner[];
  readonly tests: readonly TraceTest[];
  readonly memory: readonly TraceMemory[];
}

export interface FeatureListInput { readonly pattern?: string; }
export interface TestListInput { readonly pattern?: string; }
export interface FeatureListReceipt {
  readonly format: "niceeval.docs-trace/list-v1";
  readonly operation: "feature-list";
  readonly snapshotDigest: string;
  readonly generation: number;
  readonly features: readonly { readonly id: string; readonly path: string; readonly title: string }[];
}
export interface TestListReceipt {
  readonly format: "niceeval.docs-trace/list-v1";
  readonly operation: "test-list";
  readonly snapshotDigest: string;
  readonly generation: number;
  readonly tests: readonly { readonly path: string; readonly repo: string; readonly owner: string }[];
}
export interface FeatureShowReceipt {
  readonly format: "niceeval.docs-trace/show-v1";
  readonly operation: "feature-show";
  readonly snapshotDigest: string;
  readonly generation: number;
  readonly subject: {
    readonly kind: "feature";
    readonly id: string;
    readonly path: string;
    readonly title: string;
  };
  readonly children: readonly { readonly id: string; readonly path: string; readonly title: string }[];
  readonly useCases: readonly { readonly path: string; readonly title: string }[];
  readonly owners: readonly TraceOwner[];
  readonly tests: readonly TraceTest[];
  readonly testsByUseCase: readonly {
    readonly useCase: { readonly path: string; readonly title: string };
    readonly tests: readonly TraceTest[];
  }[];
  readonly roadmaps: readonly TraceNode[];
  readonly designs: readonly TraceNode[];
  readonly engineering: readonly TraceNode[];
  readonly currentMemory: readonly TraceMemory[];
  readonly regressions: readonly TraceMemory[];
}
export interface TestShowReceipt {
  readonly format: "niceeval.docs-trace/show-v1";
  readonly operation: "test-show";
  readonly snapshotDigest: string;
  readonly generation: number;
  readonly subject: { readonly kind: "test"; readonly path: string };
  readonly test: TraceTest;
  readonly owner: TraceOwner;
  readonly contract: { readonly ref: string; readonly kind: "feature" | "use-case" };
  readonly features: readonly TraceNode[];
  readonly regressions: readonly TraceMemory[];
}
