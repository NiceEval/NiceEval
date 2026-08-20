/**
 * Host-owned behavior shared byte-for-byte by live view and static export.
 * Missing refresh endpoints and locked-down storage are normal static-site
 * conditions, so every boundary fails quietly without altering report data.
 */

export const REPORT_LOCALE_RUNTIME = `(() => {
  "use strict";
  const locales = ["en", "zh-CN"];
  const views = Array.from(document.querySelectorAll("[data-niceeval-locale]"));
  const selectors = Array.from(document.querySelectorAll("[data-niceeval-locale-select]"));
  if (views.length === 0) return;
  const stored = () => {
    try {
      const value = localStorage.getItem("niceeval:view:locale");
      return locales.includes(value) ? value : undefined;
    } catch { return undefined; }
  };
  const preferred = () => {
    const values = typeof navigator === "undefined" ? [] : [navigator.language, ...(navigator.languages || [])];
    return values.some(value => String(value).toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
  };
  const select = (locale, persist) => {
    if (!locales.includes(locale)) return;
    for (const view of views) view.hidden = view.dataset.niceevalLocale !== locale;
    for (const selector of selectors) selector.value = locale;
    document.documentElement.lang = locale;
    const title = document.documentElement.getAttribute("data-niceeval-title-" + locale.toLowerCase());
    if (title !== null) document.title = title;
    if (!persist) return;
    try { localStorage.setItem("niceeval:view:locale", locale); } catch {}
  };
  for (const selector of selectors) {
    selector.addEventListener("change", () => select(selector.value, true));
  }
  for (const experiment of document.querySelectorAll("[data-niceeval-experiment-select]")) {
    experiment.addEventListener("change", () => {
      if (experiment.value) location.href = experiment.value;
    });
  }
  select(stored() || preferred(), false);
})();`;

export const REPORT_RELOAD_RUNTIME = `(() => {
  "use strict";
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  const source = document.currentScript && document.currentScript.src;
  if (!source) return;
  const endpoint = new URL("refresh", source).toString();
  let observed;
  let live;
  const probe = async () => {
    try {
      // The runtime file exists in both view and static output with identical
      // bytes. Only the live Host adds its revision header, so a generic
      // static server stops here without ever requesting a missing endpoint
      // (and therefore without producing a browser 404 console error).
      if (live === undefined) {
        const runtime = await fetch(source, {
          cache: "no-store",
          credentials: "same-origin",
        });
        live = runtime.ok && runtime.headers.has("x-niceeval-report-revision");
      }
      if (!live) return;
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-niceeval-refresh-probe": "1" },
      });
      if (response.status !== 204) return;
      const identity = response.headers.get("x-niceeval-report-content-hash");
      if (response.headers.get("x-niceeval-view-stale") === "1" ||
        (observed !== undefined && identity !== null && identity !== observed)) {
        location.reload();
        return;
      }
      if (identity !== null) observed = identity;
      setTimeout(probe, 1000);
    } catch {
      // Static, offline, and stopped view endpoints quietly disable reload.
    }
  };
  setTimeout(probe, 1000);
})();`;

/** Package enhancer first, then shell locale and optional reload behavior. */
export function reportSiteRuntime(enhancer: string): string {
  return `${enhancer.trimEnd()}\n${REPORT_LOCALE_RUNTIME}\n${REPORT_RELOAD_RUNTIME}\n`;
}
