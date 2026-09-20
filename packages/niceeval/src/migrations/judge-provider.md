# Use an explicit Judge provider

Migration ID: `judge-provider`

Baseline: NiceEval `0.15.0`

Legacy execution support was removed in: `unreleased`

NiceEval no longer accepts a plain Judge configuration object. The rejected
shape can contain any of these legacy fields:

```ts
{
  model,
  baseUrl,
  apiKeyEnv,
  timeoutMs,
  maxOutputTokens,
}
```

Choose the provider that actually serves the model, construct it explicitly,
and assign that value to `judgeRuntime`. This makes the service, protocol,
endpoint, credential source, and execution limits unambiguous.

## OpenAI and OpenAI-compatible endpoints

```ts
import { defineConfig } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";

export default defineConfig({
  judgeRuntime: OpenAIProvider({
    model: "judge-model",
    // Keep this only for an OpenAI-compatible custom gateway:
    // baseUrl: "https://gateway.example.test/v1",
    // apiKeyEnv: "MY_GATEWAY_API_KEY",
    // timeoutMs: 120_000,
    // maxOutputTokens: 1_024,
  }),
});
```

`OpenAIProvider` reads `OPENAI_API_KEY` by default. A custom `baseUrl` does not
change the default credential variable; set `apiKeyEnv` when the gateway uses a
different variable.

## Vercel AI Gateway

```ts
import { defineConfig } from "niceeval";
import { VercelProvider } from "niceeval/judge";

export default defineConfig({
  judgeRuntime: VercelProvider({ model: "provider/model" }),
});
```

`VercelProvider` reads `AI_GATEWAY_API_KEY` by default.

## OpenRouter

```ts
import { defineConfig } from "niceeval";
import { OpenRouterProvider } from "niceeval/judge";

export default defineConfig({
  judgeRuntime: OpenRouterProvider({ model: "provider/model" }),
});
```

`OpenRouterProvider` reads `OPENROUTER_API_KEY` by default.

## TypeSafe System One

```ts
import { defineConfig } from "niceeval";
import { TypesafeProvider } from "niceeval/judge";

export default defineConfig({
  judgeRuntime: TypesafeProvider({ model: "jev-1.13.0" }),
});
```

`TypesafeProvider` reads `TYPESAFE_API_KEY` by default. It does not accept
`maxOutputTokens`, because the System One protocol has no matching option.

## Replace `NICEEVAL_JUDGE_KEY`

Providers do not fall back to `NICEEVAL_JUDGE_KEY`. Move that secret to the
selected provider's default variable:

- OpenAI: `OPENAI_API_KEY`
- Vercel AI Gateway: `AI_GATEWAY_API_KEY`
- OpenRouter: `OPENROUTER_API_KEY`
- TypeSafe System One: `TYPESAFE_API_KEY`

If an existing deployment must keep its current variable name temporarily,
select it explicitly without copying the secret into source code:

```ts
judgeRuntime: OpenAIProvider({
  model: "judge-model",
  apiKeyEnv: "NICEEVAL_JUDGE_KEY",
})
```

Do not put the key value in this migration guide, committed configuration,
logs, snapshots, or error reports.

## Model overrides

An Eval or Experiment may still select a different model with a string after a
Provider has been selected. Supplying another Provider replaces the service and
all of its defaults, not only the model.

```ts
export default app.defineEval({
  judge: "another-model",
  async test(t) {
    // Existing rubric, material, gate, and score definitions do not change.
  },
});
```

## Verify the migration

1. Confirm that the selected provider's credential variable is present in the
   environment used to run NiceEval. Do not print its value.
2. Re-run the same NiceEval command that reported this migration.
3. Confirm that the migration error is gone and that the selected Judge model
   is the intended service and model.

This migration changes only Judge provider and model configuration. It does not
change rubrics, evaluation material, `.gate()`, `.score()`, or historical
records.
