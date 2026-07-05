import "../globals.css";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale, locales } from "../../lib/content";

type LangParams = Promise<{ lang: string }>;

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: LangParams }) {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  return {
    title: {
      default: "NiceEval",
      template: "%s | NiceEval",
    },
    description: t.meta,
  };
}

export default async function LangLayout({ children, params }: { children: ReactNode; params: LangParams }) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  return (
    <html lang={lang === "zh" ? "zh-CN" : "en"} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
