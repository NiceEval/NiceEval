export type Locale = "en" | "zh-CN";

export interface LocalizedText {
  readonly en: string;
  readonly "zh-CN": string;
}

export type InsightTarget =
  | { readonly kind: "group"; readonly groupKind: "named" | "singleton"; readonly key: string }
  | { readonly kind: "experiment"; readonly experimentId: string }
  | { readonly kind: "run"; readonly runId: string }
  | { readonly kind: "attempt"; readonly locator: string };

export interface InsightPage {
  readonly pageId: string;
  readonly route: string;
  readonly title: LocalizedText;
  readonly navigation: boolean;
  readonly target: InsightTarget;
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

export interface InsightSurface {
  readonly location: BackgroundLocation;
  readonly target: InsightTarget;
  readonly presentation: "page" | "dialog";
}

export type InsightCloseTarget =
  | { readonly kind: "history" }
  | { readonly kind: "replace"; readonly route: string };

export interface InsightSurfacePlan {
  readonly background: InsightSurface;
  readonly foreground?: InsightSurface & { readonly close: InsightCloseTarget };
}
