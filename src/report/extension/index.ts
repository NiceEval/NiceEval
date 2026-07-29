// niceeval/report/extension —— 自定义双面 renderer 协议。
// 契约见 docs/feature/reports/library/layout.md 与 docs/feature/reports/architecture.md。

export { defineRenderer } from "./define.ts";
export { isRendererComponent, rendererMetaOf } from "./meta.ts";
export type { RendererMeta } from "./meta.ts";
export {
  assertRendererAssets,
  collectRendererAssetDeclarations,
  materializeRendererAssets,
} from "./assets.ts";
export type { RendererAssetDeclaration } from "./assets.ts";
export type {
  MaterializedRendererAsset,
  PageRendererAssets,
  RendererAssetPaths,
  RendererContext,
  RendererFaces,
  RendererProps,
  RendererTextContext,
  RendererWebContext,
} from "./types.ts";
