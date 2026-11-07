# CI 文本脱敏破坏 SQLite 诊断 artifact

## 观察

2026-10-17 的 [nightly E2E run 39015222188](https://github.com/NiceEval/NiceEval/actions/runs/39015222188) 中，`repo-batch-docker-9` 的 OpenCode 真实运行失败后上传了 Record，但公开 `niceeval query run --record ... --request -` 返回 `inspection-source-invalid`，原因为 `database disk image is malformed`。该 cell 的脱敏步骤报告替换 4 次。`repo-batch-docker-8` 的 OpenClaw cell 报告替换 15 次，并留下带 WAL 的未完成 Record；不能将其视为可移植的单文件输入。

## 已确认机制

`.github/workflows/e2e.yml` 的 `Redact secrets in artifactRoot` 对全部文件执行 `readFileSync(abs, "utf8")`，命中注入值时以 UTF-8 文本重写。SQLite、WAL 和 tarball 都在遍历范围中。二进制解码可丢失字节，文本替换还会改变数据库字段长度与页偏移；不能把脱敏后的损坏文件当成原始运行证据。

## 边界与后续

此问题阻碍失败诊断，不是该 run 中 adapter 非零退出或超时的原因。当前尚未修复。需要按 artifact 格式处理敏感内容，并保持上传前的保密要求；不能简单跳过二进制扫描后上传原文件，也不能将损坏的记录修补成验收收据。验收应同时证明秘密值不出现在可下载 artifact 中，以及保留的 Record 仍能通过公开 Query 读回。
