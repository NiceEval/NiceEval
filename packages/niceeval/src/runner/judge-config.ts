import {
  isJudgeProvider,
  resolveJudgeProvider,
  type JudgeProvider,
  type JudgeProviderIdentity,
  type JudgeSelection,
} from "../judge/provider.ts";

const utf8 = new TextEncoder();

function modelSelection(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || utf8.encode(value).byteLength > 8 * 1024 || /\p{Cc}/u.test(value)) {
    throw new TypeError(`${label} must be a non-empty, control-free model ID of at most 8192 UTF-8 bytes`);
  }
  return value;
}

/** Definition-boundary validation for a model override or an opaque Provider. */
export function normalizeJudgeSelection(value: unknown, label: string): JudgeSelection {
  if (typeof value === "string") return modelSelection(value, label);
  if (isJudgeProvider(value)) return value;
  throw new TypeError(`${label} must be a model string or a Judge Provider created by niceeval/judge`);
}

/**
 * Resolve once per Eval × Experiment pair. The highest-priority complete
 * Provider replaces all lower settings; only model strings above it apply.
 */
export function resolveJudge(
  experimentJudge: JudgeSelection | undefined,
  evalJudge: JudgeSelection | undefined,
  configJudge: JudgeProvider | undefined,
): JudgeProviderIdentity | undefined {
  const layers = [configJudge, evalJudge, experimentJudge] as const;
  let provider: JudgeProvider | undefined;
  let model: string | undefined;
  for (const layer of layers) {
    if (layer === undefined) continue;
    if (isJudgeProvider(layer)) {
      provider = layer;
      model = undefined;
    } else if (provider !== undefined) {
      model = modelSelection(layer, "Judge model override");
    }
  }
  return provider === undefined ? undefined : resolveJudgeProvider(provider, model);
}
