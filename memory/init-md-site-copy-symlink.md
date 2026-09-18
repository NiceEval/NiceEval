---
format: concord.document/v1
id: init-md-site-copy-symlink
title: init-md-site-copy-symlink
createdAt: 2026-07-21T17:42:02+08:00
createdAtSource:
  kind: first-recorded
  path: memory/init-md-site-copy-symlink.md
  commit: 16456737227609aa1096778c137daa81c36390aa
description: site/public/INIT.md 是指向根 INIT.md 的 symlink，别再手动 cp
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [init-md-site-copy-symlink](init-md-site-copy-symlink.md) —
      `site/public/INIT.md` 曾是根 `INIT.md` 的物理拷贝,靠手动 cp 同步,忘了就 CI diff 红;改成
      symlink → `../../INIT.md`,根文件成唯一源、site build 跟随,不再手动 cp,diff 检查保留作
      backstop"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象**：改根 `INIT.md` 后，CI 的 `Package and site` job 里 `diff INIT.md site/public/INIT.md` 红灯，报 "out of sync"（2026-07-21 main 上因 refactor 提交漏同步而红过一次）。

**根因**：`site/public/INIT.md` 曾是根 `INIT.md` 的物理拷贝（Next 的 public 目录需要一个真实文件，`site:dev` / `site:build` 都读它）。两份需逐字相同，靠人手 `cp` 同步，容易忘。

**修法**：把 `site/public/INIT.md` 改成 symlink → `../../INIT.md`（`ln -sf ../../INIT.md site/public/INIT.md`）。git 记录 symlink，linux CI / mac dev 都能还原；`next build` 跟随 symlink 正常（已实测 build 通过）。根 `INIT.md` 成为唯一源，改它 site 副本自动跟着变，不用再 cp。CI 的 diff 检查保留作 backstop（symlink 被误替换成陈旧拷贝时报警），报错文案改成「重建 symlink」而非 cp。

**注意**：本仓库只跑 darwin/linux，symlink 可靠；Windows 不在支持范围。
