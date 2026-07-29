// defineRenderer —— 普通值双面 renderer 协议(docs/feature/reports/library/layout.md)。

import type { ReactNode } from "react";

import {
  COMPONENT_FACES,
  type ReportComponent,
  type TextContext,
  type WebContext,
} from "../definition/tree.ts";
import type { DimensionDeclarations } from "../presentation.ts";
import { assertRendererAssets } from "./assets.ts";
import { COMPONENT_RENDERER, type RendererMeta } from "./meta.ts";
import type {
  RendererFaces,
  RendererProps,
  RendererTextContext,
  RendererWebContext,
} from "./types.ts";

function componentLabel(type: unknown): string {
  if (typeof type === "function") {
    const named = type as { displayName?: string; name?: string };
    return named.displayName || named.name || "Component";
  }
  return String(type);
}

function assertSerializable(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return;
  if (kind === "function" || kind === "symbol" || kind === "bigint") {
    throw new Error(
      `defineRenderer component received non-serializable props at ${path} (${kind}). ` +
        "Renderer input must be plain computed values — await calculations in page render before passing them.",
    );
  }
  if (value instanceof Promise) {
    throw new Error(
      `defineRenderer component received a Promise at ${path}. ` +
        "Await the calculation in page render before passing the value to a renderer.",
    );
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSerializable(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(
        `defineRenderer component received a class instance at ${path}. ` +
          "Pass plain serializable objects produced by report calculations.",
      );
    }
    for (const [key, child] of Object.entries(value as globalThis.Record<string, unknown>)) {
      assertSerializable(child, `${path}.${key}`);
    }
  }
}

function splitRendererProps<TValue, TOptions extends Record<string, unknown>>(
  props: RendererProps<TValue, TOptions>,
): { value: TValue; options: TOptions } {
  const { value, ...rest } = props as RendererProps<TValue, TOptions> & { value: TValue };
  if (value === undefined) {
    throw new Error(
      'defineRenderer component requires a "value" prop with the already-computed data. ' +
        "Compute it in page render and pass it as value={…}.",
    );
  }
  assertSerializable(value, "value");
  for (const [key, child] of Object.entries(rest)) {
    assertSerializable(child, key);
  }
  return { value, options: rest as unknown as TOptions };
}

function toRendererTextContext(ctx: TextContext): RendererTextContext {
  return {
    locale: ctx.locale,
    width: ctx.width,
    dimension: (handle) => ctx.dimension(handle),
    render: (node, width) => ctx.render(node as never, width),
  };
}

function toRendererWebContext(ctx: WebContext): RendererWebContext {
  return {
    locale: ctx.locale,
    dimension: (handle) => ctx.dimension(handle),
  };
}

/**
 * 定义只接收已计算普通值的双面 renderer。
 *
 * @param faces text 与 web 必填;assets 路径相对第二个参数 `moduleUrl`(作者的
 *   `import.meta.url`)解析。
 */
export function defineRenderer<TValue, TOptions extends Record<string, unknown> = Record<string, never>>(
  faces: RendererFaces<TValue, TOptions>,
  moduleUrl = import.meta.url,
): ReportComponent<RendererProps<TValue, TOptions>> {
  const label = "defineRenderer";
  if (!faces || typeof faces !== "object") {
    throw new Error("defineRenderer expects { text, web, assets?, dimensions? }.");
  }
  if (typeof faces.web !== "function" || typeof faces.text !== "function") {
    const missing = typeof faces.web !== "function" ? "web" : "text";
    throw new Error(
      `defineRenderer requires both faces: { text(value, options, ctx), web(value, options, ctx) }. ` +
        `The ${missing} face is missing — every custom renderer must render in both hosts (niceeval show and niceeval view).`,
    );
  }
  assertRendererAssets(faces.assets, label);

  const dimensions: (data: TValue, options: TOptions) => DimensionDeclarations =
    faces.dimensions ?? (() => ({}));

  const meta: RendererMeta = {
    moduleUrl,
    styles: faces.assets?.styles ?? [],
    scripts: faces.assets?.scripts ?? [],
  };

  const component = ((props: RendererProps<TValue, TOptions>) => {
    const { value, options } = splitRendererProps(props);
    return faces.web(value, options, {
      locale: "en",
      dimension: (handle) => {
        throw new Error(
          `ctx.dimension(${JSON.stringify(handle)}) is not available when rendering ${componentLabel(component)} outside the report pipeline. ` +
            "Render through niceeval show / view, or use presentDimension from niceeval/report for a standalone React page.",
        );
      },
    });
  }) as ReportComponent<RendererProps<TValue, TOptions>>;

  component[COMPONENT_FACES] = {
    dimensions: (data, options) => dimensions(data as TValue, options as TOptions),
    text(props, ctx) {
      const { value, options } = splitRendererProps(props as RendererProps<TValue, TOptions>);
      return faces.text(value, options, toRendererTextContext(ctx));
    },
    web(props, ctx) {
      const { value, options } = splitRendererProps(props as RendererProps<TValue, TOptions>);
      return faces.web(value, options, toRendererWebContext(ctx)) as ReactNode;
    },
  };
  (component as ReportComponent<RendererProps<TValue, TOptions>> & { [COMPONENT_RENDERER]: RendererMeta })[
    COMPONENT_RENDERER
  ] = meta;
  return component;
}
