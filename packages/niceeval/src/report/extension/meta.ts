/** Cross-package renderer metadata.  This descriptor is data only. */

import type { ReportComponent } from "../definition/tree.ts";

export const COMPONENT_RENDERER: unique symbol = Symbol.for("niceeval.report.renderer/v1");
const RENDERER_DESCRIPTOR_VERSION = 1;

export interface RendererMeta {
  readonly moduleUrl: string;
  readonly styles: readonly string[];
  readonly scripts: readonly string[];
}

interface RendererDescriptorEnvelope {
  readonly version: 1;
  readonly meta: RendererMeta;
}

/** Attaches the versioned data descriptor without adding executable behavior. */
export function attachRendererMeta<Component extends ReportComponent<any>>(
  component: Component,
  meta: RendererMeta,
): Component {
  const normalized = normalizeRendererMeta(meta);
  Object.defineProperty(component, COMPONENT_RENDERER, {
    value: Object.freeze({
      version: RENDERER_DESCRIPTOR_VERSION,
      meta: normalized,
    } satisfies RendererDescriptorEnvelope),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return component;
}

/** Reads metadata from this or another installed copy of niceeval. */
export function rendererMetaOf(type: unknown): RendererMeta | undefined {
  if (typeof type !== "function") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(type, COMPONENT_RENDERER);
  if (descriptor === undefined || !("value" in descriptor) || !isRendererDescriptor(descriptor.value)) return undefined;
  return descriptor.value.meta;
}

export function isRendererComponent(type: unknown): type is ReportComponent<object> {
  return rendererMetaOf(type) !== undefined;
}

function isRendererDescriptor(value: unknown): value is RendererDescriptorEnvelope {
  return isPlainObject(value) && Object.keys(value).length === 2 && value.version === RENDERER_DESCRIPTOR_VERSION &&
    isRendererMeta(value.meta);
}

function normalizeRendererMeta(value: RendererMeta): RendererMeta {
  if (!isRendererMeta(value)) throw new TypeError("Renderer metadata must contain a module URL and local style/script paths");
  return Object.freeze({
    moduleUrl: value.moduleUrl,
    styles: Object.freeze([...value.styles]),
    scripts: Object.freeze([...value.scripts]),
  });
}

function isRendererMeta(value: unknown): value is RendererMeta {
  return isPlainObject(value) && Object.keys(value).length === 3 && typeof value.moduleUrl === "string" &&
    Array.isArray(value.styles) && value.styles.every((path) => typeof path === "string") &&
    Array.isArray(value.scripts) && value.scripts.every((path) => typeof path === "string");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
