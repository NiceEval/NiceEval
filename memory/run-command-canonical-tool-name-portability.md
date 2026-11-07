# 断言"跑过 shell"要用规范名 `"shell"`,不要用某一家的原始工具名

**现象**：`e2e/shared/evals.ts` 既有的 `runCommand(p)` factory 断言
`t.calledTool("command_execution", { input: { command: /…/ } })`,这在 codex-sdk(HTTP demo
应用,底层协议就是 codex 的 thread 事件)上一直是绿的,但把同一个 factory 复用给沙箱型
`claudeCodeAgent` 时会必然失败。

**根因**：`calledTool(name, match)` 按 `tc.name === name || tc.originalName === name` 匹配
(`src/scoring/scoped.ts`)。`tc.originalName` 是各协议的原始工具名——codex 的 shell 调用原始名
恰好就是字面量 `"command_execution"`(`local_shell_call` 分支硬编码的,见
`src/o11y/parsers/codex.ts`),但 claude-code 的原始名是 `"Bash"`。`tc.name` 是规范化后的类目,
两家的 shell 类工具都会被 `src/o11y/tool-names.ts` 的别名表规范化成同一个值 `"shell"`
(`bash`/`command_execution`/`local_shell`/`execute_command`/… 都映射到它)。之前只测过
codex-sdk 一家,"用原始名字面量当断言目标"这件事凑巧成立,掩盖了它本该用规范名的事实。

**修法**：把断言目标从 `"command_execution"` 改成规范名 `"shell"`——这是严格更宽的匹配
(任何规范化到 shell 类目的调用都会命中,包括原来能命中的 codex 原始名),对已经在跑的
codex-sdk 项目行为不变,同时让 claude-code 项目也能通过。落点:`e2e/shared/evals.ts` 的
`runCommand(p)`。适用场景:任何要写"与 SDK 无关"的工具类断言时,优先用 `tc.name`(规范类目,
如 `"shell"` / `"file_write"` / `"file_edit"`)而不是猜某一家的原始工具名字面量——除非就是要
断言"这家协议管这个动作叫什么"(比如 MCP 工具名,见 [[mcp-tool-naming-claude-vs-codex]])。
