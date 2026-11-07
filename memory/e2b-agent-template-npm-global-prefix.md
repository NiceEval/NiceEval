# E2B coding-agent 模板的 npm global 契约必须一致

## 现象

同一批 Eval 在 `niceeval-codex` / `niceeval-bub` 上能执行
`npm install -g pnpm@10.34.5`，换成 `niceeval-claude-code` 后整片以 EACCES
退出。不是 pnpm 或 yarn 的包管理器差异，而是 NiceEval 的两个 E2B 官方起点继承了不同
Node 布局：

| baseline | node | 默认 npm prefix | 运行用户写权限 |
|---|---|---|---|
| Codex / Bub | `/usr/local/bin/node` | `/usr/local` | 可写 |
| Claude Code | `/usr/bin/node` | `/usr` | 不可写 |

这会让「只换 Agent、不改 Eval」不成立。Agent CLI 本身能启动，所以只做
`node --version` / `claude --version` 自检抓不到问题。

## 裁决

NiceEval 派生的三份 E2B coding-agent baseline 的目标契约共同保证：

- 运行用户的 npm global prefix 是 `/usr/local`；
- `/usr/local/bin` 在 PATH；
- `/usr/local/bin` 与 `/usr/local/lib/node_modules` 对运行用户可写。

实现应由 `e2bCodingAgentTemplate()` 在配方里设置目录 ownership 与用户 npm config，
并让 `sandbox/e2b/build-agent-template.mts` 以真实运行用户验证 prefix、PATH 和写权限。当前源码
尚未落地，见 `plan/e2b-template-runtime-contract.md`。不要把长期 workaround 分散进每条 Eval，
也不要用 sudo：root 侧可能与模板已有的全局包发生文件冲突。

已经发布的 template 是不可变制品。源码修复不会倒改 `v0.6.1`；下一组模板发布、真机验证并
bump 具名常量前，直接消费该 release 的 Eval 使用：

```sh
npm install -g --prefix /usr/local pnpm@10.34.5
```

## 错误证据边界

Sandbox provider 返回的 `CommandResult.stdout` / `stderr` 是完整命令结果；当前实现里，Eval 若在
抛错前先做 `.slice(-500)`，EACCES 与失败 path 就在调用方丢失，NiceEval 的 result / TUI 无法恢复。
npm 尾部常是版本 notice，盲取最后 N 字节恰好会挤走根因。

目标契约不是要求每条 Eval 自觉，而是让 Sandbox wrapper 在返回非零 `CommandResult` 前自动把
stdout/stderr 落进 `commands.json`，再由 `show --execution` 下钻；实现见
`plan/failed-command-evidence.md`。即时摘要仍应有界，证据受统一 256 KiB 落盘上限约束。看到只剩
`be a permissions issue...` 一类尾句时，当前版本先检查 Eval 是否自行截断，不要先改 renderer
的 tail heuristic。
