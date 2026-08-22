import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import "../assets/enhance.js";
import "./reload.ts";
import { createReportRoutes } from "./routes.tsx";
import type { ReportManifest } from "./types.ts";

async function readManifest(appSource: string): Promise<ReportManifest> {
  const response = await fetch(new URL("manifest.json", appSource), {
    credentials: "same-origin",
  });
  if (!response.ok)
    throw new Error(`Could not load Report manifest: HTTP ${response.status}`);
  return (await response.json()) as ReportManifest;
}

const appSource =
  document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : document.baseURI;
void readManifest(appSource).then((manifest) => {
  const router = createHashRouter(createReportRoutes(manifest));
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  createRoot(root).render(<RouterProvider router={router} />);
});
