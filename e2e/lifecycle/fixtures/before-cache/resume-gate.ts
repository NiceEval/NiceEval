export type BeforeCacheResumeLayer = 1 | 2 | 3;

const mode = process.env.NICEEVAL_E2E_BEFORE_CACHE_MODE ?? "default";
const configuredLayer = process.env.NICEEVAL_E2E_BEFORE_CACHE_CANCEL_AFTER;

export const beforeCacheResumeLayer: BeforeCacheResumeLayer | undefined = (() => {
  if (mode !== "layer-resume") return undefined;
  if (configuredLayer !== "1" && configuredLayer !== "2" && configuredLayer !== "3") {
    throw new Error("NICEEVAL_E2E_BEFORE_CACHE_CANCEL_AFTER must be 1, 2, or 3 in layer-resume mode");
  }
  return Number(configuredLayer) as BeforeCacheResumeLayer;
})();

/**
 * A cross-process E2E barrier, not a production authoring pattern. The test
 * observes and releases the FIFO through Docker's public exec boundary. Unlike
 * a timed sleep, reaching the marker proves the preceding prefix was already
 * restored into the next layer's container.
 */
export function beforeCacheResumeGate(afterLayer: BeforeCacheResumeLayer): readonly string[] {
  if (beforeCacheResumeLayer !== afterLayer) return [];
  const gate = `.before-cache/resume-after-${afterLayer}`;
  return [
    `mkdir -p ${gate}`,
    `rm -f ${gate}/entered ${gate}/release.fifo`,
    `mkfifo ${gate}/release.fifo`,
    `touch ${gate}/entered`,
    `IFS= read -r _ < ${gate}/release.fifo`,
    `rm -f ${gate}/entered ${gate}/release.fifo`,
  ];
}
