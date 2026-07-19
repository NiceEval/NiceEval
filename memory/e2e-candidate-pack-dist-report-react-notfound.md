---
name: e2e-candidate-pack-dist-report-react-notfound
description: 无前端 E2E 仓库跑 niceeval show 报 Cannot find package 'react'（dist/report/built-in/standard.js）——react/react-dom 是可选 peerDependency，file: 候选包注入不会像 registry 安装那样自动装 peer，消费方必须自己显式声明这两个依赖（首轮误判为并发 pnpm pack 撞车，已被字节级比对推翻，见文末修正）
metadata:
  type: project
---

**现象**(2026-07-18):`pnpm e2e --repo claude-agent-sdk` 里真实 `ci` 实验（3 条 Eval，真实 DeepSeek 调用）全部 `passed`，JUnit 干净；但验收脚本紧接着调用 `niceeval show` 时崩:

```
niceeval error: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'react' imported from
.../niceeval@file+.../node_modules/niceeval/dist/report/built-in/standard.js
```

`e2e.ts` 因此把这次跑判成 regression(exit 1),尽管协议路径和全部 Eval 断言都是真的通过的——失败面只在 CLI 读回这一步。

**根因(推测,未做多进程复现实验,证据为间接)**:`react` 在根 `package.json` 里是 `devDependencies` + 可选 `peerDependencies`(`peerDependenciesMeta.react.optional = true`),核心 CLI(尤其纯终端的 `show`)按契约不该依赖它;但 `dist/report/built-in/**` 是 `pnpm run build:report`(`tsc -p tsconfig.report-build.json`,纯转译不打包)编译出的产物,若源码里某个内置 report face 确实 `import` 了 react,编译产物就会带一条真实的 `import ... from "react"`——consumer 不装 react 就地雷。

比对时间戳发现这次候选包对应的 `dist/report/` 里,`aggregate.js`/`components.js` 等文件是"当次" `pnpm pack`(触发 `prepare` → `build:report`)重新生成的新鲜文件,但 `built-in/` 子目录明显更旧(差了一整天)——像是没被这次构建完整重写。当时任务看板里 `ai-sdk`/`codex-sdk`/`pi-agent-core`/`langgraph`/`results-contract`/`cli-contract` 等多个仓库同时标 `in_progress`,大概率是多个 agent 并行各自 `pnpm e2e --repo <id>`,每个都在同一个根 checkout 上跑 `pnpm pack`(触发同一份 `prepare`/`build:report`),对共享的 `dist/report/**` 目录并发读写——`built-in/` 的陈旧状态与"多个 tsc 编译进程同时写同一目录"的竞态高度吻合。

**验证**:同一批 3 条 Eval 换成发布版 `niceeval@0.9.1`(不经候选 tarball 注入,直接 `pnpm install`)在本地复跑一遍——`niceeval show` / `show --history` / `show <locator> --execution` / `show <locator> --timing` 全部正常,没有 react 报错。说明这不是"claude-agent-sdk 仓库写错了什么",也不是 0.9.1 发布版本身的缺陷,问题面缩小到"这次编排器构建出的候选 tarball"。

**修法**:未定位到确定性根因,未修。规避方式:候选包注入验证失败时(表现为 `niceeval show` 之类的读面命令报 `dist/report/**` 缺依赖),先怀疑并发 `pnpm pack` 撞了共享 `dist/report/`,而不是怀疑自己仓库的 Eval/adapter 写错——用发布版本(`^0.9.1`)在本地单独复现同一批真实结果,能过就说明协议路径本身没问题,只需等其它并行 agent 的 `pnpm pack` 让开、重跑编排器一次。真正的根因排查方向(留给后续复盘):`build:report` / `prune-report-dist.mjs` 要么改成对并发安全(每次构建写独立临时目录再原子替换),要么 `e2e/scripts/injection.ts` 的 `buildCandidateTarball` 在多仓库矩阵场景下应该互斥或复用同一份已构建产物,不应该让每个仓库的编排调用各自触发一次完整的根仓库 `pnpm pack`。

---

**补充复盘(pi-agent-core 仓库,同日)**:并发构建竞态不是根因,是巧合的时间戳掩盖了真正原因。直接把当次候选 tarball 的 `dist/report/built-in/standard.js` 与 `npm pack niceeval@0.9.1` 拉下来的同名文件逐字节比较,两者开头都是同一行 `import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";`——**发布版和候选包的产物在这一点上完全一致**,不存在"候选包这次被撞坏、发布版没坏"的差异。`build:report` 只是 `tsc` 转译(见 `tsconfig.report-build.json` 注释,不打包),`dist/report/**` 从来就没打算把 `react` inline 进产物;`react`/`react-dom` 在根 `package.json` 里是**可选** peerDependency(`peerDependenciesMeta.react.optional = true`)。

真实差异在于安装路径:直接 `pnpm install niceeval@^0.9.1`(走 registry 正常 semver 解析)时,pnpm 默认的 `auto-install-peers` 会把可选 peer 一并装上,消费方即使自己 `package.json` 没写 react 也侥幸能跑;而候选包是通过 `file:<tarball>` 注入的本地依赖,同一台机器上如果消费方项目本身没有显式声明 `react`/`react-dom`,不能指望这条自动装 peer 的路径同样兜底(至少在 pi-agent-core 仓库上实测:同一个 `--force` 过的真机结果,补上 `"react"`/`"react-dom"` 依赖后 `niceeval show`/`--history`/`--execution`/`--timing` 全部一次性通过,不需要重跑 `pnpm pack`、不需要等其它 agent 让开)。

**结论与修法(已验证生效)**:任何要在验收脚本里跑 `niceeval show` / `view`(含裸命令,不只是 `--report`)的消费方项目,不管走 registry 还是候选 tarball 注入,都应该在自己的 `package.json` 里显式加 `"react"` + `"react-dom"`(满足 `peerDependencies` 声明的 `>=18` 即可),不要依赖"这次 install 走的是不是会自动补 peer 的路径"这种运气。遇到同样报错时,先检查自己仓库的依赖清单缺不缺 react,而不是先怀疑候选包被并发构建撞坏——后者目前没有任何字节级证据支持。详见 [e2e-repo-needs-react-dep-for-show](e2e-repo-needs-react-dep-for-show.md)。
