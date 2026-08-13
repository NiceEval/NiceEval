import {
  reportParagraph,
  reportText,
  type ReportBlock,
} from "../semantic/document.ts";
import type { ClassicSample } from "./sample.ts";

const classicElementTypeId: unique symbol = Symbol("@niceeval/report/classic-element");
const classicComponentTypeId: unique symbol = Symbol("@niceeval/report/classic-component");
const REACT_ELEMENT = Symbol.for("react.element");
const REACT_TRANSITIONAL_ELEMENT = Symbol.for("react.transitional.element");
const REACT_FRAGMENT = Symbol.for("react.fragment");

export interface ClassicComponentContext {
  readonly scope: ClassicSample;
}

export interface ClassicComponent<Props = object> {
  /** JSX author call: both React JSX and NiceEval's controlled runtime receive an element. */
  (props: Props): ClassicElement;
  /** Host evaluation call: the branded component may resolve to a semantic block or subtree. */
  (props: Props, context: ClassicComponentContext): unknown;
  displayName?: string;
  readonly [classicComponentTypeId]: true;
}

export interface ClassicElement {
  readonly [classicElementTypeId]: true;
  /**
   * Kept structurally compatible with ReactElement so classic components remain
   * valid under an existing `react-jsx` project. Runtime acceptance is still
   * enforced by evaluateClassicTree's brand checks.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly type: any;
  readonly props: Readonly<Record<string, unknown>>;
  readonly key: string | null;
}

export const Fragment: unique symbol = Symbol("@niceeval/report/classic-fragment");

export function jsx(
  type: unknown,
  props: Readonly<Record<string, unknown>> | null,
  key?: string | number | null,
): ClassicElement {
  return Object.freeze({
    [classicElementTypeId]: true,
    type,
    props: Object.freeze({ ...(props ?? {}) }),
    key: key == null ? null : String(key),
  });
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export function isClassicElement(value: unknown): value is ClassicElement {
  return typeof value === "object" && value !== null && classicElementTypeId in value;
}

export function isClassicComponent(value: unknown): value is ClassicComponent {
  return typeof value === "function" && classicComponentTypeId in value;
}

export function defineComponent<Props = object>(
  render: (props: Props, ctx: ClassicComponentContext) => unknown,
): ClassicComponent<Props> {
  if (typeof render !== "function") {
    throw new TypeError("defineComponent requires a function");
  }
  const component = ((props: Props, context?: ClassicComponentContext) => {
    if (context === undefined) {
      return jsx(component, (props ?? {}) as Readonly<Record<string, unknown>>);
    }
    return render(props ?? ({} as Props), context);
  }) as ClassicComponent<Props>;
  Object.defineProperty(component, classicComponentTypeId, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(component, "displayName", {
    value: render.name || undefined,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return component;
}

export async function evaluateClassicTree(
  node: unknown,
  context: ClassicComponentContext,
): Promise<readonly ReportBlock[]> {
  return Object.freeze(await evaluateNode(node, context));
}

async function evaluateNode(
  node: unknown,
  context: ClassicComponentContext,
): Promise<ReportBlock[]> {
  if (node == null || typeof node === "boolean") {
    return [];
  }
  if (typeof node === "string" || typeof node === "number") {
    return [reportParagraph([reportText(String(node))])];
  }
  if (Array.isArray(node)) {
    const parts = await Promise.all(node.map((child) => evaluateNode(child, context)));
    return parts.flat();
  }
  if (isClassicDashboardBlock(node)) {
    return [node];
  }
  const element = asJsxElement(node);
  if (element === undefined) {
    throw new TypeError("classic JSX only accepts NiceEval branded components, Fragment, arrays, string, number, or null");
  }
  if (isFragmentType(element.type)) {
    return evaluateNode(element.props.children, context);
  }
  if (typeof element.type === "string") {
    throw new TypeError(`native DOM element <${element.type}> is not allowed in a classic Report`);
  }
  if (!isClassicComponent(element.type)) {
    throw new TypeError("unbranded function components are not allowed in a classic Report");
  }
  const rendered = await element.type(element.props, context);
  return evaluateNode(rendered, context);
}

function asJsxElement(value: unknown): {
  readonly type: unknown;
  readonly props: Readonly<Record<string, unknown>>;
} | undefined {
  if (isClassicElement(value)) {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as {
    readonly $$typeof?: symbol;
    readonly type?: unknown;
    readonly props?: unknown;
  };
  if (
    (candidate.$$typeof === REACT_ELEMENT || candidate.$$typeof === REACT_TRANSITIONAL_ELEMENT)
    && candidate.props !== null
    && typeof candidate.props === "object"
  ) {
    return {
      type: candidate.type,
      props: candidate.props as Readonly<Record<string, unknown>>,
    };
  }
  return undefined;
}

function isFragmentType(type: unknown): boolean {
  return type === Fragment || type === REACT_FRAGMENT;
}

function isClassicDashboardBlock(value: unknown): value is ReportBlock {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  switch (value.type) {
    case "section":
    case "paragraph":
    case "list":
    case "table":
    case "metric":
    case "status":
    case "code-block":
    case "chart":
    case "hero":
    case "summary":
    case "ranked-bars":
    case "scatter":
    case "tree-table":
      return true;
    default:
      return false;
  }
}

export namespace JSX {
  export type Element = ClassicElement;
  export interface ElementChildrenAttribute {
    children?: unknown;
  }
  export interface IntrinsicElements {}
}
