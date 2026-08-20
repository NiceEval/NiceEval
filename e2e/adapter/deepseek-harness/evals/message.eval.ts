import { defineEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

export const DEEPSEEK_HARNESS_MARKER = "NICEEVAL-DEEPSEEK-HARNESS-E2E-817";

export default defineEval({
  description: "DeepSeek Harness 完成一轮消息并保留可区分输出",
  async test(t) {
    await t.group("原生插件已按精确版本安装、启用并可由 headless profile 加载", async () => {
      const installed = await t.sandbox.runShell(
        `DSH_HOME="$HOME/.niceeval-dsh" node -e '` +
          `const fs=require("node:fs");` +
          `const p=JSON.parse(fs.readFileSync(process.env.DSH_HOME+"/profiles/headless/package.json","utf8"));` +
          `const ok=p.dependencies?.["dsh-dead-links"]==="0.1.1"&&` +
          `p.dsh?.profile?.bundles?.includes("dsh-dead-links");` +
          `process.stdout.write(ok?"ready":"missing");process.exit(ok?0:1)'` +
          ` && DSH_HOME="$HOME/.niceeval-dsh" dsh --profile headless --dump-config >/dev/null`,
      );
      await t.check(installed.exitCode, equals(0)).orStop();
      t.check(installed.stdout, includes("ready"));
    });
    const turn = await t.send(`只回答这一段文本：${DEEPSEEK_HARNESS_MARKER}`);
    await turn.succeeded().orStop();
    t.check(turn.message, includes(DEEPSEEK_HARNESS_MARKER));
  },
});
