import { MAX_DIAGNOSTIC_SUMMARY_BYTES } from "../record/family/source-receipt/limits.ts";
import { makeBoundedSafeText, type SafeText } from "../record/family/source-receipt/model.ts";

/** Preserve both ends of safe error text within a UTF-8 byte budget. */
export function boundedErrorText(value: string, maximumBytes: number): string {
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  const total = bytes(value);
  if (total <= maximumBytes) return value;
  const reserve = bytes(` … [${total} bytes omitted] … `);
  const available = Math.max(0, maximumBytes - reserve);
  const characters = Array.from(value);
  const take = (items: readonly string[], budget: number): string[] => {
    const result: string[] = [];
    let used = 0;
    for (const character of items) {
      used += bytes(character);
      if (used > budget) break;
      result.push(character);
    }
    return result;
  };
  const head = take(characters, Math.ceil(available / 2)).join("");
  const tail = take(characters.reverse(), Math.floor(available / 2))
    .reverse()
    .join("");
  return `${head} … [${total - bytes(head) - bytes(tail)} bytes omitted] … ${tail}`;
}

/** Normalize redacted text before it crosses a durable diagnostic boundary. */
export function boundedSafeDiagnosticText(value: string): { readonly text: SafeText; readonly truncated: boolean } {
  const normalized = value
    .replace(/[\ud800-\udfff]/gu, "\ufffd")
    .replace(/\r\n?/gu, "\n")
    .replace(/\t/gu, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "");
  const bounded = boundedErrorText(normalized, MAX_DIAGNOSTIC_SUMMARY_BYTES);
  const text = makeBoundedSafeText(bounded, MAX_DIAGNOSTIC_SUMMARY_BYTES);
  if (text === undefined) throw new Error("Normalized diagnostic text must fit the SafeText budget");
  return { text, truncated: bounded !== normalized };
}
