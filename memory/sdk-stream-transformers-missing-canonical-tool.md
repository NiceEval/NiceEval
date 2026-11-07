# SDK 流转换器不发规范工具名,规范名断言在该路径静默失配

## 现象

e2e `codex-sdk/ci` 的 `run-command` 在 CI 连红 6 个 attempt(两次 run × 3),gate `calledTool("shell")` 不命中——但工件 `events.json` 显示 agent 明明成功执行了命令(`command_execution`,exit 0)。同一断言在沙箱矩阵的 codex × docker 项目上是绿的。首次暴露于 2026-07-09 run 29001520566;引入它的 commit 6307c50 自己的 CI run 被后续 push 连环取消,从未跑完,红潜伏了一天。

## 根因

规范工具名归一(`command_execution` → `"shell"`,表在 `src/o11y/tool-names.ts`)只做在了 **transcript parser 路径**(`src/o11y/parsers/{codex,claude-code,bub}.ts`,沙箱内置 agent 走这条)和 `fromAiSdk`。**SDK 流转换器路径**(`src/agents/sdk-streams.ts` 的 `fromCodexThreadEvents`,codex-sdk 这类 HTTP 被测应用走这条)发 `action.called` 时不带 `tool` 字段,`src/o11y/derive.ts` 只能落 `name: "unknown"`、`originalName: "command_execution"`,`toolMatches` 比对 `"shell"` 时两个名字都对不上。commit 6307c50 把 shared 套件 gate 从原始名改成规范名时(见 [run-command-canonical-tool-name-portability](run-command-canonical-tool-name-portability.md)),注释断言"toolMatches 同时比较规范名与原始名,不用按 SDK 分支"——前提是每条事件路径都归一过,当时只验证了 parser 路径。

## 修法

`fromCodexThreadEvents` 的四类工具项补 `tool` 规范名,与 `parsers/codex.ts` 同一套语义(直接复用其导出的 `CODEX_TOOL_ALIASES`):`command_execution` → `"shell"`、`web_search` → `"web_search"`、`file_change` → `"file_edit"`、`mcp_tool_call` → `normalizeToolName(tool, CODEX_TOOL_ALIASES)`。落点 `src/agents/sdk-streams.ts`(commit 见 2026-07-09 "fix(sdk-streams)" 提交)。

**同类未修**:`fromClaudeSdkMessages` 同样不发 `tool`。当前 e2e 的 claude-sdk 项目没有用规范名的 gate 所以没红;一旦对 Claude Agent SDK 的 CLI 词汇(`Bash`/`Read`/`Write`)写 `calledTool("shell")` 类断言就会以同样方式失配,届时对齐 `parsers/claude-code.ts` 的别名表照此修。

**教训**:把断言从原始名迁到规范名前,要枚举所有产生 `action.called` 的路径确认都带 `tool`;"toolMatches 两个名字都比"只兜住已归一的事件。
