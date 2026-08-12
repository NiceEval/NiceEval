/**
 * Durable facts owned by the framework's `niceeval.plugin-provenance/v1`
 * Attachment.  These are deliberately data-only: a Plugin callback, raw
 * options, a credential value, a receiver payload, and a filesystem path have
 * no representation here.
 */

export type PluginProvenanceTextV1 = string;

export interface PluginProvenanceSourceV1 {
  readonly kind: "plugins-array";
  readonly position: number;
}

export type PluginBehaviorIdentityValueV1 = string | number | boolean | null;

export interface PluginBehaviorIdentityItemV1 {
  readonly key: PluginProvenanceTextV1;
  readonly value: PluginBehaviorIdentityValueV1;
}

export interface TypedAttachmentContributionRefV1 {
  readonly kind: "typed-attachment";
  readonly owner: "run" | "attempt";
  readonly family: {
    readonly name: PluginProvenanceTextV1;
    readonly schemaId: PluginProvenanceTextV1;
  };
}

export interface EvalOwnerFragmentContributionRefV1 {
  readonly kind: "owner-fragment";
  readonly owner: "eval";
  readonly field:
    | "requirements"
    | "sandbox-layer"
    | "flags"
    | "labels"
    | "eval-hook";
}

export interface ExperimentOwnerFragmentContributionRefV1 {
  readonly kind: "owner-fragment";
  readonly owner: "experiment";
  readonly field:
    | "requirements"
    | "sandbox-layer"
    | "flags"
    | "labels"
    | "experiment-hook";
}

export type OwnerFragmentContributionRefV1 =
  | EvalOwnerFragmentContributionRefV1
  | ExperimentOwnerFragmentContributionRefV1;

export interface ReceiverProjectionContributionRefV1 {
  readonly kind: "receiver-projection";
  readonly scope: "run" | "attempt";
  readonly receiver: PluginProvenanceTextV1;
  readonly projection: PluginProvenanceTextV1;
}

export type PluginContributionRefV1 =
  | TypedAttachmentContributionRefV1
  | OwnerFragmentContributionRefV1
  | ReceiverProjectionContributionRefV1;

export type RunPluginContributionRefV1 =
  | (TypedAttachmentContributionRefV1 & { readonly owner: "run" })
  | ExperimentOwnerFragmentContributionRefV1
  | (ReceiverProjectionContributionRefV1 & { readonly scope: "run" });

export type EvalAttemptPluginContributionRefV1 =
  | (TypedAttachmentContributionRefV1 & { readonly owner: "attempt" })
  | EvalOwnerFragmentContributionRefV1
  | (ReceiverProjectionContributionRefV1 & { readonly scope: "attempt" });

export type ExperimentPairPluginContributionRefV1 =
  | (TypedAttachmentContributionRefV1 & { readonly owner: "attempt" })
  | ExperimentOwnerFragmentContributionRefV1
  | (ReceiverProjectionContributionRefV1 & { readonly scope: "attempt" });

export interface PluginProvenanceCredentialV1 {
  readonly kind: "redacted";
  readonly domain: PluginProvenanceTextV1;
  readonly revision: PluginProvenanceTextV1;
}

export interface PluginProvenanceBaseV1<
  ContributionRef extends PluginContributionRefV1,
> {
  readonly name: PluginProvenanceTextV1;
  readonly instance: PluginProvenanceTextV1;
  readonly revision: PluginProvenanceTextV1;
  readonly source: PluginProvenanceSourceV1;
  readonly effectiveBehaviorIdentity: readonly PluginBehaviorIdentityItemV1[];
  readonly contributionRefs: readonly ContributionRef[];
  readonly credential?: PluginProvenanceCredentialV1;
}

export type RunPluginProvenanceEntryV1 =
  PluginProvenanceBaseV1<RunPluginContributionRefV1> & {
    readonly mount: "experiment";
  };

export type AttemptPluginProvenanceEntryV1 =
  | (PluginProvenanceBaseV1<EvalAttemptPluginContributionRefV1> & {
      readonly mount: "eval";
      readonly subject: "eval" | "pair";
    })
  | (PluginProvenanceBaseV1<ExperimentPairPluginContributionRefV1> & {
      readonly mount: "experiment";
      readonly subject: "pair";
    });

/** The exact Run-owned provenance document. */
export interface RunPluginProvenanceV1 {
  readonly scope: "run";
  readonly entries: readonly RunPluginProvenanceEntryV1[];
}

/** The exact Attempt-owned provenance document. */
export interface AttemptPluginProvenanceV1 {
  readonly scope: "attempt";
  readonly entries: readonly AttemptPluginProvenanceEntryV1[];
}

export type PluginProvenanceV1 =
  | RunPluginProvenanceV1
  | AttemptPluginProvenanceV1;

export type PluginRecordOwner = "run" | "attempt";
