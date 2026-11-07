# 工作树 link 消费读到旧 INDEX.md 与旧版本号

## 现象

下游以本地路径消费 niceeval 工作树(2026-07-30):包根 `INDEX.md` 列出已删除页
(`tutorials/local-iteration.mdx` 读了 ENOENT)、缺三篇新教程与 examples/ 整组;
`--version` 报 0.4.6,远落后于实际代码。

## 根因

两者都不是生成器 bug。`INDEX.md` 是 `prepare` 时点的构建产物,树按文件系统枚举生成,
不可能列出不存在的页——读到旧树只说明自上次 `pnpm install` 后页面又改过。版本号是
Release 契约的副作用:CI 在 runner 本地写版本号、不回写仓库,工作树 `package.json`
永远停在很旧的值。`dist/report/**` 同形:link 消费改 report 源码要先 `pnpm run build:report`。

## 修法

契约已落:docs/engineering/agent-docs/README.md「维护与验收」写明 link 消费前先
`pnpm install` 或 `pnpm run build:index`。版本号不改——发版不回写是有意设计,
工作树的 `--version` 输出不作为代码新旧的依据。
