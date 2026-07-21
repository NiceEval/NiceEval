---
name: init-md-site-copy-symlink
description: site/public/INIT.md 是指向根 INIT.md 的 symlink，别再手动 cp
metadata:
  type: project
---

**现象**：改根 `INIT.md` 后，CI 的 `Package and site` job 里 `diff INIT.md site/public/INIT.md` 红灯，报 "out of sync"（2026-07-21 main 上因 refactor 提交漏同步而红过一次）。

**根因**：`site/public/INIT.md` 曾是根 `INIT.md` 的物理拷贝（Next 的 public 目录需要一个真实文件，`site:dev` / `site:build` 都读它）。两份需逐字相同，靠人手 `cp` 同步，容易忘。

**修法**：把 `site/public/INIT.md` 改成 symlink → `../../INIT.md`（`ln -sf ../../INIT.md site/public/INIT.md`）。git 记录 symlink，linux CI / mac dev 都能还原；`next build` 跟随 symlink 正常（已实测 build 通过）。根 `INIT.md` 成为唯一源，改它 site 副本自动跟着变，不用再 cp。CI 的 diff 检查保留作 backstop（symlink 被误替换成陈旧拷贝时报警），报错文案改成「重建 symlink」而非 cp。

**注意**：本仓库只跑 darwin/linux，symlink 可靠；Windows 不在支持范围。
