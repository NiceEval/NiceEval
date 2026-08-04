---
name: report-site-ci-build-needs-tmp-install-workaround
description: 下游仓库在 CI 里构建报告站要用「/tmp 装 niceeval+react + symlink node_modules 回仓库根」的 workaround,因为没有不依赖仓库自身 node_modules 的官方构建路径
metadata:
  type: project
---

发现(未修,2026-08-04):下游仓库要在 CI 里把 `.niceeval` 构建成静态报告站,又不想为此跑一遍
仓库自己的 `install`(评估用例相关依赖——Docker/E2B SDK、各家 model provider——体积大且与报告
构建无关),现状是自己写一份脚本:在 `/tmp` 建临时目录单独装 `niceeval@latest` + `react` +
`react-dom`,再 `ln -sfn` 把这份 `node_modules` 链接回仓库根,才能在仓库根跑
`niceeval view --record .niceeval --out site`(自定义 `--report` 时还要靠这个链接让 `tsx`
解析到 `import "niceeval/report"`)。真实例子见 MemoryBench 的
`scripts/vercel-build.sh`(在这个 workspace 内路径为
`/home/ctrdh/Code/NiceEval/MemoryBench/scripts/vercel-build.sh`)。

**根因**:niceeval 没有提供一条不依赖仓库自身 `node_modules` 的官方 CI 构建路径——`niceeval
view --out` 假定 `niceeval` 本身、`react`、`react-dom`(以及自定义报告文件的 import 图)已经
在当前项目可解析,没有反过来提供"只装报告构建这一小撮依赖"的入口。workaround 本身还有一处隐藏
坑:Vercel 的 build cache 会把上一次部署的 `node_modules` 原样恢复到仓库根,`ln -sfn` 对已存在
的目录会把链接建到目录内部而不是替换它,脚本必须先判断并清掉,否则每次构建都悄悄链接失败又不
报错(仍读到旧版 niceeval)。

**修法**:待设计。候选方向:①standalone 构建入口(例如一个只声明 `niceeval` + `react` +
`react-dom` 依赖、零其它 devDependency 的最小构建包/子命令,CI 可以单独 `npm i` 它而不碰宿主
项目 `node_modules`);②官方 CI 模板(把 `/tmp` 装包 + symlink 这套操作打成一条 `niceeval` 自带
的脚本或 GitHub Action,workaround 的坑由官方模板一次踩平,不用每个下游重新发现 build cache
那个陷阱)。本条先作台账,不阻塞落地——workaround 已经在 [`docs-site/zh/tutorials/deploy-report-site.mdx`](../docs-site/zh/tutorials/deploy-report-site.mdx)
写成正式教程,读者按文档能可靠复现,只是仍要在自己的 CI 里维护这份脚本,不是一条命令的官方入口。
