import { defineEval } from "niceeval";
import { equals, greaterThan, includes, jsonMatch, satisfies, toolMatch } from "niceeval/expect";

export const OMP_TOOL_MARKER = "NICEEVAL-OMP-TOOL-EVENT-493";

export default defineEval({
  description: "OMP 的真实 bash 调用保留入参、完成结果、command 分类与逐轮用量下界",
  async test(t) {
    const turn = await t.send(`请调用一次 bash 工具执行 \`printf ${OMP_TOOL_MARKER}\`。完成后只回答命令输出。`);
    await turn.succeeded().orStop();

    t.check(
      t.toolCalls,
      toolMatch("shell", {
        input: jsonMatch({ command: new RegExp(OMP_TOOL_MARKER) }),
        output: jsonMatch(new RegExp(OMP_TOOL_MARKER)),
        status: "completed",
      }).exactly(1),
    );
    t.check(
      turn.events,
      satisfies<typeof turn.events>("OMP bash operation carries an opaque command projection", (events) =>
        events.some(
          (event) =>
            event.type === "operation.started" &&
            event.operation.kind === "tool" &&
            event.operation.name === "bash" &&
            event.operation.command?.kind === "command" &&
            event.operation.command.original.state === "opaque",
        ),
      ),
    );
    t.check(turn.usage.inputTotalTokens.state, equals("lower-bound"));
    t.check(turn.usage.outputTokens.state, equals("lower-bound"));
    t.check(turn.usage.inputTotalTokens, greaterThan(0));
    t.check(turn.usage.outputTokens, greaterThan(0));
    t.check(turn.reply, includes(OMP_TOOL_MARKER));
  },
});
