import type { ReactNode } from "react";
import type { ReportNode } from "../semantic/closed.ts";

/**
 * Keep our automatic runtime structurally compatible with React 19 without
 * importing React into the Report author package.  The Host recognizes this
 * marker only while it is closing author code; it never reaches a renderer.
 */
export const REPORT_ELEMENT_MARKER = Symbol.for("react.transitional.element");
export const REPORT_FRAGMENT_MARKER = Symbol.for("react.fragment");

/**
 * An author-time JSX element. It is intentionally broader than ReportNode:
 * React's automatic JSX runtime produces this shape before the Report Host
 * invokes components and closes the result into data-only semantic nodes.
 */
export interface ReportElement {
  readonly $$typeof?: symbol;
  readonly type: unknown;
  readonly props: Readonly<Record<string, unknown>>;
  readonly key?: unknown;
}

/**
 * The public author return boundary is React-compatible data, not NiceEval's
 * later semantic tree.  The Host accepts this value only while it is closing
 * a Page or registered component and then discards every React object.
 */
export type ReportRenderable = ReactNode;

/**
 * The value a Page or compose component may author. ClosedReportNode is a
 * later Host product and is deliberately not used as this author boundary.
 */
export type AuthorReportNode =
  | ReportNode
  | ReportElement
  | readonly AuthorReportNode[]
  | null
  | undefined
  | boolean;

/** @internal Creates an immutable author-time JSX element for Report helpers. */
export function reportElement(
  type: unknown,
  props: Readonly<Record<string, unknown>> = Object.freeze({}),
  key?: unknown,
): ReportElement {
  return Object.freeze({
    $$typeof: REPORT_ELEMENT_MARKER,
    type,
    props,
    ...(key === undefined ? {} : { key }),
  });
}

/** A structural guard shared by Host closure code without importing React. */
export function isReportElement(value: unknown): value is ReportElement {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as { readonly type?: unknown; readonly props?: unknown };
  return "type" in candidate && "props" in candidate &&
    typeof candidate.props === "object" && candidate.props !== null && !Array.isArray(candidate.props);
}
