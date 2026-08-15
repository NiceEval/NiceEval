/**
 * Package-owned classic visual baseline.
 *
 * This is deliberately a data-only string rather than a component or a DOM
 * helper. The Report Host imports it as a trusted built-in asset during SSG;
 * authors never receive a way to inject it into another document surface.
 * `scripts/package-runtime/build.mjs` writes this exact value to the public
 * `niceeval/report/react/styles.css` export.
 */
export const classicStylesheet = String.raw`/* NiceEval classic Report baseline — generated from src/report/assets/classic.ts */

/*
 * Every declaration is bounded by an author-owned classic root.  The few
 * document-chrome rules use :has(.niceeval-classic) solely to make navigation
 * match a classic report; they never address Host problem surfaces.
 */
.niceeval-report__author .niceeval-classic {
  /* The Host owns appearance. A classic document only consumes its closed tokens. */
  color-scheme: inherit;
  --classic-page: var(--niceeval-color-page, #f8f8f8);
  --classic-panel: var(--niceeval-color-surface, #ffffff);
  --classic-panel-raised: var(--niceeval-color-surface-subtle, #f1f2f4);
  --classic-panel-code: color-mix(in oklch, var(--classic-panel-raised), var(--classic-panel) 42%);
  --classic-line: var(--niceeval-color-border, #d4d6db);
  --classic-line-strong: var(--niceeval-color-border-strong, #9ea2aa);
  --classic-text: var(--niceeval-color-text, #191a1d);
  --classic-muted: var(--niceeval-color-text-secondary, #5e6470);
  --classic-soft: color-mix(in oklch, var(--classic-muted), transparent 20%);
  --classic-accent: var(--niceeval-color-accent, #2167c8);
  --classic-focus: var(--niceeval-color-focus, #2167c8);
  --classic-good: var(--niceeval-color-positive, #16805c);
  --classic-warn: var(--niceeval-color-warning, #a76400);
  --classic-bad: var(--niceeval-color-negative, #ba3434);
  --classic-c0: var(--niceeval-color-series-1, #2a78d6);
  --classic-c1: var(--niceeval-color-series-2, #1b8b66);
  --classic-c2: var(--niceeval-color-series-3, #b57400);
  --classic-c3: var(--niceeval-color-series-4, #008300);
  --classic-c4: var(--niceeval-color-series-5, #cf5151);
  --classic-c5: var(--niceeval-color-series-6, #cc5d24);
  --classic-radius: max(0.4rem, var(--niceeval-radius, 0.5rem));
  --classic-radius-small: calc(var(--classic-radius) * 0.72);
  --classic-shadow: 0 1px 2px color-mix(in oklch, black, transparent 90%), 0 9px 30px color-mix(in oklch, black, transparent 95%);
  --classic-gap: clamp(0.8rem, 1.8vw, 1.25rem);
  --classic-gap-tight: clamp(0.45rem, 1vw, 0.7rem);
  --classic-sans: var(--niceeval-font-sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif);
  --classic-mono: var(--niceeval-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  color: var(--classic-text);
  font-family: var(--classic-sans);
  font-size: var(--niceeval-font-size, 14px);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.niceeval-report__author .niceeval-classic,
.niceeval-report__author .niceeval-classic * {
  box-sizing: border-box;
}

.niceeval-report__author .niceeval-classic :focus-visible {
  outline: 2px solid var(--classic-focus);
  outline-offset: 2px;
}

/* Classic chrome: only a document which actually contains a classic root is changed. */
.niceeval-report:has(.niceeval-classic) {
  padding: 0;
  background: var(--niceeval-color-page, #050505);
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__topbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.75rem 1rem;
  align-items: center;
  min-height: 3.25rem;
  padding: 0.55rem clamp(1rem, 4vw, 2rem);
  border-bottom: 1px solid var(--niceeval-color-border, #262626);
  background: color-mix(in oklch, var(--niceeval-color-page, #050505), black 18%);
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__brand {
  display: inline-flex;
  gap: 0.45rem;
  align-items: center;
  color: var(--niceeval-color-text, #ededed);
  font-weight: 740;
  letter-spacing: -0.02em;
  text-decoration: none;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__brand-mark {
  width: 0.85rem;
  height: 0.85rem;
  border: 1.5px solid currentColor;
  transform: rotate(45deg);
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__site-navigation ul {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.35rem 0.9rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__site-navigation a {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font-size: 0.86em;
  font-weight: 650;
  text-decoration: none;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__site-navigation a[aria-current="page"],
.niceeval-report:has(.niceeval-classic) .niceeval-report__site-navigation a:hover {
  color: var(--niceeval-color-text, #ededed);
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__language {
  display: inline-flex;
  gap: 0.2rem;
  padding: 0.15rem;
  border: 1px solid var(--niceeval-color-border, #262626);
  border-radius: 0.4rem;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__language > button {
  appearance: none;
  min-block-size: 1.7rem;
  padding: 0 0.55rem;
  border: 0;
  border-radius: 0.28rem;
  background: transparent;
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  cursor: pointer;
  font: inherit;
  font-size: 0.78em;
  font-weight: 720;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__language > button[aria-pressed="true"] {
  background: var(--niceeval-color-surface, #0b0b0b);
  color: var(--niceeval-color-text, #ededed);
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__document {
  width: min(100%, 72rem);
  margin: 0 auto;
  padding: clamp(1rem, 4vw, 2.25rem) clamp(1rem, 4vw, 2rem) 4rem;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__document-header {
  display: none;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__navigation {
  margin: 0 0 clamp(1.1rem, 3vw, 2rem);
  padding: 0.55rem 0;
  border-block: 1px solid color-mix(in oklch, var(--niceeval-color-border, #d4d6db), transparent 24%);
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__navigation ul {
  align-items: center;
  gap: 0.35rem 0.8rem;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__navigation a {
  display: inline-flex;
  min-block-size: 2rem;
  align-items: center;
  padding-inline: 0.1rem;
  color: var(--niceeval-color-text-secondary, #5e6470);
  font-size: 0.86em;
  font-weight: 650;
  letter-spacing: 0.01em;
  text-decoration: none;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__navigation a:hover,
.niceeval-report:has(.niceeval-classic) .niceeval-report__navigation a[aria-current="page"] {
  color: var(--niceeval-color-accent, #2167c8);
  text-decoration: underline;
  text-underline-offset: 0.23em;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__document-header {
  max-width: 76ch;
  padding-bottom: clamp(1.4rem, 4vw, 3.25rem);
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__document-header > h1 {
  letter-spacing: -0.035em;
}

/* Layout primitives ------------------------------------------------------- */
.niceeval-report__author .niceeval-classic-stack,
.niceeval-report__author .niceeval-classic-series {
  display: grid;
  gap: var(--classic-gap);
  margin-block: var(--classic-gap);
}

.niceeval-report__author .niceeval-classic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15.5rem), 1fr));
  gap: var(--classic-gap);
  align-items: start;
  margin-block: var(--classic-gap);
}

.niceeval-report__author .niceeval-classic-grid > * {
  min-width: 0;
}

.niceeval-report__author .niceeval-classic-section {
  margin-block: var(--classic-gap);
}

.niceeval-report__author .niceeval-classic-section > .niceeval-report__callout,
.niceeval-report__author .niceeval-classic-callouts > .niceeval-report__stack,
.niceeval-report__author .niceeval-classic-copy-block > .niceeval-classic-section > .niceeval-report__callout {
  margin: 0;
}

.niceeval-report__author .niceeval-classic .niceeval-report__stack {
  display: grid;
  gap: var(--classic-gap-tight);
}

.niceeval-report__author .niceeval-classic .niceeval-report__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--classic-line);
  border-radius: var(--classic-radius);
  background: var(--classic-line);
  box-shadow: var(--classic-shadow);
}

.niceeval-report__author .niceeval-classic .niceeval-report__grid > * {
  min-width: 0;
  margin: 0;
  padding: clamp(0.85rem, 2vw, 1.1rem);
  background: var(--classic-panel);
}

.niceeval-report__author .niceeval-classic .niceeval-report__paragraph {
  max-width: 78ch;
  margin: 0;
  color: var(--classic-text);
  white-space: pre-wrap;
}

.niceeval-report__author .niceeval-classic .niceeval-report__paragraph + .niceeval-report__paragraph {
  margin-top: 0.55rem;
}

.niceeval-report__author .niceeval-classic :is(h2, h3, h4, h5, h6) {
  color: var(--classic-text);
  line-height: 1.2;
}

.niceeval-report__author .niceeval-classic .niceeval-report__callout {
  margin: 0;
  padding: clamp(0.9rem, 2.3vw, 1.3rem);
  border: 1px solid var(--classic-line);
  border-inline-start: 3px solid var(--classic-line-strong);
  border-radius: var(--classic-radius);
  background: var(--classic-panel);
  box-shadow: var(--classic-shadow);
}

.niceeval-report__author .niceeval-classic .niceeval-report__callout > :is(h2, h3, h4, h5, h6):first-child {
  margin: 0 0 0.75rem;
  font-size: clamp(1rem, 1.5vw, 1.15rem);
  font-weight: 720;
  letter-spacing: -0.012em;
}

.niceeval-report__author .niceeval-classic .niceeval-report__callout--positive {
  border-inline-start-color: var(--classic-good);
}

.niceeval-report__author .niceeval-classic .niceeval-report__callout--warning {
  border-inline-start-color: var(--classic-warn);
  background: color-mix(in oklch, var(--classic-panel), var(--classic-warn) 3%);
}

.niceeval-report__author .niceeval-classic .niceeval-report__callout--negative {
  border-inline-start-color: var(--classic-bad);
  background: color-mix(in oklch, var(--classic-panel), var(--classic-bad) 3%);
}

/* Hero and attribution ---------------------------------------------------- */
.niceeval-report__author .niceeval-classic-hero {
  display: block;
  margin: clamp(0.8rem, 3vw, 2rem) 0 clamp(1.5rem, 5vw, 3.5rem);
}

.niceeval-report__author .niceeval-classic-hero > .niceeval-report__callout {
  max-width: 74rem;
  margin: 0 auto;
  padding: clamp(1.45rem, 5vw, 4rem) clamp(1rem, 4vw, 3rem);
  border: 0;
  border-radius: calc(var(--classic-radius) * 1.45);
  background:
    radial-gradient(circle at 50% -35%, color-mix(in oklch, var(--classic-accent), transparent 72%), transparent 50%),
    var(--classic-panel);
  box-shadow: none;
  text-align: center;
}

.niceeval-report__author .niceeval-classic-hero :is(h1, h2, h3, h4, h5, h6),
.niceeval-report__author .niceeval-classic-hero :is(h1, h2, h3, h4, h5, h6) .niceeval-report__paragraph {
  max-width: 18ch;
  margin: 0 auto;
  color: var(--classic-text);
  font-size: clamp(2rem, 6vw, 4.4rem);
  font-weight: 790;
  letter-spacing: -0.055em;
  line-height: 0.98;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__author > .niceeval-report__stack > .niceeval-report__stack:first-child:not([class*="niceeval-classic"]) {
  margin: 0 0 clamp(1.5rem, 5vw, 3.5rem);
  text-align: center;
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__author > .niceeval-report__stack > .niceeval-report__stack:first-child:not([class*="niceeval-classic"]) > .niceeval-report__paragraph {
  max-width: 42rem;
  margin-inline: auto;
  color: var(--niceeval-color-text-secondary, #a1a1aa);
}

.niceeval-report:has(.niceeval-classic) .niceeval-report__author > .niceeval-report__stack > .niceeval-report__stack:first-child:not([class*="niceeval-classic"]) > .niceeval-report__paragraph:first-child {
  color: var(--niceeval-color-text, #ededed);
  font-size: clamp(2rem, 6vw, 4.4rem);
  font-weight: 790;
  letter-spacing: -0.055em;
  line-height: 0.98;
}

.niceeval-report__author .niceeval-classic-hero .niceeval-report__paragraph {
  max-width: 66ch;
  margin-inline: auto;
  color: var(--classic-muted);
  font-size: clamp(0.96rem, 1.7vw, 1.08rem);
}

.niceeval-report__author .niceeval-classic-hero .niceeval-report__paragraph:first-of-type {
  margin-top: 1.1rem;
}

.niceeval-report__author .niceeval-classic-hero-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.65rem;
  margin: 1.35rem 0 0;
}

.niceeval-report__author .niceeval-classic-fresh-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.75rem;
  color: var(--classic-muted);
  cursor: pointer;
  font-size: 0.82rem;
}

.niceeval-report__author .niceeval-classic-fresh-only .niceeval-classic-stale {
  display: none;
}

.niceeval-report__author .niceeval-classic-hero-links .niceeval-report__link,
.niceeval-report__author .niceeval-classic-hero-link,
.niceeval-report__author .niceeval-classic-hero-link .niceeval-report__link,
.niceeval-report__author a.niceeval-classic-hero-link {
  display: inline-flex;
  min-block-size: 2.45rem;
  align-items: center;
  padding: 0 1rem;
  border: 1px solid color-mix(in oklch, var(--classic-accent), var(--classic-line) 55%);
  border-radius: var(--classic-radius);
  background: color-mix(in oklch, var(--classic-accent), transparent 90%);
  color: var(--classic-text);
  font-size: 0.92rem;
  font-weight: 650;
  text-decoration: none;
}

.niceeval-report__author .niceeval-classic-hero-links .niceeval-report__paragraph {
  margin: 0;
}

.niceeval-report__author .niceeval-classic-hero-meta,
.niceeval-report__author .niceeval-classic-summary-range {
  margin: 1rem 0 0;
  color: var(--classic-muted);
  font-size: 0.88rem;
  text-align: center;
}

.niceeval-report__author .niceeval-classic-powered-by,
.niceeval-report__author .niceeval-classic-powered-by .niceeval-report__link,
.niceeval-report__author .niceeval-classic-powered-by-link {
  margin: 1.25rem 0 0;
  color: var(--classic-soft);
  font-size: 0.8rem;
  letter-spacing: 0.02em;
  text-align: center;
  text-decoration: none;
}

.niceeval-report__author .niceeval-classic-powered-by-link:hover {
  color: var(--classic-text);
  text-decoration: underline;
}

.niceeval-report__author .niceeval-classic-notices-empty {
  display: none;
}

.niceeval-report__author .niceeval-classic-notices .niceeval-report__callout {
  box-shadow: none;
}

/* Metric and summary cards ------------------------------------------------ */
.niceeval-report__author .niceeval-classic .niceeval-report__metric {
  min-width: 0;
  margin: 0;
}

.niceeval-report__author .niceeval-classic .niceeval-report__metric dt {
  color: var(--classic-soft);
  font-size: 0.72rem;
  font-weight: 720;
  letter-spacing: 0.065em;
  text-transform: uppercase;
}

.niceeval-report__author .niceeval-classic .niceeval-report__metric dd {
  margin: 0.35rem 0 0;
}

.niceeval-report__author .niceeval-classic .niceeval-report__metric dd:first-of-type {
  color: var(--classic-text);
  font-size: clamp(1.45rem, 3.4vw, 2.2rem);
  font-weight: 760;
  letter-spacing: -0.035em;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__author .niceeval-classic .niceeval-report__metric-unit {
  margin-inline-start: 0.22em;
  color: var(--classic-muted);
  font-size: 0.5em;
  font-weight: 620;
  letter-spacing: 0;
}

.niceeval-report__author .niceeval-classic .niceeval-report__metric-meta,
.niceeval-report__author .niceeval-classic .niceeval-report__metric-details,
.niceeval-report__author .niceeval-classic .niceeval-report__chart-kind {
  color: var(--classic-muted);
  font-size: 0.8rem;
  line-height: 1.4;
}

.niceeval-report__author .niceeval-classic-metric {
  margin: 0;
}

.niceeval-report__author .niceeval-classic-metric > .niceeval-report__stack {
  gap: 0.75rem;
}

.niceeval-report__author .niceeval-classic-summary > .niceeval-classic-section > .niceeval-report__callout {
  border: 0;
  background: transparent;
  box-shadow: none;
  padding: 0;
}

.niceeval-report__author .niceeval-classic-summary-title,
.niceeval-report__author .niceeval-classic-summary-title .niceeval-report__paragraph {
  margin: 0 0 0.75rem;
  color: var(--classic-muted);
  font-size: 0.76rem;
  font-weight: 760;
  letter-spacing: 0.065em;
  text-transform: uppercase;
}

.niceeval-report__author .niceeval-classic-summary .niceeval-report__grid,
.niceeval-report__author .niceeval-classic-summary .niceeval-classic-grid {
  margin-block: 0.75rem 1rem;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 1px;
}

/* A summary Stat is already the grid cell. Flatten the generic Stat panel so
 * six KPIs read as one compact strip instead of six nested cards. Incomplete
 * metrics still retain the Host-rendered status line below their value. */
.niceeval-report__author .niceeval-classic-summary .niceeval-classic-stat-metric > .niceeval-report__metric {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.niceeval-report__author .niceeval-classic-summary .niceeval-classic-stat-metric .niceeval-report__metric-details {
  min-height: 1.15em;
  margin-top: 0.45rem;
  font-size: 0.72rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.niceeval-report__author .niceeval-classic-stat {
  min-width: 0;
  padding: clamp(0.85rem, 2vw, 1.1rem);
  border: 0;
  background: var(--classic-panel);
}

.niceeval-report__author .niceeval-classic-stat-label,
.niceeval-report__author .niceeval-classic-stat-label .niceeval-report__paragraph {
  color: var(--classic-soft);
  font-size: 0.72rem;
  font-weight: 720;
  letter-spacing: 0.065em;
  text-transform: uppercase;
}

.niceeval-report__author .niceeval-classic-stat-value,
.niceeval-report__author .niceeval-classic-stat-value .niceeval-report__paragraph {
  margin: 0.35rem 0 0;
  color: var(--classic-text);
  font-size: clamp(1.05rem, 2.1vw, 1.55rem);
  font-weight: 760;
  letter-spacing: -0.03em;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.niceeval-report__author .niceeval-classic-stat-value .niceeval-report__paragraph {
  max-width: none;
}

/* Tables, rows, values ---------------------------------------------------- */
.niceeval-report__author .niceeval-classic .niceeval-report__table-section {
  min-width: 0;
  margin: 0;
}

.niceeval-report__author .niceeval-classic .niceeval-report__table-wrap {
  width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  border: 1px solid var(--classic-line);
  border-radius: var(--classic-radius);
  background: var(--classic-panel);
  box-shadow: var(--classic-shadow);
}

.niceeval-report__author .niceeval-classic .niceeval-report__table {
  width: 100%;
  min-width: min(38rem, 100%);
  border: 0;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--classic-panel);
}

.niceeval-report__author .niceeval-classic .niceeval-report__table caption {
  padding: 0.85rem 1rem 0.7rem;
  color: var(--classic-muted);
  font-size: 0.83rem;
  font-weight: 720;
  letter-spacing: 0.025em;
  text-align: start;
}

.niceeval-report__author .niceeval-classic .niceeval-report__table :is(th, td) {
  border: 0;
  border-bottom: 1px solid var(--classic-line);
  padding: 0.72rem 0.95rem;
  color: var(--classic-text);
  text-align: start;
  vertical-align: top;
}

.niceeval-report__author .niceeval-classic .niceeval-report__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--classic-muted);
  background: var(--classic-panel-raised);
  font-size: 0.7rem;
  font-weight: 760;
  letter-spacing: 0.065em;
  text-transform: uppercase;
}

.niceeval-report__author .niceeval-classic .niceeval-report__table tbody tr {
  transition: background-color 120ms ease-out;
}

.niceeval-report__author .niceeval-classic .niceeval-report__table tbody tr:hover {
  background: color-mix(in oklch, var(--classic-accent), transparent 95%);
}

.niceeval-report__author .niceeval-classic .niceeval-report__table tbody tr:last-child :is(th, td) {
  border-bottom: 0;
}

.niceeval-report__author .niceeval-classic .niceeval-report__align-end {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__author .niceeval-classic .niceeval-report__metric-value {
  display: grid;
  gap: 0.15rem;
  min-width: max-content;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__author .niceeval-classic .niceeval-report__scalar {
  color: var(--classic-text);
}

.niceeval-report__author .niceeval-classic .niceeval-report__link {
  color: var(--classic-accent);
  font-weight: 650;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
}

.niceeval-report__author .niceeval-classic .niceeval-report__link:hover {
  color: color-mix(in oklch, var(--classic-accent), var(--classic-text) 25%);
}

/* Chart text equivalents retain the 0.12 panel hierarchy even without JS. */
.niceeval-report__author .niceeval-classic .niceeval-report__chart {
  display: grid;
  gap: 0.8rem;
  min-width: 0;
  margin: 0;
  padding: clamp(0.85rem, 2vw, 1.2rem);
  border: 1px solid var(--classic-line);
  border-radius: var(--classic-radius);
  background:
    linear-gradient(180deg, color-mix(in oklch, var(--classic-panel-raised), transparent 42%), transparent 42%),
    var(--classic-panel);
  box-shadow: var(--classic-shadow);
}

.niceeval-report__author .niceeval-classic .niceeval-report__chart figcaption {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.65rem;
  align-items: baseline;
  margin: 0;
  color: var(--classic-text);
  font-size: 0.92rem;
  font-weight: 740;
}

.niceeval-report__author .niceeval-classic .niceeval-report__chart--bars {
  border-inline-start: 3px solid var(--classic-c0);
}

.niceeval-report__author .niceeval-classic .niceeval-report__chart--line {
  border-inline-start: 3px solid var(--classic-c1);
}

.niceeval-report__author .niceeval-classic .niceeval-report__chart--scatter {
  border-inline-start: 3px solid var(--classic-c2);
}

.niceeval-report__author .niceeval-classic .niceeval-report__chart .niceeval-report__table-wrap {
  box-shadow: none;
}

/* Horizontal Bars use an HTML leaderboard so labels, values, and the legend
 * retain the visual hierarchy of classic even before optional enhancement. */
.niceeval-report__author .niceeval-classic .niceeval-report__chart--classic-horizontal {
  gap: 0.95rem;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-bars > ol {
  display: grid;
  gap: 0.52rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-bar-row {
  display: grid;
  grid-template-columns: minmax(9rem, 14rem) minmax(7rem, 1fr) minmax(4.5rem, max-content);
  gap: 0.72rem;
  align-items: center;
  min-width: 0;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-bar-label {
  min-width: 0;
  overflow: hidden;
  color: var(--classic-text);
  font-size: 0.84rem;
  font-weight: 640;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-bar-track {
  display: block;
  min-width: 0;
  block-size: 0.92rem;
  overflow: hidden;
  border: 1px solid color-mix(in oklch, var(--classic-line), transparent 16%);
  border-radius: 999px;
  background-color: color-mix(in oklch, var(--classic-panel-raised), var(--classic-line) 24%);
  box-shadow: inset 0 1px 1px color-mix(in oklch, black, transparent 90%);
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-bar-fill,
.niceeval-report__author .niceeval-classic .niceeval-classic-chart-legend-swatch {
  --classic-chart-series-color: var(--classic-c0);
  display: block;
  background-color: var(--classic-chart-series-color);
  background-image: none;
  background-repeat: repeat;
  background-size: auto;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-bar-fill {
  min-inline-size: 0;
  block-size: 100%;
  border-radius: inherit;
  box-shadow: inset 0 1px 0 color-mix(in oklch, white, transparent 72%);
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-bar-end {
  display: grid;
  justify-items: end;
  gap: 0.12rem;
  min-width: 0;
  color: var(--classic-text);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  text-align: end;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-bar-end > data {
  font-weight: 720;
  white-space: nowrap;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-bar-status {
  color: var(--classic-muted);
  font-size: 0.7rem;
  font-weight: 550;
  line-height: 1.25;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.42rem 0.85rem;
  margin: 0.85rem 0 0;
  padding: 0;
  color: var(--classic-muted);
  font-size: 0.76rem;
  list-style: none;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-legend > li {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.35rem;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-legend-swatch {
  inline-size: 0.72rem;
  block-size: 0.72rem;
  flex: 0 0 auto;
  border: 1px solid color-mix(in oklch, var(--classic-line-strong), transparent 32%);
  border-radius: 0.16rem;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-series-c0 { --classic-chart-series-color: var(--classic-c0); }
.niceeval-report__author .niceeval-classic .niceeval-classic-chart-series-c1 { --classic-chart-series-color: var(--classic-c1); }
.niceeval-report__author .niceeval-classic .niceeval-classic-chart-series-c2 { --classic-chart-series-color: var(--classic-c2); }
.niceeval-report__author .niceeval-classic .niceeval-classic-chart-series-c3 { --classic-chart-series-color: var(--classic-c3); }
.niceeval-report__author .niceeval-classic .niceeval-classic-chart-series-c4 { --classic-chart-series-color: var(--classic-c4); }
.niceeval-report__author .niceeval-classic .niceeval-classic-chart-series-c5 { --classic-chart-series-color: var(--classic-c5); }

/* Keep color and texture in separate longhand declarations. A later
 * `background` shorthand would reset background-image and make series variants
 * indistinguishable in computed style. */
.niceeval-report__author .niceeval-classic .niceeval-classic-chart-series-v2 {
  background-color: var(--classic-chart-series-color);
  background-image: repeating-linear-gradient(135deg, transparent 0 0.25rem, color-mix(in oklch, white, transparent 68%) 0.25rem 0.5rem);
  background-size: 0.72rem 0.72rem;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-series-v3 {
  background-color: var(--classic-chart-series-color);
  background-image: repeating-linear-gradient(0deg, transparent 0 0.2rem, color-mix(in oklch, white, transparent 64%) 0.2rem 0.32rem);
  background-size: 0.68rem 0.68rem;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-chart-series-v4 {
  background-color: var(--classic-chart-series-color);
  background-image: radial-gradient(circle at 0.16rem 0.16rem, color-mix(in oklch, white, transparent 52%) 0 0.09rem, transparent 0.1rem);
  background-size: 0.55rem 0.55rem;
}

/* The Host closes SVG geometry at build time; classic only supplies its token skin. */
.niceeval-report__author .niceeval-classic .niceeval-report__chart-svg {
  border-color: var(--classic-line);
  background: color-mix(in oklch, var(--classic-panel-raised), var(--classic-panel) 52%);
}

.niceeval-report__author .niceeval-classic .niceeval-report__chart-grid-line {
  stroke: var(--classic-line);
}

.niceeval-report__author .niceeval-classic .niceeval-report__chart-axis {
  stroke: var(--classic-line-strong);
}

.niceeval-report__author .niceeval-classic .niceeval-report__chart-tick,
.niceeval-report__author .niceeval-classic .niceeval-report__chart-axis-title,
.niceeval-report__author .niceeval-classic .niceeval-report__chart-legend-item text {
  fill: var(--classic-muted);
}

.niceeval-report__author .niceeval-classic .niceeval-report__chart-point {
  fill: var(--classic-panel);
}

.niceeval-report__author .niceeval-classic .niceeval-report__chart-data > summary {
  color: var(--classic-muted);
}

.niceeval-report__author .niceeval-classic .niceeval-report__chart-kind,
.niceeval-report__author .niceeval-classic .niceeval-report__evidence,
.niceeval-report__author .niceeval-classic .niceeval-report__issue-refs,
.niceeval-report__author .niceeval-classic .niceeval-report__metric-details,
.niceeval-report__author .niceeval-classic .niceeval-report__metric-meta,
.niceeval-report__author .niceeval-classic-chart .niceeval-report__row-issues,
.niceeval-report__author .niceeval-classic-chart .niceeval-report__issues {
  display: none;
}

.niceeval-report__author .niceeval-classic-filter,
.niceeval-report__author .niceeval-classic input[data-niceeval-filter] {
  display: block;
  width: min(100%, 17.5rem);
  height: 2.15rem;
  margin: 0 0 0.75rem auto;
  padding: 0 0.7rem;
  border: 1px solid var(--classic-line);
  border-radius: var(--classic-radius);
  background: var(--classic-panel);
  color: var(--classic-text);
  font: inherit;
}

.niceeval-report__author .niceeval-classic th[data-niceeval-sort],
.niceeval-report__author .niceeval-classic-table-head [data-niceeval-sort] {
  cursor: pointer;
  user-select: none;
}

.niceeval-report__author .niceeval-classic-table-head [data-niceeval-sort] {
  appearance: none;
  display: block;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  line-height: inherit;
  text-align: inherit;
  text-transform: inherit;
}

.niceeval-report__author .niceeval-classic-table-head [data-niceeval-sort].niceeval-classic-table-end {
  text-align: end;
}

.niceeval-report__author .niceeval-classic-table-head [data-niceeval-sort]:focus-visible {
  outline: 2px solid var(--classic-accent, var(--report-focus, currentColor));
  outline-offset: 2px;
}

.niceeval-report__author .niceeval-classic th[data-niceeval-sort]::after,
.niceeval-report__author .niceeval-classic-table-head [data-niceeval-sort]::after {
  color: var(--classic-soft);
  content: " ↕";
  font-size: 0.72em;
  opacity: 0.55;
}

.niceeval-report__author .niceeval-classic th.niceeval-sort-asc::after,
.niceeval-report__author .niceeval-classic-table-head [data-niceeval-sort].niceeval-sort-asc::after { content: " ↑"; color: var(--classic-text); }
.niceeval-report__author .niceeval-classic th.niceeval-sort-desc::after,
.niceeval-report__author .niceeval-classic-table-head [data-niceeval-sort].niceeval-sort-desc::after { content: " ↓"; color: var(--classic-text); }
.niceeval-report__author .niceeval-classic .niceeval-row-hidden { display: none; }

.niceeval-report__author .niceeval-classic-table-tree {
  display: grid;
  gap: 0;
  overflow: auto;
  border: 1px solid var(--classic-line);
  border-radius: var(--classic-radius);
  background: var(--classic-panel);
}

.niceeval-report__author .niceeval-classic-table-caption,
.niceeval-report__author .niceeval-classic-table-caption .niceeval-report__paragraph {
  padding: 0.85rem 1rem 0.55rem;
  color: var(--classic-muted);
  font-size: 0.76rem;
  font-weight: 760;
  letter-spacing: 0.065em;
  text-transform: uppercase;
}

.niceeval-report__author .niceeval-classic-table-head,
.niceeval-report__author .niceeval-classic-table-row {
  display: grid;
  grid-template-columns: minmax(12rem, 1.6fr) repeat(4, minmax(5.5rem, 1fr));
  gap: 0.75rem;
  align-items: center;
  padding: 0.75rem 1rem;
}

.niceeval-report__author .niceeval-classic-table-head {
  border-bottom: 1px solid var(--classic-line);
  background: var(--classic-panel-raised);
  color: var(--classic-muted);
  font-size: 0.7rem;
  font-weight: 760;
  letter-spacing: 0.065em;
  text-transform: uppercase;
}

.niceeval-report__author .niceeval-classic-table-group,
.niceeval-report__author .niceeval-classic-table-row {
  border-bottom: 1px solid var(--classic-line);
}

.niceeval-report__author .niceeval-classic-table-group > summary.niceeval-classic-table-row {
  cursor: pointer;
  list-style: none;
}

.niceeval-report__author .niceeval-classic-table-group > summary.niceeval-classic-table-row::-webkit-details-marker {
  display: none;
}

.niceeval-report__author .niceeval-classic-table-group > summary.niceeval-classic-table-row > .niceeval-classic-table-cell:first-child,
.niceeval-report__author .niceeval-classic-table-group > summary.niceeval-classic-table-row > .niceeval-classic-table-cell:first-child .niceeval-report__paragraph {
  padding-inline-start: 1.15rem;
}

.niceeval-report__author .niceeval-classic-table-group > summary.niceeval-classic-table-row > .niceeval-classic-table-cell:first-child::before {
  display: inline-block;
  width: 0.45rem;
  height: 0.45rem;
  margin-inline-end: 0.55rem;
  border-right: 1.5px solid var(--classic-muted);
  border-bottom: 1.5px solid var(--classic-muted);
  transform: rotate(-45deg);
  content: "";
}

.niceeval-report__author .niceeval-classic-table-group[open] > summary.niceeval-classic-table-row > .niceeval-classic-table-cell:first-child::before {
  transform: rotate(45deg);
}

.niceeval-report__author .niceeval-classic-table-children {
  background: color-mix(in oklch, var(--classic-panel-raised), var(--classic-panel) 35%);
}

.niceeval-report__author .niceeval-classic-table-cell .niceeval-report__link {
  color: var(--classic-accent);
  font-weight: 650;
}

.niceeval-report__author .niceeval-classic-table-child {
  padding-inline-start: 1.6rem;
}

.niceeval-report__author .niceeval-classic-table-end,
.niceeval-report__author .niceeval-classic-table-end .niceeval-report__paragraph {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__author .niceeval-classic-table-cell .niceeval-report__paragraph {
  margin: 0;
  max-width: none;
}

.niceeval-tooltip {
  position: absolute;
  z-index: 8;
  min-width: 8rem;
  max-width: 18rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--classic-line, #262626);
  border-radius: 0.4rem;
  background: var(--classic-panel, #0b0b0b);
  box-shadow: 0 0.75rem 2rem color-mix(in oklch, black, transparent 55%);
  color: var(--classic-text, #ededed);
  font-size: 0.78rem;
  line-height: 1.35;
  pointer-events: none;
  transform: translate(-50%, calc(-100% - 0.55rem));
}

.niceeval-tooltip-meta {
  color: var(--classic-muted, #a1a1aa);
}

/* Tab panels, callouts and copy blocks ----------------------------------- */
.niceeval-report__author .niceeval-classic-tabs {
  display: grid;
  gap: 0.65rem;
  margin-block: var(--classic-gap);
}

.niceeval-report__author .niceeval-classic-tab {
  min-width: 0;
}

/* The enhancer adds its controls only after the complete static sections exist. */
.niceeval-report__author .niceeval-classic-tabs[data-niceeval-classic-tabs-enhanced="true"] {
  grid-template-columns: minmax(0, 1fr);
  gap: var(--classic-gap-tight);
}

.niceeval-report__author .niceeval-classic-tabs[data-niceeval-classic-tabs-enhanced="true"] > .niceeval-classic-tablist {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.35rem;
  border: 1px solid var(--classic-line);
  border-radius: var(--classic-radius);
  background: var(--classic-panel-raised);
}

.niceeval-report__author .niceeval-classic-tabs[data-niceeval-classic-tabs-enhanced="true"] > .niceeval-classic-tablist > [role="tab"] {
  appearance: none;
  display: inline-flex;
  flex: 1 1 10rem;
  min-inline-size: 0;
  min-block-size: 2.25rem;
  align-items: center;
  justify-content: start;
  padding: 0.45rem 0.75rem;
  border: 1px solid transparent;
  border-radius: var(--classic-radius-small);
  background: transparent;
  color: var(--classic-muted);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  line-height: 1.2;
  text-align: start;
  text-decoration: none;
  transition: background-color 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out;
}

.niceeval-report__author .niceeval-classic-tabs[data-niceeval-classic-tabs-enhanced="true"] > .niceeval-classic-tablist > [role="tab"]:hover {
  border-color: color-mix(in oklch, var(--classic-accent), var(--classic-line) 64%);
  background: color-mix(in oklch, var(--classic-accent), var(--classic-panel-raised) 92%);
  color: var(--classic-text);
}

.niceeval-report__author .niceeval-classic-tabs[data-niceeval-classic-tabs-enhanced="true"] > .niceeval-classic-tablist > [role="tab"][aria-selected="true"] {
  border-color: color-mix(in oklch, var(--classic-accent), var(--classic-line) 52%);
  background: var(--classic-panel);
  box-shadow: inset 0 -2px 0 var(--classic-accent);
  color: var(--classic-text);
}

.niceeval-report__author .niceeval-classic-tabs[data-niceeval-classic-tabs-enhanced="true"] > .niceeval-classic-tablist > [role="tab"]:focus-visible {
  outline: 2px solid var(--classic-focus);
  outline-offset: 2px;
}

.niceeval-report__author .niceeval-classic-tabs[data-niceeval-classic-tabs-enhanced="true"] > .niceeval-classic-tab[hidden] {
  display: none;
}

.niceeval-report__author .niceeval-classic-tab > .niceeval-classic-section > .niceeval-report__callout {
  border-inline-start-width: 1px;
}

.niceeval-report__author .niceeval-classic-tab :is(h2, h3, h4, h5, h6) {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.niceeval-report__author .niceeval-classic-tab :is(h2, h3, h4, h5, h6)::before {
  width: 0.55rem;
  height: 0.55rem;
  flex: 0 0 auto;
  border: 1px solid var(--classic-line-strong);
  border-radius: 999px;
  background: var(--classic-panel-raised);
  content: "";
}

.niceeval-report__author .niceeval-classic-callouts > .niceeval-report__stack {
  gap: 0.65rem;
}

.niceeval-report__author .niceeval-classic-callouts .niceeval-report__callout {
  box-shadow: none;
}

.niceeval-report__author .niceeval-classic-copy-block,
.niceeval-report__author .niceeval-classic-fix-prompt,
.niceeval-report__author .niceeval-classic-markdown {
  margin-block: var(--classic-gap-tight);
}

.niceeval-report__author .niceeval-classic-copy-block .niceeval-report__paragraph,
.niceeval-report__author .niceeval-classic-fix-prompt .niceeval-report__paragraph,
.niceeval-report__author .niceeval-classic-markdown .niceeval-report__paragraph {
  padding: 0.85rem 1rem;
  border: 1px solid var(--classic-line);
  border-radius: var(--classic-radius-small);
  background: var(--classic-panel-code);
  color: var(--classic-text);
  font-family: var(--classic-mono);
  font-size: 0.86rem;
  line-height: 1.6;
  overflow-x: auto;
}

.niceeval-report__author .niceeval-classic-markdown .niceeval-report__paragraph {
  font-family: inherit;
}

/* Evidence: conversational and command cards ---------------------------- */
.niceeval-report__author .niceeval-classic-conversation,
.niceeval-report__author .niceeval-classic-command-evidence {
  display: grid;
  gap: 0.65rem;
  margin-block: var(--classic-gap);
}

.niceeval-report__author .niceeval-classic-conversation > .niceeval-report__stack,
.niceeval-report__author .niceeval-classic-command-evidence > .niceeval-report__stack {
  gap: 0.65rem;
}

.niceeval-report__author .niceeval-classic-conversation .niceeval-report__callout,
.niceeval-report__author .niceeval-classic-command-evidence .niceeval-report__callout {
  position: relative;
  padding: 0.9rem 1rem;
  border-inline-start-width: 3px;
  box-shadow: none;
}

.niceeval-report__author .niceeval-classic-conversation .niceeval-report__callout > :is(h2, h3, h4, h5, h6),
.niceeval-report__author .niceeval-classic-command-evidence .niceeval-report__callout > :is(h2, h3, h4, h5, h6) {
  color: var(--classic-muted);
  font-family: var(--classic-mono);
  font-size: 0.76rem;
  font-weight: 720;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.niceeval-report__author .niceeval-classic-conversation .niceeval-report__paragraph,
.niceeval-report__author .niceeval-classic-command-evidence .niceeval-report__paragraph {
  max-width: none;
}

.niceeval-report__author .niceeval-classic-command-evidence .niceeval-report__paragraph:first-of-type {
  color: var(--classic-accent);
  font-family: var(--classic-mono);
  font-size: 0.88rem;
}

.niceeval-report__author .niceeval-classic-command-evidence .niceeval-report__paragraph:not(:first-of-type) {
  padding: 0.6rem 0.75rem;
  border-radius: var(--classic-radius-small);
  background: var(--classic-panel-code);
  color: var(--classic-muted);
  font-family: var(--classic-mono);
  font-size: 0.8rem;
}

/* Source and diff retain code-review density, not generic prose. ---------- */
.niceeval-report__author .niceeval-classic-source,
.niceeval-report__author .niceeval-classic-diff {
  overflow: hidden;
  margin-block: var(--classic-gap);
  border: 1px solid var(--classic-line);
  border-radius: var(--classic-radius);
  background: var(--classic-panel);
  box-shadow: var(--classic-shadow);
}

.niceeval-report__author .niceeval-classic-source > .niceeval-classic-section,
.niceeval-report__author .niceeval-classic-diff > .niceeval-report__stack {
  margin: 0;
}

.niceeval-report__author .niceeval-classic-source .niceeval-report__callout,
.niceeval-report__author .niceeval-classic-diff .niceeval-report__callout {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.niceeval-report__author .niceeval-classic-source .niceeval-report__callout > :is(h2, h3, h4, h5, h6),
.niceeval-report__author .niceeval-classic-diff .niceeval-report__callout > :is(h2, h3, h4, h5, h6) {
  padding-bottom: 0.7rem;
  border-bottom: 1px solid var(--classic-line);
  color: var(--classic-muted);
  font-family: var(--classic-mono);
  font-size: 0.78rem;
}

.niceeval-report__author .niceeval-classic-source .niceeval-report__paragraph,
.niceeval-report__author .niceeval-classic-diff .niceeval-report__paragraph {
  max-width: none;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--classic-line);
  border-radius: var(--classic-radius-small);
  background: var(--classic-panel-code);
  color: var(--classic-text);
  font-family: var(--classic-mono);
  font-size: 0.8rem;
  line-height: 1.62;
  overflow-x: auto;
}

.niceeval-report__author .niceeval-classic-diff > .niceeval-report__stack > .niceeval-report__callout + .niceeval-report__callout {
  border-top: 1px solid var(--classic-line);
}

.niceeval-report__author .niceeval-classic-diff .niceeval-report__callout--positive {
  box-shadow: inset 3px 0 0 var(--classic-good);
}

.niceeval-report__author .niceeval-classic-diff .niceeval-report__callout--warning {
  box-shadow: inset 3px 0 0 var(--classic-warn);
}

.niceeval-report__author .niceeval-classic-diff .niceeval-report__callout--negative {
  box-shadow: inset 3px 0 0 var(--classic-bad);
}

/* Waterfall keeps timing rows visually sequential and numeric. ------------ */
.niceeval-report__author .niceeval-classic-waterfall {
  margin-block: var(--classic-gap);
}

.niceeval-report__author .niceeval-classic-waterfall .niceeval-report__table-section {
  position: relative;
}

.niceeval-report__author .niceeval-classic-waterfall .niceeval-report__table caption {
  font-family: var(--classic-mono);
}

.niceeval-report__author .niceeval-classic-waterfall .niceeval-report__table tbody tr {
  background:
    linear-gradient(90deg, color-mix(in oklch, var(--classic-c0), transparent 88%) 0 2px, transparent 2px),
    var(--classic-panel);
}

.niceeval-report__author .niceeval-classic-waterfall .niceeval-report__table td {
  font-family: var(--classic-mono);
  font-size: 0.84rem;
  font-variant-numeric: tabular-nums;
}

/* Optional author-surface navigation/dialog patterns, never the Host shell. */
.niceeval-report__author .niceeval-classic .niceeval-classic-navigation {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
  padding: 0.45rem;
  border: 1px solid var(--classic-line);
  border-radius: var(--classic-radius);
  background: var(--classic-panel-raised);
}

.niceeval-report__author .niceeval-classic .niceeval-classic-navigation a {
  min-block-size: 2rem;
  padding: 0.45rem 0.7rem;
  border-radius: var(--classic-radius-small);
  color: var(--classic-muted);
  font-size: 0.84rem;
  font-weight: 670;
  text-decoration: none;
}

.niceeval-report__author .niceeval-classic .niceeval-classic-navigation a:hover,
.niceeval-report__author .niceeval-classic .niceeval-classic-navigation a[aria-current="page"] {
  color: var(--classic-text);
  background: var(--classic-panel);
  box-shadow: 0 1px 1px color-mix(in oklch, black, transparent 88%);
}

.niceeval-report__author .niceeval-classic .niceeval-classic-dialog {
  width: min(100% - 1.5rem, 46rem);
  max-height: min(78vh, 56rem);
  margin: auto;
  overflow: auto;
  border: 1px solid var(--classic-line-strong);
  border-radius: calc(var(--classic-radius) * 1.35);
  background: var(--classic-panel);
  box-shadow: 0 1.5rem 5rem color-mix(in oklch, black, transparent 52%);
}

.niceeval-report__author .niceeval-classic .niceeval-classic-dialog > * {
  padding: clamp(1rem, 3vw, 1.75rem);
}

/* Semantic links/downloads inside the author surface. -------------------- */
.niceeval-report__author .niceeval-classic .niceeval-report__download {
  margin: 0;
  padding: 0.85rem 1rem;
  border: 1px solid color-mix(in oklch, var(--classic-accent), var(--classic-line) 58%);
  border-radius: var(--classic-radius);
  background: color-mix(in oklch, var(--classic-accent), var(--classic-panel) 94%);
}

.niceeval-report__author .niceeval-classic .niceeval-report__download > a {
  color: var(--classic-accent);
  font-weight: 720;
}

/* Color system survives where a custom renderer retains legacy classes. */
.niceeval-report__author .niceeval-classic .niceeval-classic-c0 { color: var(--classic-c0); }
.niceeval-report__author .niceeval-classic .niceeval-classic-c1 { color: var(--classic-c1); }
.niceeval-report__author .niceeval-classic .niceeval-classic-c2 { color: var(--classic-c2); }
.niceeval-report__author .niceeval-classic .niceeval-classic-c3 { color: var(--classic-c3); }
.niceeval-report__author .niceeval-classic .niceeval-classic-c4 { color: var(--classic-c4); }
.niceeval-report__author .niceeval-classic .niceeval-classic-c5 { color: var(--classic-c5); }

.niceeval-report__author .niceeval-classic .niceeval-classic-series-c0 { --classic-series: var(--classic-c0); }
.niceeval-report__author .niceeval-classic .niceeval-classic-series-c1 { --classic-series: var(--classic-c1); }
.niceeval-report__author .niceeval-classic .niceeval-classic-series-c2 { --classic-series: var(--classic-c2); }
.niceeval-report__author .niceeval-classic .niceeval-classic-series-c3 { --classic-series: var(--classic-c3); }
.niceeval-report__author .niceeval-classic .niceeval-classic-series-c4 { --classic-series: var(--classic-c4); }
.niceeval-report__author .niceeval-classic .niceeval-classic-series-c5 { --classic-series: var(--classic-c5); }

/* Desktop density --------------------------------------------------------- */
@media (min-width: 58rem) {
  .niceeval-report__author .niceeval-classic-summary .niceeval-report__grid,
  .niceeval-report__author .niceeval-classic-summary .niceeval-classic-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .niceeval-report__author .niceeval-classic-experiment-table .niceeval-report__table,
  .niceeval-report__author .niceeval-classic-attempt-list .niceeval-report__table {
    min-width: 46rem;
  }

  .niceeval-report__author .niceeval-classic-tabs {
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  }
}

@media (min-width: 44.01rem) and (max-width: 57.99rem) {
  .niceeval-report__author .niceeval-classic-summary .niceeval-report__grid,
  .niceeval-report__author .niceeval-classic-summary .niceeval-classic-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

/* Mobile: preserve the information hierarchy; only geometry becomes linear. */
@media (max-width: 44rem) {
  .niceeval-report:has(.niceeval-classic) .niceeval-report__navigation {
    margin-bottom: 1rem;
  }

  .niceeval-report:has(.niceeval-classic) .niceeval-report__navigation ul {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 0.2rem;
  }

  .niceeval-report__author .niceeval-classic {
    --classic-gap: 0.85rem;
  }

  .niceeval-report__author .niceeval-classic-grid,
  .niceeval-report__author .niceeval-classic .niceeval-report__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .niceeval-report__author .niceeval-classic-hero > .niceeval-report__callout {
    padding: 1.55rem 1rem;
  }

  .niceeval-report__author .niceeval-classic-hero :is(h1, h2, h3, h4, h5, h6),
  .niceeval-report:has(.niceeval-classic) .niceeval-report__author > .niceeval-report__stack > .niceeval-report__stack:first-child:not([class*="niceeval-classic"]) > .niceeval-report__paragraph:first-child {
    font-size: clamp(2rem, 12vw, 3.05rem);
  }

  .niceeval-report__author .niceeval-classic-summary .niceeval-report__grid,
  .niceeval-report__author .niceeval-classic-summary .niceeval-classic-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .niceeval-report__author .niceeval-classic .niceeval-classic-chart-bar-row {
    grid-template-columns: minmax(6.2rem, 0.9fr) minmax(4rem, 1fr) minmax(3.7rem, max-content);
    gap: 0.45rem;
  }

  .niceeval-report__author .niceeval-classic .niceeval-classic-chart-bar-label {
    font-size: 0.78rem;
  }

  .niceeval-report__author .niceeval-classic .niceeval-classic-chart-bar-status {
    max-inline-size: 7.5rem;
    font-size: 0.65rem;
  }

  .niceeval-report__author .niceeval-classic-table-head,
  .niceeval-report__author .niceeval-classic-table-row {
    grid-template-columns: minmax(8rem, 1.4fr) repeat(2, minmax(4.5rem, 1fr));
  }

  .niceeval-report__author .niceeval-classic-table-head > :nth-child(n + 4),
  .niceeval-report__author .niceeval-classic-table-row > :nth-child(n + 4) {
    display: none;
  }

  .niceeval-report__author .niceeval-classic .niceeval-report__callout {
    padding: 0.85rem;
  }

  .niceeval-report__author .niceeval-classic-tabs[data-niceeval-classic-tabs-enhanced="true"] > .niceeval-classic-tablist {
    gap: 0.25rem;
    padding: 0.25rem;
  }

  .niceeval-report__author .niceeval-classic-tabs[data-niceeval-classic-tabs-enhanced="true"] > .niceeval-classic-tablist > [role="tab"] {
    flex-basis: min(100%, 10rem);
  }

  .niceeval-report__author .niceeval-classic .niceeval-report__table-wrap {
    overflow-x: visible;
    border: 0;
  }

  .niceeval-report__author .niceeval-classic .niceeval-report__table {
    min-width: 0;
  }

  .niceeval-report__author .niceeval-classic .niceeval-report__table :is(th, td) {
    padding: 0.62rem 0.7rem;
  }

  .niceeval-report__author .niceeval-classic-source .niceeval-report__paragraph,
  .niceeval-report__author .niceeval-classic-diff .niceeval-report__paragraph {
    margin-inline: -0.1rem;
    padding: 0.7rem;
  }
}

/* Static / no-JS must not conceal a panel or use motion to convey meaning. */
@media (prefers-reduced-motion: reduce) {
  .niceeval-report__author .niceeval-classic *,
  .niceeval-report__author .niceeval-classic *::before,
  .niceeval-report__author .niceeval-classic *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;
