// 安装 Manifest 的落点与读写(定稿见 docs/feature/adapters/architecture/coding-agent-extensions.md
// 「安装 Manifest」、docs/feature/record/architecture.md「agent-setup.json」)。
//
// 分工:**adapter 写**(setup 收尾,知道自己装了什么)、**运行器读**(把它抬成 attempt artifact)。
// 中间那层只是一个双方都认的沙箱路径 —— core 不解释 manifest 内容,也不按 agent 名字分支;
// 自定义沙箱 adapter 用同一个 `shared.writeAgentSetup()` 就能让自己的安装结果进落盘。

import type { AgentSetupManifest, Sandbox } from "../types.ts";

/**
 * 沙箱内的 manifest 路径(相对 workdir)。`__niceeval__/` 已在 git 基线的 .gitignore 里
 * (见 runner/sandbox-prep.ts),所以写它不会污染 agent 产出的 diff。
 */
export const AGENT_SETUP_MANIFEST_PATH = "__niceeval__/agent-setup.json";

/** adapter 在 setup 收尾调:把这次实际安装的东西写进沙箱 manifest。 */
export async function writeAgentSetupManifest(sandbox: Sandbox, manifest: AgentSetupManifest): Promise<void> {
  await sandbox.writeFiles({ [AGENT_SETUP_MANIFEST_PATH]: JSON.stringify(manifest, null, 2) });
}

/**
 * 运行器在 agent.setup 之后调:沙箱里没有这个文件(adapter 什么都没装,或不是 coding agent)
 * 就是 undefined —— 不生成空 artifact,与「某类数据为空就不落文件」的落盘规则一致。
 * 文件在但不是合法 JSON 视为「manifest 无法完整反映安装结果」,按 setup 失败上抛。
 */
export async function readAgentSetupManifest(sandbox: Sandbox): Promise<AgentSetupManifest | undefined> {
  let raw: string;
  try {
    raw = await sandbox.readFile(AGENT_SETUP_MANIFEST_PATH);
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(raw) as AgentSetupManifest;
  } catch {
    throw new Error(
      `Agent setup manifest ${AGENT_SETUP_MANIFEST_PATH} is not valid JSON. The adapter wrote a broken install manifest; ` +
        "it must faithfully report what was installed (write it with shared.writeAgentSetup()).",
    );
  }
}
