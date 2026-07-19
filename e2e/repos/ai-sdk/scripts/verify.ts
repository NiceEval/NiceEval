// CLI black-box verification (docs/engineering/e2e-ci/verification.md style): spawns
// `niceeval` as a subprocess and asserts on stdout / --json / --junit — never imports
// niceeval library code, never scans `.niceeval/` by hand.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const EXPECTED_EVALS = [
  "ui-message-stream/tool-call",
  "ui-message-stream/hitl-approval",
  "ui-message-stream/session-replay",
  "in-process/tool-and-approval",
  "zero-mapping/tool-call",
];

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

interface JsonResult {
  id: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

interface JsonSummary {
  results: JsonResult[];
}

export async function runVerify(): Promise<void> {
  // Single combined command runs all three Experiments (ui-message-stream, in-process,
  // zero-mapping) covering this repo's three entry points; logged unconditionally so
  // scripts/e2e.ts can classify infra-vs-regression from the raw --output ci log even
  // when the assert below throws.
  const runCmd = "pnpm exec niceeval exp --force --output ci --json summary.json --junit junit.xml";
  const res = spawnSync(runCmd, { shell: true, encoding: "utf8" });
  writeFileSync("logs/exp-ci.log", `${res.stdout}\n${res.stderr}`, "utf8");
  assert.equal(
    res.status,
    0,
    `${runCmd}\nexited ${res.status}, expected 0. stderr tail:\n${res.stderr.slice(-2000)}`,
  );

  // 1. `show` board lists every Experiment this repo owns; each Experiment's own board
  // (`show --exp <id>`) lists every Eval it covers — a dropped Eval must not go unnoticed.
  // Bare `show` groups by experiment rather than flattening every eval id (current CLI),
  // so the id-level check goes one level down via `--exp`.
  const board = sh("pnpm exec niceeval show");
  for (const experimentId of ["ui-message-stream", "in-process", "zero-mapping"]) {
    assert.ok(
      board.includes(experimentId),
      `show board is missing the ${experimentId} experiment group — discovery/selection changed`,
    );
  }
  for (const experimentId of ["ui-message-stream", "in-process", "zero-mapping"]) {
    const groupBoard = sh(`pnpm exec niceeval show --exp ${experimentId}`);
    for (const id of EXPECTED_EVALS.filter((e) => e.startsWith(`${experimentId}/`))) {
      assert.ok(
        groupBoard.includes(id),
        `show --exp ${experimentId} is missing ${id} — discovery/selection changed; run \`pnpm exec niceeval exp --dry\` to see the plan`,
      );
    }
  }

  // 2. every Eval's latest attempt passed.
  for (const id of EXPECTED_EVALS) {
    const line = latestAttemptLine(id);
    assert.ok(
      line.includes("passed"),
      `${id} latest attempt is not passed: ${line}\nUse the trailing locator with \`niceeval show @<locator>\` for the main failing assertion`,
    );
  }

  // 3. usage reaches the CLI readback (--json), not just Turn.usage inside the eval —
  // covers this repo's "per-turn usage non-empty" duty (ai-sdk.md 仓库验收). Scoped to the
  // two entry points that actually carry usage: the UI Message Stream protocol frames
  // carry no token counts at all (see src/agents/ui-message-stream.ts's coverage
  // declaration — usage is honestly `unavailable`, not a bug to assert against here).
  const summary = JSON.parse(readFileSync("summary.json", "utf8")) as JsonSummary;
  for (const id of ["zero-mapping/tool-call", "in-process/tool-and-approval"]) {
    const result = summary.results.find((r) => r.id === id);
    assert.ok(result, `summary.json has no result entry for ${id}`);
    assert.ok(
      (result!.usage?.inputTokens ?? 0) > 0 && (result!.usage?.outputTokens ?? 0) > 0,
      `${id}'s --json usage is empty — usage isn't reaching the CLI readback`,
    );
  }

  // 4. UI Message Stream: bare tool name + input echoed on the execution tree (call+input
  // fidelity all the way through normalization → display).
  const uiExecution = sh(`pnpm exec niceeval show ${locatorOf("ui-message-stream/tool-call")} --execution`);
  assert.ok(
    uiExecution.includes("get_weather"),
    "execution tree is missing the get_weather call node — the SSE tool part wasn't normalized into action.called/result",
  );
  assert.ok(
    /北京/.test(uiExecution),
    "TOOL card's input has no 北京 — the tool input didn't survive normalization/display",
  );

  // 5. in-process aiSdkAgent: same bare-name vocabulary as the HTTP transport (进程内循环),
  // and this is this repo's OTel proof. --execution correlates spans to call nodes by
  // gen_ai.tool.call.id (src/o11y/execution-tree.ts) — that's confirmed working: the tool
  // node carries real span timing, no "timing unavailable".
  const inProcessLocator = locatorOf("in-process/tool-and-approval");
  const inProcessExecution = sh(`pnpm exec niceeval show ${inProcessLocator} --execution`);
  assert.ok(
    inProcessExecution.includes("get_weather"),
    "in-process execution tree is missing get_weather — the two transports don't share event vocabulary",
  );
  assert.ok(
    !inProcessExecution.includes("timing unavailable"),
    "execution tree nodes lost their span time annotation — aiSdkOtel() correlation via gen_ai.tool.call.id broke",
  );

  // `show --timing`'s separate OTel-subtree-under-turn view keys off a *different*
  // correlation field — turn.traceId, assigned in src/context/session.ts (sendWithOtel)
  // and only ever set when a shared-pool OTel channel drives the turn (src/o11y/otlp/
  // turn-otel.ts, AgentOtelChannel.runTurn) — i.e. tracing.scope === "run" or
  // defineConfig({ telemetry }). aiSdkAgent's tracing is attempt-scoped (the correct
  // choice per docs/observability.md — full concurrency, no shared long-running-service
  // receiver needed), so turn.traceId is never assigned and this subtree cannot render
  // today. Verified empirically both without and with defineConfig({ telemetry }): the
  // latter *does* assign a traceId via AgentOtelChannel's window-attribution fallback, but
  // that id is a synthetic per-turn placeholder (see turn-otel.ts's `randomBytes(16)`) that
  // never matches the real traceId AI SDK's OpenTelemetry integration stamps on its own
  // spans — so linkage still fails even then. This is a real gap in niceeval's per-turn
  // correlation for attempt-scope tracing, not something this repo can wire around; kept
  // non-gating on purpose. Flip the assert below to a hard `assert.ok` once niceeval lands
  // that correlation.
  const inProcessTiming = sh(`pnpm exec niceeval show ${inProcessLocator} --timing`);
  if (!inProcessTiming.includes("get_weather")) {
    console.warn(
      `[verify] KNOWN GAP (non-gating): \`show --timing\` has no OTel subtree for ${inProcessLocator} — ` +
        "turn.traceId correlation isn't wired for attempt-scope aiSdkAgent tracing yet; see the comment above this line.",
    );
  }
}
