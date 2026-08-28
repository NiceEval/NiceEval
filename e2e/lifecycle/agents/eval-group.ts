import { Effect } from "effect";
import { appendFileSync } from "node:fs";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

const evidenceCoverage = {
  ...completeEvidenceCoverage,
  usage: { status: "unavailable", reason: "deterministic fixture has no token usage" } as const,
};

const ensure = {
  identity: { agent: "eval-group-lifecycle-fixture", version: "24.19.0", revision: "1" },
  probe: shell('test "$(node --version)" = "v24.19.0"'),
};

const EXPECTED_GROUPS = new Set(["group-a", "group-b"]);
const HOME_MARKER = ".niceeval-eval-group-owner";
const WORKDIR_MARKER = ".niceeval-eval-group-dirty-workdir";
const firstMemberArrivals = new Set<string>();
let releaseFirstMembers: () => void = () => undefined;
const firstMembersReady = new Promise<void>((resolve) => {
  releaseFirstMembers = resolve;
});

function signalError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Eval Group fixture was aborted");
}

async function waitForOtherGroup(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signalError(signal);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(signalError(signal)));
    const timer = setTimeout(
      () => finish(() => reject(new Error("different Eval Groups did not enter the fixture concurrently"))),
      60_000,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    void firstMembersReady.then(
      () => finish(resolve),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export const evalGroupAgent = defineSandboxAgent({
  name: "lifecycle-eval-group",
  evidenceCoverage,
  ensure,
  send: (_input, ctx) => Effect.tryPromise({
      try: async () => {
    const evalId = ctx.evalId;
    const groupId = ctx.evalGroup?.id;
    if (evalId === undefined || groupId === undefined || !EXPECTED_GROUPS.has(groupId)) {
      throw new Error(`unexpected Eval Group context: ${String(groupId)} / ${String(evalId)}`);
    }
    if (!evalId.startsWith(`${groupId}/`)) {
      throw new Error(`Eval ${JSON.stringify(evalId)} does not belong to Group ${JSON.stringify(groupId)}`);
    }

    const member = evalId.slice(groupId.length + 1);
    const quotedGroup = JSON.stringify(groupId);
    const identity = await ctx.sandbox.runShellOrThrow("cat /etc/hostname", { signal: ctx.signal });
    const sandboxId = identity.stdout.trim();
    appendFileSync(
      "eval-group-lifecycle.ndjson",
      `${JSON.stringify({ groupId, evalId, sandboxId })}\n`,
      "utf8",
    );

    if (member === "01-first") {
      if (firstMemberArrivals.has(groupId)) {
        throw new Error(`first member of ${JSON.stringify(groupId)} ran more than once`);
      }
      firstMemberArrivals.add(groupId);
      await ctx.sandbox.runShellOrThrow(
        [
          "set -eu",
          `group=${quotedGroup}`,
          `printf '%s' "$group" > "$HOME/${HOME_MARKER}"`,
          `printf '%s' dirty > ${WORKDIR_MARKER}`,
        ].join("\n"),
        { signal: ctx.signal },
      );
      if (firstMemberArrivals.size === EXPECTED_GROUPS.size) releaseFirstMembers();
      await waitForOtherGroup(ctx.signal);
      return {
        status: "completed",
        events: [{ type: "message", role: "assistant", text: `${groupId}:first-complete` }],
      };
    }

    if (member === "02-second") {
      await ctx.sandbox.runShellOrThrow(
        [
          "set -eu",
          `group=${quotedGroup}`,
          `test "$(cat "$HOME/${HOME_MARKER}")" = "$group"`,
          `test ! -e ${WORKDIR_MARKER}`,
        ].join("\n"),
        { signal: ctx.signal },
      );
      return {
        status: "completed",
        events: [{ type: "message", role: "assistant", text: `${groupId}:second-complete` }],
      };
    }

    throw new Error(`unexpected Eval Group member: ${JSON.stringify(evalId)}`);

      },
      catch: (cause) => cause,
    }),
});
