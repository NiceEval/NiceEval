import { useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { AttemptDialog } from "./AttemptDialog.tsx";
import { AttemptDetails } from "./details/index.tsx";
import type { Locale } from "../shell/types.ts";
import { useCurrentGeneration } from "../data/index.ts";
import { attemptQueryOptions } from "./data/load.ts";

export function AttemptRoute({
  locator,
  onClose,
}: {
  readonly locator: string;
  readonly onClose: () => void;
}): ReactElement {
  const selection = new URLSearchParams(useLocation().search);
  const aspect = selection.get("aspect") ?? undefined;
  const id = selection.get("id") ?? undefined;
  const generation = useCurrentGeneration();
  const { data: model } = useSuspenseQuery(attemptQueryOptions(generation, locator));
  const { i18n, t } = useTranslation();
  const locale: Locale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
  return (
    <AttemptDialog title={t("attempt.title")} onClose={onClose}>
      <AttemptDetails
        key={`${locator}:${aspect}:${id}`}
        model={model}
        locale={locale}
        aspect={aspect}
        selectedId={id}
      />
    </AttemptDialog>
  );
}
