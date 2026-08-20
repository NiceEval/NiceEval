import {
  resolvedPageWebProjection,
  type ResolvedPage,
} from "./resolved-page.ts";

export interface RenderResolvedPageWebOptions {
  /** Explicit: the page resolver closes one web body for each requested locale. */
  readonly locale: string;
}

export interface ResolvedPageWebProjectionMissing {
  readonly code: "report-web-projection-missing";
  readonly pageId: string;
  readonly route: string;
  readonly locale: string;
}

/**
 * Reads one pre-closed HTML body. view and static receive this exact string;
 * neither can invoke Analysis or an author component while serving it.
 */
export function renderResolvedPageWeb(
  page: ResolvedPage,
  options: RenderResolvedPageWebOptions,
): string {
  const projection = resolvedPageWebProjection(page, options);
  if (projection !== undefined) return projection.html;
  throw webProjectionMissing(page, options);
}

/** A total variant for Host error mapping without exception inspection. */
export function resolvedPageWeb(
  page: ResolvedPage,
  options: RenderResolvedPageWebOptions,
): { readonly state: "rendered"; readonly html: string } | ResolvedPageWebProjectionMissing {
  const projection = resolvedPageWebProjection(page, options);
  if (projection !== undefined) return Object.freeze({ state: "rendered" as const, html: projection.html });
  return webProjectionMissing(page, options);
}

function webProjectionMissing(
  page: ResolvedPage,
  options: RenderResolvedPageWebOptions,
): ResolvedPageWebProjectionMissing {
  return Object.freeze({
    code: "report-web-projection-missing" as const,
    pageId: page.target.pageId,
    route: page.target.route,
    locale: options.locale,
  });
}
