/**
 * Closed declarations for the package's optional classic visual enhancement.
 * A Host decides whether and how these package-owned files enter a static
 * export; authors cannot supply arbitrary style, script, or network URLs.
 */
export { classicStylesheet } from "../assets/classic.ts";

export interface ClassicAssetManifest {
  readonly stylesheet: "report/react/styles.css";
  readonly enhancement: "report/react/enhance.js";
}

export const classicAssetManifest: ClassicAssetManifest = Object.freeze({
  stylesheet: "report/react/styles.css",
  enhancement: "report/react/enhance.js",
});
