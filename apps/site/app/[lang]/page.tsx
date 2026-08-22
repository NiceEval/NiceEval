import { notFound } from "next/navigation";
import HomeClient from "../../components/site-home-client";
import { absoluteUrl, getDictionary, githubUrl, hasLocale, locales, withLocale } from "../../lib/content";
import { JsonLd } from "../../lib/json-ld";

type LangParams = Promise<{ lang: string }>;

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: LangParams }) {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  const path = withLocale(lang);
  return {
    title: { absolute: t.titleHome },
    alternates: {
      canonical: path,
      languages: { en: withLocale("en"), zh: withLocale("zh"), "x-default": withLocale("en") },
    },
    openGraph: {
      title: t.titleHome,
      description: t.meta,
      type: "website",
      url: path,
      siteName: "NiceEval",
      locale: lang === "zh" ? "zh_CN" : "en_US",
    },
  };
}

export default async function HomePage({ params }: { params: LangParams }) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "NiceEval",
          description: t.meta,
          url: absoluteUrl(withLocale(lang)),
          applicationCategory: "DeveloperApplication",
          operatingSystem: "Node.js",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          sameAs: [githubUrl],
        }}
      />
      <HomeClient t={t} locale={lang} />
    </>
  );
}
