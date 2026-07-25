# E2B coding-agent 模板统一 Node 工具契约：实现 TODO

目标契约已定稿，正文见
[`docs/feature/sandbox/library/prebuilt-environments.md`](../docs/feature/sandbox/library/prebuilt-environments.md)
「E2B: TemplateBuilder 派生」与「官方 coding agent 起点」。本计划只列实现、验证与发布次序，
不复制第二份行为定义。

## 背景与当前状态

当前公共制品（旧命名下的 `v0.6.1`）继承了两套不相容的 Node 布局：

| baseline | node | 默认 npm prefix | 运行用户 `npm install -g` |
|---|---|---|---|
| Codex / Bub | `/usr/local/bin/node` | `/usr/local` | 成功 |
| Claude Code | `/usr/bin/node` | `/usr` | EACCES |

`/usr/local/bin` 在三份模板的 PATH 中，且当前实例验证可由运行用户写入。因此现阶段 Eval 使用
`npm install -g --prefix /usr/local <pkg>` 可以保持 Agent-neutral。源码 factory 已实现默认 prefix
规范化，构建脚本也已加入最终状态自检；但已发布模板不会被源码提交倒改，真实制品验证、同 tag
发布与常量切换仍未完成。

## TODO

- [x] **A. 派生配方**
  - [x] A1. 在 `src/sandbox/e2b-agent-template.ts` 用一个共同步骤包住 Claude Code / Codex / Bub
    三条 recipe；为 `user` 准备 `/usr/local/bin` 与 `/usr/local/lib/node_modules` 的写权限。
  - [x] A2. 以运行用户写 npm config，使普通 `npm install -g` 的 prefix 为 `/usr/local`。
  - [x] A3. 不改 Agent CLI 的安装选择：Claude Code 继续 native installer，Codex 继续固定 npm
    版本，Bub 继续 uv tool + marker。Node 工具契约是横切层，不是第四套 Agent 安装逻辑。

- [ ] **B. 守护**
  - [x] B1. `Template.toJSON()` 结构测试覆盖三种 Agent，证明共同 prefix / 目录准备步骤都存在。
  - [x] B2. `sandbox/e2b/build-agent-template.mts` 在 build 内以 `user` 身份验证：
    `npm config get prefix === /usr/local`、PATH 包含 `/usr/local/bin`、两个目标目录可写。
  - [ ] B3. 发布前真实启动三份构建结果，各执行一次普通 `npm install -g`，再在新的 login shell
    用 `command -v` 解析二进制。至少覆盖 pnpm；Claude Code 分支额外确认 native `claude` 未被
    npm 路径遮蔽。

- [ ] **C. 发布次序**（版本方案见
  [预制环境 · 版本号跟着被装的 Agent 走](../docs/feature/sandbox/library/prebuilt-environments.md#版本号跟着被装的-agent-走)：
  tag 是 `<Agent 版本>-r<配方修订>`，三个 Agent 各自独立发版）
  - [ ] C1. 逐 agent 构建并发布：`pnpm tsx sandbox/e2b/build-agent-template.mts <agent>`
    （tag 由 `agentBaselineVersionTag()` 给出，当前是 `2.1.207-r2` / `0.144.1-r2` /
    `0.3.9-r2`），记录 Template ID / Build ID 与验证结果。
  - [ ] C2. 每发布并验证完一个 agent，就更新它在 `sandbox/e2b/published.json` 的条目与
    `src/sandbox/e2b-agent-template.ts` 的 `PUBLISHED_E2B_BASELINE_TAG`；不再等三份齐了才动，
    但也不能让某一项常量先指向尚未发布的 tag（`src/sandbox/official-baselines.test.ts` 守护）。
  - [ ] C3. 三份都换代后，移除 `sandbox/README.md` 与公开 Sandbox 教程里的
    `--prefix /usr/local` workaround 段落，并同步 `docs/source-map.md` 的已知差异条目。
  - [ ] C4. Docker 侧：确认 `main` 上的镜像 CI 已推出 `niceeval/<agent>:<Agent 版本>-r2`
    三份多架构 manifest（新 workflow 由基线配方变更触发，不再跟 `v*` tag）。

## 错误证据的配套边界

模板修复解决根因，不等于 renderer 能从 Eval 抛出的截断摘要里恢复字节。当前尚无独立失败命令
artifact，Eval 若只把 stderr 的 `.slice(-500)` 放进错误，读取面确实只剩这 500 字节；目标修法是
由公开 Sandbox wrapper 在完整 `CommandResult` 返回给 Eval **之前**登记非零命令的 stdout/stderr，
写进 `commands.json`，因此不受调用方随后截断摘要影响。实现按
[`plan/failed-command-evidence.md`](failed-command-evidence.md) 与
[`docs/error-feedback.md`](../docs/error-feedback.md) 的分层规则推进；不能用「TUI 摘要更聪明」
代替原始证据采集。

## 验收

1. 三份新模板内，普通用户执行 `npm install -g pnpm@10.34.5` 均成功，新的 login shell 可直接
   `command -v pnpm`。
2. 同一条安装 Eval 只换 Agent，不需要条件分支、sudo 或修改 shell rc。
3. 构建自检若发现 prefix、PATH、目录权限任一漂移，模板发布在 registry 写入前失败。
4. release 常量、published 记录、内部运维文档和公开教程指向同一组已验证制品。
