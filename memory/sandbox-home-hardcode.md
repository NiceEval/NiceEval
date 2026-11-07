# Sandbox $HOME 不能 hardcode

**现象**：bub agent 在 Vercel sandbox 上出现 `$HOME/.local/bin/bub: No such file or directory`。

**根因**：`BUB_HOME` 和 `BUB_CHECKPOINT_PATHS` 硬编码了 `/home/node`（Docker sandbox 的用户 home），但不同 sandbox backend 的 Linux 用户不同（Vercel 是 `/home/vercel-sandbox`）。checkpoint tar 里嵌入的是绝对路径，解压后文件在 `/home/node/...`，而 `$HOME` 展开成 `/home/vercel-sandbox/...`，路径错位。

**修法**：在 agent `setup()` 里用 `printf '%s' $HOME` 检测实际 home，存入 `Map<sandboxId, home>` 闭包变量供 `send()` 使用；checkpoint 路径和磁盘缓存 key 都带上 home，避免不同 sandbox 共用同一份缓存。不应有 `if (backend === 'vercel')` 之类的分支，对所有 backend 一视同仁。

已修复：`src/agents/bub.ts`（2026-06-30）
