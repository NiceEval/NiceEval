import type { ReactElement } from "react";
import { useLoaderData, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AttemptDialog } from "./AttemptDialog.tsx";
import { AttemptDetails } from "./details/index.tsx";
import type { Locale } from "../shell/types.ts";
import type { AttemptPageModel } from "./model/page.ts";

export function AttemptRoute(): ReactElement {
  const model = useLoaderData() as AttemptPageModel;
  const location = useLocation();
  const { i18n, t } = useTranslation();
  const locale: Locale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
  const details = <AttemptDetails model={model} locale={locale} />;
  return (location.state as { background?: Location } | null)?.background === undefined
    ? details
    : <AttemptDialog title={t("attempt.title")}>{details}</AttemptDialog>;
}
