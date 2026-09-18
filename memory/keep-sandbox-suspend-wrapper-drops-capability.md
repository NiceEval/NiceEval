---
format: concord.document/v1
id: keep-sandbox-suspend-wrapper-drops-capability
title: keep-sandbox-suspend-wrapper-drops-capability
createdAt: 2026-07-22T18:19:59+08:00
createdAtSource:
  kind: first-recorded
  path: memory/keep-sandbox-suspend-wrapper-drops-capability.md
  commit: d5d069622fd6aba6b9d3db3accfb3326ccdf523b
description: normalizeSandboxPaths 包装丢了接口外的 suspend() 能力，--keep-sandbox 对
  docker/e2b/vercel 全部假成功真不停——真机跑通 docker
  全链路（keep→list→enter→history→diff→stop）才发现，mock 单测测不出这类拼接 bug
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
      [keep-sandbox-suspend-wrapper-drops-capability](keep-sandbox-suspend-wrap\
      per-drops-capability.md) — `normalizeSandboxPaths` 包装丢了接口外的 `suspend()`
      能力,`--keep-sandbox` 对 docker/e2b/vercel 三家全部假成功真不停(state 永远停 alive,只留一条
      warning);真机跑通 docker 全链路才发现,mock 单测互相拼不出这个 bug;修为按 `appendLog`
      先例原样转发(`src/sandbox/paths.ts`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象**：任何 provider 用 `--keep-sandbox` 跑完，run 摘要照常打印 `NICEEVAL kept ...`（看起来成功），但紧跟着总有一行诊断：

```
NICEEVAL warning key=sandbox-suspend-failed:<id> ... message="sandbox <id> kept but suspend failed; the instance is still running: sandbox provider has no suspend capability (sandboxId=<id>)"
```

登记项 `state` 永远停在 `"alive"`，从未真正转过 `"dormant"`——docker 容器一直没停（`docker ps` 能看到还在跑），e2b/vercel 同理会一直计费。这不是某个 provider 特有的问题，docker/e2b/vercel 三个内置 provider 全部一样，只是被一条 warning 日志盖住，进程本身不报错、不退出非零，非常容易被忽略成"provider 偶尔不支持"而不是当成 bug 排查。

复现方式：真实起一个 docker 沙箱跑 `niceeval exp ... --keep-sandbox=all`，然后用 `docker ps` 核对容器状态（不要只看 CLI 输出）。已有的 mock 单测（`src/sandbox/keep.test.ts`、`src/sandbox/paths.test.ts`）此前互不覆盖对方，各自都"测对了"，拼在一起却不对——这类 bug 只有真实端到端才会暴露。

**根因**：`src/sandbox/resolve.ts` 的 `createSandbox()` 用 `normalizeSandboxPaths()`（`src/sandbox/paths.ts`）包装刚创建出的 provider 实例后才登记/返回，runner 后续拿到的全是这层包装对象（包括 `src/runner/attempt.ts` 里 Scope release 阶段调 `suspendSandbox(sb)` 时的 `sb`）。`normalizeSandboxPaths` 返回一个全新对象字面量，只实现公开 `Sandbox` 接口的方法——而 `suspend()` 按设计（`docs/feature/sandbox/architecture.md`："`Sandbox` 接口不因留存扩大"）故意不在这个公开接口里，所以包装对象上根本没有 `suspend` 这个属性。`src/sandbox/keep.ts` 的 `suspendSandbox()` 靠运行时属性探测（`(sandbox as Partial<Suspendable>).suspend`）找这个方法——探测的对象永远是包装后的那个，不管底层 `DockerSandbox`/`VercelSandbox`/`E2BSandbox` 类本身是否实现了 `suspend()`，探测结果永远是 `undefined`，于是永远走 throw 分支，被 `attempt.ts` 捕获后降级成一条 diagnostic（不中断 run，只留警告）。

这个 bug 从 `suspend()` 这个能力方法被加进三个 provider 类那一刻起就存在，`normalizeSandboxPaths` 从未同步更新去转发它——纯粹的"新增能力，旧的包装层没跟上"疏漏，不是某次改动引入的直接回归。

**修法**：`src/sandbox/paths.ts` 的 `normalizeSandboxPaths` 现在按同一个实例探测 `suspend`，有就在返回对象上转发（`...(typeof suspend === "function" ? { suspend: () => suspend.call(sandbox) } : {})`），没有就彻底不出现这个 key——和已有的 `appendLog`（同样是"接口之外的可选能力，原样转发，不装饰不吞掉"）完全同一个模式。补的测试：`src/sandbox/paths.test.ts`（包装转发/省略 `suspend` 两个分支）、`src/sandbox/keep.test.ts`（`suspendSandbox` 自身"有能力就调用"/"没有就抛清晰错误"两个分支）。修在 commit `57e5af6`。

**适用场景**：给 `Sandbox` 之外新增一个非公开的可选能力方法时（`appendLog`、`suspend` 已经是两个），必须同步检查 `normalizeSandboxPaths` 是否转发了它——写扩展方法时顺手 grep 一下 `src/sandbox/paths.ts`，不要假设"实例创建出来之后一路原样传下去"。规划这类生命周期功能的验收步骤时，给真实端到端手测（不只是 mock 单测）留位置；手测时不要只看 CLI 的 summary/kept 输出显示"成功"就当验证通过，同时用 provider 自己的检查手段（`docker ps` 等）核对真实副作用——这类接口层面的"假成功、真失败"只会在诊断日志里留一行 warning。
