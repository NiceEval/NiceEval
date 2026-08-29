import type { ReactNode } from "react";
export type Locale = "en" | "zh-CN";

export interface LocalizedText {
  readonly en: string;
  readonly "zh-CN": string;
}

export interface ReportPageManifest {
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

export interface ReportManifest {
  readonly title: LocalizedText;
  readonly defaultRoute: string;
  readonly experimentSelection?: {
    readonly options: readonly {
      readonly route: string;
      readonly label: string;
    }[];
  };
  readonly pages: readonly ReportPageManifest[];
}

export interface ReportPageContent {
  readonly title: LocalizedText;
  readonly body: ReactNode;
}

export type ReportPageLoader = (page: ReportPageManifest, locale: Locale) => Promise<ReportPageContent>;

export interface BackgroundLocation {
  readonly pathname: string;
  readonly search?: string;
}

export interface ReportRouteState {
  readonly background?: BackgroundLocation;
}
