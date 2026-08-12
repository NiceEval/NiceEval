import {
  basalt,
  themeStylesheet,
  type ThemeDefinition,
} from "./theme.ts";

export interface RenderReportHtmlInput {
  readonly text: string;
  /** Omission deliberately means the host's closed Basalt default. */
  readonly theme?: ThemeDefinition;
}

/**
 * The sole HTML shell for the fixed text/semantic Report projection. The
 * stylesheet's structure is package-owned; a Theme can only select its
 * validated design-token values through `themeStylesheet`.
 */
export function renderReportHtml(input: RenderReportHtmlInput): string {
  const theme = input.theme ?? basalt;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NiceEval report</title><style>${themeStylesheet(theme)}${REPORT_HTML_STYLESHEET}</style><body><main class="niceeval-report"><pre class="niceeval-report__text">${escapeHtml(input.text)}</pre></main></body></html>`;
}

const REPORT_HTML_STYLESHEET = "html{min-height:100%;background:var(--niceeval-color-page,#050505);}body{min-height:100vh;margin:0;background:var(--niceeval-color-page,#050505);color:var(--niceeval-color-text,#ededed);}.niceeval-report{box-sizing:border-box;min-height:100vh;margin:0 auto;padding:clamp(1rem,4vw,4rem);background:var(--niceeval-color-page,#050505);color:var(--niceeval-color-text,#ededed);font-family:var(--niceeval-font-sans,ui-sans-serif,system-ui,sans-serif);font-size:var(--niceeval-font-size,13px);line-height:1.5;}.niceeval-report__text{box-sizing:border-box;display:block;max-width:96ch;margin:0 auto;padding:clamp(1rem,3vw,2rem);overflow-wrap:anywhere;white-space:pre-wrap;background:var(--niceeval-color-surface,#0b0b0b);color:var(--niceeval-color-text,#ededed);border:1px solid var(--niceeval-color-border,#262626);border-radius:var(--niceeval-radius,0);font:inherit;font-family:var(--niceeval-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);}";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
