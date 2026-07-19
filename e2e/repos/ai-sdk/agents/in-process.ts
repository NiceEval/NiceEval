// Entry point 2/3: aiSdkAgent({ generate }) — the in-process loop entry point (stateless
// history + approval resume handled by the factory). This is also the vehicle for this
// repo's OTel proof: `tracing: aiSdkOtel()` wires a per-attempt OTLP receiver and the
// generate() call threads `telemetry` straight into generateText's own `telemetry` option
// (niceeval/adapter/otel is the only supported way to get a waterfall for this entry point).
import { aiSdkAgent } from "niceeval/adapter";
import { aiSdkOtel } from "niceeval/adapter/otel";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { buildTools, SYSTEM_PROMPT } from "../src/backend/tool-defs.ts";
import { DEFAULT_MODEL, resolveModel } from "../src/backend/models.ts";

export default aiSdkAgent<ModelMessage>({
  name: "ai-sdk-in-process",
  tracing: aiSdkOtel(),
  generate: ({ messages, model, signal, telemetry }) =>
    generateText({
      model: resolveModel(model ?? DEFAULT_MODEL),
      system: SYSTEM_PROMPT,
      messages,
      tools: buildTools(),
      stopWhen: stepCountIs(5),
      abortSignal: signal,
      telemetry,
    }),
  data: (result) => ({ reply: result.text }),
});
