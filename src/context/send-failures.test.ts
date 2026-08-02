// cases: docs/engineering/testing/unit/eval.md

import { describe, expect, it, vi } from "vitest";
import { ExperimentFatalError } from "../shared/failure-class.ts";
import { normalizeExternalCause } from "../shared/external-cause.ts";
import {
  classifySendFailure,
  makeSendFailure,
  normalizeSendFailure,
  resolveSendFailureClass,
  sendAcceptanceFromEvents,
  sendFailureText,
} from "./send-failures.ts";

describe("SendFailure envelope", () => {
  it("constructs a structural envelope and validates acceptance/message", () => {
    expect(makeSendFailure({ acceptance: "unknown", message: "lost terminal frame" })).toEqual({
      type: "agent-send-failed",
      acceptance: "unknown",
      message: "lost terminal frame",
    });
    expect(() => makeSendFailure({ acceptance: "unknown", message: "  " })).toThrow(/non-empty/);
    expect(() => makeSendFailure({ acceptance: "invalid" as never, message: "x" })).toThrow(/acceptance/);
  });

  it("uses one bounded, control-safe text for diagnostics and classification", () => {
    const text = `\u001b[31mboom\u001b[0m\u0000${"x".repeat(5000)}`;
    const rendered = sendFailureText(makeSendFailure({ acceptance: "unknown", message: text }));
    expect(rendered).not.toMatch(/\u001b|\u0000/);
    expect(rendered.length).toBe(4096);
    expect(rendered.endsWith("…")).toBe(true);
  });

  it("normalizes generic throws conservatively into a typed cause snapshot", () => {
    const cause = new Error("fetch failed", { cause: Object.assign(new Error("dns"), { code: "ENOTFOUND" }) });
    expect(normalizeSendFailure(cause)).toMatchObject({
      type: "agent-send-failed",
      acceptance: "unknown",
      message: "fetch failed · dns",
      cause: {
        _tag: "Error",
        message: "fetch failed",
        cause: { _tag: "Cause", value: { message: "dns" } },
      },
    });
  });
});

describe("send failure classification chain", () => {
  it("fallback only recognizes structured 429/network facts, never natural language", () => {
    expect(classifySendFailure(makeSendFailure({
      acceptance: "rejected",
      message: "busy",
      cause: normalizeExternalCause({ statusCode: 429 }),
    }))).toEqual({ retryable: true, reason: "rate_limit" });
    expect(classifySendFailure(makeSendFailure({
      acceptance: "rejected",
      message: "connect failed",
      cause: normalizeExternalCause({ cause: { code: "ECONNREFUSED" } }),
    }))).toEqual({ retryable: true, reason: "network" });
    expect(classifySendFailure(makeSendFailure({ acceptance: "rejected", message: "429 retry later" })))
      .toEqual({ retryable: false });
    expect(classifySendFailure(makeSendFailure({
      acceptance: "rejected",
      message: "nonzero",
      process: { exitCode: 75 },
    }))).toEqual({ retryable: false });
  });

  it("resolves declared, experiment, adapter, fallback in order and swallows classifier errors", () => {
    const adapter = vi.fn(() => ({ retryable: true as const, reason: "adapter" }));
    const experiment = vi.fn(() => ({ retryable: false as const, scope: "eval" as const, reason: "experiment" }));
    const declared = new ExperimentFatalError("tunnel dead");
    const failure = makeSendFailure({
      acceptance: "rejected",
      message: "outer",
      cause: normalizeExternalCause(declared),
    });
    expect(resolveSendFailureClass(failure, { experiment, adapter })).toEqual({ retryable: false, scope: "experiment" });
    expect(experiment).not.toHaveBeenCalled();
    expect(adapter).not.toHaveBeenCalled();

    const ordinary = makeSendFailure({ acceptance: "rejected", message: "x" });
    expect(resolveSendFailureClass(ordinary, { experiment, adapter })).toEqual({
      retryable: false,
      scope: "eval",
      reason: "experiment",
    });
    expect(adapter).not.toHaveBeenCalled();

    expect(resolveSendFailureClass(ordinary, {
      experiment: () => { throw new Error("classifier bug"); },
      adapter,
    })).toEqual({ retryable: true, reason: "adapter" });
  });

  it.each(["started", "unknown"] as const)("acceptance=%s vetoes retry but preserves reason/scope", (acceptance) => {
    const failure = makeSendFailure({ acceptance, message: "x" });
    expect(resolveSendFailureClass(failure, {
      adapter: () => ({ retryable: true, reason: "protocol_busy", scope: "experiment" }),
    })).toEqual({ retryable: false, reason: "protocol_busy", scope: "experiment" });
  });

  it("agent output vetoes retry even when an external adapter mislabeled acceptance as rejected", () => {
    const failure = makeSendFailure({
      acceptance: "rejected",
      message: "stream ended",
      events: [{ type: "message", role: "assistant", text: "partial answer" }],
    });
    expect(resolveSendFailureClass(failure, {
      adapter: () => ({ retryable: true, reason: "adapter_claim" }),
    })).toEqual({ retryable: false, reason: "adapter_claim" });
  });
});

describe("sendAcceptanceFromEvents", () => {
  it("requires agent output and does not treat empty/error-only events as rejection evidence", () => {
    expect(sendAcceptanceFromEvents([])).toBe("unknown");
    expect(sendAcceptanceFromEvents([{ type: "error", message: "failed" }])).toBe("unknown");
    expect(sendAcceptanceFromEvents([{ type: "message", role: "assistant", text: "started" }])).toBe("started");
  });
});
