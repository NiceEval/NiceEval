# e2e/report 仓库里用 HEAD 的 bin/niceeval.js 跑自定义 --report 文件,locator 深链静默丢失

## 现象

在 `e2e/report/`(独立 workspace,自己的 `node_modules/niceeval` 是已发布版本)里,用
`node /path/to/niceeval-checkout/bin/niceeval.js view --report reports/x.tsx --out <dir>`
（HEAD 的入口,cwd 在 e2e/report 下,方便快速迭代不用整套 `pnpm e2e --repo report` 编排)导出静态
站点,`AttemptList`/`ExperimentList` 里的 locator 全部渲染成纯 `<span class="nre-locator">`,没有
`<a href="attempt/...html">`——即使报告确实声明了 `input:"attempt"` 的 page。换成
`pnpm exec niceeval view --report reports/x.tsx --out <dir>`(仍在 e2e/report 目录下,但走这个
仓库自己 `node_modules/.bin/niceeval`)立刻正常出现 `<a>` 深链。连裸 `view`(不带 `--report`)用
HEAD 的 bin 也是好的——只有同时满足「HEAD 的 bin」+「用户自定义 `--report` 文件」两个条件才复现,
连 `extends: standard` 这种几乎不改内容的报告文件也会触发。

## 根因

`report-build-rootdir-and-module-identity` 条目记过「raw src 与 dist 编译产物是两个模块实例,
`activeWebContext` 这类模块级可变状态跨实例不可见」——这次是同一类问题的更极端版本。`--report`
文件本身要 `import { Grid, AttemptList, ... } from "niceeval/report"`,Node 的裸模块说明符解析
按**被加载文件自己的位置**找 `node_modules`:文件在 `e2e/report/reports/x.tsx` 下,`niceeval/report`
解析到的是 `e2e/report/node_modules/niceeval`(已发布版本自己的 `dist/report/**`)。但用 HEAD 的
`bin/niceeval.js` 启动时,CLI 自身内部(`src/report/runtime/host.ts`/`web.ts`)相对路径 import 的是
**checkout 仓库自己的** `dist/report/**`。两份物理上完全不同的 `dist/report` 各自持有一份
`activeWebContext` 模块级变量:host 侧 `runWithWebContext` 设置的是 checkout 仓库那份实例的状态,
但 `AttemptList` 组件读 `ctx.attemptHref` 走的是 e2e/report 自己 `node_modules/niceeval` 那份实例
——互相看不见,`hrefOf()` 拿到 `undefined`,静默退化成纯文本,不报错不崩溃。

`pnpm exec niceeval` 不会出这个问题:它解析到的 CLI 入口本身就在 e2e/report 自己的
`node_modules/niceeval/bin/`,同一个包内部相对 import 与用户报告文件的 `from "niceeval/report"`
天然指向同一份 `dist/report/**`,只有一个模块实例。真实的 `pnpm e2e --repo report` 编排流程
(把仓库拷到隔离临时目录、把 candidate tarball 注入该目录自己的 `node_modules/niceeval`)同样天然
自洽,不会触发这个问题——受影响的只是「HEAD checkout 的 bin 越过自己的 node_modules 边界,直接
渲染另一个目录里用户自己 `node_modules/niceeval` 的报告文件」这一种混用姿势。

## 修法

给 e2e 仓库(或任何独立项目)里的 `--report` 文件做本地渲染 smoke test,一律用
`pnpm exec niceeval`(或该仓库自己 `node_modules/.bin/niceeval`),不要图省事直接
`node /path/to/niceeval-checkout/bin/niceeval.js`——后者只对**不消费 `niceeval/report` 导出的
命令**(裸 `show`/`view`、`exp` 等不需要装载用户 `.tsx` 报告文件的路径)安全;一旦命令要装载
`--report <file>`,report 文件自己的模块解析边界就把这条捷径撅断了。日常在
`memory/e2e-report-dev-loop-pnpm-link-pollutes-workspace-yaml.md` 记过的「用 HEAD 的 bin 免安装
迭代」技巧对纯 CLI-black-box 断言(不涉及自定义报告组件)依然成立,只是多这一条例外:凡是新建/
修改 `--report` 文件本身,验证渲染效果要切回 `pnpm exec niceeval`,拿到的行为才能代表真实
`pnpm e2e --repo report` 编排环境里会发生的事。

适用场景:任何 e2e 仓库新增/修改 `.tsx` 报告文件后本地冒烟(B5 新增 `e2e/report/reports/*.tsx` 时
踩到,深链/过滤/折叠这类渲染面断言一度全部静默失败,排查半天才定位到是用错了本地入口,不是报告
文件本身的 bug)。
