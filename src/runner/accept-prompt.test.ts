// cases: docs/engineering/testing/unit/experiments-runner.md

import { describe, expect, it } from "vitest";

import {
  equivalentAcceptCommand,
  promptAcceptSelections,
  type PromptReader,
} from "./accept-prompt.ts";

function scriptedReader(answers: readonly (string | Error)[]): PromptReader {
  let index = 0;
  return {
    question: async () => {
      const answer = answers[index++] ?? "";
      if (answer instanceof Error) throw answer;
      return answer;
    },
    close: () => {},
  };
}

describe("不带值的 --accept 交互助手", () => {
  it("只把明确选择复用的 selector 交给带值执行路径,重跑与读入中断都不授权", async () => {
    const output: string[] = [];
    const selected = await promptAcceptSelections(
      [
        { selector: "config:judge.model", from: "old", to: "new", evals: 5 },
        { selector: "source:evals/share/prompt.ts", from: "aaa", to: "bbb", evals: 2 },
        { selector: "opaque:no-manifest", evals: 1 },
      ],
      scriptedReader(["yes", "rerun", new Error("input closed")]),
      (text) => output.push(text),
    );

    expect(selected).toEqual(["config:judge.model"]);
    expect(output.join("")).toContain("config:judge.model");
    expect(output.join("")).toContain("source:evals/share/prompt.ts");
    expect(output.join("")).toContain("opaque:no-manifest");
  });

  it("先打印的等价命令只含已授权 selector；一个都不选时等价于原命令", () => {
    expect(equivalentAcceptCommand("niceeval exp compare/codex", [
      "config:judge.model",
      "source:evals/share/prompt.ts",
    ])).toBe(
      "niceeval exp compare/codex --accept config:judge.model --accept source:evals/share/prompt.ts",
    );
    expect(equivalentAcceptCommand("niceeval exp compare/codex", [])).toBe("niceeval exp compare/codex");
  });
});
