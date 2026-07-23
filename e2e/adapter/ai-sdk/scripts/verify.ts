// CLI black-box verification (docs/engineering/testing/e2e/verification.md style): spawns
// `niceeval` as a subprocess and asserts on stdout / --json / --junit — never imports
// niceeval library code, never scans `.niceeval/` by hand.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const EXPECTED_EVALS = ["tool-call", "hitl-approval", "session-replay"];

function sh(cmd: string, expect: number | "nonzero" = 0): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(ok, `${cmd}\nexited ${exit}, expected ${expect}. stderr tail:\n${res.stderr.slice(-2000)}`);
  return res.stdout;
}

function latestAttemptLine(evalId: string): string {
  const lines = sh(`pnpm exec niceeval show ${evalId} --history`)
    .split("\n")
    .filter((l) => l.includes("@"));
  assert.ok(lines.length > 0, `show --history has no attempt line for ${evalId} — the experiment never ran this eval`);
  return lines.at(-1)!;
}

function locatorOf(evalId: string): string {
  return latestAttemptLine(evalId).match(/@\S+/)![0];
}

export async function runVerify(): Promise<void> {
  // logged unconditionally so scripts/e2e.ts can classify infra-vs-regression even when the
  // assert below throws. `--json` streams NDJSON events to stdout (`--output` and `--json
  // <path>` file sinks are both gone from the CLI — see docs/feature/experiments/cli.md「机器
  // 怎么读:--json」); `pnpm --silent exec` keeps pnpm's own preamble line out of stdout so the
  // captured log stays valid NDJSON.
  const runCmd = "pnpm --silent exec niceeval exp --force --json --junit junit.xml";
  const res = spawnSync(runCmd, { shell: true, encoding: "utf8" });
  writeFileSync("logs/exp-ci.log", `${res.stdout}\n${res.stderr}`, "utf8");
  assert.equal(
    res.status,
    0,
    `${runCmd}\nexited ${res.status}, expected 0. stderr tail:\n${res.stderr.slice(-2000)}`,
  );

  // 1. `show` board lists the Experiment this repo owns (single experiment: `ci`); its own
  // board (`show --exp ci`) lists every Eval it covers — a dropped Eval must not go
  // unnoticed. Bare `show` groups by experiment rather than flattening every eval id
  // (current CLI), so the id-level check goes one level down via `--exp`.
  const board = sh("pnpm exec niceeval show");
  assert.ok(board.includes("ci"), "show board is missing the ci experiment group — discovery/selection changed");
  const groupBoard = sh("pnpm exec niceeval show --exp ci");
  for (const id of EXPECTED_EVALS) {
    assert.ok(
      groupBoard.includes(id),
      `show --exp ci is missing ${id} — discovery/selection changed; run \`pnpm exec niceeval exp --dry\` to see the plan`,
    );
  }

  // 2. every Eval's latest attempt passed.
  for (const id of EXPECTED_EVALS) {
    const line = latestAttemptLine(id);
    assert.ok(
      line.includes("passed"),
      `${id} latest attempt is not passed: ${line}\nUse the trailing locator with \`niceeval show @<locator>\` for the main failing assertion`,
    );
  }

  // 3. bare tool name + input echoed on the execution tree (call+input fidelity all the
  // way through normalization → display), and the same node carries real OTel span timing
  // — this repo's remote-agent telemetry proof (docs/engineering/testing/e2e/adapter/ai-sdk.md):
  // the app's official @ai-sdk/otel integration (src/backend/otel.ts) exports spans to the
  // fixed-port receiver niceeval.config.ts's `telemetry.port` opens, and `--execution`
  // correlates them to call nodes by gen_ai.tool.call.id (src/o11y/execution-tree.ts).
  // Usage is not asserted here: the UI Message Stream protocol carries no token counts at
  // all (see src/agents/ui-message-stream.ts's coverage declaration — usage is honestly
  // `unavailable`); "usage reaches the CLI readback" as a mechanism fact is already covered
  // by e2e/report, this repo doesn't need to re-prove it.
  const locator = locatorOf("tool-call");
  const execution = sh(`pnpm exec niceeval show ${locator} --execution`);
  assert.ok(
    execution.includes("get_weather"),
    "execution tree is missing the get_weather call node — the SSE tool part wasn't normalized into action.called/result",
  );
  assert.ok(
    /北京/.test(execution),
    "TOOL card's input has no 北京 — the tool input didn't survive normalization/display",
  );
  assert.ok(
    !execution.includes("timing unavailable"),
    "execution tree node lost its span time annotation — the app's @ai-sdk/otel export or niceeval's " +
      "gen_ai.tool.call.id correlation broke",
  );

  // `show --timing`'s separate OTel-subtree-under-turn view keys off a *different*
  // correlation field — turn.traceId, assigned in src/context/session.ts (sendWithOtel)
  // and only ever set when a shared-pool OTel channel drives the turn (src/o11y/otlp/
  // turn-otel.ts, AgentOtelChannel.runTurn) — i.e. tracing.scope === "run" or
  // defineConfig({ telemetry }), which niceeval.config.ts's `telemetry.port` triggers here.
  // Verified empirically (memory/ai-sdk-agent-otel-timing-subtree-unlinked.md, against the
  // in-process aiSdkAgent this repo used before): the shared-pool channel *does* assign a
  // traceId via AgentOtelChannel's window-attribution fallback, but that id is a synthetic
  // per-turn placeholder (turn-otel.ts's `randomBytes(16)`) that never matches the real
  // traceId AI SDK's OpenTelemetry integration stamps on its own spans — so linkage fails
  // regardless of transport. This is a real gap in niceeval's per-turn correlation for
  // shared-pool tracing, not something this repo can wire around; kept non-gating on
  // purpose. Flip the assert below to a hard `assert.ok` once niceeval lands that
  // correlation.
  const timing = sh(`pnpm exec niceeval show ${locator} --timing`);
  if (!timing.includes("get_weather")) {
    console.warn(
      `[verify] KNOWN GAP (non-gating): \`show --timing\` has no OTel subtree for ${locator} — ` +
        "turn.traceId correlation isn't wired for shared-pool tracing yet; see the comment above this line.",
    );
  }
}
