import type { DesignPage } from "./schema.js";

export type DesignDecisionState =
  | { readonly _tag: "undecided" }
  | { readonly _tag: "decided"; readonly selectedPlan: string };

export interface DesignFileReceipt {
  readonly path: string;
  readonly digest: string;
  readonly byteLength: number;
}

export interface DesignPlanReceipt {
  readonly selector: string;
  readonly ref: string;
  readonly title: string;
  readonly pages: readonly DesignPage[];
}

export interface DesignManifestDigests {
  readonly designDecision: string;
  readonly featureDesign: string;
}

interface DesignMutationReceiptBase {
  readonly dryRun: boolean;
  readonly design: {
    readonly slug: string;
    readonly ref: string;
    readonly title: string;
    readonly state: DesignDecisionState;
  };
  readonly plans: readonly DesignPlanReceipt[];
  readonly manifestDigests: DesignManifestDigests;
  readonly snapshotDigest: string;
  readonly generation: number;
  readonly nextGeneration: number;
  readonly headCommit: string;
  readonly changedPaths: readonly string[];
  readonly files: readonly DesignFileReceipt[];
  readonly projectionDigest: string;
}

export interface DesignCreateReceipt extends DesignMutationReceiptBase {
  readonly format: "niceeval.docs-design/create-v1";
  readonly operation: "design-create";
  readonly cases: boolean;
}

export interface DesignCheckFinding {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface DesignCheckReceipt {
  readonly format: "niceeval.docs-design/check-v1";
  readonly operation: "design-check";
  readonly ok: boolean;
  readonly design: DesignMutationReceiptBase["design"];
  readonly plans: readonly DesignPlanReceipt[];
  readonly cases: boolean;
  readonly manifestDigests: DesignManifestDigests;
  readonly snapshotDigest: string;
  readonly generation: number;
  readonly files: readonly DesignFileReceipt[];
  readonly projectionDigest: string;
  readonly findings: readonly DesignCheckFinding[];
}

export interface DesignDecideReceipt extends DesignMutationReceiptBase {
  readonly format: "niceeval.docs-design/decide-v1";
  readonly operation: "design-decide";
  readonly selectedPlan: string;
}

export type DesignReceipt = DesignCreateReceipt | DesignCheckReceipt | DesignDecideReceipt;
