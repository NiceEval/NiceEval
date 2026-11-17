import { Effect, Schema } from "effect";
import { expect, test } from "vitest";
import { defineRecordAttachment, RecordOwner } from "./index.ts";
import { prepareStreamingRecordAttachment } from "../writer/current-attachment.ts";

// Illegal JavaScript values cannot survive a CLI JSON input boundary. This
// matrix distinguishes canonical admission failures from Schema rejections.
// @feature docs/feature/run/README.md
test.each([NaN, undefined, "\ud800", "unsupported-enum"])(
  "attachment rejection preserves the nested field path for %s",
  async (value) => {
    const definition = defineRecordAttachment({
      owner: RecordOwner.attempt,
      family: "test.encoding-diagnostics",
      schema: Schema.Struct({ segments: Schema.Array(Schema.Struct({ outcome: Schema.Literal("completed") })) }),
    });
    const result = await Effect.runPromise(
      Effect.result(
        prepareStreamingRecordAttachment({
          definition,
          // Deliberately cross the runtime boundary with hostile untyped input.
          value: { segments: [{ outcome: value }] } as never,
        }),
      ),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        code: "record-attachment-encode-error",
        issues: [{ code: "record-attachment-schema-invalid", path: ["value", "segments", "0", "outcome"] }],
        schemaIssues: [{ path: ["segments", expect.toBeOneOf([0, "0"]), "outcome"], message: expect.any(String) }],
      },
    });
  },
);
