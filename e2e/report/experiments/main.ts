import { defineExperiment } from "niceeval";
import { aiSdkAgent } from "niceeval/adapter";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { resolveModel } from "../src/model.ts";
import { stockTools } from "../src/tools.ts";

const agent = aiSdkAgent<ModelMessage>({
  name: "results-mechanism",
  generate: ({ messages, model, signal }) =>
    generateText({
      model: resolveModel(model ?? "gpt-5.6-luna"),
      messages,
      tools: stockTools(),
      stopWhen: stepCountIs(3),
      abortSignal: signal,
    }),
});

// The only Experiment in this repo that calls the real gateway. `attempts: 2` with
// `earlyExit: false` guarantees two real attempts of tool-call even though it's expected
// to pass every time — the point is exercising sources.json dedup across attempts that
// share the same eval file (docs/engineering/testing/e2e/report.md point 1), which a single
// attempt (with `earlyExit: false`) would never produce.
export default defineExperiment({
  description: "main:真实 Chat Completions 网关工具调用往返,跑两次验证 sources.json 跨 attempt 去重",
  agent,
  model: "gpt-5.6-luna",
  evals: ["tool-call"],
  attempts: 2,
  earlyExit: false,
});
