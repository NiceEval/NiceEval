# OpenAI Chat Completions / Responses live compatibility

Repo `adapter/openai-compat` owns live compatibility for both OpenAI
converters. It covers `turnFromChatCompletion()` and `turnFromResponses()`.

These are response converters, not complete NiceEval Agent factories.

The repository locks `openai@6.49.0` and requires `OPENAI_API_KEY` plus
`OPENAI_BASE_URL`. It runs only in `main`, `nightly`, and `release` lanes.

## Chat Completion live

The Experiment creates the official OpenAI client with `maxRetries: 0`. It
also sets an explicit 90-second timeout.

It forces one named function through `tool_choice`. The transport counter must
observe exactly one request.

The complete official `ChatCompletion` return value enters the converter
unchanged. The Eval checks the native tool name and call input marker.

It also checks non-empty protocol usage. The test reads the same result back
through history and `show --execution`.

## Responses live

The Responses Experiment has the same one-request and no-retry limits. It
forces one named function with the official Responses `tool_choice` shape.

The complete `Response` enters `turnFromResponses()` directly.

The Eval checks the native function name, exact marker input, and usage. The
test proves the persisted result through public history and execution output.

## Cost and reliability boundary

One authorized repository run makes two paid requests. One uses Chat
Completions and one uses Responses.

This live Repo is not part of deterministic takeover repetition. Provider or
gateway errors are failures, not passes or skips.

Run it only after explicit cost authorization:

```sh
pnpm e2e --lane main --repo adapter/openai-compat
```
