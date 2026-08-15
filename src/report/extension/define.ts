/** Custom renderer definition for the standard React Report author model. */

import {
  defineComponent,
  type ReportComponent,
  type TextContext,
  type WebContext,
} from "../definition/tree.ts";
import { assertRendererAssets } from "./assets.ts";
import { attachRendererMeta, type RendererMeta } from "./meta.ts";
import type {
  RendererFaces as RendererFacesContract,
  RendererOptions,
  RendererProps,
  RendererTextContext,
  RendererWebContext,
} from "./types.ts";

/** The final renderer face contract; values and options are closed data. */
export type RendererFaces<TValue, TOptions extends RendererOptions> = RendererFacesContract<TValue, TOptions>;

function assertSerializable(value: unknown, path: string, active = new WeakSet<object>()): void {
  if (value === null) return;
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      if (Number.isFinite(value)) return;
      throw new TypeError(`${path} must be a finite number when passed to defineRenderer`);
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new TypeError(
        `defineRenderer received non-serializable ${typeof value} at ${path}; ` +
          "await calculations in page render and pass plain closed data.",
      );
  }
  if (value instanceof Promise) {
    throw new TypeError(`defineRenderer received a Promise at ${path}; await it in page render first.`);
  }
  if (Array.isArray(value)) {
    if (active.has(value)) throw new TypeError(`defineRenderer received a cyclic value at ${path}`);
    active.add(value);
    value.forEach((entry, index) => assertSerializable(entry, `${path}[${index}]`, active));
    active.delete(value);
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `defineRenderer received a class instance at ${path}; pass plain computed values instead.`,
      );
    }
    if (active.has(value)) throw new TypeError(`defineRenderer received a cyclic value at ${path}`);
    active.add(value);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) assertSerializable(entry, `${path}.${key}`, active);
    }
    active.delete(value);
  }
}

function splitRendererProps<TValue, TOptions extends RendererOptions>(
  props: RendererProps<TValue, TOptions>,
): { readonly value: TValue; readonly options: TOptions } {
  const { value, ...rest } = props as RendererProps<TValue, TOptions> & { readonly value: TValue };
  if (value === undefined) {
    throw new TypeError('defineRenderer requires a "value" prop with already-computed data.');
  }
  assertSerializable(value, "value");
  for (const [key, entry] of Object.entries(rest)) {
    if (entry !== undefined) assertSerializable(entry, key);
  }
  return { value, options: rest as unknown as TOptions };
}

function toRendererTextContext(context: TextContext): RendererTextContext {
  return {
    locale: context.locale,
    width: context.width,
    dimension: (handle) => context.dimension(handle),
    render: (node, width) => context.render(node, width),
  };
}

function toRendererWebContext(context: WebContext): RendererWebContext {
  return {
    locale: context.locale,
    dimension: (handle) => context.dimension(handle),
  };
}

/**
 * Defines a renderer that consumes one already-computed ordinary value.  It
 * has no Sample, reader, machine producer, or Host callback; both faces run
 * only after the Report tree's one resolve lifecycle has closed its inputs.
 */
export function defineRenderer<TValue, TOptions extends RendererOptions = Record<string, never>>(
  faces: RendererFaces<TValue, TOptions>,
  moduleUrl?: string,
): ReportComponent<RendererProps<TValue, TOptions>> {
  if (typeof faces !== "object" || faces === null || Array.isArray(faces)) {
    throw new TypeError("defineRenderer expects { text, web, assets?, dimensions? }");
  }
  if (typeof faces.text !== "function" || typeof faces.web !== "function") {
    throw new TypeError("defineRenderer requires synchronous text(value, options, ctx) and web(value, options, ctx) faces");
  }
  assertRendererAssets(faces.assets, "defineRenderer");
  const hasAssets = (faces.assets?.styles?.length ?? 0) > 0 || (faces.assets?.scripts?.length ?? 0) > 0;
  if (hasAssets && moduleUrl === undefined) {
    throw new TypeError(
      "defineRenderer with assets requires import.meta.url as its second argument so relative paths remain closed.",
    );
  }

  const dimensions = faces.dimensions ?? (() => ({}));
  const meta: RendererMeta = {
    moduleUrl: moduleUrl ?? import.meta.url,
    styles: faces.assets?.styles ?? [],
    scripts: faces.assets?.scripts ?? [],
  };
  const component = defineComponent<RendererProps<TValue, TOptions>>({
    dimensions(props) {
      const { value, options } = splitRendererProps(props);
      return dimensions(value, options);
    },
    text(props, context) {
      const { value, options } = splitRendererProps(props);
      return faces.text(value, options, toRendererTextContext(context));
    },
    web(props, context) {
      const { value, options } = splitRendererProps(props);
      return faces.web(value, options, toRendererWebContext(context));
    },
  });
  return attachRendererMeta(component, meta);
}
