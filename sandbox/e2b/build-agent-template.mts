import { Template } from "e2b";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  e2bCodingAgentTemplate,
  type E2BCodingAgent,
} from "niceeval/sandbox/e2b-template";

const [agent, alias] = process.argv.slice(2) as [E2BCodingAgent | undefined, string | undefined];
if (!agent || !["claude-code", "codex", "bub"].includes(agent) || !alias) {
  throw new Error(
    "用法: pnpm tsx sandbox/e2b/build-agent-template.mts <claude-code|codex|bub> <template-alias>",
  );
}

const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};
let releaseTag = `v${packageJson.version}`;
try {
  releaseTag = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
  }).trim();
} catch {
  // Published source archives may not include .git; package version is the correct fallback there.
}

// 在 build 前继续链 .aptInstall() / .runCmd() / .copy()，即可把项目依赖叠加在官方起点上。
const template = e2bCodingAgentTemplate(agent)
  .runCmd("git --version && node --version");

const built = await Template.build(template, alias, {
  cpuCount: 2,
  memoryMB: 4096,
  tags: ["default", releaseTag, "stable"],
});
console.log(`built ${agent} template: ${built.name} (${built.templateId}, build ${built.buildId})`);
console.log(`publish with: e2b template publish ${alias} --yes`);
