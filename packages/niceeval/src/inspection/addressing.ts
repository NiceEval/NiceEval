// @concord-file
// @concord-implements docs/feature/inspection/cli.md
/** One address grammar shared by terminal and browser entry points. */
export const INSPECTION_ASPECTS = ["assertions", "source", "execution", "timing", "usage", "diff", "artifacts"] as const;
export type InspectionAspect = typeof INSPECTION_ASPECTS[number];
export const INSPECTION_ID_ROUTES = Object.freeze([
  { prefix: "ae_", aspect: "assertions" },
  { prefix: "fc_", aspect: "diff" },
  { prefix: "art_", aspect: "artifacts" },
  ...["tool_", "command_", "item_", "turn_", "evt_", "event_", "ee_", "ev_", "diagnostic_"].map((prefix) => ({ prefix, aspect: "execution" as const })),
] as const);
export interface InspectionAddress {
  readonly locator?: string;
  readonly runIds: readonly string[];
  readonly experimentIds: readonly string[];
  readonly runs: boolean;
  readonly aspect?: InspectionAspect;
  readonly id?: string;
  readonly imageId?: string;
}
export function inspectionIdAspect(id: string): InspectionAspect | undefined {
  return /^[a-f0-9]{64}$/u.test(id) ? "execution" : INSPECTION_ID_ROUTES.find(route => id.startsWith(route.prefix))?.aspect;
}
export function parseInspectionAddress(tokens: readonly string[]): InspectionAddress {
  let index = 0;
  let locator: string | undefined;
  const runIds: string[] = [];
  const experimentIds: string[] = [];
  let runs = false;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.startsWith("@")) { if (locator !== undefined) throw new Error("Select exactly one Attempt."); locator = token; }
    else if (token.startsWith("run:")) runIds.push(token.slice(4));
    else if (token.startsWith("exp:")) experimentIds.push(token.slice(4));
    else if (token === "runs") runs = true;
    else break;
    index++;
  }
  if ([locator !== undefined, runIds.length > 0, experimentIds.length > 0, runs].filter(Boolean).length > 1)
    throw new Error("Attempt, Experiment, Run, and runs objects cannot be combined.");
  const available = locator !== undefined ? INSPECTION_ASPECTS : experimentIds.length > 0 ? ["assertions"] : [];
  const invalid = (message: string): never => { throw new Error(`${message} Available aspects: ${available.join(", ") || "none"}.`); };
  let aspect: InspectionAspect | undefined;
  if (INSPECTION_ASPECTS.includes(tokens[index] as InspectionAspect)) aspect = tokens[index++] as InspectionAspect;
  const id = tokens[index];
  if (id !== undefined) {
    index++;
    const route = inspectionIdAspect(id);
    if (route === undefined) invalid(`Unknown ID prefix ${JSON.stringify(id)}.`);
    if (aspect !== undefined && aspect !== route!) invalid(`ID ${JSON.stringify(id)} conflicts with aspect ${aspect}.`);
    aspect = route!;
  }
  let imageId: string | undefined;
  if (tokens[index] === "image" && aspect === "assertions" && id !== undefined) { index++; imageId = tokens[index++]; if (!imageId) invalid("Expected an image ID."); }
  if (index !== tokens.length) invalid("Unexpected address arguments.");
  if (aspect !== undefined && !available.includes(aspect)) invalid(`Aspect ${aspect} requires an Attempt${aspect === "assertions" ? " or Experiment" : ""}.`);
  if (id !== undefined && locator === undefined) invalid("An ID requires an Attempt.");
  if (runIds.some((id) => id.length === 0) || experimentIds.some((id) => id.length === 0)) invalid("Object IDs must not be empty.");
  return { locator, runIds: [...new Set(runIds)], experimentIds: [...new Set(experimentIds)], runs, aspect, id, imageId };
}
/** Quote one argv value for a pasteable POSIX shell command. */
export function inspectionShellWord(value: string): string {
  return /^[a-zA-Z0-9_@./:=-]+$/u.test(value) ? value : `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Stable identity prefixes determine the exact detail selector without probing facts. */
export function inspectionTraceSelector(id: string, offset?: number) {
  if (id.startsWith("tool_")) return { kind: "tool-occurrence" as const, toolOccurrenceId: id };
  if (id.startsWith("command_")) return { kind: "command" as const, commandId: id };
  if (id.startsWith("item_")) return { kind: "item" as const, itemId: id };
  if (id.startsWith("ev_") || /^[a-f0-9]{64}$/u.test(id)) return { kind: "execution-evidence" as const, evidenceId: id, ...(offset === undefined ? {} : { offset }) };
  return { kind: "execution-event" as const, eventId: id };
}
