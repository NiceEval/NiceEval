# Package 场景 Repo

这个功能 Repo 当前用 CommonJS consumer 证明安装边界，不依赖任何 Adapter package；以后 ESM、无 `type` 与 exports case 继续增加测试文件，
不再按 module mode 创建更长的 Repo ID。根 runner 把候选 tarball 安装到这里，而不是在 test 中另造一个没有安装
NiceEval 的 `/tmp` 项目。它刻意没有预置 `niceeval.config.ts`、`evals/` 或 `experiments/`：测试的对象就是
`niceeval init` 生成的 TypeScript config 能否被紧接着的 `niceeval list` 装载。

```sh
pnpm e2e --repo package -- --run test/commonjs-init-list.test.ts
cd <isolated-repo> && pnpm test --run test/commonjs-init-list.test.ts
```
