# Published niceeval package is about 108 MB per install

## 观察

`niceeval@0.21.0` 安装后包目录约 108 MB：

- `node_modules/`（来自 `bundledDependencies`）约 75 MB，其中 `effect` 62 MB；被打包的依赖无法与使用方项目的同一依赖共用，也无法被 pnpm store 去重。
- `dist/` 中 `.map` 约 28 MB、`.d.ts` 约 23 MB；`packages/niceeval/vite.config.ts` 设置了 `sourcemap: false`，但发布产物仍包含 `.map`。

每个安装 NiceEval 的项目都承担这部分体积；下游校准时多份安装合计占用数 GB。

## 期望

查清 `bundledDependencies` 的理由（是否为保证 CLI 与项目共享同一份 effect 运行时），评估改为普通依赖或 peer 依赖后的体积与运行时重复加载风险；发布产物不包含未被使用的 source map。给出改动前后的安装体积。
