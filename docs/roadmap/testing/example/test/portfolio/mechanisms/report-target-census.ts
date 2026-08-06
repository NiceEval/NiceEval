import { defineMechanismProof } from "../../../e2e/report/support/contracts";

export default defineMechanismProof({
  id: "reports.target-census",
  feature: {
    path: "docs/feature/reports/view.md",
    anchor: "参数化页的-dialog-摆放",
  },
  risk: "producer 新增 pageId 后，旧 exporter 仍只产一部分文档",
  wrongAlgorithms: [
    "从链接反推文档，漏掉没有旧入口的新增 pageId",
    "只枚举 attempt target，把 experiment 与 custom page 当例外",
  ],
  whyPrimaryCannotCatch:
    "浏览器主证明只交互三类代表，不能低成本穷举每个动态 key 与双向孤儿集合",
  matrixOwner: "reports.target-identity-matrix",
  layer: "structure",
});
