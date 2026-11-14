import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const MODELS_DEV_URL = "https://models.dev/api.json";
const PRICE_KEYS = ["gpt-5.6-luna"];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "src/o11y/prices.json");
const check = process.argv.includes("--check");

function perMillion(value, field, model) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`LiteLLM ${model}.${field} must be a non-negative number`);
  }
  return Number((value * 1_000_000).toPrecision(15));
}

function niceEvalPrice(model, source) {
  return {
    in: perMillion(source.input_cost_per_token, "input_cost_per_token", model),
    out: perMillion(source.output_cost_per_token, "output_cost_per_token", model),
    cacheRead: perMillion(source.cache_read_input_token_cost, "cache_read_input_token_cost", model),
    cacheWrite: perMillion(source.cache_creation_input_token_cost, "cache_creation_input_token_cost", model),
  };
}

const response = await fetch(LITELLM_PRICES_URL);
if (!response.ok) throw new Error(`Unable to fetch LiteLLM prices: HTTP ${response.status}`);
const upstream = await response.json();
const catalog = JSON.parse(await readFile(OUTPUT, "utf8"));

for (const model of PRICE_KEYS) {
  const source = upstream[model];
  if (source?.litellm_provider !== "openai") {
    throw new Error(`LiteLLM is missing the canonical OpenAI price entry ${model}`);
  }
  catalog.prices[model] = niceEvalPrice(model, source);
}

// Keep context metadata beside prices, with the same model key lookup rules.
// models.dev is primary; the explicit LiteLLM price overlays also own their
// context limits. Other LiteLLM entries only fill missing model keys.
const contextWindows = {};
const contextLimit = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
for (const [model, source] of Object.entries(upstream)) {
  const limit = contextLimit(source?.max_input_tokens);
  if (limit !== undefined) contextWindows[model] = limit;
}
const modelsResponse = await fetch(MODELS_DEV_URL);
if (!modelsResponse.ok) throw new Error(`Unable to fetch models.dev metadata: HTTP ${modelsResponse.status}`);
const modelProviders = await modelsResponse.json();
for (const [provider, source] of Object.entries(modelProviders)) {
  for (const [model, entry] of Object.entries(source.models ?? {})) {
    const limit = contextLimit(entry.limit?.context);
    if (limit !== undefined) {
      contextWindows[model] = limit;
      contextWindows[`${provider}/${model}`] = limit;
    }
  }
}
for (const model of PRICE_KEYS) {
  const limit = contextLimit(upstream[model]?.max_input_tokens);
  if (limit !== undefined) contextWindows[model] = limit;
}
catalog.contextWindows = Object.fromEntries(
  Object.entries(contextWindows).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
);
catalog.$contextSources = { modelsDev: MODELS_DEV_URL, LiteLLM: LITELLM_PRICES_URL };
catalog.$note =
  "per-1M-token USD prices; vendored snapshot from models.dev with explicit LiteLLM price overlays. contextWindows: positive safe-integer token limits from models.dev limit.context, falling back to LiteLLM max_input_tokens (never max_tokens); explicit LiteLLM price overlays also take precedence for context limits.";

catalog.$priceOverlays = {
  LiteLLM: {
    source: LITELLM_PRICES_URL,
    license: "MIT",
    models: PRICE_KEYS,
    unit: "source USD/token converted to USD/1M tokens",
  },
};

const generated = `${JSON.stringify(catalog, null, 2)}\n`;
const current = await readFile(OUTPUT, "utf8");
if (check && generated !== current) {
  throw new Error("Vendored prices are stale; run `pnpm --filter niceeval sync:prices`");
}
if (!check) await writeFile(OUTPUT, generated);
