import type { Locale as SupportedLocale } from "../../../../../i18n/core.ts";

export type Locale = SupportedLocale;

export interface LocalizedText {
  readonly en: string;
  readonly "zh-CN": string;
}

export interface InsightPage {
  readonly pageId: string;
  readonly route: string;
  readonly title: LocalizedText;
  readonly navigation: boolean;
  readonly presentation: "page" | "overlay";
  readonly target:
    | { readonly kind: "group"; readonly groupKind: "named" | "singleton"; readonly key: string }
    | { readonly kind: "experiment"; readonly experimentId: string }
    | { readonly kind: "run"; readonly runId: string }
    | { readonly kind: "attempt"; readonly locator: string };
}

export interface InsightManifest {
  readonly title: LocalizedText;
  readonly defaultRoute: string;
  readonly experimentSelection?: {
    readonly options: readonly {
      readonly route: string;
      readonly label: string;
    }[];
  };
  readonly pages: readonly InsightPage[];
}


export interface BackgroundLocation {
  readonly pathname: string;
  readonly search?: string;
}

export interface InsightRouteState {
  readonly background?: BackgroundLocation;
}
