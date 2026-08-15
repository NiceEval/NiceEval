import type { ReactElement } from "react";
import type { HeroData } from "./content.ts";
import {
  DEFAULT_REPORT_LOCALE,
  localeText,
  resolveLocalizedText,
  type LocalizedText,
  type ReportLocale,
} from "../../model/locale.ts";
import type { HeroBrandProps } from "./hero-types.ts";
import { PoweredBy } from "./PoweredBy.tsx";

function classNames(...parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join(" ");
}

/** ISO instant formatting for the browser face; unparseable values stay visible. */
function formatLastRun(value: string, locale: ReportLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return value;
  }
}

/**
 * The standard React web face for a Report hero.  Its title and data are
 * already closed by the caller; this function does no Report data access.
 */
export function HeroCard({
  title,
  data,
  logo,
  description,
  links = [],
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: HeroBrandProps & {
  readonly title: LocalizedText;
  readonly data: HeroData;
  readonly className?: string;
  readonly locale?: ReportLocale;
}): ReactElement {
  const meta =
    data.latestStartedAt === null
      ? localeText(locale, "hero.noRuns")
      : localeText(locale, "hero.lastRun", { time: formatLastRun(data.latestStartedAt, locale) });
  return (
    <header className={classNames("niceeval-report", "niceeval-hero", className)}>
      {logo === undefined ? null : (
        <img
          className="niceeval-hero-logo"
          src={logo.src}
          alt={resolveLocalizedText(logo.alt, locale)}
        />
      )}
      <h1 className="niceeval-hero-title">{resolveLocalizedText(title, locale)}</h1>
      {description === undefined ? null : (
        <p className="niceeval-hero-description">{resolveLocalizedText(description, locale)}</p>
      )}
      {links.length === 0 ? null : (
        <nav className="niceeval-hero-links" aria-label="Report links">
          {links.map((link) => (
            <a
              key={`${link.href}:${resolveLocalizedText(link.label, locale)}`}
              className="niceeval-hero-link"
              href={link.href}
              rel="noopener"
            >
              {resolveLocalizedText(link.label, locale)}
            </a>
          ))}
        </nav>
      )}
      <p className="niceeval-hero-meta">{meta}</p>
      <PoweredBy />
    </header>
  );
}
