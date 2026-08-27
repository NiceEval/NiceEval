// Eval author context. The public names below are aliases for the active
// Assert-first runtime; no Fact producer or collector surface is exported.

import type { AnswerValue } from "../agents/types.ts";
import type {
  BooleanMatch,
  EventMatch,
  ScoreMatch,
  ThresholdedScoreMatch,
} from "../assertions/match.ts";
import type { InputRequest } from "../o11y/types.ts";
import type { JsonMatch } from "../shared/types.ts";
import type {
  AssertFirstSandbox,
  AssertFirstSessionHandle,
  AssertFirstTestContext,
  AssertFirstTurnHandle,
} from "./assert-first.ts";

export type {
  FileChangedOptions,
} from "./assert-first.ts";

export type {
  BooleanMatch,
  EventMatch,
  ScoreMatch,
  ThresholdedScoreMatch,
} from "../assertions/match.ts";

type AssertionContextKind = "pass" | "score";

/** `t.send()` / `session.send()` input. */
export type SendInput = string | {
  readonly text: string;
  readonly files?: readonly import("../agents/types.ts").InputFile[];
};

export interface InputRequestFilter {
  readonly id?: string | RegExp;
  readonly prompt?: string | RegExp;
  readonly display?: string | RegExp;
  readonly action?: string | RegExp;
  readonly input?: JsonMatch;
  readonly optionIds?: readonly string[];
}

export type RespondAnswer = { readonly request: InputRequest } & AnswerValue;

/** A completed Assert-first Agent turn. */
export type TurnHandle<
  Kind extends AssertionContextKind = AssertionContextKind,
> = AssertFirstTurnHandle<Kind>;

/** An Assert-first Agent session. */
export type SessionHandle<
  Kind extends AssertionContextKind = AssertionContextKind,
> = AssertFirstSessionHandle<Kind>;

/** The author-facing Sandbox with Assert-first post-run checks. */
export type EvalSandbox<
  Kind extends AssertionContextKind = AssertionContextKind,
> = AssertFirstSandbox<Kind>;

/** The public Eval Context is the Assert-first runtime handed to Runner. */
export type TestContext = AssertFirstTestContext<"pass">;

/** Score Eval extends the same sealed entry runtime with direct point entries. */
export type ScoreTestContext = AssertFirstTestContext<"score">;
