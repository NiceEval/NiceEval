import { Result, Schema, SchemaIssue } from "effect";
import { AssertionEntryIdSchema, AssertionsExactParseOptions, isAssertionsRawDataGraph } from "./codec.ts";
import type {
  AssertionDisplay,
  AssertionEntryId,
  AssertionEntry,
  AssertionCriterionRecord,
  AssertionMaterials,
  AssertionEvaluation,
  AssertionDecision,
  EvaluatorFailure,
  AssertionDecisionPolicy,
  ScoreContribution,
  ExplanationRetention,
  AssertionsDocument,
} from "./model.ts";

export interface AssertionEntryInput<Content> {
  readonly display: AssertionDisplay;
  readonly criterion: AssertionCriterionRecord;
  readonly materials: AssertionMaterials<Content>;
  readonly evaluation: AssertionEvaluation;
  readonly decision: AssertionDecision;
  readonly evaluatorFailure?: EvaluatorFailure;
  readonly policy: AssertionDecisionPolicy;
  readonly control: import("./model.ts").AssertionControl;
  readonly contribution: ScoreContribution;
  readonly explanationRetention: ExplanationRetention;
}

export interface AssertionsEntryIdSource {
  /** Must return a fresh `ae_[a-z0-9]{20}` candidate for this Attachment. */
  readonly next: () => string;
}

export type AssertionsProducerError =
  | {
      readonly code: "assertion-entry-id-invalid";
      readonly entryId: string;
    }
  | {
      readonly code: "assertion-entry-id-duplicate";
      readonly entryId: string;
    }
  | { readonly code: "assertions-document-sealed" }
  | {
      readonly code: "assertions-document-invalid";
      readonly message: string;
    };

function invalidDocument(message: string): AssertionsProducerError {
  return { code: "assertions-document-invalid" as const, message };
}

function firstSchemaIssue(error: Schema.SchemaError): string | undefined {
  try {
    const issue = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues[0];
    if (issue === undefined) return undefined;
    const path = issue.path === undefined || issue.path.length === 0 ? "document" : issue.path.map(String).join(".");
    const expected = issue.message.split(", actual ", 1)[0] ?? issue.message;
    const message = expected.length <= 512 ? expected : `${expected.slice(0, 511)}…`;
    return `${path}: ${message}`;
  } catch {
    return undefined;
  }
}

export interface AssertionsDocumentBuilder<Content> {
  /** Appends exactly one completed Assertion in declaration/display order. */
  readonly append: (entry: AssertionEntryInput<Content>) => Result.Result<AssertionEntryId, AssertionsProducerError>;
  /**
   * Checks the writer-only exact document schema once and prevents subsequent
   * appends. Repeated calls return the same sealed document without running
   * an evaluator or minting another entry ID.
   */
  readonly seal: () => Result.Result<AssertionsDocument<Content>, AssertionsProducerError>;
}

/**
 * Assertion producers own normalization and ID allocation. This builder owns
 * neither Record paths nor content streams: the later Attachment adapter
 * supplies Record's local builder, so an entry cannot borrow another
 * Attachment's capability.
 */
export function createAssertionsDocumentBuilder<Content, Encoded>(input: {
  readonly documentSchema: Schema.Codec<AssertionsDocument<Content>, Encoded>;
  readonly entryIds: AssertionsEntryIdSource;
}): AssertionsDocumentBuilder<Content> {
  const entryIds = new Set<string>();
  const entries: AssertionEntry<Content>[] = [];
  let sealed: AssertionsDocument<Content> | undefined;

  const builder: AssertionsDocumentBuilder<Content> = {
    append(entry: AssertionEntryInput<Content>): Result.Result<AssertionEntryId, AssertionsProducerError> {
      if (sealed !== undefined) {
        return Result.fail({ code: "assertions-document-sealed" });
      }
      const entryIdText = input.entryIds.next();
      const entryId = Schema.decodeUnknownResult(AssertionEntryIdSchema, AssertionsExactParseOptions)(entryIdText);
      if (Result.isFailure(entryId)) {
        return Result.fail({
          code: "assertion-entry-id-invalid",
          entryId: entryIdText,
        });
      }
      if (entryIds.has(entryId.success)) {
        return Result.fail({
          code: "assertion-entry-id-duplicate",
          entryId: entryIdText,
        });
      }
      entryIds.add(entryId.success);
      entries.push({ entryId: entryId.success, ...entry });
      return Result.succeed(entryId.success);
    },
    seal(): Result.Result<AssertionsDocument<Content>, AssertionsProducerError> {
      if (sealed !== undefined) return Result.succeed(sealed);
      const document: AssertionsDocument<Content> = { entries };
      if (!isAssertionsRawDataGraph(document)) {
        return Result.fail(
          invalidDocument(
            "Assertions could not be saved because an entry contains a cyclic or non-JSON value. " +
              "Upgrade NiceEval and retry; if this persists, report assertions-document-invalid.",
          ),
        );
      }
      const encoded = Schema.encodeUnknownResult(input.documentSchema, AssertionsExactParseOptions)(document);
      if (Result.isFailure(encoded)) {
        const issue = firstSchemaIssue(encoded.failure);
        return Result.fail(
          invalidDocument(
            `Assertions could not be saved${issue === undefined ? "" : ` because ${issue}`}. ` +
              "Upgrade NiceEval and retry; if this persists, report assertions-document-invalid.",
          ),
        );
      }
      sealed = document;
      return Result.succeed(document);
    },
  };
  return builder;
}
