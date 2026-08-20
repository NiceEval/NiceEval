import { completeEvidenceCoverage, defineAgent, defineSandboxAgent } from "niceeval/adapter";
import type { Agent } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

import { weatherFixture } from "../src/tools.ts";

const GREETING = "Hello, niceeval!";

/**
 * CLI 功能 Repo 使用的进程内确定性 Agent。
 *
 * 它只实现当前 CLI pilot 需要的公开 Agent/Turn 边界：普通问候返回一条 assistant
 * message，天气问题返回一组完整的 tool call/result 事件和一条 assistant message。
 * 不读取环境变量、不访问网络，也不依赖 provider SDK；失败与执行错误由各自的 Eval
 * 通过公开断言和异常路径产生。
 */
export function deterministicAgent(name: string): Agent {
  return defineAgent({
    name,
    evidenceCoverage: completeEvidenceCoverage,
    async send(input, ctx) {
      if (ctx.signal.aborted) {
        throw new Error("deterministic backend aborted");
      }

      ctx.session.capture(`cli-deterministic:${name}`);

      if (/weather/i.test(input.text)) {
        const operationId = "get-weather-1";
        return {
          status: "completed",
          events: [
            {
              type: "operation.started",
              operationId,
              operation: {
                kind: "tool",
                name: "get_weather",
                input: { city: weatherFixture.city },
              },
            },
            {
              type: "operation.finished",
              operationId,
              kind: "tool",
              output: weatherFixture,
              status: "completed",
            },
            {
              type: "message",
              role: "assistant",
              text: `The weather in ${weatherFixture.city} is ${weatherFixture.condition}.`,
            },
          ],
        };
      }

      return {
        status: "completed",
        events: [{ type: "message", role: "assistant", text: GREETING }],
      };
    },
  });
}

/** The paired Sandbox prepare command fails before this adapter can run. */
export const preContextErrorAgent = defineSandboxAgent({
  name: "cli-pre-context-error",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { fixture: "cli-pre-context-error", revision: "1" },
    probe: shell("true"),
  },
  async send() {
    throw new Error("pre-context error fixture unexpectedly reached the agent");
  },
});
