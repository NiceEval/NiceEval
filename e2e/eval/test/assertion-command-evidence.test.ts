import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { decodeInspectionDocument, narrowInspectionSuccess } from "niceeval/inspection";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertion, inspectAttempt } from "./inspection.ts";

// @feature docs/feature/assertions/architecture/evidence.md
test.concurrent("命令断言失败保留启动错误、退出码与脱敏输出尾部", async () => {
  await evalE2E.case("command-evidence", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "assertion-command-evidence", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const evaluation = only(
      run.expEvalEvents(),
      (event) => event.evalId === "assertion-command-evidence",
      run.diagnostic(),
    );
    expect(evaluation.verdict, run.diagnostic()).toBe("failed");
    const attempt = await inspectAttempt(niceeval, projectRoot, evaluation.locator, "attempt.get");
    expect(attempt.document.attempt.assertions.entries).toHaveLength(2);
    const json = await niceeval.run(["show", evaluation.locator, "assertions", "--json"]);
    expect(json.exitCode, json.diagnostic()).toBe(0);
    const details = json.ndjson<unknown>().map((input) => {
      const decoded = decodeInspectionDocument(input);
      if (!decoded.success) throw new Error(`${decoded.reason}\n${json.diagnostic()}`);
      const detail = narrowInspectionSuccess(decoded.value, "attempt.assertion.detail");
      if (!detail.success) throw new Error(`${detail.reason}\n${json.diagnostic()}`);
      return detail.value;
    });
    expect(details).toHaveLength(2);
    for (const [label, expected] of [
      [
        "missing command",
        {
          command: "niceeval-missing-command-evidence",
          exitCode: -1,
          startError: expect.stringContaining("spawn niceeval-missing-command-evidence ENOENT"),
          stdout: "",
          stderr: "",
        },
      ],
      [
        "nonzero command",
        {
          exitCode: 23,
          stdout: expect.stringMatching(/o{10}stdout-tail$/u),
          stderr: expect.stringMatching(/e{10}<redacted> stderr-tail$/u),
        },
      ],
    ] as const) {
      const entry = only(attempt.document.attempt.assertions.entries, (entry) => entry.display.label === label);
      const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator, entry.entryId);
      const observedFact = assertionEntry(detail.document, detail.receipt.diagnostic()).evaluation.observed;
      if (observedFact.kind !== "fields") throw new Error(detail.receipt.diagnostic());
      const command = only(observedFact.fields, (field) => field.label === "commandResult").value;
      if (command.kind !== "fields") throw new Error(detail.receipt.diagnostic());
      const fields = Object.fromEntries(
        command.fields.map((field) => [field.label, field.value.kind === "value" ? field.value.value : null]),
      );
      expect(fields, detail.receipt.diagnostic()).toMatchObject(expected);
      const observed = JSON.stringify(observedFact);
      const compact = only(details, (detail) => detail.assertion.entryId === entry.entryId);
      expect(assertionEntry(compact, json.diagnostic()).evaluation.observed).toEqual(
        assertionEntry(detail.document, detail.receipt.diagnostic()).evaluation.observed,
      );
      expect(observed).not.toContain("synthetic-command-secret");
      expect(Buffer.byteLength(observed)).toBeLessThan(24_000);
      expect(detail.receipt.stdout).not.toContain("synthetic-command-secret");
    }
    const human = await niceeval.run(["show", evaluation.locator, "assertions"]);
    expect(human.exitCode, human.diagnostic()).toBe(0);
    for (const value of ["niceeval-missing-command-evidence", "ENOENT", "23", "stdout-tail", "stderr-tail"])
      expect(human.stdout, human.diagnostic()).toContain(value);
    expect(human.stdout).toMatch(/exitCode\s+23/u);
    expect(human.stdout).toMatch(/startError\s+spawn/u);
    expect(human.stdout).toMatch(/stdout\s+o{10}/u);
    expect(human.stdout).toMatch(/stderr\s+e{10}/u);
    expect(human.stdout).not.toContain("synthetic-command-secret");
  });
});
