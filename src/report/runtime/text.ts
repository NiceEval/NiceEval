import {
  resolvedPageTextProjection,
  type ResolvedPage,
} from "./resolved-page.ts";

export interface RenderResolvedPageTextOptions {
  /** Explicit: a machine or terminal caller must never inherit process locale. */
  readonly locale: string;
  /** Explicit: closed terminal output is only reusable at the requested width. */
  readonly width: number;
}

export interface ResolvedPageTextProjectionMissing {
  readonly code: "report-text-projection-missing";
  readonly pageId: string;
  readonly route: string;
  readonly locale: string;
  readonly width: number;
}

/**
 * Reads one pre-closed terminal projection. This function deliberately has no
 * Sample, callback, renderer, or Effect dependency.
 */
export function renderResolvedPageText(
  page: ResolvedPage,
  options: RenderResolvedPageTextOptions,
): string {
  const projection = resolvedPageTextProjection(page, options);
  if (projection !== undefined) return projection.text;
  throw textProjectionMissing(page, options);
}

/** A total variant for Host error mapping without exception inspection. */
export function resolvedPageText(
  page: ResolvedPage,
  options: RenderResolvedPageTextOptions,
): { readonly state: "rendered"; readonly text: string } | ResolvedPageTextProjectionMissing {
  const projection = resolvedPageTextProjection(page, options);
  if (projection !== undefined) return Object.freeze({ state: "rendered" as const, text: projection.text });
  return textProjectionMissing(page, options);
}

function textProjectionMissing(
  page: ResolvedPage,
  options: RenderResolvedPageTextOptions,
): ResolvedPageTextProjectionMissing {
  return Object.freeze({
    code: "report-text-projection-missing" as const,
    pageId: page.target.pageId,
    route: page.target.route,
    locale: options.locale,
    width: options.width,
  });
}
