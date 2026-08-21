/** Live `view` reload is an app concern; static reports quietly stop here. */
if (location.protocol === "http:" || location.protocol === "https:") {
  const source =
    document.currentScript instanceof HTMLScriptElement
      ? document.currentScript.src
      : undefined;
  if (source !== undefined) {
    const endpoint = new URL("refresh", source).toString();
    let observed: string | null | undefined;
    let live: boolean | undefined;
    const probe = async (): Promise<void> => {
      try {
        if (live === undefined) {
          const response = await fetch(source, {
            cache: "no-store",
            credentials: "same-origin",
          });
          live =
            response.ok && response.headers.has("x-niceeval-report-revision");
        }
        if (!live) return;
        const response = await fetch(endpoint, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "x-niceeval-refresh-probe": "1" },
        });
        if (response.status !== 204) return;
        const identity = response.headers.get("x-niceeval-report-content-hash");
        if (
          response.headers.get("x-niceeval-view-stale") === "1" ||
          (observed !== undefined && identity !== null && identity !== observed)
        ) {
          location.reload();
          return;
        }
        observed = identity;
        window.setTimeout(() => void probe(), 1000);
      } catch {
        // Static, offline, and stopped view endpoints quietly disable reload.
      }
    };
    window.setTimeout(() => void probe(), 1000);
  }
}
