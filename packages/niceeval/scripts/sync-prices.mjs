import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
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
