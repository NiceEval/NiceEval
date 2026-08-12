---
title: 'E2E run 输出的 candidate 路径在命令结束后已被删除'
severity: 'minor'
---

## Expected Behavior

`pnpm e2e --repo eval -- ...` 输出 candidate tarball 路径后，该路径应可供紧接着的 `pnpm e2e takeover --candidate <path>` 复用；或者输出应明确标注它会被清理，并给出生成持久 candidate 的下一步命令。

## Current Behavior

普通 E2E run 打印 `/tmp/niceeval-e2e-default-*/candidate.tgz` 和 fingerprint，并在 summary 里重复该路径。命令成功结束后对应临时目录已删除；把打印出的路径传给 takeover 立即得到 `ENOENT`。

## Possible Solution

需要 takeover 的 run 可保留 candidate，或把 candidate 复制到 durable artifact root；若仍清理，则不要把临时路径表现成可复用交接物，并在 summary 提示先运行 `pnpm e2e pack --out <持久路径>`。

## Minimal Reproducible Example

先运行 `pnpm e2e --repo eval -- --run test/assertion-score.test.ts`，记录输出的 candidate path。随后运行 `pnpm e2e takeover --candidate <该路径> --repo eval -- --run test/assertion-score.test.ts`，观察 `ENOENT: no such file or directory`。

## Context

修改既有 Eval E2E owner 后按 testing 契约执行 deterministic takeover 时复现。首轮 E2E 本身 clean pass；只有从其输出接续 takeover 的路径失效。
