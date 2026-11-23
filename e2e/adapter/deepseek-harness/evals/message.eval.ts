import { defineEval } from "niceeval";
import { equals, includes } from "niceeval/expect";
import { DSH_LOOPBACK_MODEL, DSH_LOOPBACK_REPLY, DSH_PLUGIN, DSH_PLUGIN_PROBE } from "./plugin-probe.ts";

export const DEEPSEEK_HARNESS_MARKER = "NICEEVAL-DEEPSEEK-HARNESS-E2E-817";

export default defineEval({
  description: "DeepSeek Harness 完成一轮消息并保留可区分输出",
  async test(t) {
    await t.group("原生插件已安装并在首个模型请求中提供工具", async () => {
      const result = await t.sandbox.runCommandOrThrow("node", ["--input-type=module", "-e", DSH_PLUGIN_PROBE]);
      const observation: {
        installed: boolean;
        reply: string;
        status: string;
        firstRequest: { model: string; tools: string[] };
        usage: { inputTokens: number; outputTokens: number };
      } = JSON.parse(result.stdout);
      t.check(observation.installed, equals(true));
      t.check(observation.reply, equals(DSH_LOOPBACK_REPLY));
      t.check(observation.status, equals("completed"));
      t.check(observation.usage.inputTokens, equals(1));
      t.check(observation.usage.outputTokens, equals(1));
      t.check(observation.firstRequest.model, equals(DSH_LOOPBACK_MODEL));
      t.check(observation.firstRequest.tools.includes(DSH_PLUGIN.tool), equals(true));
      t.check(observation.firstRequest.tools.includes("team_task_list"), equals(true));
    });
    const turn = await t.send(`只回答这一段文本：${DEEPSEEK_HARNESS_MARKER}`);
    await turn.succeeded().orStop();
    t.check(turn.reply, includes(DEEPSEEK_HARNESS_MARKER));
  },
});
