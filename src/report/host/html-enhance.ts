/**
 * Package-owned progressive enhancement for live tabs/dialog and classic
 * chrome (language + hierarchy filter). It never recomputes business data.
 *
 * Live language clicks request the current URL with:
 *   x-niceeval-report-fragment: <revision>
 *   x-niceeval-report-locale: en | zh-CN
 * The URL does not change. Host JSON contract (one body, two consumers):
 *
 *   {
 *     revision: number,                 // must match the live shell
 *     locale: "en" | "zh-CN",
 *     title: string,                    // requested route, localized
 *     html: string,                     // requested route document HTML
 *     navigation: {                     // every fixed page, declaration order
 *       title: string,
 *       html: string,
 *       route?: string
 *     }[]
 *   }
 *
 * Language apply writes navigation into tab labels/panels by index. If
 * [data-niceeval-direct-page] is visible (family / exact-route live page),
 * it also replaces that section with html and sets document.title from
 * title. It must not leave the direct section on the previous locale.
 * Dialog apply reads only title + html; navigation is ignored.
 *
 * Before a locale swap the runtime records the selected tab route, whether
 * the direct section is showing, open hierarchy `data-niceeval-row-key`
 * values, and filter values; after swap it restores by those identities,
 * never by localized labels. A visible [data-niceeval-direct-page] is
 * replaced from payload.html (or the navigation entry for the current
 * route) without changing the URL.
 */

export const REPORT_FRAGMENT_HEADER = "x-niceeval-report-fragment";
export const REPORT_LOCALE_HEADER = "x-niceeval-report-locale";

export const REPORT_ENHANCE_SCRIPT = `
(() => {
  const fragmentHeader = "x-niceeval-report-fragment";
  const localeHeader = "x-niceeval-report-locale";
  const hostCopy = {
    en: { noMatch: "No matching experiments", close: "Close", language: "Language", reportPages: "Report pages" },
    "zh-CN": { noMatch: "没有匹配的实验", close: "关闭", language: "语言", reportPages: "报告页面" },
  };
  const revisionMeta = document.querySelector('meta[name="niceeval-report-revision"]');
  const revision = revisionMeta ? Number(revisionMeta.getAttribute("content")) : -1;
  const root = document.documentElement;
  let locale = root.getAttribute("lang") === "zh-CN" ? "zh-CN" : "en";
  let trigger = null;

  const copyFor = (next) => hostCopy[next] || hostCopy.en;

  const applyHostChrome = (next) => {
    const text = copyFor(next);
    const closeBtn = document.querySelector("[data-niceeval-dialog-close]");
    if (closeBtn) closeBtn.textContent = text.close;
    const language = document.querySelector("[data-niceeval-copy=language]");
    if (language) language.setAttribute("aria-label", text.language);
    const pages = document.querySelector("[data-niceeval-copy=reportPages]");
    if (pages) pages.setAttribute("aria-label", text.reportPages);
  };

  const tablist = () => document.querySelector('[role="tablist"]');
  const tabs = () => Array.from(document.querySelectorAll('[role="tab"][data-niceeval-tab]'));
  const panels = () => Array.from(document.querySelectorAll('[role="tabpanel"][data-niceeval-panel]'));
  const directPage = () => document.querySelector('[data-niceeval-direct-page]');
  const dialog = document.querySelector('dialog.niceeval-report__dialog');
  const content = dialog && dialog.querySelector('[data-niceeval-dialog-content]');
  const close = dialog && dialog.querySelector('[data-niceeval-dialog-close]');

  const activate = (tab, focus) => {
    const index = tab.getAttribute("data-niceeval-tab");
    for (const candidate of tabs()) {
      const selected = candidate === tab;
      candidate.setAttribute("aria-selected", String(selected));
      candidate.setAttribute("tabindex", selected ? "0" : "-1");
    }
    for (const panel of panels()) panel.hidden = panel.getAttribute("data-niceeval-panel") !== index;
    const direct = directPage();
    if (direct) direct.hidden = true;
    if (focus) tab.focus();
  };

  const bindTabs = () => {
    tabs().forEach((tab, index) => {
      tab.addEventListener("click", () => activate(tab, false));
      tab.addEventListener("keydown", (event) => {
        const items = tabs();
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % items.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = items.length - 1;
        else return;
        event.preventDefault();
        activate(items[next], true);
      });
    });
  };

  const bindDisclosures = (scope) => {
    for (const details of scope.querySelectorAll("details.niceeval-report__hierarchy-node")) {
      const summary = details.querySelector(":scope > summary");
      if (!summary) continue;
      const sync = () => summary.setAttribute("aria-expanded", String(details.open));
      sync();
      details.addEventListener("toggle", sync);
    }
  };

  const ownText = (item) => {
    if (item.tagName === "DETAILS") {
      const summary = item.querySelector(":scope > summary");
      return (summary ? summary.innerText : "").toLowerCase();
    }
    return (item.innerText || "").toLowerCase();
  };

  const syncDisclosure = (details) => {
    const summary = details.querySelector(":scope > summary");
    if (summary) summary.setAttribute("aria-expanded", String(details.open));
  };

  const applyFilterToRegion = (region) => {
    const input = region.querySelector("[data-niceeval-filter]");
    const status = region.querySelector("[data-niceeval-filter-status]");
    if (!input || !status) return;
    const query = String(input.value || "").trim().toLowerCase();
    const items = Array.from(region.querySelectorAll("[data-niceeval-hierarchy-item]"));
    if (query.length === 0) {
      for (const item of items) item.hidden = false;
      status.hidden = true;
      status.textContent = "";
      return;
    }
    const matched = new Set();
    for (const item of items) {
      if (ownText(item).includes(query)) matched.add(item);
    }
    for (const item of [...matched]) {
      let parent = item.parentElement;
      while (parent && parent !== region) {
        if (parent.hasAttribute("data-niceeval-hierarchy-item")) matched.add(parent);
        if (parent.tagName === "DETAILS") parent.open = true;
        parent = parent.parentElement;
      }
      for (const child of item.querySelectorAll("[data-niceeval-hierarchy-item]")) matched.add(child);
    }
    for (const item of items) item.hidden = !matched.has(item);
    const any = matched.size > 0;
    status.hidden = any;
    status.textContent = any ? "" : copyFor(locale).noMatch;
  };

  const bindFilters = (scope) => {
    for (const region of scope.querySelectorAll("[data-niceeval-hierarchy]")) {
      if (region.dataset.niceevalFilterBound === "1") continue;
      region.dataset.niceevalFilterBound = "1";
      const input = region.querySelector("[data-niceeval-filter]");
      const clear = region.querySelector("[data-niceeval-filter-clear]");
      if (!input || !clear) continue;
      input.addEventListener("input", () => applyFilterToRegion(region));
      clear.addEventListener("click", () => {
        input.value = "";
        applyFilterToRegion(region);
        input.focus();
      });
    }
  };

  const itemKey = (el) =>
    el.getAttribute("data-niceeval-row-key") || el.getAttribute("data-niceeval-hierarchy-key") || "";

  const captureHierarchy = (scope) => {
    if (!scope) return { openKeys: [], openRoutes: [], filters: [] };
    const openKeys = [];
    const openRoutes = [];
    for (const details of scope.querySelectorAll("details.niceeval-report__hierarchy-node[open]")) {
      const key = itemKey(details);
      if (key) openKeys.push(key);
      const route = details.getAttribute("data-niceeval-hierarchy-route");
      if (route) openRoutes.push(route);
    }
    const filters = Array.from(scope.querySelectorAll("[data-niceeval-filter]")).map((input) => String(input.value || ""));
    return { openKeys, openRoutes, filters };
  };

  const restoreHierarchy = (scope, snapshot) => {
    if (!scope || !snapshot) return;
    const keys = new Set(snapshot.openKeys || []);
    const routes = new Set(snapshot.openRoutes || []);
    for (const details of scope.querySelectorAll("details.niceeval-report__hierarchy-node")) {
      const key = itemKey(details);
      const route = details.getAttribute("data-niceeval-hierarchy-route");
      if ((key && keys.has(key)) || (route && routes.has(route))) details.open = true;
      syncDisclosure(details);
    }
    const inputs = Array.from(scope.querySelectorAll("[data-niceeval-filter]"));
    (snapshot.filters || []).forEach((value, index) => {
      if (inputs[index]) inputs[index].value = value;
    });
    for (const region of scope.querySelectorAll("[data-niceeval-hierarchy]")) applyFilterToRegion(region);
  };

  const captureLiveContext = () => {
    const selected = tabs().find((tab) => tab.getAttribute("aria-selected") === "true");
    const direct = directPage();
    return {
      selectedRoute: selected ? selected.getAttribute("data-niceeval-route") : null,
      directVisible: Boolean(direct && !direct.hidden),
      panels: panels().map(captureHierarchy),
      direct: captureHierarchy(direct),
    };
  };

  const restoreLiveContext = (snapshot) => {
    if (!snapshot) return;
    const direct = directPage();
    if (snapshot.directVisible && direct) {
      for (const tab of tabs()) {
        tab.setAttribute("aria-selected", "false");
        tab.setAttribute("tabindex", "-1");
      }
      for (const panel of panels()) panel.hidden = true;
      direct.hidden = false;
      restoreHierarchy(direct, snapshot.direct);
      panels().forEach((panel, index) => restoreHierarchy(panel, snapshot.panels[index]));
      return;
    }
    const nextTab = tabs().find((tab) => tab.getAttribute("data-niceeval-route") === snapshot.selectedRoute) || tabs()[0];
    if (nextTab) activate(nextTab, false);
    panels().forEach((panel, index) => restoreHierarchy(panel, snapshot.panels[index]));
    if (direct) restoreHierarchy(direct, snapshot.direct);
  };

  const parseEmbeddedLocale = (nextLocale) => {
    const script = document.querySelector('script[type="application/json"][data-niceeval-locale-payload="' + nextLocale + '"]');
    if (!script || !script.textContent) return null;
    try {
      return JSON.parse(script.textContent);
    } catch {
      return null;
    }
  };

  const parseEmbeddedDocument = (nextLocale) => {
    const template = document.querySelector('template[data-niceeval-locale-document="' + nextLocale + '"]');
    if (!template) return null;
    return template.innerHTML;
  };

  const htmlForCurrentRoute = (payload) => {
    if (typeof payload.html === "string" && payload.html.length > 0) return payload.html;
    const path = location.pathname;
    const staticPath = path.endsWith("/") ? path + "index.html" : path;
    const items = Array.isArray(payload.navigation) ? payload.navigation : [];
    for (const item of items) {
      if (typeof item.html !== "string" || item.html.length === 0) continue;
      const route = typeof item.route === "string" ? item.route : "";
      if (route === path || route === staticPath) {
        return item.html;
      }
    }
    return "";
  };

  const applyNavigation = (payload) => {
    if (!payload || !Array.isArray(payload.navigation)) return false;
    const direct = directPage();
    const directVisible = Boolean(direct && !direct.hidden);
    const currentHtml = htmlForCurrentRoute(payload);
    if (directVisible && currentHtml.length === 0) return false;
    const snapshot = captureLiveContext();
    payload.navigation.forEach((item, index) => {
      const tab = document.querySelector('[data-niceeval-tab="' + index + '"]');
      const panel = document.querySelector('[data-niceeval-panel="' + index + '"]');
      if (tab && typeof item.title === "string") tab.textContent = item.title;
      if (panel && typeof item.html === "string") panel.innerHTML = item.html;
    });
    if (directVisible && direct) {
      direct.innerHTML = currentHtml;
      direct.hidden = false;
    }
    if (typeof payload.title === "string" && payload.title.length > 0) document.title = payload.title;
    if (payload.locale === "en" || payload.locale === "zh-CN") {
      locale = payload.locale;
      root.setAttribute("lang", locale);
      applyHostChrome(locale);
    }
    bindDisclosures(document);
    bindFilters(document);
    restoreLiveContext(snapshot);
    return true;
  };

  const applyStaticDocument = (html) => {
    const article = document.querySelector("main .niceeval-report__document");
    if (!article || typeof html !== "string") return false;
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const next = wrap.querySelector(".niceeval-report__document");
    if (!next) return false;
    const snapshot = captureHierarchy(article);
    article.replaceWith(next);
    bindDisclosures(document);
    bindFilters(document);
    restoreHierarchy(next, snapshot);
    return true;
  };

  const fetchLocale = async (nextLocale) => {
    if (revision < 0 || location.protocol === "file:") return null;
    try {
      const headers = {
        accept: "application/json",
        [fragmentHeader]: String(revision),
        [localeHeader]: nextLocale,
      };
      const response = await fetch(location.href, { headers });
      if (response.status === 409) {
        window.location.reload();
        return null;
      }
      if (!response.ok) return null;
      const payload = await response.json();
      if (payload.revision !== revision) {
        window.location.reload();
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  };

  const commitLocale = (nextLocale) => {
    locale = nextLocale;
    root.setAttribute("lang", nextLocale);
    setPressed(nextLocale);
    applyHostChrome(nextLocale);
  };

  const switchLocale = async (nextLocale) => {
    if (nextLocale === locale) {
      setPressed(nextLocale);
      return;
    }
    const embedded = parseEmbeddedLocale(nextLocale);
    if (embedded && applyNavigation(embedded)) {
      commitLocale(nextLocale);
      return;
    }
    const staticHtml = parseEmbeddedDocument(nextLocale);
    if (staticHtml && applyStaticDocument(staticHtml)) {
      commitLocale(nextLocale);
      return;
    }
    const payload = await fetchLocale(nextLocale);
    if (payload && applyNavigation(payload)) commitLocale(nextLocale);
  };

  const setPressed = (nextLocale) => {
    for (const button of document.querySelectorAll("[data-niceeval-locale]")) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-niceeval-locale") === nextLocale));
    }
  };

  bindTabs();
  bindDisclosures(document);
  bindFilters(document);

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-niceeval-locale]") : null;
    if (!button) return;
    const next = button.getAttribute("data-niceeval-locale");
    if (next === "en" || next === "zh-CN") {
      event.preventDefault();
      void switchLocale(next);
    }
  });

  if (dialog && close) {
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      const previous = trigger;
      trigger = null;
      if (previous && previous.isConnected) previous.focus();
    });
  }

  document.addEventListener("click", async (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const element = event.target instanceof Element ? event.target.closest("a[data-niceeval-report-route]") : null;
    const href = element && element.getAttribute("href");
    if (!element || !href || element.getAttribute("target") === "_blank" || !dialog || !content || !close) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const fixedTab = tabs().find((tab) => tab.getAttribute("data-niceeval-route") === url.pathname);
    event.preventDefault();
    if (fixedTab) {
      activate(fixedTab, true);
      return;
    }
    try {
      const response = await fetch(url.href, {
        headers: {
          accept: "application/json",
          [fragmentHeader]: String(revision),
          [localeHeader]: locale,
        },
      });
      if (response.status === 409) {
        window.location.reload();
        return;
      }
      if (!response.ok) {
        window.location.assign(url.href);
        return;
      }
      const payload = await response.json();
      if (payload.revision !== revision || typeof payload.title !== "string" || typeof payload.html !== "string") {
        window.location.reload();
        return;
      }
      content.innerHTML = payload.html;
      dialog.setAttribute("aria-label", payload.title);
      trigger = element;
      dialog.showModal();
      close.focus();
    } catch {
      window.location.assign(url.href);
    }
  });
})();
`;
