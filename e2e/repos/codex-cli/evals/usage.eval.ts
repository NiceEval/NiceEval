// 协议行为:usage 与实际模型——usage 逐轮到位;实际模型不能只信 experiment 传下来的请求参数
// (网关可能改写),需要从 Codex session 侧写读取核对(见
// docs/engineering/e2e-ci/adapters/codex-cli.md)。
//
// 核验方式:Codex 把每轮的 turn_context(含 model 字段)侧写进
// ~/.codex/sessions/YYYY/MM/DD/rollout-*-<thread_id>.jsonl——本仓库设计阶段已用真实
// codex-cli 0.144.1 在本机核对过这个字段确实存在且值就是这次请求实际生效的模型名。
import { defineEval } from "niceeval";
import { equals, includes, satisfies } from "niceeval/expect";

export default defineEval({
  description: "usage 与实际模型:usage 逐轮非空;实际模型从 Codex session 侧写核对",
  async test(t) {
    const turn = await t.send("9 乘以 7 等于多少?先说明简短的推理过程,再给出最终数字。");
    turn.expectOk();

    await t.group("usage 逐轮非空", () => {
      t.check(
        turn.usage?.inputTokens,
        satisfies((v) => typeof v === "number" && v > 0, "usage.inputTokens > 0"),
      );
      t.check(
        turn.usage?.outputTokens,
        satisfies((v) => typeof v === "number" && v > 0, "usage.outputTokens > 0"),
      );
    });
    turn.messageIncludes("63");

    await t.group("实际模型从 Codex session 侧写核对,不只信请求参数", async () => {
      const probe = await t.sandbox.runShell(
        `f=$(find ~/.codex/sessions -name "*${t.sessionId}*.jsonl" | head -1); test -n "$f" && grep -o '"model":"[^"]*"' "$f" | sort -u`,
      );
      t.check(probe.exitCode, equals(0));
      t.check(probe.stdout, includes(`"model":"${t.model}"`));
    });
  },
});
