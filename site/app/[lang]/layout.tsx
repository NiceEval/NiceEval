import "../globals.css";
import type { ReactNode } from "react";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
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
    metadataBase: new URL("https://niceeval.com"),
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
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
        <Script
          src="https://api.goshipfast.com/tracker.js"
          data-project="cmr24oe2n006qlj10lr9t38n8"
          data-endpoint="https://api.goshipfast.com"
          strategy="lazyOnload"
        />
        <Script
          src="https://vibeloft.ai/telemetry/v1.js"
          data-vl-product-id="b5b155b2-4d7d-426e-89f8-95eaa1f61ba9"
          data-vl-auth-key="REPLACE_WITH_NEW_WEB_AUTH_KEY"
          strategy="lazyOnload"
        />
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-Q30H5WX93X" strategy="afterInteractive" />
        <Script id="ga4" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-Q30H5WX93X');
          `}
        </Script>
      </body>
    </html>
  );
}
