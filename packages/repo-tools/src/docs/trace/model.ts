export type DocsNodeKind = "feature" | "roadmap" | "engineering" | "design" | "design-plan" | "use-case";
export type TraceScope = "feature" | "use-case";
export type TracePageRole = "overview" | "library" | "cli" | "architecture" | "lifecycle" | "reference" | "supporting";

export interface TraceNode {
  readonly kind: DocsNodeKind;
  readonly path: string;
  readonly title: string;
  readonly relations: Readonly<Record<string, readonly string[]>>;
}

export interface TracePage {
  readonly path: string;
  readonly title: string;
  readonly role: TracePageRole;
  readonly feature: string;
}

export interface TraceOwner {
  readonly ref: string;
  readonly path: string;
  readonly anchor: string;
  readonly contract: string;
  readonly description: string;
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

export interface TraceFeedbackSourceIssue {
  readonly kind: "issue";
  readonly repository: string;
  readonly number: number;
  readonly url: string;
}

export type TraceFeedbackSource = TraceFeedbackSourceIssue | {
  readonly kind: "dogfood";
  readonly repository: string;
  readonly originId: string;
  readonly commit: string;
} | {
  readonly kind: "dev";
  readonly repository: string;
  readonly commit?: string | undefined;
};

export interface TraceFeedback {
  readonly path: string;
  readonly id: string;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly source: TraceFeedbackSource;
  readonly subject: "product" | "repository" | "dependency";
  readonly claim: "defect" | "friction" | "request";
  readonly adoptions: {
    readonly current: readonly string[];
    readonly history: readonly { readonly target: string; readonly commit: string }[];
  };
  readonly memoryRelations: readonly {
    readonly kind: "investigation" | "root-cause" | "decision" | "delivery";
    readonly memory: string;
  }[];
  /** Digest of the complete decoded metadata, including closure credentials. */
  readonly metadataDigest: string;
}

export interface TraceMemoryPromotion {
  readonly kind: "roadmap" | "feature" | "use-case" | "engineering";
  readonly current: readonly string[];
  readonly history: readonly { readonly target: string; readonly commit: string }[];
}

export interface TraceMemory {
  readonly path: string;
  readonly id: string;
  readonly title: string;
  readonly kind: "problem" | "decision" | "insight" | "legacy/unstructured";
  readonly state?: "open" | "resolved" | "adopted" | "current" | "superseded";
  readonly promotions: readonly TraceMemoryPromotion[];
  /** Digest of decoded structured metadata. Legacy body bytes intentionally do not participate. */
  readonly metadataDigest?: string;
}

export interface TraceSnapshot {
  readonly digest: string;
  readonly generation: number;
  readonly nodes: readonly TraceNode[];
  readonly pages: readonly TracePage[];
  readonly owners: readonly TraceOwner[];
  readonly tests: readonly TraceTest[];
  readonly feedback: readonly TraceFeedback[];
  readonly memory: readonly TraceMemory[];
}

export interface TraceTargetRelation {
  readonly target: string;
  readonly scope: TraceScope;
  readonly via: string;
}

export interface TraceFeedbackSummary {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly state: "open" | "closed";
}

export interface TraceMemorySummary {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly kind: TraceMemory["kind"];
  readonly state?: TraceMemory["state"];
}

export interface TraceScopedTest extends TraceTargetRelation {
  readonly via: "owner";
  readonly path: string;
  readonly repo: string;
  readonly owner: string;
  readonly lane: readonly string[];
  readonly areas: readonly string[];
  readonly executor: { readonly kind: string };
}

export interface TraceFeedbackAdoption extends TraceTargetRelation {
  readonly via: "feedback-adoption";
  readonly feedback: TraceFeedbackSummary;
}

export interface TraceFeedbackMemoryRelation extends TraceTargetRelation {
  readonly via: "feedback-memory-relation";
  readonly kind: "investigation" | "root-cause" | "decision" | "delivery";
  readonly feedback: TraceFeedbackSummary;
  readonly memory: TraceMemorySummary;
}

export interface TraceMemoryPromotionRelation extends TraceTargetRelation {
  readonly via: "memory-promotion";
  readonly promotionKind: TraceMemoryPromotion["kind"];
  readonly memory: TraceMemorySummary;
}

export interface TraceAdoptionHistory extends TraceTargetRelation {
  readonly via: "feedback-adoption-history";
  readonly feedback: TraceFeedbackSummary;
  readonly commit: string;
}

export interface TraceRegression extends TraceTargetRelation {
  readonly via: "test-regression";
  readonly test: string;
  readonly memory: TraceMemorySummary;
}

export type TraceIssueProvenance = TraceTargetRelation & ({
  readonly via: "feedback";
  readonly feedback: TraceFeedbackSummary;
  readonly repository: string;
  readonly number: number;
  readonly url: string;
} | {
  readonly via: "test";
  readonly test: string;
  readonly issue: string;
});

export interface TraceFinding {
  readonly code: string;
  readonly subject: string;
  readonly message: string;
}

export interface TraceNodeRelation extends TraceTargetRelation {
  readonly source: {
    readonly kind: DocsNodeKind;
    readonly path: string;
    readonly title: string;
  };
}

export interface TraceRelationsByTarget {
  readonly target: string;
  readonly scope: TraceScope;
  readonly title: string;
  readonly tests: readonly TraceScopedTest[];
  readonly feedbackAdoptions: readonly TraceFeedbackAdoption[];
  readonly feedbackMemoryRelations: readonly TraceFeedbackMemoryRelation[];
  readonly memoryPromotions: readonly TraceMemoryPromotionRelation[];
  readonly regressions: readonly TraceRegression[];
  readonly issueProvenance: readonly TraceIssueProvenance[];
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
  readonly format: "niceeval.docs-trace/show-v2";
  readonly operation: "feature-show";
  readonly snapshotDigest: string;
  readonly generation: number;
  readonly subject: {
    readonly kind: "feature";
    readonly id: string;
    readonly path: string;
    readonly title: string;
  };
  readonly pages: readonly Omit<TracePage, "feature">[];
  readonly children: readonly { readonly id: string; readonly path: string; readonly title: string }[];
  readonly useCases: readonly {
    readonly path: string;
    readonly title: string;
    readonly via: "containment" | "composes";
  }[];
  readonly relationsByTarget: readonly TraceRelationsByTarget[];
  readonly tests: readonly TraceScopedTest[];
  readonly feedbackAdoptions: readonly TraceFeedbackAdoption[];
  readonly feedbackMemoryRelations: readonly TraceFeedbackMemoryRelation[];
  readonly memoryPromotions: readonly TraceMemoryPromotionRelation[];
  readonly regressions: readonly TraceRegression[];
  readonly issueProvenance: readonly TraceIssueProvenance[];
  readonly adoptionHistory: readonly TraceAdoptionHistory[];
  readonly findings: readonly TraceFinding[];
  readonly roadmaps: readonly TraceNodeRelation[];
  readonly designs: readonly TraceNodeRelation[];
  readonly engineering: readonly TraceNodeRelation[];
}

export interface TestShowReceipt {
  readonly format: "niceeval.docs-trace/show-v2";
  readonly operation: "test-show";
  readonly snapshotDigest: string;
  readonly generation: number;
  readonly subject: { readonly kind: "test"; readonly path: string };
  readonly test: {
    readonly path: string;
    readonly repo: string;
    readonly lane: readonly string[];
    readonly areas: readonly string[];
    readonly executor: { readonly kind: string };
  };
  readonly owner: TraceOwner;
  readonly contract: { readonly ref: string; readonly kind: TraceScope };
  readonly features: readonly { readonly id: string; readonly path: string; readonly title: string }[];
  readonly regressions: readonly TraceRegression[];
  readonly issueProvenance: readonly TraceIssueProvenance[];
  readonly findings: readonly TraceFinding[];
}
