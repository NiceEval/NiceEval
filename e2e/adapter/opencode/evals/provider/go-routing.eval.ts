import { defineEval } from "niceeval";
import { equals, includes, isDefined, satisfies } from "niceeval/expect";

const CLI_MODEL = "opencode-go/deepseek-v4-flash";
const PROVIDER = "opencode-go";
const API_MODEL = "deepseek-v4-flash";
const LIVE_MARKER = "OPENCODE-GO-DEEPSEEK-V4-FLASH-E2E-731";

export default defineEval({
  description:
    "OpenCode Go 路由:完整 CLI 模型映射到 deepseek-v4-flash API 模型并完成真实请求",
  async test(t) {
    t.assert(t.check(t.model, equals(CLI_MODEL)));

    const turn = await t.send(
      `Reply with exactly ${LIVE_MARKER}. Do not call tools, read files, or run commands.`,
    );
    await t.require(turn.succeeded());
    t.assert(t.check(turn.message, includes(LIVE_MARKER)));
    t.assert(t.noFailedActions());

    await t.group("真实会话记录确认 provider 与 API model", async () => {
      t.assert(
        t.check(
          t.sessionId,
          isDefined("OpenCode sessionID 应在真实请求后被捕获"),
        ),
      );
      const exported = await t.sandbox.runShell(
        `opencode export ${JSON.stringify(t.sessionId)} | tr -d '[:space:]'`,
      );
      t.assert(t.check(exported.exitCode, equals(0)));
      t.assert(
        t.check(exported.stdout, includes(`\"providerID\":\"${PROVIDER}\"`)),
      );
      t.assert(
        t.check(exported.stdout, includes(`\"modelID\":\"${API_MODEL}\"`)),
      );
    });
  },
});
