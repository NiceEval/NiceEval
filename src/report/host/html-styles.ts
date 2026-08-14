/** Package-owned styles for the generic report document and live shell. */
export const REPORT_HTML_STYLESHEET = `
html {
  min-height: 100%;
  max-width: 100%;
  background: var(--niceeval-color-page, #050505);
}

body {
  min-height: 100vh;
  max-width: 100%;
  margin: 0;
  background: var(--niceeval-color-page, #050505);
  color: var(--niceeval-color-text, #ededed);
}

.niceeval-report,
.niceeval-report * {
  box-sizing: border-box;
}

.niceeval-report {
  min-height: 100vh;
  min-width: 0;
  max-width: 100%;
  padding: clamp(2rem, 6vw, 6rem) clamp(1rem, 5vw, 5rem);
  background: var(--niceeval-color-page, #050505);
  color: var(--niceeval-color-text, #ededed);
  font-family: var(--niceeval-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: var(--niceeval-font-size, 13px);
  line-height: 1.6;
}

.niceeval-report__document,
.niceeval-report__text {
  display: block;
  width: min(100%, 72rem);
  margin: 0 auto;
  overflow-wrap: anywhere;
}

.niceeval-report__text {
  max-width: 96ch;
  padding-block: 1rem;
  white-space: pre-wrap;
  font-family: var(--niceeval-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.niceeval-report__document-header {
  max-width: 72ch;
  padding: 0 0 clamp(2.5rem, 6vw, 5rem);
}

.niceeval-report h1,
.niceeval-report h2,
.niceeval-report h3,
.niceeval-report h4,
.niceeval-report h5,
.niceeval-report h6 {
  margin: 0;
  color: var(--niceeval-color-text, #ededed);
  font-weight: 600;
  line-height: 1.1;
}

.niceeval-report h1 {
  max-width: 18ch;
  font-size: clamp(2rem, 5vw, 3.5rem);
  letter-spacing: -0.02em;
}

.niceeval-report h2 {
  max-width: 30ch;
  font-size: clamp(1.5rem, 3vw, 2rem);
}

.niceeval-report h3 {
  font-size: 1.25rem;
}

.niceeval-report h4,
.niceeval-report h5,
.niceeval-report h6 {
  font-size: 1rem;
}

.niceeval-report__section {
  margin-top: clamp(3.5rem, 8vw, 6.5rem);
}

.niceeval-report__section .niceeval-report__section {
  margin-top: clamp(2rem, 5vw, 3.5rem);
}

.niceeval-report__section > :is(h1, h2, h3, h4, h5, h6) + * {
  margin-top: 1.25rem;
}

.niceeval-report__paragraph,
.niceeval-report__list {
  max-width: 68ch;
}

.niceeval-report__paragraph {
  margin: 1rem 0;
}

.niceeval-report__list {
  margin: 1rem 0;
  padding-inline-start: 1.5rem;
}

.niceeval-report__list > li + li {
  margin-top: 0.6rem;
}

.niceeval-report__list > li > *:first-child {
  margin-top: 0;
}

.niceeval-report a {
  color: var(--niceeval-color-accent, #cbd6dc);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
}

.niceeval-report a:focus-visible {
  outline: 2px solid var(--niceeval-color-focus, #cbd6dc);
  outline-offset: 3px;
}

.niceeval-report__inline-code,
.niceeval-report__code-block {
  font-family: var(--niceeval-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.niceeval-report__inline-code {
  padding: 0.1em 0.3em;
  background: var(--niceeval-color-surface-subtle, #111111);
  border-radius: var(--niceeval-radius, 0);
}

.niceeval-report__code-block {
  margin: 1.5rem 0 2.5rem;
  padding: clamp(1rem, 3vw, 1.5rem);
  overflow: auto;
  background: var(--niceeval-color-surface-subtle, #111111);
  border: 1px solid var(--niceeval-color-border, #262626);
  border-radius: var(--niceeval-radius, 0);
}

.niceeval-report__code-block code {
  font: inherit;
}

.niceeval-report__table-wrap {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 1.5rem 0 2.75rem;
  overflow-x: auto;
}

.niceeval-report__table {
  width: 100%;
  min-width: 36rem;
  border-collapse: collapse;
  border-top: 1px solid var(--niceeval-color-border-strong, #343434);
}

.niceeval-report__table caption {
  padding-bottom: 0.75rem;
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font-weight: 600;
  text-align: left;
}

.niceeval-report__table th,
.niceeval-report__table td {
  padding: 0.8rem 0.75rem;
  border-bottom: 1px solid var(--niceeval-color-border, #262626);
  vertical-align: top;
}

.niceeval-report__table th {
  color: var(--niceeval-color-text, #ededed);
  font-weight: 600;
  vertical-align: bottom;
}

.niceeval-report__table tbody th {
  text-align: start;
  vertical-align: top;
}

.niceeval-report__hierarchy-table {
  min-width: 52rem;
  border-top: 1px solid var(--niceeval-color-border-strong, #343434);
}

.niceeval-report__hierarchy-row {
  display: grid;
  grid-template-columns: var(--niceeval-hierarchy-template);
  align-items: start;
  border-bottom: 1px solid var(--niceeval-color-border, #262626);
}

.niceeval-report__hierarchy-header {
  color: var(--niceeval-color-text, #ededed);
  font-weight: 600;
}

.niceeval-report__hierarchy-row > [role="columnheader"],
.niceeval-report__hierarchy-cell {
  min-width: 0;
  padding: 0.8rem 0.75rem;
  overflow-wrap: anywhere;
}

.niceeval-report__hierarchy-row > :not(:first-child) {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__hierarchy-node > summary {
  cursor: pointer;
  list-style-position: inside;
}

.niceeval-report__hierarchy-node > summary::marker {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
}

.niceeval-report__hierarchy-node > summary > .niceeval-report__hierarchy-row {
  display: inline-grid;
  width: calc(100% - 1.5rem);
  vertical-align: top;
}

.niceeval-report__hierarchy-children {
  margin-left: clamp(0.75rem, 2.5vw, 2rem);
  border-left: 1px solid var(--niceeval-color-border, #262626);
}

.niceeval-report__align-start {
  text-align: start;
}

.niceeval-report__align-end {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__metric {
  display: inline-grid;
  width: min(100%, 16rem);
  margin: 0 clamp(2rem, 4vw, 4rem) 2rem 0;
  vertical-align: top;
}

.niceeval-report__metric > div {
  display: grid;
  gap: 0.35rem;
}

.niceeval-report__metric dt {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
}

.niceeval-report__metric dd {
  margin: 0;
  color: var(--niceeval-color-text, #ededed);
  font-size: clamp(1.6rem, 3vw, 2.25rem);
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__metric-unit {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font-size: 0.55em;
  font-weight: 400;
}

.niceeval-report__status {
  max-width: 72ch;
  margin: 1.25rem 0;
  padding: 0.25rem 0 0.25rem 1rem;
  border-left: 2px solid var(--niceeval-color-border-strong, #343434);
}

.niceeval-report__status--positive {
  border-left-color: var(--niceeval-color-positive, #3ddc97);
}

.niceeval-report__status--warning {
  border-left-color: var(--niceeval-color-warning, #e8b84a);
}

.niceeval-report__status--negative {
  border-left-color: var(--niceeval-color-negative, #ff6b6b);
}

.niceeval-report__status-detail {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
}

.niceeval-report__chart {
  margin: 2.5rem 0 3.5rem;
}

.niceeval-report__chart figcaption {
  max-width: 68ch;
  font-size: 1.1rem;
  font-weight: 600;
}

.niceeval-report__chart-category {
  display: block;
  margin-top: 0.3rem;
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font-size: 0.85em;
  font-weight: 400;
}

.niceeval-report__document--classic-dashboard > :not(.niceeval-report__document-header) {
  margin-top: clamp(2rem, 5vw, 4rem);
}

.niceeval-report__hero {
  max-width: 72ch;
  padding: clamp(1.25rem, 3vw, 2rem);
  border: 1px solid var(--niceeval-color-border-strong, #343434);
  background: var(--niceeval-color-surface-subtle, #111111);
}

.niceeval-report__hero-logo {
  display: block;
  width: 3rem;
  height: 3rem;
  margin-bottom: 1rem;
  object-fit: contain;
}

.niceeval-report__hero-title {
  margin: 0 0 0.75rem;
  font-size: clamp(1.35rem, 3vw, 2rem);
  font-weight: 650;
}

.niceeval-report__hero > p {
  margin: 0;
  font-size: clamp(1.05rem, 2vw, 1.35rem);
}

.niceeval-report__hero-links ul,
.niceeval-report__scatter-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

.niceeval-report__summary {
  max-width: 72rem;
  padding: clamp(1rem, 3vw, 1.5rem);
  border: 1px solid var(--niceeval-color-border, #262626);
  background: var(--niceeval-color-surface-subtle, #111111);
}

.niceeval-report__summary > h2 {
  margin-bottom: 1.25rem;
}

.niceeval-report__summary > dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1rem;
  margin: 0;
}

.niceeval-report__summary-metric {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
}

.niceeval-report__summary-metric dt,
.niceeval-report__bar-coverage,
.niceeval-report__coverage {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
}

.niceeval-report__summary-metric dd {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__ranked-bars,
.niceeval-report__scatter {
  margin: 2.5rem 0 3.5rem;
}

.niceeval-report__ranked-bars figcaption,
.niceeval-report__scatter figcaption {
  display: grid;
  gap: 0.3rem;
  max-width: 68ch;
  font-size: 1.1rem;
  font-weight: 600;
}

.niceeval-report__ranked-bars figcaption > span,
.niceeval-report__scatter figcaption > span {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font-size: 0.85em;
  font-weight: 400;
}

.niceeval-report__ranked-bars > ol {
  display: grid;
  gap: 1rem;
  max-width: 72rem;
  margin: 1.25rem 0 0;
  padding: 0;
  list-style: none;
}

.niceeval-report__bar {
  display: grid;
  grid-template-columns: minmax(10rem, 18rem) minmax(8rem, 1fr) auto;
  align-items: center;
  gap: 0.75rem 1rem;
}

.niceeval-report__bar-label {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.niceeval-report__bar-label span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.niceeval-report__bar-label strong {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font-size: 0.9em;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__bar-track {
  height: 0.75rem;
  overflow: hidden;
  border: 1px solid var(--niceeval-color-border-strong, #343434);
  background: var(--niceeval-color-page, #050505);
}

.niceeval-report__bar-fill {
  display: block;
  height: 100%;
  min-width: 0;
  background: var(--niceeval-color-accent, #cbd6dc);
}

.niceeval-report__bar--missing .niceeval-report__bar-track {
  background: repeating-linear-gradient(
    135deg,
    var(--niceeval-color-page, #050505),
    var(--niceeval-color-page, #050505) 0.35rem,
    var(--niceeval-color-surface-subtle, #111111) 0.35rem,
    var(--niceeval-color-surface-subtle, #111111) 0.7rem
  );
}

.niceeval-report__bar-coverage,
.niceeval-report__coverage {
  font-size: 0.82em;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__dashboard-data {
  margin-top: 1.5rem;
}

.niceeval-report__scatter svg {
  display: block;
  width: min(100%, 72rem);
  height: auto;
  margin-top: 1.25rem;
  overflow: visible;
  border: 1px solid var(--niceeval-color-border, #262626);
  background: var(--niceeval-color-surface-subtle, #111111);
}

.niceeval-report__scatter-axis {
  stroke: var(--niceeval-color-border-strong, #343434);
  stroke-width: 1;
}

.niceeval-report__scatter-grid {
  stroke: var(--niceeval-color-border, #262626);
  stroke-width: 1;
}

.niceeval-report__scatter-tick {
  fill: var(--niceeval-color-text-secondary, #a1a1aa);
  font-family: var(--niceeval-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 11px;
}

.niceeval-report__scatter-axis-label {
  fill: var(--niceeval-color-text-secondary, #a1a1aa);
  font-family: var(--niceeval-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 14px;
}

.niceeval-report__scatter-better {
  fill: var(--niceeval-color-text-tertiary, #74747b);
  font-family: var(--niceeval-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 12px;
}

.niceeval-report__scatter-line {
  fill: none;
  stroke: var(--niceeval-color-accent, #cbd6dc);
  stroke-width: 2;
  opacity: 0.55;
}

.niceeval-report__scatter-point {
  fill: var(--niceeval-color-accent, #cbd6dc);
  stroke: var(--niceeval-color-page, #050505);
  stroke-width: 1.5;
}

.niceeval-report__scatter-line--1,
.niceeval-report__scatter-point--1,
.niceeval-report__scatter-key--1 {
  stroke: var(--niceeval-color-positive, #3ddc97);
  fill: var(--niceeval-color-positive, #3ddc97);
}

.niceeval-report__scatter-line--2,
.niceeval-report__scatter-point--2,
.niceeval-report__scatter-key--2 {
  stroke: var(--niceeval-color-warning, #e8b84a);
  fill: var(--niceeval-color-warning, #e8b84a);
}

.niceeval-report__scatter-line--3,
.niceeval-report__scatter-point--3,
.niceeval-report__scatter-key--3 {
  stroke: var(--niceeval-color-negative, #ff6b6b);
  fill: var(--niceeval-color-negative, #ff6b6b);
}

.niceeval-report__scatter-line--4,
.niceeval-report__scatter-point--4,
.niceeval-report__scatter-key--4 {
  stroke: var(--niceeval-color-series-1, #3987e5);
  fill: var(--niceeval-color-series-1, #3987e5);
}

.niceeval-report__scatter-line--5,
.niceeval-report__scatter-point--5,
.niceeval-report__scatter-key--5 {
  stroke: var(--niceeval-color-series-2, #199e70);
  fill: var(--niceeval-color-series-2, #199e70);
}

.niceeval-report__scatter-point-label {
  fill: var(--niceeval-color-text, #ededed);
  font-size: 11px;
}

.niceeval-report__scatter-key {
  display: inline-block;
  width: 0.7rem;
  height: 0.7rem;
  margin-right: 0.35rem;
  background: var(--niceeval-color-accent, #cbd6dc);
}

.niceeval-report__tree-label {
  padding-inline-start: calc(0.75rem + var(--niceeval-tree-depth, 0) * 1.25rem) !important;
}

.niceeval-report__tree-table tbody tr[data-kind="attempt"] .niceeval-report__tree-label {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
}

@media (max-width: 44rem) {
  .niceeval-report {
    padding: 2rem 1rem 4rem;
  }

  .niceeval-report__document-header {
    padding-bottom: 3rem;
  }

  .niceeval-report__metric {
    width: 100%;
    margin-right: 0;
    padding-bottom: 1.25rem;
    border-bottom: 1px solid var(--niceeval-color-border, #262626);
  }

  .niceeval-report__table {
    min-width: 32rem;
  }

  .niceeval-report__bar {
    grid-template-columns: 1fr auto;
  }

  .niceeval-report__bar-track {
    grid-column: 1 / -1;
  }
}
`;

export const REPORT_LIVE_STYLESHEET = `
.niceeval-report__tabs {
  display: flex;
  width: min(100%, 72rem);
  margin: 0 auto 2.5rem;
  gap: 0.25rem;
  overflow-x: auto;
  border-bottom: 1px solid var(--niceeval-color-border, #262626);
}

.niceeval-report__tabs [role="tab"] {
  flex: 0 0 auto;
  padding: 0.7rem 1rem;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font: inherit;
  cursor: pointer;
}

.niceeval-report__tabs [role="tab"][aria-selected="true"] {
  border-bottom-color: var(--niceeval-color-accent, #cbd6dc);
  color: var(--niceeval-color-text, #ededed);
}

.niceeval-report__dialog {
  width: min(92vw, 72rem);
  max-height: 88vh;
  padding: clamp(1rem, 3vw, 2.5rem);
  overflow: auto;
  border: 1px solid var(--niceeval-color-border-strong, #343434);
  background: var(--niceeval-color-page, #050505);
  color: var(--niceeval-color-text, #ededed);
}

.niceeval-report__dialog::backdrop {
  background: rgb(0 0 0 / 72%);
}

.niceeval-report__dialog [data-niceeval-dialog-close] {
  position: sticky;
  bottom: 0;
  margin-top: 1.5rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--niceeval-color-border-strong, #343434);
  background: var(--niceeval-color-page-raised, #111);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
`;

/** Classic-dashboard chrome, layout, and mechanical enhancement styles. */
export const REPORT_CLASSIC_STYLESHEET = `
html,
body {
  overflow-x: clip;
}

.niceeval-report--classic {
  --page: var(--niceeval-color-page, #050505);
  --panel: var(--niceeval-color-surface, #0b0b0b);
  --panel-2: var(--niceeval-color-surface-subtle, #111111);
  --line: var(--niceeval-color-border, #262626);
  --line-strong: var(--niceeval-color-border-strong, #343434);
  --text: var(--niceeval-color-text, #ededed);
  --muted: var(--niceeval-color-text-secondary, #a1a1aa);
  --soft: var(--niceeval-color-text-tertiary, #74747b);
  --accent: var(--niceeval-color-accent, #cbd6dc);
  --focus: var(--niceeval-color-focus, #cbd6dc);
  --good: var(--niceeval-color-positive, #3ddc97);
  --bad: var(--niceeval-color-negative, #ff6b6b);
  --warn: var(--niceeval-color-warning, #e8b84a);
  --c0: var(--niceeval-color-series-1, #3987e5);
  --c1: var(--niceeval-color-series-2, #199e70);
  --c2: var(--niceeval-color-series-3, #c98500);
  --c3: var(--niceeval-color-series-4, #008300);
  --c4: var(--niceeval-color-series-5, #e66767);
  --c5: var(--niceeval-color-series-6, #d95926);
  --series: var(--muted);
  min-height: 100vh;
  padding: 0;
  overflow-x: clip;
}

.niceeval-report--classic .niceeval-report__banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.75rem;
  min-height: 64px;
  padding: 0 clamp(1.25rem, 5vw, 5rem);
  border-bottom: 1px solid var(--line);
  background: var(--page);
  position: sticky;
  top: 0;
  z-index: 10;
}

.niceeval-report--classic .niceeval-report__brand {
  display: flex;
  align-items: baseline;
  flex: 0 0 auto;
  gap: 0.75rem;
  color: var(--text);
  font-size: 20px;
  font-weight: 690;
  text-decoration: none;
}

.niceeval-report--classic .niceeval-report__brand-mark {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 1.25px solid var(--text);
  transform: rotate(45deg);
}

.niceeval-report--classic .niceeval-report__tabs {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  margin: 0;
  justify-content: center;
  border-bottom: 0;
}

.niceeval-report--classic .niceeval-report__language {
  display: inline-flex;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--niceeval-radius, 0);
  background: var(--panel);
}

.niceeval-report--classic .niceeval-report__language button {
  height: 30px;
  min-width: 44px;
  padding: 0 0.7rem;
  border: 0;
  border-right: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.niceeval-report--classic .niceeval-report__language button:last-child {
  border-right: 0;
}

.niceeval-report--classic .niceeval-report__language button[aria-pressed="true"] {
  background: var(--panel-2);
  color: var(--text);
  font-weight: 620;
}

.niceeval-report--classic > main {
  width: min(70rem, calc(100% - 2.5rem));
  max-width: 100%;
  min-width: 0;
  margin: 0 auto;
  padding: clamp(2.6rem, 7vw, 5.1rem) 0 4.5rem;
}

.niceeval-report--classic .niceeval-report__document {
  width: 100%;
}

.niceeval-report--classic .niceeval-report__document-header {
  max-width: none;
  padding-bottom: 1.5rem;
}

.niceeval-report--classic .niceeval-report__document-header h1 {
  max-width: none;
}

.niceeval-report--classic .niceeval-report__document--classic-dashboard > :not(.niceeval-report__document-header) {
  margin-top: 1.75rem;
}

.niceeval-report--classic .niceeval-report__hero {
  max-width: none;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: center;
}

.niceeval-report--classic .niceeval-report__hero-logo {
  width: clamp(4rem, 8vw, 5rem);
  height: clamp(4rem, 8vw, 5rem);
  margin: 0 auto 1.35rem;
}

.niceeval-report--classic .niceeval-report__hero-title {
  max-width: none;
  margin: 0;
  font-size: clamp(2.35rem, 5vw, 3.75rem);
  font-weight: 760;
  letter-spacing: -0.01em;
  line-height: 0.98;
}

.niceeval-report--classic .niceeval-report__hero > p {
  max-width: 45rem;
  margin: 1.1rem auto 0;
  color: var(--muted);
  font-size: clamp(0.95rem, 1.7vw, 1.05rem);
  line-height: 1.65;
}

.niceeval-report--classic .niceeval-report__hero-links ul {
  justify-content: center;
}

.niceeval-report--classic .niceeval-report__hero-links {
  margin-top: 1.35rem;
}

.niceeval-report--classic .niceeval-report__hero-links a {
  display: inline-flex;
  align-items: center;
  min-height: 2.5rem;
  padding: 0 1rem;
  border: 1px solid color-mix(in oklch, var(--accent), var(--line) 55%);
  background: color-mix(in oklch, var(--accent), transparent 90%);
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 650;
  text-decoration: none;
}

.niceeval-report--classic .niceeval-report__hero-meta {
  margin: 0.9rem 0 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.niceeval-report--classic .niceeval-report__powered {
  margin: 0.65rem 0 0;
  font-size: 0.75rem;
}

.niceeval-report--classic .niceeval-report__powered a {
  color: var(--soft);
  text-decoration: none;
}

.niceeval-report--classic .niceeval-report__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--panel);
}

.niceeval-report--classic .niceeval-report__grid:has(> :nth-child(6):last-child) {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.niceeval-report--classic .niceeval-report__stat {
  min-width: 0;
  margin: 0;
  padding: 0.85rem 1rem;
  box-shadow: 1px 0 0 var(--line), 0 1px 0 var(--line);
}

.niceeval-report--classic .niceeval-report__stat dt {
  color: var(--soft);
  font-size: 0.75rem;
  font-weight: 560;
}

.niceeval-report--classic .niceeval-report__stat dd {
  margin: 0.25rem 0 0;
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  white-space: pre-line;
}

.niceeval-report--classic .niceeval-report__stat-good {
  color: var(--good);
}

.niceeval-report--classic .niceeval-report__stat-bad {
  color: var(--bad);
}

.niceeval-report--classic .niceeval-report__section {
  margin-top: 2rem;
}

.niceeval-report--classic .niceeval-report__section > :is(h1, h2, h3) {
  max-width: none;
  margin-bottom: 0.75rem;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.niceeval-report--classic .niceeval-report__ranked-bars,
.niceeval-report--classic .niceeval-report__scatter {
  margin: 0;
  padding: 0.9rem 1rem 0.6rem;
  border: 1px solid var(--line);
  background: var(--panel);
}

.niceeval-report--classic .niceeval-report__ranked-bars > ol {
  grid-template-columns: max-content minmax(5rem, 1fr) max-content;
  gap: 0.45rem 0.65rem;
}

.niceeval-report--classic .niceeval-report__bar {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
}

.niceeval-report--classic .niceeval-report__bar-track {
  height: 1.5rem;
  border: 0;
  background: var(--panel-2);
}

.niceeval-report--classic .niceeval-report__bar-fill {
  min-width: 2px;
  background-color: color-mix(in srgb, var(--series, var(--accent)) 74%, var(--panel));
}

.niceeval-report--classic .niceeval-report__bar-fill--v2 {
  background-color: transparent;
  background-image: repeating-linear-gradient(
    -45deg,
    color-mix(in srgb, var(--series, var(--accent)) 78%, var(--panel)),
    color-mix(in srgb, var(--series, var(--accent)) 78%, var(--panel)) 2px,
    color-mix(in srgb, var(--series, var(--accent)) 28%, var(--panel)) 2px,
    color-mix(in srgb, var(--series, var(--accent)) 28%, var(--panel)) 5px
  );
}

.niceeval-report--classic .niceeval-report__bar-fill--v3 {
  background-color: transparent;
  background-image: repeating-linear-gradient(
    0deg,
    color-mix(in srgb, var(--series, var(--accent)) 78%, var(--panel)),
    color-mix(in srgb, var(--series, var(--accent)) 78%, var(--panel)) 2px,
    color-mix(in srgb, var(--series, var(--accent)) 28%, var(--panel)) 2px,
    color-mix(in srgb, var(--series, var(--accent)) 28%, var(--panel)) 5px
  );
}

.niceeval-report--classic .niceeval-report__bar-fill--v4 {
  background-color: color-mix(in srgb, var(--series, var(--accent)) 28%, var(--panel));
  background-image: radial-gradient(
    circle at 25% 25%,
    color-mix(in srgb, var(--series, var(--accent)) 88%, var(--panel)) 1.2px,
    transparent 1.3px
  );
  background-size: 6px 6px;
}

.niceeval-report--classic .niceeval-report__series-0 { --series: var(--c0); }
.niceeval-report--classic .niceeval-report__series-1 { --series: var(--c1); }
.niceeval-report--classic .niceeval-report__series-2 { --series: var(--c2); }
.niceeval-report--classic .niceeval-report__series-3 { --series: var(--c3); }
.niceeval-report--classic .niceeval-report__series-4 { --series: var(--c4); }
.niceeval-report--classic .niceeval-report__series-5 { --series: var(--c5); }

.niceeval-report--classic .niceeval-report__bar-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.9rem;
  margin: 0.65rem 0 0;
  padding: 0;
  color: var(--soft);
  font-size: 0.72rem;
  list-style: none;
}

.niceeval-report--classic .niceeval-report__bar-key {
  display: inline-block;
  width: 0.7rem;
  height: 0.7rem;
  margin-right: 0.3rem;
  background-color: color-mix(in srgb, var(--series, var(--accent)) 74%, var(--panel));
  vertical-align: -0.05rem;
}

.niceeval-report--classic .niceeval-report__scatter svg {
  width: 100%;
  margin-top: 0.5rem;
  overflow: hidden;
  border: 0;
  background: transparent;
}

.niceeval-report--classic .niceeval-report__hierarchy {
  min-width: 0;
  max-width: 100%;
}

.niceeval-report--classic .niceeval-report__hierarchy-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
}

.niceeval-report--classic .niceeval-report__hierarchy-toolbar input {
  width: min(100%, 17.5rem);
  height: 2.1rem;
  min-width: 0;
  padding: 0 0.7rem;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
  font: inherit;
}

.niceeval-report--classic .niceeval-report__hierarchy-toolbar button {
  height: 2.1rem;
  padding: 0 0.75rem;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.niceeval-report--classic .niceeval-report__hierarchy-scroll {
  display: block;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.niceeval-report--classic .niceeval-report__visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 40rem) {
  .niceeval-report--classic .niceeval-report__banner {
    padding: 0 1.25rem;
    gap: 0.75rem;
  }

  .niceeval-report--classic > main {
    width: min(100% - 1.75rem, 70rem);
    padding-top: 2.6rem;
  }

  .niceeval-report--classic .niceeval-report__grid:has(> :nth-child(6):last-child) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .niceeval-report--classic .niceeval-report__ranked-bars > ol {
    grid-template-columns: minmax(5ch, max-content) minmax(3rem, 1fr) max-content;
  }

  .niceeval-report--classic .niceeval-report__bar-track {
    grid-column: auto;
    height: 1.25rem;
  }
}
`;
