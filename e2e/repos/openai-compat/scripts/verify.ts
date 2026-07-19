// 仓库内验收(docs/engineering/e2e-ci/verification.md 的写法):CLI 黑盒——只跑
// `pnpm exec niceeval ...`、断言 stdout / 退出码 / --junit 文件,不 import niceeval 库代码,
// 不递归扫 `.niceeval/`。

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

function sh(cmd: string, expect: number | "nonzero" = 0): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(ok, `${cmd}\n退出 ${exit},预期 ${expect}。stderr 尾部:\n${(res.stderr ?? "").slice(-2000)}`);
  return res.stdout ?? "";
}

const EXPECTED_EVALS = ["chat-completions/tool-call", "responses/tool-call", "responses/negative"];

function latestAttemptLine(evalId: string): string {
  const lines = sh(`pnpm exec niceeval show ${evalId} --history`)
    .split("\n")
    .filter((l) => l.includes("@"));
  assert.ok(lines.length > 0, `show --history 里 ${evalId} 没有任何 attempt 行——实验没跑到这条 Eval`);
  return lines.at(-1)!;
}

export function runVerify(): void {
  // 用例一:跑两个实验,断言退出码为 0(--force 保证真实新跑)。
  sh("pnpm exec niceeval exp chat-completions --force --output ci --junit junit-chat-completions.xml");
  sh("pnpm exec niceeval exp responses --force --output ci --junit junit-responses.xml");

  // 用例二:show --history(裸,不带 eval id)——三条 Eval 都实际运行了,少排用例不能全绿。
  // 本仓库有两个实验组(chat-completions/responses),裸 `show`(不带 --history)在多组时只
  // 渲染按组汇总的榜单、不展开叶子 eval id,所以榜单断言改读 `--history`——它总是逐 eval
  // 列出 id(见下面用例三对单个 id 的复用),同样是「自有事实的子串级出现」。
  const historyBoard = sh("pnpm exec niceeval show --history");
  for (const id of EXPECTED_EVALS) {
    assert.ok(
      historyBoard.includes(id),
      `show --history 缺少 ${id}——发现或选择器行为变了,先跑 pnpm exec niceeval exp <name> --dry 看计划`,
    );
  }

  // 用例三:按 eval id 单独 show --history——逐 attempt 断言 verdict passed,并拿到 locator。
  const locators: Record<string, string> = {};
  for (const id of EXPECTED_EVALS) {
    const line = latestAttemptLine(id);
    assert.ok(
      line.includes("passed"),
      `${id} 最新 attempt 不是 passed:${line}\n用行尾 locator 执行 pnpm exec niceeval show @<locator> 看主失败断言`,
    );
    locators[id] = line.match(/@\S+/)![0];
  }

  // 用例四:show --execution——两条 tool-call Eval 的调用节点与入参都存在。
  for (const id of ["chat-completions/tool-call", "responses/tool-call"]) {
    const execution = sh(`pnpm exec niceeval show ${locators[id]} --execution`);
    assert.ok(
      execution.includes("get_weather"),
      `${id}:执行树缺少 get_weather 调用节点——调用没被归一进事件流,或 show 执行树读不回`,
    );
    assert.ok(
      execution.includes("Brooklyn"),
      `${id}:TOOL 卡片的 input 里没有出现入参 Brooklyn——入参在归一或展示链路上被丢弃/改写`,
    );
    // openai-compat 的两个转换器都没有 tracing 面(见适配器文档「仓库验收」)——反向断言。
    assert.ok(
      execution.includes("timing unavailable"),
      `${id}:执行树出现了时间注释,但 fromChatCompletion/fromResponses 不应声明 tracing 面`,
    );
  }

  // 用例五:show --timing——未声明 tracing 面的仓库,--timing 只有 runner 时间树,不挂 OTel
  // 子树(不应出现工具 span)。用 responses/tool-call 的 locator 验证。
  const timing = sh(`pnpm exec niceeval show ${locators["responses/tool-call"]} --timing`);
  assert.ok(
    !timing.includes("get_weather"),
    "responses/tool-call:--timing 出现了工具 span,但 openai-compat 两个转换器都没有声明 tracing 面",
  );

  // 用例六:JSON 出口口径一致——三条 Eval 的 id 与 passed 计数在 --json 摘要里同样能找到。
  sh("pnpm exec niceeval exp chat-completions --output ci --json summary-chat-completions.json");
  const ccSummary = JSON.parse(readFileSync("summary-chat-completions.json", "utf8")) as { results?: unknown[] };
  assert.ok(
    Array.isArray(ccSummary.results) && ccSummary.results.length > 0,
    "--json 摘要里 results 数组为空——JSON 出口与 show 读面口径不一致",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runVerify();
  console.log("[verify] all checks passed");
}
