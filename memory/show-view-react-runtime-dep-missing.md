---
format: concord.document/v1
id: show-view-react-runtime-dep-missing
title: show / view 全新安装必崩:react 是可选 peerDep(已修)
createdAt: 2026-07-24T12:53:11+08:00
createdAtSource:
  kind: first-recorded
  path: memory/show-view-react-runtime-dep-missing.md
  commit: 67bacc46e6afb2b23e4b66496dc51d137ed41ee6
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
    statement: "# show / view 全新安装必崩:react 是可选 peerDep(已修)"
    proof: []
    source:
      path: memory/show-view-react-runtime-dep-missing.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:41f8fd98e565a7cd4f8965b62a560ab3eb00f4525d1059932498fb2ae3d6969e
---
# show / view 全新安装必崩:react 是可选 peerDep(已修)

**现象**：全新安装 niceeval 的项目里跑 `niceeval show` / `view` 直接 `ERR_MODULE_NOT_FOUND: react`——`dist/report/built-in/standard.js` 顶部 `import … from "react/jsx-runtime"`,但装不到 react。真机复现于两个沙箱里 agent 自己的 `show`、以及 harness 的 evalAdapter 取证。本地仓库能跑纯属环境里恰好有 react(dev 依赖)。pnpm 消费方尤其必崩。

**根因**：`react` / `react-dom` 曾登记为 **`peerDependencies` 且 `peerDependenciesMeta.optional = true`**。pnpm 不自动装 peer,optional 又压掉告警——消费方磁盘上根本没有 react。但 report 的 web 面(`show`/`view`)是 `renderToStaticMarkup`(`react-dom/server`)渲染静态 HTML 的核心路径(`src/report/runtime/web.ts`),对 react 是硬运行时依赖。「react 只是可选 peer,CLI 核心不硬依赖它」这个旧假设只对 **live 面板**(无 react 的同步纯函数 text 面)成立,对 show/view 不成立。

**修法**（`package.json`）：把 `react` / `react-dom` 从 `peerDependencies` + `peerDependenciesMeta` 移入 **`dependencies`**（`^19.0.0`),并从 `devDependencies` 删掉重复登记(版本单源在 dependencies)。全新安装即带 react,show/view 不再崩。`docs/cli.md`「为什么不引 ink」一节顺手改掉「react 只是可选 peerDependency」的错误论据——保留 live 面板不走 reconciler 的架构理由,并写明 report web 面本就以 react 渲染。

**适用场景**:任何随包发的 React 组件在 CLI 核心路径被 SSR 到 HTML 的库——它对 react 是 dependency 不是 peer。嵌入自有 React 页面(`niceeval/report/react`)的高级用法靠包管理器 dedupe 与自己的 react 共存。相关 [[linked-consumer-stale-dist-report]]、[[react19-dangerously-set-inner-html-identity]]。
