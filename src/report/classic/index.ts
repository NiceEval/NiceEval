/**
 * Migration-friendly classic report library.  This facade builds exclusively
 * on the current Sample / MetricValue / semantic author contract; it does not
 * revive v0.12 Record readers, SemanticFrame, raw HTML, or browser fetches.
 */
export * from "./components.ts";
export * from "./format.ts";
export * from "./locale.ts";
export * from "./presentation.ts";
export * from "./primitives.ts";
export * from "./text-layout.ts";
export * from "./theme.ts";

/** Safe CSS now belongs to Report head declarations, not a body component. */
export { Style } from "../definition.ts";
export type { StyleDeclaration } from "../definition.ts";
