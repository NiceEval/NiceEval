// defineRenderer 元数据符号与读取器。

import type { ReportComponent } from "../definition/tree.ts";

/** 挂 renderer 元数据的私有键:资产收集与模块 URL 解析靠它。 */
export const COMPONENT_RENDERER: unique symbol = Symbol.for("niceeval.report.renderer");

export interface RendererMeta {
  readonly moduleUrl: string;
  readonly styles: readonly string[];
  readonly scripts: readonly string[];
}

export function rendererMetaOf(type: unknown): RendererMeta | undefined {
  if (typeof type !== "function") return undefined;
  return (type as ReportComponent<object> & { [COMPONENT_RENDERER]?: RendererMeta })[COMPONENT_RENDERER];
}

export function isRendererComponent(type: unknown): boolean {
  return rendererMetaOf(type) !== undefined;
}
