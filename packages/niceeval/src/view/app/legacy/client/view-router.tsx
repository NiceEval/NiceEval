import type { ReactNode } from "react";
import { createHashRouter } from "react-router-dom";

import { createReportRoutes } from "./routes.tsx";
import { viewManifest, type ViewCatalogSelection } from "./manifest.ts";
import type { Locale, ReportPageContent, ReportPageLoader } from "./types.ts";

export interface LegacyPageRepository {
  readonly group: (selection: { readonly kind: "named" | "singleton"; readonly key: string }) => Promise<unknown>;
  readonly experiment: (experimentId: string) => Promise<unknown>;
  readonly run: (runId: string) => Promise<unknown>;
  readonly attempt: (locator: string) => Promise<unknown>;
  readonly reset: () => void;
}

export interface LegacyPageRenderers {
  readonly group: (data: unknown, locale: Locale) => ReactNode;
  readonly experiment: (data: unknown, locale: Locale) => ReactNode;
  readonly run: (data: unknown, locale: Locale) => ReactNode;
  readonly attempt: (data: unknown, locale: Locale) => ReactNode;
}

export function createLegacyViewRouter(
  catalog: ViewCatalogSelection,
  repository: LegacyPageRepository,
  renderers: LegacyPageRenderers,
): ReturnType<typeof createHashRouter> {
  const manifest = viewManifest(catalog);
  const loadPage: ReportPageLoader = async (page, locale): Promise<ReportPageContent> => {
    switch (page.target.kind) {
      case "group": {
        const data = await repository.group({ kind: page.target.groupKind, key: page.target.key });
        return Object.freeze({ title: page.title, body: renderers.group(data, locale) });
      }
      case "experiment": {
        const data = await repository.experiment(page.target.experimentId);
        return Object.freeze({ title: page.title, body: renderers.experiment(data, locale) });
      }
      case "run": {
        const data = await repository.run(page.target.runId);
        return Object.freeze({ title: page.title, body: renderers.run(data, locale) });
      }
      case "attempt": {
        const data = await repository.attempt(page.target.locator);
        return Object.freeze({ title: page.title, body: renderers.attempt(data, locale) });
      }
    }
  };
  return createHashRouter(createReportRoutes(manifest, loadPage, repository.reset));
}
