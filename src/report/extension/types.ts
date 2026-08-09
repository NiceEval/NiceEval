// defineRenderer 的公开类型(docs/feature/reports/README.md「自定义 renderer」、
// docs/feature/reports/README.md「自定义显示形状」)。

import type { ReactNode } from "react";
import type { JsonValue } from "../../shared/types.ts";
import type { ReportNode } from "../definition/tree.ts";
import type { DimensionDeclarations } from "../presentation.ts";
import type { ReportLocale } from "../model/locale.ts";
import type { PresentedDimension } from "../presentation.ts";

/** renderer 声明的本地资产路径,相对 defineRenderer 调用文件解析。 */
export interface RendererAssetPaths {
  readonly styles?: readonly string[];
  readonly scripts?: readonly string[];
}

/**
 * text / web renderer 共用的呈现上下文:只含 locale 与维度呈现,不含 Sample、Record、
 * Source、IO 或异步取数(docs/feature/reports/README.md「自定义显示形状」)。
 */
export interface RendererContext {
  readonly locale: ReportLocale;
  /** 取本 renderer `dimensions()` 声明的句柄在这一页的呈现面。 */
  dimension(handle: string): PresentedDimension;
}

/** text 面 renderer 上下文:在 RendererContext 上增加终端排版能力。 */
export interface RendererTextContext extends RendererContext {
  readonly width: number;
  render(node: ReportNode, width?: number): string;
}

/** web 面 renderer 上下文:与 RendererContext 同形,维度查询含颜色 / 线型 / pattern。 */
export type RendererWebContext = RendererContext;

/** Renderer options 的闭包值域：props 可跨 text/web 宿主并序列化，不挂原始 SDK 对象。 */
export type RendererOptions = Readonly<Record<string, JsonValue>>;

export interface RendererFaces<TValue, TOptions extends RendererOptions> {
  readonly assets?: RendererAssetPaths;
  readonly dimensions?: (value: TValue, options: TOptions) => DimensionDeclarations;
  text(value: TValue, options: TOptions, context: RendererTextContext): string;
  web(value: TValue, options: TOptions, context: RendererWebContext): ReactNode;
}

/** defineRenderer 产物的 props:`value` 承载已算好的普通值,其余键是 options。 */
export type RendererProps<TValue, TOptions extends RendererOptions> = TOptions & {
  readonly value: TValue;
};

/** 物化后的单条 renderer 资产:按内容哈希去重,路径形如 `assets/<sha256><ext>`。 */
export interface MaterializedRendererAsset {
  readonly hash: string;
  readonly ext: string;
  readonly path: string;
  readonly kind: "style" | "script";
  readonly content: Uint8Array;
}

/** 一页收集并物化后的 renderer 资产清单。 */
export interface PageRendererAssets {
  readonly styles: readonly MaterializedRendererAsset[];
  readonly scripts: readonly MaterializedRendererAsset[];
}
