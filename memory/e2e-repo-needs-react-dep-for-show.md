# 无前端的 E2E 测试仓库跑 `niceeval show` 报 `Cannot find package 'react'`

**现象**：`e2e/repos/pi-agent-core`（纯后端 + adapter，没有任何前端代码）经根编排器注入候选 tarball 后，`pnpm exec niceeval exp ci --force` 正常跑完并 4/4 passed，但紧接着裸 `pnpm exec niceeval show`（不带 `--report`）直接崩：

```
niceeval error: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'react' imported from
.../node_modules/niceeval/dist/report/built-in/standard.js
```

本机独立安装(未注入候选、走 registry 发布的 `niceeval@0.9.1`)时同一条命令不报错——一度怀疑是候选 tarball 本身的问题,但两份 `dist/report/built-in/standard.js` 内容完全一致(都 `import ... from "react/jsx-runtime"`),说明不是候选包坏了,是**这个测试仓库自己没装 react**导致的資源缺失偶然被本机残留的其它 node_modules 掩盖过一次,不是版本差异。

**根因**：`niceeval` 的裸 `show`/`view` 默认走内建 React 报告(`dist/report/built-in/standard.js`),但 `package.json` 只把 `react`/`react-dom` 声明成**可选 peerDependency**(`peerDependenciesMeta.react.optional: true`),`dist/report/**` 只是 `tsc` 转译产物、并未把 react 打包进去。消费方项目不装 react 就用不了默认报告。examples/zh 下的 tier1 示例从没暴露过这个坑,是因为它们本来就为自己的 demo 前端装了 `react`/`react-dom`,顺带满足了这个 peer dep——这掩盖了它是一条通用契约而非那几个示例的偶然巧合。任何没有前端的 E2E/consumer 仓库都会撞上。

**修法**：`e2e/repos/pi-agent-core/package.json` 的 `dependencies` 里显式加 `"react"` 与 `"react-dom"`（版本对齐 root `devDependencies` 的 `^19.2.7`即可，只要满足 `peerDependencies` 声明的 `>=18`）。适用场景：任何要在验收脚本里跑 `niceeval show` / `view`（含默认内建报告）且自身没有前端依赖的测试仓库或用户项目，都要显式加这两个依赖,不能指望 npm/pnpm 自动帮你满足"可选"peer。
