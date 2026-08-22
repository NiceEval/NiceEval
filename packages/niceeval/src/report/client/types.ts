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
  readonly fragment: string;
}

export interface ReportManifest {
  readonly title: LocalizedText;
  readonly defaultRoute: string;
  readonly pages: readonly ReportPageManifest[];
}

export interface ReportFragment {
  readonly title: LocalizedText;
  readonly html: LocalizedText;
}

export interface BackgroundLocation {
  readonly pathname: string;
  readonly search?: string;
}

export interface ReportRouteState {
  readonly background?: BackgroundLocation;
}
