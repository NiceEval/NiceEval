import type { JsonValue } from "../../shared/types.ts";

/**
 * The current-declaration experiment profile. It is independent of
 * AnalysisSample and must never be mixed with a historical Record snapshot.
 */
export interface ClassicExperimentProfile {
  readonly experimentId: string;
  readonly agent: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: Readonly<Record<string, JsonValue>>;
  readonly labels?: Readonly<Record<string, string | number>>;
  readonly description?: string;
}

export interface ClassicSelectionNotice {
  readonly code: "selection-profile-unavailable";
  readonly summary: string;
}

export type ClassicSelectionOrigin =
  | {
      readonly metadataOrigin: "current-declaration";
      readonly profiles: readonly ClassicExperimentProfile[];
    }
  | {
      readonly metadataOrigin: "partial";
      readonly notice: ClassicSelectionNotice;
    };

export const CLASSIC_SELECTION_PROFILE_UNAVAILABLE: ClassicSelectionNotice = Object.freeze({
  code: "selection-profile-unavailable",
  summary: "this Report selection does not include a current project declaration profile",
});

export function partialClassicSelectionOrigin(
  notice: ClassicSelectionNotice = CLASSIC_SELECTION_PROFILE_UNAVAILABLE,
): ClassicSelectionOrigin {
  return Object.freeze({
    metadataOrigin: "partial" as const,
    notice,
  });
}

export function currentDeclarationSelectionOrigin(
  profiles: readonly ClassicExperimentProfile[],
): ClassicSelectionOrigin {
  return Object.freeze({
    metadataOrigin: "current-declaration" as const,
    profiles: Object.freeze([...profiles]),
  });
}
