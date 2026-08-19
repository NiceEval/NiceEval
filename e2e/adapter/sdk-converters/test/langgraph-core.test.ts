// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#langgraph-core-deterministic

import { test } from "vitest";
import { proveSdkConverterOwner } from "./support.ts";

test("createLangGraphEventStream 接收真实 v3 GraphRunStream 与官方 core Event", async () => {
  await proveSdkConverterOwner({
    experimentId: "langgraph-core",
    evalId: "langgraph-core",
    caseName: "langgraph-core",
    source: {
      file: "evals/langgraph-core.eval.ts",
      content: "export default defineEval({",
    },
    executionMarkers: ["langgraph-runtime-methods:lifecycle", "graph_lookup", "langgraph-core-tool-output"],
  });
});
