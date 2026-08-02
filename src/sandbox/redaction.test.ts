// cases: docs/engineering/testing/unit/sandbox.md
import { describe, expect, it } from "vitest";
import {
  REDACTED_SENSITIVE_VALUE,
  commandSensitiveValues,
  redactSensitiveEvidence,
  redactSensitiveText,
  rememberSensitiveValues,
} from "./redaction.ts";

// bug: memory/command-evidence-known-secret-redaction.md
describe("命令证据的已知敏感值脱敏", () => {
  it("只消费显式非空字符串并最长优先精确替换，不靠键名猜测", () => {
    const short = "synthetic-token";
    const authorization = `Bearer ${short}`;
    const values = commandSensitiveValues({
      sensitiveValues: [short, "", authorization, 42],
    });
    const remembered = new Set<string>();
    rememberSensitiveValues(remembered, values);

    expect(redactSensitiveText(`Authorization=${authorization}; raw=${short}`, remembered)).toBe(
      `Authorization=${REDACTED_SENSITIVE_VALUE}; raw=${REDACTED_SENSITIVE_VALUE}`,
    );
    expect(redactSensitiveText("api_key=ordinary-visible-value", remembered)).toBe(
      "api_key=ordinary-visible-value",
    );
  });

  it("递归复制证据数据并替换命令、stdout/stderr、事件与错误中的同一已知值", () => {
    const marker = "synthetic-sensitive-value-for-test";
    const input = {
      phases: [{ command: { display: `curl -H '${marker}'` } }],
      commands: [{ stdout: `echo ${marker}`, stderr: `rejected ${marker}` }],
      events: [{ type: "error", message: marker }],
      error: { message: `failed: ${marker}`, cause: { message: marker } },
      exitCode: 1,
    };

    const output = redactSensitiveEvidence(input, [marker]);

    expect(JSON.stringify(output)).not.toContain(marker);
    expect(JSON.stringify(output)).toContain(REDACTED_SENSITIVE_VALUE);
    expect(output).not.toBe(input);
    expect(input.error.message).toContain(marker);
    expect(output.exitCode).toBe(1);
  });
});
