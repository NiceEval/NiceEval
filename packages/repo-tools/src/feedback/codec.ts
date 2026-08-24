import { ParseResult, Schema } from "effect";
import { parse, stringify } from "yaml";
import { FeedbackContentInvalid } from "./errors.js";
import { FeedbackV2Schema, type FeedbackV2 } from "./schema.js";

export interface FeedbackDocument { readonly metadata: FeedbackV2; readonly body: string }

function splitFrontmatter(path: string, source: string): { readonly input: unknown; readonly body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(source);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new FeedbackContentInvalid({ operation: "decode", path, message: "missing YAML frontmatter" });
  }
  try { return { input: parse(match[1]) as unknown, body: match[2] }; }
  catch (cause) {
    throw new FeedbackContentInvalid({ operation: "decode", path, message: cause instanceof Error ? cause.message : String(cause) });
  }
}

export function decodeFeedbackDocument(path: string, source: string): FeedbackDocument {
  const { body, input } = splitFrontmatter(path, source);
  const decoded = Schema.decodeUnknownEither(FeedbackV2Schema, { errors: "all", onExcessProperty: "error" })(input);
  if (decoded._tag === "Left") throw new FeedbackContentInvalid({
    operation: "decode", path, message: ParseResult.TreeFormatter.formatErrorSync(decoded.left),
  });
  return { metadata: decoded.right, body };
}

export function encodeFeedbackDocument(document: FeedbackDocument): string {
  return `---\n${stringify(document.metadata, { lineWidth: 0 }).trimEnd()}\n---\n${document.body}`;
}
