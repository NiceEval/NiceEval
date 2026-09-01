import "i18next";

import type en from "./locales/en.json" with { type: "json" };

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: typeof en;
  }
}
