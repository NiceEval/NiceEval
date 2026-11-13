# Codex native apply_patch is unavailable in login shells

## 观察与期望

真实 Codex CLI 在 Debian 登录 shell 中执行 `apply_patch` 时出现 `command not found`。Codex 临时 arg0 目录已注入环境 PATH，但 `bash -lc` 会重置 PATH。Agent 额外搜索补丁工具或退回其它命令。

`codexAgent` ensure 完成后，Agent 用户的 `bash -lc 'command -v apply_patch'` 应成功，且命令应为锁定 Codex 自带的补丁工具，接受 `*** Begin Patch` 格式。

## 复现与影响

在 `node:24-slim` 本地 Docker 容器中，把指向 Codex 原生二进制的 `apply_patch` 链接放到临时目录并预置 PATH。`bash -c` 找到它，`bash -lc` 找不到。Codex `0.144.1` 与 `0.167.2` 均复现；把链接放进现有 `/usr/local/bin` 后两版都能应用原生补丁。

正式回归经过安装后 Library/CLI 的真实 `codexAgent` ensure，使用非 root Docker 用户，不调用模型。

## 身份与来源

NiceEval main，Feature 基线 `2e78812fc`，包 `0.0.0-development`，Linux、Node 24、pnpm 11。来源：NiceEval-Eval dogfood 父 agent 的复现与本地 Docker 独立核验。观察已脱敏，不含 secret、私有文件内容或漏洞细节。2026-11-12 搜索全部 open/closed Issues，未发现相同项。
