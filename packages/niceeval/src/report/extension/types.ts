/** Public types for extension renderers. */

import type { ReactNode } from "react";
import type { JsonValue } from "../../analysis/index.ts";
import type { ReportNode } from "../definition/tree.ts";
import type {
  DimensionDeclarations,
  PresentedDimension,
} from "../presentation.ts";
import type { ReportLocale } from "../model/locale.ts";

/** Local assets resolve relative to the module URL passed to defineRenderer(). */
export interface RendererAssetPaths {
  readonly styles?: readonly string[];
  readonly scripts?: readonly string[];
}

/** Shared, data-only renderer context. */
export interface RendererContext {
  readonly locale: ReportLocale;
  readonly dimension: (handle: string) => PresentedDimension;
}

export interface RendererTextContext extends RendererContext {
  readonly width: number;
  readonly render: (node: ReportNode, width?: number) => string;
}

export type RendererWebContext = RendererContext;

/** Renderer options must survive one resolved-page boundary as JSON data. */
export type RendererOptions = Readonly<Record<string, JsonValue>>;

export interface RendererFaces<TValue, TOptions extends RendererOptions> {
  readonly assets?: RendererAssetPaths;
  readonly dimensions?: (value: TValue, options: TOptions) => DimensionDeclarations;
  readonly text: (value: TValue, options: TOptions, context: RendererTextContext) => string;
  readonly web: (value: TValue, options: TOptions, context: RendererWebContext) => ReactNode;
}

/** The component props wrap one already-computed value plus JSON options. */
export type RendererProps<TValue, TOptions extends RendererOptions> = TOptions & {
  readonly value: TValue;
};

export interface MaterializedRendererAsset {
  readonly hash: string;
  readonly ext: string;
  readonly path: string;
  readonly kind: "style" | "script";
  readonly content: Uint8Array;
}

export interface PageRendererAssets {
  readonly styles: readonly MaterializedRendererAsset[];
  readonly scripts: readonly MaterializedRendererAsset[];
}
