/**
 * Standard React-element author trees for Report.  This is deliberately an
 * author-model module: it expands a tree exactly once while a ReportSample is
 * live, then leaves text/web projection to a Host.  It has no Record reader,
 * Effect Scope, machine face, or machine-producer callback.
 */

import type { ReactNode } from "react";
import {
  isReport,
  type PageContext,
  type ReportMeta,
  type ReportSample,
  type ReportTarget,
} from "./report.ts";
import {
  allocatePageDimensions,
  UndeclaredDimensionValueError,
  type DimensionDeclaration,
  type DimensionDeclarations,
  type DimensionPins,
  type PageDimensionHandle,
  type PresentedDimension,
} from "../presentation.ts";

export type {
  DimensionDeclaration,
  DimensionDeclarations,
  DimensionPins,
  PresentedDimension,
} from "../presentation.ts";

/** A normal React JSX value.  Runtime checks below accept React 18 and 19 element markers. */
export type ReportNode = ReactNode;

/** The structural part of a React element the Report resolver needs. */
export interface ReportElement {
  readonly $$typeof: symbol;
  readonly type: unknown;
  readonly props: Readonly<Record<string, unknown>>;
  readonly key?: string | number | bigint | null;
}

/** react/jsx-runtime's cross-copy Fragment identity. */
export const Fragment = Symbol.for("react.fragment");

/**
 * Component extension points remain global symbols so primitives can annotate
 * a component without a module-local identity. The descriptor below is the
 * authoritative cross-package component identity.
 */
export const COMPONENT_FACES: unique symbol = Symbol.for("niceeval.report.faces");
export const COMPONENT_COMPOSE: unique symbol = Symbol.for("niceeval.report.compose");
export const COMPONENT_ROLE: unique symbol = Symbol.for("niceeval.report.role");
export const COMPONENT_RAW_CHILDREN: unique symbol = Symbol.for("niceeval.report.rawChildren");

const reportComponentTypeId: unique symbol = Symbol.for("niceeval.report.component");
const REPORT_COMPONENT_DESCRIPTOR: unique symbol = Symbol.for("niceeval.report.component/v1");
const REPORT_COMPONENT_DESCRIPTOR_VERSION = 1;

/** Synchronous terminal face context.  It deliberately has no Sample or reader. */
export interface TextContext {
  readonly width: number;
  readonly locale: string;
  readonly render: (node: ReportNode, width?: number) => string;
  readonly command: (target: ReportTarget) => string | undefined;
  readonly experimentCommand: (experimentIdPrefix: string) => string;
  readonly panelMode: "boxed" | "plain";
  /** The current node's page-level declaration handle. */
  readonly dimension: (handle: string) => PresentedDimension;
}

/** Synchronous web face context.  It deliberately has no Sample or DOM handle. */
export interface WebContext {
  readonly locale: string;
  readonly href: (target: ReportTarget) => string | undefined;
  /** The current node's page-level declaration handle. */
  readonly dimension: (handle: string) => PresentedDimension;
}

/** Composition is the only author callback that receives live data. */
export interface ComposeContext {
  readonly scope: ReportSample;
  readonly page: PageContext;
  readonly report: ReportMeta;
}

/** Resolve has precisely the same bounded live capability as composition. */
export interface ResolveContext extends ComposeContext {}

export type AuthorComposeContext = ComposeContext;
export type AuthorResolveContext = ResolveContext;
/** Final public name for callbacks that receive ctx.scope and ctx.report. */
export type ComponentContext = ComposeContext;

/** A dual-face component's data lifecycle. */
export interface ComponentFaces<Props extends object, Resolved extends object = Props> {
  /** Runs at most once per resolved element specification. */
  readonly resolve?: (props: Props, context: AuthorResolveContext) => Resolved | Promise<Resolved>;
  /** Optional presentation declaration; it cannot read live Report data. */
  readonly dimensions?: (data: Resolved, props: Props) => DimensionDeclarations;
  /** Text is synchronous and runs only after resolve has produced closed props. */
  readonly text: (data: Resolved, context: TextContext) => string;
  /** Web is synchronous and runs only after resolve has produced closed props. */
  readonly web: (data: Resolved, context: WebContext) => ReactNode;
}

/** A Report component is a standard function component at the JSX boundary. */
export type ReportComponent<Props extends object> = ((props: Props) => ReactNode) & {
  readonly [reportComponentTypeId]: true;
  [COMPONENT_FACES]?: ComponentFaces<Props, object>;
  [COMPONENT_COMPOSE]?: (props: Props, context: ComposeContext) => ReportNode | Promise<ReportNode>;
  [COMPONENT_ROLE]?: "tabs" | "tab";
  [COMPONENT_RAW_CHILDREN]?: true;
  displayName?: string;
};

export interface ComposeComponentDescriptor {
  readonly kind: "compose";
  readonly compose: (
    props: Readonly<Record<string, unknown>>,
    context: ComposeContext,
  ) => ReportNode | Promise<ReportNode>;
}

export interface PrimitiveComponentDescriptor {
  readonly kind: "primitive";
  readonly resolve?: (
    props: Readonly<Record<string, unknown>>,
    context: ResolveContext,
  ) => object | Promise<object>;
  readonly dimensions?: (
    data: object,
    props: Readonly<Record<string, unknown>>,
  ) => DimensionDeclarations;
  readonly text: (data: object, context: TextContext) => string;
  readonly web: (data: object, context: WebContext) => ReactNode;
}

export type ReportComponentDescriptor = ComposeComponentDescriptor | PrimitiveComponentDescriptor;

interface ComponentDescriptorEnvelope {
  readonly version: 1;
  readonly descriptor: ReportComponentDescriptor;
}

/** Process-local cache only; Symbol.for is the cross-package source of truth. */
const descriptorCache = new WeakMap<object, ReportComponentDescriptor>();

/** Defines an asynchronous composition component. */
export function defineComponent<Props extends object>(
  compose: (props: Props, context: AuthorComposeContext) => ReportNode | Promise<ReportNode>,
): ReportComponent<Props>;
/** Defines one data resolve phase followed by synchronous text and web faces. */
export function defineComponent<Props extends object, Resolved extends object = Props>(
  faces: ComponentFaces<Props, Resolved>,
): ReportComponent<Props>;
export function defineComponent<Props extends object>(
  input:
    | ((props: Props, context: AuthorComposeContext) => ReportNode | Promise<ReportNode>)
    | ComponentFaces<Props, object>,
): ReportComponent<Props> {
  const descriptor = typeof input === "function"
    ? composeDescriptor(input)
    : primitiveDescriptor(input);

  const component = ((props: Props): ReactNode => {
    const known = reportComponentDescriptor(component);
    if (known.kind === "compose") {
      throw new Error(
        `Compose component ${componentLabel(component)} can only render inside the Report resolve lifecycle; ` +
          "it needs ctx.scope and ctx.report to assemble its tree.",
      );
    }
    return known.web(props, bindNodeDimensions(resolveActiveWebContext(), props));
  }) as ReportComponent<Props>;

  Object.defineProperties(component, {
    [reportComponentTypeId]: {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    },
    [REPORT_COMPONENT_DESCRIPTOR]: {
      value: Object.freeze({
        version: REPORT_COMPONENT_DESCRIPTOR_VERSION,
        descriptor,
      } satisfies ComponentDescriptorEnvelope),
      enumerable: false,
      writable: false,
      configurable: false,
    },
    // Keep the established symbols writable for primitives that mark
    // raw children or Tabs roles after calling defineComponent().
    [COMPONENT_FACES]: {
      value: descriptor.kind === "primitive" ? descriptor : undefined,
      enumerable: false,
      writable: true,
      configurable: false,
    },
    [COMPONENT_COMPOSE]: {
      value: descriptor.kind === "compose" ? descriptor.compose : undefined,
      enumerable: false,
      writable: true,
      configurable: false,
    },
    [COMPONENT_ROLE]: {
      value: undefined,
      enumerable: false,
      writable: true,
      configurable: false,
    },
    [COMPONENT_RAW_CHILDREN]: {
      value: undefined,
      enumerable: false,
      writable: true,
      configurable: false,
    },
    displayName: {
      value: typeof input === "function" ? componentDisplayName(input) : undefined,
      enumerable: false,
      writable: true,
      configurable: false,
    },
  });
  descriptorCache.set(component, descriptor);
  return component;
}

/** Reads the portable descriptor from this or another installed niceeval copy. */
export function reportComponentDescriptor(component: unknown): ReportComponentDescriptor {
  const descriptor = descriptorFor(component);
  if (descriptor === undefined) {
    throw new TypeError("a Report component must be created by defineComponent");
  }
  return descriptor;
}

export function isReportComponent(component: unknown): component is ReportComponent<object> {
  return descriptorFor(component) !== undefined;
}

/** Useful to Host code that receives standard JSX elements. */
export function isReportComponentInvocation(value: unknown): value is ReportElement {
  return isReportElement(value) && descriptorFor(value.type) !== undefined;
}

/** Returns the primitive descriptor for a Report component. */
export function facesOf(type: unknown): PrimitiveComponentDescriptor | undefined {
  const descriptor = descriptorFor(type);
  return descriptor?.kind === "primitive" ? descriptor : undefined;
}

export function composeOf(type: unknown): ComposeComponentDescriptor["compose"] | undefined {
  const descriptor = descriptorFor(type);
  return descriptor?.kind === "compose" ? descriptor.compose : undefined;
}

function descriptorFor(component: unknown): ReportComponentDescriptor | undefined {
  if (typeof component !== "function") return undefined;
  const cached = descriptorCache.get(component);
  if (cached !== undefined) return cached;
  const property = Object.getOwnPropertyDescriptor(component, REPORT_COMPONENT_DESCRIPTOR);
  if (property === undefined || !("value" in property) || !isDescriptorEnvelope(property.value)) return undefined;
  descriptorCache.set(component, property.value.descriptor);
  return property.value.descriptor;
}

function isDescriptorEnvelope(value: unknown): value is ComponentDescriptorEnvelope {
  return isPlainObject(value) && Object.keys(value).length === 2 &&
    value.version === REPORT_COMPONENT_DESCRIPTOR_VERSION && isComponentDescriptor(value.descriptor);
}

function isComponentDescriptor(value: unknown): value is ReportComponentDescriptor {
  if (!isPlainObject(value) || typeof value.kind !== "string") return false;
  if (value.kind === "compose") {
    return hasOnlyFields(value, ["kind", "compose"]) && typeof value.compose === "function";
  }
  if (value.kind !== "primitive" || typeof value.text !== "function" || typeof value.web !== "function") {
    return false;
  }
  if (!Object.keys(value).every((key) => ["kind", "resolve", "dimensions", "text", "web"].includes(key))) {
    return false;
  }
  return (value.resolve === undefined || typeof value.resolve === "function") &&
    (value.dimensions === undefined || typeof value.dimensions === "function");
}

function composeDescriptor<Props extends object>(
  compose: (props: Props, context: AuthorComposeContext) => ReportNode | Promise<ReportNode>,
): ComposeComponentDescriptor {
  if (typeof compose !== "function") throw new TypeError("defineComponent(compose) requires a compose callback");
  return Object.freeze({
    kind: "compose" as const,
    compose: (props: Readonly<Record<string, unknown>>, context: ComposeContext) => compose(props as Props, context),
  });
}

function primitiveDescriptor<Props extends object>(
  faces: ComponentFaces<Props, object>,
): PrimitiveComponentDescriptor {
  const fields = ownFields(faces, "defineComponent(faces)");
  for (const key of fields.keys()) {
    if (key !== "resolve" && key !== "dimensions" && key !== "text" && key !== "web") {
      throw new TypeError(`defineComponent(faces) has an unknown field: ${key}`);
    }
  }
  const text = fields.get("text");
  const web = fields.get("web");
  if (typeof text !== "function" || typeof web !== "function") {
    throw new TypeError("defineComponent(faces) requires both synchronous text and web faces");
  }
  const resolve = fields.get("resolve");
  const dimensions = fields.get("dimensions");
  if (resolve !== undefined && typeof resolve !== "function") {
    throw new TypeError("defineComponent(faces).resolve must be a function when supplied");
  }
  if (dimensions !== undefined && typeof dimensions !== "function") {
    throw new TypeError("defineComponent(faces).dimensions must be a function when supplied");
  }
  return Object.freeze({
    kind: "primitive" as const,
    ...(resolve === undefined
      ? {}
      : {
        resolve: (props: Readonly<Record<string, unknown>>, context: ResolveContext) =>
          (resolve as (props: Props, context: AuthorResolveContext) => object | Promise<object>)(props as Props, context),
      }),
    ...(dimensions === undefined
      ? {}
      : {
        dimensions: (data: object, props: Readonly<Record<string, unknown>>) =>
          (dimensions as (data: object, props: Props) => DimensionDeclarations)(data, props as Props),
      }),
    text: text as PrimitiveComponentDescriptor["text"],
    web: web as PrimitiveComponentDescriptor["web"],
  });
}

// ───────────────────────── Page presentation plan ─────────────────────────

/**
 * One resolved page's presentation allocation.  A handle belongs to a props
 * object, rather than a component type or a global name: two component
 * instances may both use "series" without being able to read one another.
 */
export interface PageDimensions {
  dimension(props: object, handle: string): PresentedDimension;
  readonly slotsByDimension: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/** Cross-copy transport only; this is never an author-visible context field. */
const PAGE_DIMENSIONS: unique symbol = Symbol.for("niceeval.report.pageDimensions/v1");

/**
 * Returns a rendering context carrying a page plan.  Extensible Host contexts
 * keep their identity; frozen contexts get a descriptor-preserving clone.
 */
export function withPageDimensions<C extends object>(context: C, plan: PageDimensions | undefined): C {
  if (plan === undefined || pageDimensionsOf(context) === plan) return context;
  const current = Object.getOwnPropertyDescriptor(context, PAGE_DIMENSIONS);
  if (Object.isExtensible(context) && (current === undefined || current.configurable)) {
    Object.defineProperty(context, PAGE_DIMENSIONS, {
      value: plan,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return context;
  }
  const descriptors = Object.getOwnPropertyDescriptors(context) as Record<PropertyKey, PropertyDescriptor>;
  descriptors[PAGE_DIMENSIONS] = {
    value: plan,
    enumerable: false,
    writable: false,
    configurable: false,
  };
  return Object.create(Object.getPrototypeOf(context), descriptors) as C;
}

function pageDimensionsOf(context: object): PageDimensions | undefined {
  const plan = (context as Record<symbol, unknown>)[PAGE_DIMENSIONS];
  return isPageDimensions(plan) ? plan : undefined;
}

function isPageDimensions(value: unknown): value is PageDimensions {
  return typeof value === "object" && value !== null &&
    typeof (value as { dimension?: unknown }).dimension === "function" &&
    (value as { slotsByDimension?: unknown }).slotsByDimension instanceof Map;
}

function noPageDimensionsError(handle: string): UndeclaredDimensionValueError {
  return new UndeclaredDimensionValueError(
    `ctx.dimension(${JSON.stringify(handle)}) has no page dimension plan: this component is rendering outside the Report pipeline. ` +
      "Render through niceeval show / view, or use presentDimension() for a standalone React page.",
    handle,
  );
}

/** Binds a face context to exactly one resolved props identity. */
function bindNodeDimensions<C extends object>(context: C, props: object): C {
  const plan = pageDimensionsOf(context);
  const descriptors = Object.getOwnPropertyDescriptors(context) as Record<PropertyKey, PropertyDescriptor>;
  descriptors.dimension = {
    value: (handle: string): PresentedDimension => {
      if (plan === undefined) throw noPageDimensionsError(handle);
      return plan.dimension(props, handle);
    },
    enumerable: true,
    writable: false,
    configurable: false,
  };
  const bound = Object.create(Object.getPrototypeOf(context), descriptors) as C;
  return withPageDimensions(bound, plan);
}

function assertDimensionDeclarations(label: string, declared: unknown): DimensionDeclarations {
  if (!isPlainObject(declared)) {
    throw new Error(
      `${label} dimensions() must return a { [handle]: { dimension, encoding, values } } record. ` +
        "A component that consumes no dimensions returns {}.",
    );
  }
  for (const [handle, value] of Object.entries(declared)) {
    if (!isPlainObject(value) || typeof value.dimension !== "string" || value.dimension.length === 0) {
      throw new Error(`${label} dimensions().${handle} must declare a non-empty dimension name.`);
    }
    if (!Array.isArray(value.values) || value.values.some((entry) => typeof entry !== "string")) {
      throw new Error(
        `${label} dimensions().${handle}.values must be an array of display keys in renderer traversal order.`,
      );
    }
    if (!isDimensionEncoding(value.encoding)) {
      throw new Error(
        `${label} dimensions().${handle}.encoding must be { kind: "label" }, { kind: "color" }, ` +
          'or { kind: "series", mark: "line" | "scatter" | "bar" | "area" }.',
      );
    }
  }
  return declared as DimensionDeclarations;
}

function isDimensionEncoding(value: unknown): boolean {
  if (!isPlainObject(value) || typeof value.kind !== "string") return false;
  if (value.kind === "label" || value.kind === "color") {
    return Object.keys(value).length === 1;
  }
  return value.kind === "series" && Object.keys(value).length === 2 &&
    (value.mark === "line" || value.mark === "scatter" || value.mark === "bar" || value.mark === "area");
}

/**
 * Collects every resolved primitive's declarations before either face renders.
 * Calling this once per face is intentional: the same declaration/pin input
 * gives text its label projection and web its stable color/texture slots.
 */
export function collectPageDimensions(
  node: ReportNode,
  pins: DimensionPins = {},
  face: "text" | "web" = "web",
): PageDimensions {
  const handles: PageDimensionHandle[] = [];
  const byProps = new WeakMap<object, { readonly label: string; readonly handles: ReadonlyMap<string, string> }>();
  let nodeIndex = 0;

  const visit = (current: ReportNode): void => {
    if (current === null || current === undefined || typeof current === "boolean" ||
      typeof current === "string" || typeof current === "number" || typeof current === "bigint") {
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isReportElement(current)) return;
    if (current.type === Fragment) {
      visit(current.props.children as ReportNode);
      return;
    }
    const descriptor = descriptorFor(current.type);
    if (descriptor?.kind === "primitive") {
      if (descriptor.dimensions !== undefined) {
        const label = componentLabel(current.type);
        const declared = assertDimensionDeclarations(label, descriptor.dimensions(current.props, current.props));
        const keys = new Map<string, string>();
        for (const [handle, declaration] of Object.entries(declared)) {
          const key = `${nodeIndex}\u0000${handle}`;
          handles.push({ handle: key, declaration });
          keys.set(handle, key);
        }
        byProps.set(current.props, { label, handles: keys });
        nodeIndex += 1;
      }
      if (!hasRawChildren(current.type)) visit(current.props.children as ReportNode);
      return;
    }
    if (!hasRawChildren(current.type)) visit(current.props.children as ReportNode);
  };

  visit(node);
  const plan = allocatePageDimensions(handles, pins, { face });
  return Object.freeze({
    slotsByDimension: plan.slotsByDimension,
    dimension(props: object, handle: string): PresentedDimension {
      const entry = byProps.get(props);
      const key = entry?.handles.get(handle);
      if (key === undefined) {
        throw new UndeclaredDimensionValueError(
          `${entry?.label ?? "This component"} queried dimension handle ${JSON.stringify(handle)}, which its dimensions() did not declare` +
            `${entry && entry.handles.size > 0 ? ` (declared: ${[...entry.handles.keys()].map((name) => JSON.stringify(name)).join(", ")})` : ""}.`,
          handle,
        );
      }
      return plan.dimension(key);
    },
  } satisfies PageDimensions);
}

// ───────────────────── One author-tree resolve lifecycle ─────────────────────

export class ResolveMemo {
  private readonly entries = new Map<object, MemoEntry[]>();

  fetch<Value extends object>(
    callback: object,
    scope: object,
    props: object,
    resolve: () => Promise<Value>,
  ): Promise<Value> {
    let entries = this.entries.get(callback);
    if (entries === undefined) {
      entries = [];
      this.entries.set(callback, entries);
    }
    for (const entry of entries) {
      if (entry.scope === scope && deepEqualSpec(entry.props, props)) return entry.result as Promise<Value>;
    }
    const result = resolve();
    entries.push({ scope, props, result });
    return result;
  }
}

interface MemoEntry {
  readonly scope: object;
  readonly props: object;
  readonly result: Promise<object>;
}

/** The Host may supply a memo per page; no scoped service is retained here. */
export interface ResolveEnv {
  readonly scope: ReportSample;
  readonly page: PageContext;
  readonly report: ReportMeta;
  readonly memo?: ResolveMemo;
}

/**
 * Expands compose components and runs each dual-face resolve once.  The
 * returned React tree carries only resolved props; it does not carry ctx,
 * Sample, reader, Effect Scope, or a machine producer.
 */
export async function resolveReportTree(node: ReportNode, env: ResolveEnv): Promise<ReportNode> {
  const context = Object.freeze({
    scope: env.scope,
    page: env.page,
    report: env.report,
  }) satisfies ComposeContext;
  return resolveNode(node, { memo: env.memo ?? new ResolveMemo(), context }, [], 0);
}

interface ResolveState {
  readonly memo: ResolveMemo;
  readonly context: ComposeContext;
}

const MAX_RESOLVE_DEPTH = 1_024;

async function resolveNode(
  node: ReportNode,
  state: ResolveState,
  path: readonly string[],
  depth: number,
): Promise<ReportNode> {
  if (depth > MAX_RESOLVE_DEPTH) {
    throw new Error(`Report component expansion exceeded ${MAX_RESOLVE_DEPTH} levels${formatPath(path)}`);
  }
  if (node === null || node === undefined || typeof node === "boolean" ||
    typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    return node;
  }
  if (Array.isArray(node)) {
    const resolved = await Promise.all(node.map((child) => resolveNode(child, state, path, depth + 1)));
    return keySiblingElements(resolved, path.length > 0 ? path.join(">") : "report");
  }
  if (!isReportElement(node)) return node;
  const { type, props } = node;
  if (type === Fragment) {
    const children = await resolveNode(props.children as ReportNode, state, path, depth + 1);
    return withElementProps(node, { ...props, children: keySiblingElements(children, "<>") });
  }
  if (typeof type === "string") throw illegalNodeError(type, path);

  const descriptor = descriptorFor(type);
  if (descriptor === undefined) throw illegalNodeError(type, path);
  const label = componentLabel(type);
  if (descriptor.kind === "compose") {
    const expanded = await descriptor.compose(props, state.context);
    return resolveNode(expanded, state, [...path, label], depth + 1);
  }

  let resolvedProps: Readonly<Record<string, unknown>> = props;
  if (descriptor.resolve !== undefined) {
    const result = await state.memo.fetch(descriptor.resolve, state.context.scope, props, async () => {
      const data = await descriptor.resolve!(props, state.context);
      if (!isPlainObject(data)) {
        throw new TypeError(`${label} resolve() must return a plain props object`);
      }
      return data;
    });
    resolvedProps = result;
  }
  if (hasRawChildren(type)) {
    return resolvedProps === props ? node : withElementProps(node, resolvedProps);
  }
  const children = await resolveNode(resolvedProps.children as ReportNode, state, [...path, label], depth + 1);
  return withElementProps(node, { ...resolvedProps, children: keySiblingElements(children, label) });
}

/**
 * Gives every element of a resolved sibling array an explicit key.  Author
 * JSX and compose callbacks routinely emit sibling arrays (multi-child JSX,
 * Fragment children, `{a}{b}` brackets) without keys; React 19 dev re-warns
 * even for `Children.toArray` auto-keys, so the closed tree must carry real
 * keys.  Position is the only stable sibling identity of a closed static
 * tree; author-supplied keys are preserved untouched.
 */
function keySiblingElements(children: ReportNode, prefix: string): ReportNode {
  if (!Array.isArray(children)) return children;
  return children.map((child, index) => {
    if (Array.isArray(child)) return keySiblingElements(child, prefix);
    if (!isReportElement(child)) return child;
    if (child.key !== null && child.key !== undefined) return child;
    return withElementKey(child, `${prefix}:${index}`);
  });
}

/** The resolver memoizes equivalent ordinary data but compares instances by identity. */
export function deepEqualSpec(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || typeof left !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => deepEqualSpec(value, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && deepEqualSpec(left[key], right[key]));
}

// ─────────────────────────── Tree validation ───────────────────────────

/** Ensures a resolved tree has only Report dual-face components and Fragments. */
export function validateReportTree(node: ReportNode, path: readonly string[] = []): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    throw bareTextError(node, path);
  }
  if (Array.isArray(node)) {
    for (const child of node) validateReportTree(child, path);
    return;
  }
  if (isReport(node)) {
    throw new Error(`A defineReport(...) product is not a Report tree node${formatPath(path)}; the Report shell cannot nest.`);
  }
  if (!isReportElement(node)) {
    throw new Error(`Report tree contains an unsupported value (${typeof node})${formatPath(path)}`);
  }
  if (node.type === Fragment) {
    validateReportTree(node.props.children as ReportNode, path);
    return;
  }
  if (typeof node.type === "string") throw illegalNodeError(node.type, path);
  const descriptor = descriptorFor(node.type);
  if (descriptor === undefined) throw illegalNodeError(node.type, path);
  const label = componentLabel(node.type);
  if (descriptor.kind === "compose") {
    throw new Error(`${label} is a compose component and must be expanded before validation${formatPath(path)}`);
  }
  if (!hasRawChildren(node.type)) {
    validateReportTree(node.props.children as ReportNode, [...path, label]);
  }
}

// ─────────────────────────── Text projection ───────────────────────────

export interface TextRenderOptions {
  readonly width?: number;
  readonly locale?: string;
  readonly command?: (target: ReportTarget) => string | undefined;
  readonly experimentCommand?: (experimentIdPrefix: string) => string;
  readonly panelMode?: "boxed" | "plain";
  /** The page-level text projection created by collectPageDimensions(..., "text"). */
  readonly pageDimensions?: PageDimensions;
}

/** Makes a self-contained text context for an already resolved Report tree. */
export function createTextContext(options: TextRenderOptions = {}): TextContext {
  const width = Math.max(20, options.width ?? 80);
  const command = options.command ?? (() => undefined);
  const experimentCommand = options.experimentCommand ?? ((prefix: string) => `niceeval show --exp ${shellQuote(prefix)}`);
  const make = (currentWidth: number): TextContext => {
    const context: TextContext = {
      width: currentWidth,
      locale: options.locale ?? "en",
      command,
      experimentCommand,
      panelMode: options.panelMode ?? "plain",
      dimension: (handle: string): PresentedDimension => {
        throw noPageDimensionsError(handle);
      },
      render: (node, childWidth) => renderNodeToText(
        node,
        childWidth === undefined ? context : make(Math.max(10, childWidth)),
      ),
    };
    return Object.freeze(withPageDimensions(context, options.pageDimensions));
  };
  return make(width);
}

/** Text rendering never calls compose or resolve; callers pass a resolved tree. */
export function renderNodeToText(node: ReportNode, context: TextContext): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    throw bareTextError(node, []);
  }
  if (Array.isArray(node)) {
    return node.map((child) => renderNodeToText(child, context)).filter((text) => text.length > 0).join("\n");
  }
  if (!isReportElement(node)) throw new Error(`Report tree contains an unsupported value (${typeof node})`);
  if (node.type === Fragment) return renderNodeToText(node.props.children as ReportNode, context);
  if (typeof node.type === "string") throw illegalNodeError(node.type, []);
  const descriptor = descriptorFor(node.type);
  if (descriptor?.kind === "primitive") return descriptor.text(node.props, bindNodeDimensions(context, node.props));
  if (descriptor?.kind === "compose") {
    throw new Error(`${componentLabel(node.type)} must be resolved before text rendering`);
  }
  throw illegalNodeError(node.type, []);
}

// ───────────────────── React web-context bridge ─────────────────────

const DEFAULT_WEB_CONTEXT: WebContext = Object.freeze({
  locale: "en",
  href: () => undefined,
  dimension: (handle: string): never => {
    throw noPageDimensionsError(handle);
  },
});
const ACTIVE_WEB_CONTEXT = Symbol.for("niceeval.report.activeWebContext.v1");

function resolveActiveWebContext(): WebContext {
  const context = (globalThis as Record<symbol, unknown>)[ACTIVE_WEB_CONTEXT];
  return isWebContext(context) ? context : DEFAULT_WEB_CONTEXT;
}

/**
 * Lets a web Host render an already-resolved tree through React while sharing
 * context across duplicate package instances.  It is synchronous by design.
 */
export function runWithWebContext<Value>(context: WebContext, callback: () => Value): Value {
  const host = globalThis as Record<symbol, unknown>;
  const previous = host[ACTIVE_WEB_CONTEXT];
  host[ACTIVE_WEB_CONTEXT] = context;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete host[ACTIVE_WEB_CONTEXT];
    else host[ACTIVE_WEB_CONTEXT] = previous;
  }
}

function isWebContext(value: unknown): value is WebContext {
  return isPlainObject(value) && typeof value.locale === "string" &&
    typeof value.href === "function" && typeof value.dimension === "function";
}

// ─────────────────────────── Helpers ───────────────────────────

const REACT_ELEMENT_MARKERS = new Set<symbol>([
  Symbol.for("react.element"),
  Symbol.for("react.transitional.element"),
]);

function isReportElement(value: unknown): value is ReportElement {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<ReportElement>;
  if (typeof candidate.$$typeof !== "symbol" || !REACT_ELEMENT_MARKERS.has(candidate.$$typeof)) return false;
  if (typeof candidate.type !== "string" && typeof candidate.type !== "symbol" && typeof candidate.type !== "function") return false;
  return typeof candidate.props === "object" && candidate.props !== null && !Array.isArray(candidate.props);
}

function withElementProps(element: ReportElement, props: Readonly<Record<string, unknown>>): ReportNode {
  const descriptors = Object.getOwnPropertyDescriptors(element) as Record<PropertyKey, PropertyDescriptor>;
  descriptors.props = {
    value: props,
    enumerable: true,
    writable: false,
    configurable: false,
  };
  return Object.create(Object.getPrototypeOf(element), descriptors) as ReportNode;
}

/** Clones a React element with an explicit sibling key, preserving everything else. */
function withElementKey(element: ReportElement, key: string): ReportNode {
  const descriptors = Object.getOwnPropertyDescriptors(element) as Record<PropertyKey, PropertyDescriptor>;
  descriptors.key = {
    value: key,
    enumerable: true,
    writable: false,
    configurable: false,
  };
  return Object.create(Object.getPrototypeOf(element), descriptors) as ReportNode;
}

function hasRawChildren(type: unknown): boolean {
  return typeof type === "function" &&
    (type as unknown as Record<symbol, unknown>)[COMPONENT_RAW_CHILDREN] === true;
}

function componentLabel(type: unknown): string {
  if (type === Fragment) return "<>";
  if (typeof type === "string") return `<${type}>`;
  if (typeof type === "function") {
    const named = type as { displayName?: unknown; name?: unknown };
    const label = typeof named.displayName === "string" && named.displayName.length > 0
      ? named.displayName
      : typeof named.name === "string" && named.name.length > 0 ? named.name : "anonymous component";
    return `<${label}>`;
  }
  return `<${String(type)}>`;
}

function componentDisplayName(value: unknown): string | undefined {
  if (typeof value !== "function") return undefined;
  const named = value as { displayName?: unknown; name?: unknown };
  return typeof named.displayName === "string" && named.displayName.length > 0
    ? named.displayName
    : typeof named.name === "string" && named.name.length > 0 ? named.name : undefined;
}

function illegalNodeError(type: unknown, path: readonly string[]): Error {
  if (typeof type === "string") {
    return new Error(
      `Report trees cannot contain raw HTML <${type}>${formatPath(path)}. ` +
        "Every Report node needs both text and web faces; use a Report primitive or defineComponent().",
    );
  }
  return new Error(
    `${componentLabel(type)} is not a Report component${formatPath(path)}. ` +
      "Wrap it with defineComponent() so the Report can render it in both text and web hosts.",
  );
}

function bareTextError(value: string | number | bigint, path: readonly string[]): Error {
  const preview = typeof value === "string" ? JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value) : String(value);
  return new Error(
    `Report trees cannot contain bare ${typeof value} (${preview})${formatPath(path)}. ` +
      "Use the Text primitive so both hosts have explicit text semantics.",
  );
}

function formatPath(path: readonly string[]): string {
  return path.length === 0 ? "" : ` (in ${path.join(" > ")})`;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9._/@-]+$/.test(value) ? value : `'${value.replaceAll("'", `"'"'`)}'`;
}

function ownFields(value: unknown, label: string): ReadonlyMap<string, unknown> {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
  const entries: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`${label} cannot contain symbol fields`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label} cannot contain accessors or hidden fields`);
    }
    entries.push([key, descriptor.value]);
  }
  return new Map(entries);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyFields(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && allowed.every((key) => Object.hasOwn(value, key));
}
