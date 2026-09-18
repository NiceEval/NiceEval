---
format: concord.document/v1
id: e2b-list-returns-paginator-not-array
title: e2b-list-returns-paginator-not-array
createdAt: 2026-07-18T17:37:45+08:00
createdAtSource:
  kind: first-recorded
  path: memory/e2b-list-returns-paginator-not-array.md
  commit: 0cef7946b085cf102fd9ac695cfa566ee8845637
description: reconcileProvision 把 e2b Sandbox.list() 当成同步返回 Promise<数组>
  来用,真实签名是同步返回 SandboxPaginator,for...of 直接炸 TypeError,导致对账(reconcile)硬失败、整批重试被
  abort
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
    statement: "- 已修
      [e2b-list-returns-paginator-not-array](e2b-list-returns-paginator-not-arr\
      ay.md) — `Sandbox.list()` 真实是同步返回 `SandboxPaginator`，不是 Promise
      数组；provision reconcile 与 detached keep inspect 都改为 `hasNext`/`nextItems()`
      翻页，避免将真机 TypeError 吞成错误的过期状态(`src/sandbox/e2b.ts`、`src/sandbox/keep.ts`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象**(2026-07-18,coding-agent-memory-evals 实跑 `niceeval exp compare`):大量 `sandbox-provision-reconcile-failed`,内层错误 `TypeError: sandboxes is not iterable`,provisioning 重试被直接 abort(不是原始的 `creating sandbox: fetch failed` 而是重试路径自己炸的次生失败)。

**根因**:`src/sandbox/e2b.ts` 的 `reconcileProvision` 用 `E2BSdkSandbox as unknown as { list?: (opts) => Promise<Array<...>> }` 手写了一个 e2b SDK 里从未真实存在过的签名。核对 `e2b` 包实际导出的类型(`node_modules/e2b/dist/index.d.ts`)、以及从 `e2b@2.0.0`(`package.json` 声明的 peerDependency 下限)到装的 `2.31.0` 的 `.d.ts`:`Sandbox.list(opts?)` 从始至终都是**同步**方法,返回 `SandboxPaginator`(要 `hasNext` + `await nextItems()` 翻页),不是 `Promise<数组>`。这不是 SDK 中途破坏性升级——是当初写这段代码时没 import 真实类型对照,直接猜了个形状用 `as unknown as` 绕过 tsc 检查;写的时候整个函数包在吞错的 try/catch 里(见 [[e2b-provision-429-duplicate-sandbox]] 修复前的版本),错误的类型假设从未真正跑通过,只是每次都静默失败、什么也没对账。`d895830`(记在 [[e2b-provision-429-duplicate-sandbox]])把这层吞错去掉、改成对账失败必须硬抛,这个设计意图本身是对的,但同一次改动没有对照真实 SDK 类型验证,才把潜伏的错误假设第一次真正打进生产重试路径。

**修法**(2026-07-18,修在 `src/sandbox/e2b.ts` 的 `reconcileProvision`; 2026-07-22 同步 `src/sandbox/keep.ts` 的 detached inspect):去掉 `as unknown as` 猜测类型,直接调用真实的静态方法 `E2BSdkSandbox.list()` / `E2BSdkSandbox.kill()`(两者签名已由包本身的 `.d.ts` 保证,不需要再手写 fallback 判断"这个版本有没有这个方法")。`Sandbox.list()` 支持服务端 `query.metadata` 过滤,直接传 `{ query: { metadata: { "niceeval-provision-token": token } }`,不用再拉全量列表在客户端按 token 比对;返回的 `SandboxPaginator` 用 `while (paginator.hasNext) { await paginator.nextItems() }` 翻页。detached inspect 用相同的 paginator 遍历查找 sandbox id；SDK/网络错误不再误报 `expired`，统一归状态未知。

**教训**:给第三方 SDK 写薄封装时,凡是包本身导出了类型,就必须 `import type` 真实类型对照检查,不要用 `as unknown as` 编一个"看起来合理"的形状——这种写法能骗过 tsc,但只是把运行时验证推迟到了触发那条代码路径的那一刻,如果那条路径长期被吞错保护(如本例的 try/catch),错误假设可以潜伏很久都不被发现。
