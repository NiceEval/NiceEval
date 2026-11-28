import type { AgentSendContext } from "./types.ts";

export function upstreamFailureIdentifier(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(value) ? value : undefined;
}

export function upstreamHttpFailureStatus(value: unknown): number | undefined {
  const status = typeof value === "string" && /^[45][0-9]{2}$/u.test(value) ? Number(value) : value;
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
}

// @concord-code
// @concord-implements docs/feature/adapters/architecture/agent-contract.md#upstream-failure-diagnostics
export function reportUpstreamFailure(
  ctx: Pick<AgentSendContext, "diagnostic" | "turnId">,
  adapter: string,
  facts: { readonly reason?: unknown; readonly code?: unknown; readonly httpStatus?: unknown },
): void {
  const reason = upstreamFailureIdentifier(facts.reason);
  const code = upstreamFailureIdentifier(facts.code);
  const httpStatus = upstreamHttpFailureStatus(facts.httpStatus);
  if (reason === undefined && code === undefined && httpStatus === undefined) return;
  const detail = [
    reason,
    code === reason ? undefined : code,
    httpStatus === undefined ? undefined : `HTTP ${httpStatus}`,
  ]
    .filter((value) => value !== undefined)
    .join(" · ");
  ctx.diagnostic({
    code: "agent-upstream-failure",
    level: "warning",
    message: `${adapter} upstream failure: ${detail}`,
    data: {
      turnId: ctx.turnId,
      ...(reason === undefined ? {} : { reason }),
      ...(code === undefined ? {} : { upstreamCode: code }),
      ...(httpStatus === undefined ? {} : { httpStatus }),
    },
  });
}
