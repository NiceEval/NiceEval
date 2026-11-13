# codexAgent 在版本已满足时仍重新上传整份发行包

Sandbox 里已有锁定版本的 Codex CLI，但 `codex` 指向 npm 的 JS 启动器时，`codexAgent` 的 ensure 判定未安装，并为每个 Attempt 重新上传整份发行包。

## 观察

2026-11-13 在 NiceEval-Eval 运行 24 格（并发 10，Instabox）。快照里用 `npm install -g @openai/codex@0.167.2` 预装了锁定版本，
`~/.local/bin/codex → /usr/local/bin/codex → …/@openai/codex/bin/codex.js`，没有 `apply_patch` 链接。

- `niceeval invocation show <id>`：10 个 Attempt 全部停在 `agent.ensure`，detail 为 `installing official OpenAI Codex CLI 0.167.2`，超过 12 分钟没有一格进入 `agent.run`。
- 宿主 `niceeval exp` 进程常驻内存约 4.5 GiB，10 条 HTTPS 连接各自只发出 50–75 MB；发行包 `openai-codex-0.167.2-linux-x64.tgz` 为 174 MB。
- Sandbox 内 `codex --version` 已经是 `codex-cli 0.167.2`。

## 期望

- 版本已满足、只缺原生二进制链接时，ensure 在 Sandbox 内补链接，不重新上传发行包。
- 探测未命中时，live detail 与 `invocation show` 说明未命中的原因（哪一项检查不满足），而不是只显示“installing”。
- 多个 Attempt 同时需要同一份发行包时，宿主不把它在内存里各持有一份。

## 下游处理

NiceEval-Eval 已在自己的准备脚本里把 `codex` 与 `apply_patch` 都指向原生二进制（提交 `fix(sandbox): point preinstalled codex and apply_patch at the native binary`），所以它不再受影响；其它用 npm 预装 Codex 的项目仍会遇到。

## 来源

NiceEval-Eval dogfood，NiceEval main `4ecfb7738`，Linux、Node 24、pnpm 11、Instabox `universal` 模板。公开观察，不含凭据。
与 roadmap 中“缓存 agent 安装、解释探测未命中”的方向相关，这里补的是一次真实运行的证据。
