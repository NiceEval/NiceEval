import { defineBehavior } from "../support/contracts";

export const reportTargetClosure = defineBehavior({
  id: "reports.target-closure",
  task: {
    repository: "niceeval",
    path: "docs/feature/reports/use-case/交付报告/导出静态站.md",
    anchor: "全流程",
  },
  contract: {
    repository: "niceeval",
    path: "docs/feature/reports/view.md",
    anchor: "参数化页的-dialog-摆放",
  },
  title: "静态站中的每类参数化页都能打开并继续下钻",
  risk: "release-blocking",
  primary: {
    layer: "e2e",
    target: {
      entry: "browser",
      observations: ["html", "browser-a11y"],
      boundaries: ["installed-package", "real-cli", "real-browser"],
      verifier: {
        engine: "playwright-chromium",
        javaScript: "enabled",
        network: "local-only",
      },
    },
    execution: {
      mode: "read-only",
      evidenceRecipeId: "report-targets-v1",
    },
  },
  requiredBoundaryProofs: [],
});
