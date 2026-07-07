import { notFound } from "next/navigation";
import HomeClient from "../../components/site-home-client";
import { getDictionary, githubUrl, hasLocale, locales } from "../../lib/content";
import { JsonLd } from "../../lib/json-ld";

type LangParams = Promise<{ lang: string }>;

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: LangParams }) {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  return {
    alternates: { canonical: `/${lang}` },
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
          url: `https://niceeval.com/${lang}`,
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
