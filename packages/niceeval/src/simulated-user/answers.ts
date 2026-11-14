import * as Schema from "effect/Schema";
import type { InputRequest, InputResponse } from "../types.ts";
import { SimulatedUserError } from "./definition.ts";

const Answer = Schema.Union([
  Schema.Struct({ requestId: Schema.String, text: Schema.String }),
  Schema.Struct({ requestId: Schema.String, optionId: Schema.String }),
]);
const Waiting = Schema.Struct({ answers: Schema.Array(Answer) });
const Message = Schema.Struct({ message: Schema.String });

export type SimulatedUserAnswer =
  | { readonly message: string }
  | { readonly responses: readonly InputResponse[]; readonly text: string };

/** Validates all answers before permitting a single structured Session drive. */
export function parseSimulatedUserAnswer(
  value: unknown,
  requests: readonly InputRequest[] | undefined,
): SimulatedUserAnswer {
  try {
    if (requests === undefined) return Schema.decodeUnknownSync(Message, { onExcessProperty: "error" })(value);
    const { answers } = Schema.decodeUnknownSync(Waiting, { onExcessProperty: "error" })(value);
    if (answers.length !== requests.length) throw new Error("answer count");
    const byId = new Map(answers.map((answer) => [answer.requestId, answer]));
    if (byId.size !== answers.length) throw new Error("duplicate requestId");
    const responses = requests.map((request) => {
      if (request.id === undefined) throw new Error("missing requestId");
      const answer = byId.get(request.id);
      if (answer === undefined) throw new Error("unknown or missing requestId");
      if (request.options?.length) {
        if (!("optionId" in answer) || !request.options.some((option) => option.id === answer.optionId))
          throw new Error("invalid optionId");
      } else if (!("text" in answer)) throw new Error("text required");
      return Object.freeze(answer);
    });
    return Object.freeze({
      responses: Object.freeze(responses),
      text: responses.map((answer) => ("text" in answer ? answer.text : answer.optionId)).join("\n"),
    });
  } catch {
    throw new SimulatedUserError("simulated-user-failed", "invalid-answer");
  }
}

/** The sole model tool varies with this Turn's exact pending requests. */
export function simulatedUserToolSchema(requests: readonly InputRequest[] | undefined): Record<string, unknown> {
  if (requests === undefined)
    return {
      type: "object",
      additionalProperties: false,
      required: ["message"],
      properties: { message: { type: "string" } },
    };
  return {
    type: "object",
    additionalProperties: false,
    required: ["answers"],
    properties: {
      answers: {
        type: "array",
        minItems: requests.length,
        maxItems: requests.length,
        items: {
          oneOf: requests.map((request) => ({
            type: "object",
            additionalProperties: false,
            required: ["requestId", request.options?.length ? "optionId" : "text"],
            properties: {
              requestId: { const: request.id },
              ...(request.options?.length
                ? { optionId: { type: "string", enum: request.options.map((option) => option.id) } }
                : { text: { type: "string" } }),
            },
          })),
        },
      },
    },
  };
}
