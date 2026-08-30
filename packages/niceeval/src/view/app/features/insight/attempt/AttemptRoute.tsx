import type { ReactElement } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AttemptDialog } from "./AttemptDialog.tsx";
import { AttemptDetails } from "./details/index.tsx";
import type { Locale } from "../shell/types.ts";
import type { AttemptPageModel } from "./model/page.ts";
import { useCurrentGeneration } from "../data/index.ts";
import { attemptQueryOptions } from "./data/load.ts";

export function AttemptRoute(): ReactElement {
  const generation = useCurrentGeneration();
  const locator = useParams().locator;
  if (locator === undefined) throw new Error("Attempt route parameter is missing.");
  const { data: model } = useSuspenseQuery(attemptQueryOptions(generation, `@${locator}`));
  const { i18n, t } = useTranslation();
  const locale: Locale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
  return <AttemptDialog title={t("attempt.title")}>
    <AttemptDetails model={model} locale={locale} />
  </AttemptDialog>;
}
