import type { AnalysisSample } from "../../analysis/index.ts";
import type { ClassicLocale } from "./localize.ts";
import {
  partialClassicSelectionOrigin,
  type ClassicSelectionOrigin,
} from "./origin.ts";

export interface ClassicHostBinding {
  readonly selectionOrigin: ClassicSelectionOrigin;
  readonly locale: ClassicLocale;
}

const bindings = new WeakMap<AnalysisSample, ClassicHostBinding>();

/** Host-only binding. Never stored on AnalysisSample and never given to authors. */
export function bindClassicHost(
  sample: AnalysisSample,
  binding: ClassicHostBinding,
): void {
  bindings.set(sample, Object.freeze(binding));
}

export function classicHostBinding(sample: AnalysisSample): ClassicHostBinding {
  return bindings.get(sample) ?? Object.freeze({
    selectionOrigin: partialClassicSelectionOrigin(),
    locale: "en" as const,
  });
}
