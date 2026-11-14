import { randomUUID } from "node:crypto";
import type { TurnHandle } from "../context/types.ts";
import type { InputRequest } from "../types.ts";
import { defineSimulatedUser, SimulatedUserError, type SimulatedUser, type SimulatedUserDefinition } from "./definition.ts";
import { parseSimulatedUserAnswer, type SimulatedUserAnswer } from "./answers.ts";
import type { SimulatedUserActivity, SimulatedUserGeneration } from "./audit.ts";

/** The Session owner supplies authentic Turn identity and atomic send/respond. */
export interface SimulatedUserSession<Kind extends "pass" | "score"> {
  assertCurrent(turn: TurnHandle<Kind>): { readonly sessionId: string; readonly turnId: string };
  acquire(): () => void;
  drive(answer: SimulatedUserAnswer): Promise<TurnHandle<Kind>>;
}

/** The pi owner retains conversation history, but never drives an Agent Session. */
export interface SimulatedUserConversation {
  generate(input: {
    readonly question: string;
    readonly requests: readonly InputRequest[] | undefined;
    readonly signal: AbortSignal;
    readonly deadlineAt: number;
    readonly generations: SimulatedUserGeneration[];
    readonly submit: (candidate: unknown) => void;
  }): Promise<void>;
  close(): Promise<void>;
  snapshot(): Promise<string>;
}

export function bindSimulatedUser<Kind extends "pass" | "score">(
  raw: SimulatedUserDefinition,
  session: SimulatedUserSession<Kind>,
  deps: {
    readonly signal: AbortSignal;
    readonly assertOpen: () => void;
    readonly now: () => number;
    readonly deadlineAt?: number;
    readonly createConversation: (definition: SimulatedUserDefinition) => SimulatedUserConversation;
    readonly latchFailure: (error: SimulatedUserError) => void;
    readonly capture: (activity: SimulatedUserActivity) => Promise<void>;
    readonly onClose: (close: () => Promise<void>) => void;
  },
): SimulatedUser<Kind> {
  const definition = defineSimulatedUser(raw);
  let conversation: SimulatedUserConversation | undefined;
  let closed = false;
  deps.onClose(async () => { closed = true; await conversation?.close(); });
  return Object.freeze({ async reply(turn: TurnHandle<Kind>): Promise<TurnHandle<Kind>> {
    try { deps.assertOpen(); } catch { throw new SimulatedUserError("simulated-user-invalid-turn", "closed"); }
    if (closed || deps.signal.aborted) throw new SimulatedUserError("simulated-user-invalid-turn", "closed");
    const source = session.assertCurrent(turn);
    if (turn.status === "waiting" && turn.inputRequests.length === 0) throw new SimulatedUserError("simulated-user-invalid-turn", "waiting-without-requests");
    const release = session.acquire();
    const startOffsetMs = deps.now();
    const deadlineAt = Math.min(Date.now() + (definition.timeoutMs ?? 120_000), deps.deadlineAt ?? Infinity);
    const controller = new AbortController();
    const signal = AbortSignal.any([deps.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(new SimulatedUserError("simulated-user-failed", "timeout")), Math.max(1, deadlineAt - Date.now()));
    const requests = turn.status === "waiting" ? turn.inputRequests : undefined;
    const question = JSON.stringify({ reply: turn.reply, ...(requests === undefined ? {} : { inputRequests: requests }) });
    const generations: SimulatedUserGeneration[] = [];
    let answer: SimulatedUserAnswer | undefined;
    let failure: SimulatedUserActivity["failure"] = null;
    let targetTurnId: string | null = null;
    try {
      try {
        conversation ??= deps.createConversation(definition);
        await conversation.generate({ question, requests, signal, deadlineAt, generations, submit(candidate) {
          if (answer !== undefined || signal.aborted || closed) throw new SimulatedUserError("simulated-user-invalid-turn", "closed");
          answer = parseSimulatedUserAnswer(candidate, requests);
        } });
        if (deps.signal.aborted) deps.signal.throwIfAborted();
        if (signal.aborted) throw new SimulatedUserError("simulated-user-failed", "timeout");
        if (answer === undefined) throw new SimulatedUserError("simulated-user-failed", "no-answer");
      } catch (cause) {
        if (deps.signal.aborted) throw cause;
        const error = signal.aborted ? new SimulatedUserError("simulated-user-failed", "timeout")
          : cause instanceof SimulatedUserError ? cause : new SimulatedUserError("simulated-user-failed", "transport");
        failure = { code: error.code, reason: error.reason };
        deps.latchFailure(error);
        throw error;
      }
      // A concurrent author drive may have changed pending requests while pi ran.
      // The generation budget ends here; the Agent keeps its normal send deadline.
      clearTimeout(timer);
      session.assertCurrent(turn);
      deps.assertOpen();
      const next = await session.drive(answer);
      targetTurnId = session.assertCurrent(next).turnId;
      return next;
    } catch (cause) {
      if (cause instanceof SimulatedUserError) {
        failure ??= { code: cause.code, reason: cause.reason };
        if (cause.code !== "simulated-user-invalid-turn") deps.latchFailure(cause);
      }
      throw cause;
    } finally {
      clearTimeout(timer);
      controller.abort();
      try { await deps.capture({ protocol: "niceeval.simulated-user/v1", id: `su_${randomUUID()}`, sessionId: source.sessionId,
        sourceTurnId: source.turnId, targetTurnId, question, conversation: await conversation?.snapshot() ?? "[]", answer: answer === undefined ? null : JSON.stringify(answer),
        startOffsetMs, durationMs: Math.max(0, deps.now() - startOffsetMs), failure, generations }); }
      catch (cause) {
        if (deps.signal.aborted) throw cause;
        const error = new SimulatedUserError("simulated-user-failed", "storage");
        deps.latchFailure(error);
        throw error;
      }
      finally { release(); }
    }
  } });
}
