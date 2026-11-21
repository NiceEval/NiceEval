import { createHash } from "node:crypto";
import * as Predicate from "effect/Predicate";
import type { JudgeProviderIdentity } from "./provider.ts";

/** One routing key and one compatibility decision for the Attempt's resolved Provider. */
export class JudgePromptCache {
  private readonly key: string;
  private readonly onRejection: () => void;
  private rejected = false;

  constructor(provider: JudgeProviderIdentity, attemptId: string, onRejection: () => void) {
    this.onRejection = onRejection;
    this.key = createHash("sha256")
      .update(JSON.stringify([provider.provider, provider.baseUrl, provider.model, attemptId]))
      .digest("hex");
  }

  get activeKey(): string | undefined {
    return this.rejected ? undefined : this.key;
  }

  observeRejection(sentKey: string | undefined, status: number, body: string): boolean {
    if (sentKey !== this.key || status !== 400 || !rejectsCacheKey(body)) return false;
    if (!this.rejected) {
      this.rejected = true;
      this.onRejection();
    }
    return true;
  }
}

function rejectsCacheKey(body: string): boolean {
  let message: unknown = body;
  try {
    const value: unknown = JSON.parse(body);
    const error = Predicate.isObject(value) && Predicate.isObject(value.error) ? value.error : value;
    if (Predicate.isObject(error) && error.param === "prompt_cache_key") return true;
    message = Predicate.isObject(error) ? error.message : error;
  } catch {
    // Some OpenAI-compatible endpoints report unsupported parameters as text.
  }
  return (
    typeof message === "string" &&
    /\b(?:unknown|unrecognized|unsupported|unexpected|not supported|not allowed|extra (?:inputs?|fields?))\b[^\n]{0,100}\bprompt_cache_key\b|\bprompt_cache_key\b[^\n]{0,100}\b(?:is not supported|is unsupported|is not allowed|is unrecognized|is unexpected)\b/iu.test(
      message,
    )
  );
}
