// AgentProfile:每个 e2e 项目声明自己的协议现实(工具名、能力开关)。
// 共享 eval/experiment 都是 factory,吃 profile 决定断言口径——SDK 间的差异只允许
// 出现在各项目的 profile.ts 里,不允许出现在共享套件的断言逻辑里(见 docs/engineering/e2e-ci/README.md 第 3 节)。
export interface AgentProfile {
  /** 天气工具在该 SDK 协议里的真实名字(claude-sdk 是 MCP 命名空间名);coding agent 没有则为 null。 */
  weatherToolName: string | null;
  /** 经审批门控的计算器工具名;不支持 HITL(codex-sdk)则为 null。 */
  calcToolName: string | null;
  /** 网络搜索工具名;只有 ai-sdk-v7 的被测应用注册了它,其余为 null。 */
  searchToolName: string | null;
  /** 协议是否携带 usage(决定是否断言 maxTokens;UI Message Stream / langgraph 自定义帧没有)。 */
  usage: boolean;
  /** 是否是"目录里的编码 agent"(决定 create-file / run-command 是否生效、问答是否强断言零工具)。 */
  sandboxTools: boolean;
  /** coding agent 的工作目录绝对路径(host 模式必填,eval 直接读宿主磁盘核实;沙箱模式见 workspace)。 */
  workspaceDir?: string;
  /**
   * coding agent 的文件系统在哪:"host" = eval 用 node:fs 直接读宿主磁盘(codex-sdk 这类连接
   * 已经在跑的本地 HTTP 应用,workspaceDir 是宿主路径);"sandbox" = 走 t.sandbox.* 读容器里
   * 落盘的文件(claude-code / codex CLI 这类真正跑在沙箱里的 agent,每次 attempt 都是全新容器,
   * 不需要 workspaceDir,也不需要跑前清理)。省略按 "host" 处理,兼容既有 SDK 项目。
   */
  workspace?: "host" | "sandbox";
  /**
   * 已安装的 skill 名(GitHub org/repo 里 SKILL.md 声明的 skill id,如 "effect-ts")。
   * skill 正反配对 eval(skillUsed/skillAbsent)需要;基线组(没装 skill)留空。
   */
  skillName?: string;
  /**
   * 该 SDK"skill 被用到"的可观测方式,两家协议不一样(实测见 memory/):
   * "tool" = 有原生工具调用可断言(claude-code 的 `Skill` 工具,入参 `{ skill, args }`);
   * "shell" = 没有原生工具,只能从读取 skill 文件的 shell 命令入参认(codex 没有 Skill 概念,
   * 靠 prompt 提示后自己用 shell 读 SKILL.md,只能从 command 入参猜)。
   */
  skillDetection?: "tool" | "shell";
  /**
   * skill 安装后落在工作区的相对目录,供 "shell" 检测机制拼路径正则用。
   * 实测:claude-code(`skills add -a claude-code`)落在 `.claude/skills`;
   * codex(`skills add -a codex`)落在 `.agents/skills`(skills 包的"通用"目录)。
   */
  skillInstallDir?: string;
  /**
   * agent 是否带跨会话的磁盘持久记忆(claude-code 的 memory 文件)。为 true 时
   * session-isolation 的反面半场改测"新会话 transcript 不回放历史",不测"回答里
   * 不含事实"——带记忆的 agent 在同一沙箱里跨会话记得事实是正确行为,不是隔离失效。
   */
  persistentMemory?: boolean;
  /**
   * 挂载的 MCP 工具在该协议事件流里的真实(规范化前)名字。实测两家命名不同:
   * claude-code 是 MCP 命名空间 `mcp__<server>__<tool>`;codex 是 `<server>.<tool>`
   * (点分隔,见 `src/o11y/parsers/codex.ts` 的 mcp_tool_call 分支)。
   */
  mcpToolName?: string;
}
