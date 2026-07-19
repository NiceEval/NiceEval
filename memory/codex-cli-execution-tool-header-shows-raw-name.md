---
name: codex-cli-execution-tool-header-shows-raw-name
description: "`show --execution` 的 TOOL 卡片头显示 ExecutionActionNode.name(协议原始未归一化名),不是 t.calledTool() 断言用的 canonical 工具名;codex 的 command_execution/file_change 在 --execution 里就是这两个字面量,不会显示 shell/file_edit"
metadata:
  type: infra-bug
---

**现象**:`e2e/repos/codex-cli` 的 `coding-task` Eval 内部 `t.calledTool("shell", …)` /
`t.calledTool("file_edit", …)` 断言真机通过(attempt 标 passed),但 `scripts/verify.ts`
对同一个 attempt 跑 `pnpm exec niceeval show <locator> --execution` 后
`execution.includes("file_edit")` / `execution.includes("shell")` 两条断言必然失败——真机抓到
的 `--execution` 输出里 TOOL 卡片头是:

```
TOOL · command_execution
  input
    /bin/bash -lc 'echo niceeval-e2e-run-914'
  ...
TOOL · file_change
  input
    {"path":"...","kind":"update"}
```

字面量 `"shell"`、`"file_edit"` 全文不出现一次。

**根因**:`src/o11y/execution-tree.ts` 的 `ExecutionActionNode` 同时有两个名字字段:`name`
(「原始工具名(未归一化)对齐 StreamEvent.action.called.name」)和 `tool`(「归一化后的规范工具名」,
可选)。`src/show/render.ts` 的 `executionNodeLines()` 渲染 TOOL 卡片头时用的是
`` `TOOL · ${node.name}` ``——即原始名,不是 `node.tool`。`src/o11y/parsers/codex.ts` 对
`command_execution`/`local_shell_call` 与 `file_change` 这两类 item,`emitCall(callId, "command_execution", …, "shell")`
/ `emitCall(callId, "file_change", …, "file_edit")` 里第二个参数(原始名)恰好硬编码成
`"command_execution"`/`"file_change"`,第四个参数(canonical `tool`)才是 `"shell"`/`"file_edit"`——
`t.calledTool()` 走 `tc.name === name || tc.originalName === name` 匹配(两个字段都能命中,
故 Eval 内部断言不受影响),但 `--execution` 的展示只用了原始名这一个字段。

MCP 工具调用不受影响:`mcp_tool_call` 分支的原始名本身就是 `${server}.${tool}`(如
`"e2e.get-sum"`),这恰好是有意义、值得展示的字符串,不存在"原始名对断言无用"的问题——
只有 command_execution/file_change 这类"协议原始名是内部事件类型、canonical 名才是人话"的
情况才会踩这个坑。

**修法**:`e2e/repos/codex-cli/scripts/verify.ts` 的 `--execution` 断言改成 OR 两种写法都接受:
`execution.includes("file_edit") || execution.includes("file_change")`、
`execution.includes("shell") || execution.includes("command_execution")`——`e2e/repos/codex-sdk`
的 `verify.ts` 已经用同一个 OR 写法处理过这个坑(`execution.includes("shell") ||
execution.includes("command_execution")`),这次是同一坑第二次出现,直接照抄。

**未做的更彻底修法(留给以后决定)**:如果认为 `--execution` 的 TOOL 头本就该显示 canonical
名(或两者都显示,如 `TOOL · shell (command_execution)`),这是 `src/show/render.ts` 的展示层
设计决定,影响所有沙箱型 adapter 的 `--execution` 输出,不是本仓库能单方面改的范围——本条
只记录现状与 repo-local workaround,不代表这就是理想形态。

**适用场景**:任何要在 `--execution` CLI 输出里断言"某类工具被调用"的验收脚本,如果目标
协议(codex 是已知的一个)的 canonical 工具名与协议原始事件类型名不同,断言子串时要么用
OR 兼容两种,要么改用 `t.calledTool()` 在 Eval 内部断言(那里两个名字都会被匹配)而不是指望
CLI 展示面重复一遍同一保证。相关:[[run-command-canonical-tool-name-portability]](同一对
raw/canonical 名字的另一个坑,那条讲的是 Eval 断言目标该选哪个名,这条讲的是 CLI 展示面
选了哪个名)。
