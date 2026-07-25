import { Template } from "e2b";
import { readFile } from "node:fs/promises";
import {
  e2bBaselineBuildTag,
  e2bCodingAgentTemplate,
  verifyE2BNodeToolContract,
  type E2BCodingAgent,
} from "niceeval/sandbox/e2b-template";

const AGENTS = ["claude-code", "codex", "bub"] as const;

const [agent, aliasArg] = process.argv.slice(2) as [E2BCodingAgent | undefined, string | undefined];
if (!agent || !AGENTS.includes(agent)) {
  throw new Error(
    `用法: pnpm tsx sandbox/e2b/build-agent-template.mts <${AGENTS.join("|")}> [template-alias]`,
  );
}

// 制品的版本位是它装的那个 Agent 的版本,不是 niceeval 的 release —— 换 Codex CLI 只重建 codex。
const versionTag = e2bBaselineBuildTag(agent);
const alias = aliasArg ?? `niceeval-${agent}`;

const ledgerUrl = new URL("./published.json", import.meta.url);
const ledger = JSON.parse(await readFile(ledgerUrl, "utf8")) as {
  templates: Record<string, { name: string; versionTag: string }>;
};
const published = ledger.templates[agent];
if (published && published.versionTag === versionTag && alias === `niceeval-${agent}`) {
  throw new Error(
    `${published.name}:${versionTag} 已发布,不能原地覆盖。配方变了就 bump ` +
      `src/agents/coding-cli-versions.ts 的 AGENT_BASELINE_RECIPE_REVISION["${agent}"],` +
      `Agent 版本变了就改对应的版本常量。`,
  );
}

// 在 build 前继续链 .aptInstall() / .runCmd() / .copy()，即可把项目依赖叠加在官方起点上。
// 自检放在最后：它要断言的是发布物的最终状态，追加步骤同样受这条门槛约束。
const template = verifyE2BNodeToolContract(
  e2bCodingAgentTemplate(agent).runCmd("git --version && node --version"),
);

const built = await Template.build(template, alias, {
  cpuCount: 2,
  memoryMB: 4096,
  // default 让不带 tag 的名字跟随最新构建(只适合交互试用);版本 tag 是 CI 该钉的那个。
  tags: ["default", versionTag],
});
console.log(`built ${agent} template: ${built.name}:${versionTag} (${built.templateId}, build ${built.buildId})`);
console.log(`publish with: e2b template publish ${alias} --yes`);
console.log(
  `发布并真机验证后,把 versionTag/templateId/buildId 写进 sandbox/e2b/published.json,` +
    `并同批更新 src/sandbox/e2b-agent-template.ts 的 PUBLISHED_E2B_BASELINE_TAG。`,
);
