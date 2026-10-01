---
format: concord.document/v1
id: e2b-putcontent-root-owned-nested-directory
title: e2b-putcontent-root-owned-nested-directory
createdAt: 2026-08-02T15:18:14+08:00
createdAtSource:
  kind: first-recorded
  path: memory/e2b-putcontent-root-owned-nested-directory.md
  commit: 0d24186331cc787226bccdc99c515ff8b7f331a6
description: E2B prepare 的 putContent 在 root-owned 目标下只写入顶层文件，嵌套目录 mkdir 以默认用户执行并因 Permission denied 中止
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [e2b-putcontent-root-owned-nested-directory](e2b-putcontent-root-owned-nested-directory.md) — E2B prepare 的 registered directory 快照完整,但 `putContent()` 在 root-owned 目标下用默认用户 mkdir 嵌套目录而 Permission denied,现场只剩顶层文件;修为仅对明确权限拒绝的幂等 mkdir 用 root 重试"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象**：Terminal-Bench 的 `recover-obfuscated-files` 把 folder-local `fixture/` 登记后，
在 E2B prepare 里送到 `/tmp/niceeval-install-fixture`。`install.sh` 与顶层 NOTE 已存在，
`setup_files/` 及其两个文件却完全缺失，随后 install.sh 的 glob copy 以 exit 1 结束。

真实 E2B 诊断确认 `registeredSandboxContentSnapshotOf()` 已包含 `setup_files` 和全部嵌套字节；
传输也成功写完两个顶层文件。失败点是下一步
`mkdir -p /tmp/niceeval-install-fixture/setup_files`，不是目录扫描、digest 或缓存。

**根因**：调用方刚用 `{ root: true }` 执行
`rm -rf /tmp/niceeval-install-fixture && mkdir -p /tmp/niceeval-install-fixture`，所以父目录是
root-owned 755。`putContent()` 的文件走 E2B Files API，仍能写进这个目录；目录 entry 却走
默认 sandbox user 的 `mkdir -p`，创建第一层子目录时得到 Permission denied。于是现场看起来像
“目录没有递归登记”，实际是递归兑现走到了第一个受权限限制的目录命令后中止。

**修法**：`src/sandbox/operations.ts` 的内容目录创建先以默认用户执行，保持普通 workdir fixture
可编辑；只有 command-exit 的 stdout/stderr 明确是 Permission denied 或 Operation not permitted
时，才以 `{ root: true }` 重试同一条幂等 `mkdir -p`。其它错误原样抛出，不把路径、transport
或取消错误误判成提权需求。

回归测试在 `src/sandbox/operations.test.ts` 构造 root-owned 目标与两层嵌套目录，逐项核对
目录路径和文件字节，并要求第一层权限拒绝后发生 root 重试。真实 E2B 的同一 oracle 随后从
prepare errored 变为 1 passed。
