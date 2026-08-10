// owner: docs/engineering/testing/e2e/adapter/claude-agent-sdk.md#adapter-claude-agent-sdk-live-compatibility
//
// 这个 live Journey 只使用 Claude Agent SDK 原生 Bash。`Bash` 的原始名称和
// tool_use_id → tool_result 配对由候选包的 createClaudeSdkEventStream 产生，
// Eval 只从标准事件流读取结果。

import { defineEval } from "niceeval";
import { isDefined, satisfies, includes, toolMatch } from "niceeval/expect";

function requiredInjectedValue(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[configuration] ${name} must be injected by the native live test`,
    );
  }
  return value;
}

const marker = requiredInjectedValue("NICEEVAL_CLAUDE_AGENT_SDK_MARKER");
const sentinel = requiredInjectedValue("NICEEVAL_CLAUDE_AGENT_SDK_SENTINEL");
const command = `printf '%s\\n' '${marker}'`;
const positive = (label: string) =>
  satisfies(`${label} > 0`, (value) => typeof value === "number" && value > 0);

export default defineEval({
  description:
    "Claude SDK 原生 Bash 的配对、usage 与 resume 会话在真实 provider 下可读",
  async test(t) {
    const first = await t.send(
      [
        "这是一个协议兼容性检查。",
        "只能调用一次原生 Bash 工具，严格执行下面这一条安全命令；不要改写、组合或执行任何其他命令：",
        command,
        `完成后记住本轮会话哨兵 ${sentinel}，并用一句简短的话确认。`,
      ].join("\n"),
    );
    await t.require(first.succeeded());
    t.check(
      first.calledTool(
        toolMatch("shell", {
          input: satisfies(
            "shell command",
            (input) =>
              typeof input === "object" &&
              input !== null &&
              !Array.isArray(input) &&
              input["command"] === command,
          ),
          status: "completed",
        }),
        { count: 1 },
      ),
    );
    t.check(first.usage?.inputTokens, positive("first.usage.inputTokens"));
    t.check(first.usage?.outputTokens, positive("first.usage.outputTokens"));
    t.check(
      t.sessionId,
      isDefined(
        "Claude Agent SDK system/init session_id captured before the first result",
      ),
    );

    const resumed = await t.send(
      `只回复上一轮要求你记住的会话哨兵。不要调用任何工具，不要读取或写入文件。`,
    );
    await t.require(resumed.succeeded());
    t.check(resumed.message, includes(sentinel));
    t.check(resumed.notCalledTool(toolMatch("shell")));
    t.check(resumed.usage?.inputTokens, positive("resumed.usage.inputTokens"));
    t.check(
      resumed.usage?.outputTokens,
      positive("resumed.usage.outputTokens"),
    );
    t.check(
      t.sessionId,
      isDefined(
        "Claude Agent SDK session_id remains captured at the resumed result terminal",
      ),
    );
  },
});
