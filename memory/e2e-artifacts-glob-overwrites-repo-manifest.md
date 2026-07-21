# e2e.json 的宽泛 artifacts glob 会把隔离副本的 package.json 拷回真实仓库

**现象**：在根仓库跑 `pnpm e2e --repo report`（或任意仓库）后，真实的
`e2e/<repo>/package.json` 被静默改写成指向一次性临时目录里的候选 tarball 路径，例如：

```
"niceeval": "file:/var/folders/.../niceeval-e2e-XXXXXX/tarball/niceeval-0.4.6.tgz",
```

`git diff` 能看到这一行变化；由于该临时目录在编排器结束时已被 `rm(scratchRoot,
{recursive:true})` 删除，下一次任何直接在该仓库目录里跑 `pnpm install` / `pnpm
e2e` / `pnpm run typecheck` 都会因为 tarball 路径不存在而报
`ENOENT ... open '.../tarball/niceeval-0.4.6.tgz'` 后 install 失败退出 254。

**根因**：`e2e/scripts/run.ts` 的 `runRepoOnce()` 只在**隔离副本**
（`scratchRoot/runs/<id>/attempt-N/`）里执行 `pointAtCandidateTarball()` 改写
`package.json`——这一步本身没问题，副本才应该指向候选 tarball。但收尾阶段
`collectArtifacts(copyDir, repo.dir, repo.manifest.artifacts)` 会把
`e2e.json.artifacts` 里声明的每个 glob 从隔离副本拷回**真实仓库目录**
（`repo.dir`），且拷贝逻辑对不含 `/` 的裸文件名 glob 是用
`globToRegExp` 转正则后匹配 `copyDir` 顶层的**全部**条目——`e2e/report/e2e.json`
当时声明的 `"*.json"` 会连带匹配到副本顶层的 `package.json`（连同
`tsconfig.json`，只是内容未变所以看不出来），于是被改写过的副本
`package.json` 原样覆盖回真实仓库，制造了一次「仓库自己产生的」manifest 污染。
这与 README §3.2「候选 tarball 覆盖该依赖，但不永久修改仓库 manifest 或
lockfile」的设计承诺相悖——承诺本身没问题，是 `report` 仓库自己的 `e2e.json`
把作为『一次运行证据』的 JSON 产物（`main.json`）和仓库自身的
manifest/配置文件用同一个过宽的 glob 混在了一起。

其它已有仓库（`e2e/cli`、`e2e/adapter/*`）从未踩到这个坑，因为它们的
`artifacts` 字段从来只写显式文件名（`junit.xml`、`junit/**`），不用 `*.xml`/
`*.json` 这类会命中仓库自身配置文件的通配符。

**修法**：`e2e/report/e2e.json` 的 `artifacts` 字段从 `["*.xml", "*.json", ...]`
改成显式列出该仓库真正产出的证据文件名：`"main.xml"`、`"fail.xml"`、
`"error.xml"`、`"main.json"`（另加新增的 `"site-export/**"`，见
`docs/engineering/testing/e2e/report.md` 的 `view --out` 导出目录约定）。同时把
这四个文件名和 `site-export/` 一起加进 `.gitignore`（此前只忽略了
`.niceeval/`，这四个顶层证据文件此前是未忽略的 untracked 状态，存在被
`git add -A` 误提交的风险）。

**适用场景**：任何 E2E 仓库编写 `e2e.json.artifacts` 时，裸文件名 glob
（不含 `/` 的那一类）会按 `run.ts` 的 `collectArtifacts()` 逻辑匹配隔离副本
**顶层的任意文件**，不只是仓库自己产出的证据——`package.json`、
`pnpm-lock.yaml`（如果哪天允许 `.yaml` 通配）、`tsconfig.json`、`.env.example`
等仓库自带的顶层文件都在潜在命中范围内。新增/复制一个仓库时优先用显式文件名或
`dir/**`，只有确定该仓库顶层不存在同名 checked-in 文件时才考虑用通配符。

若要根治（不在本次改动范围内，未做）：`collectArtifacts()` 可以改成排除
`repo.dir` 里已作为 checked-in 文件存在的路径（即已被 git 跟踪的文件不应被
「证据回收」逻辑覆盖），或者干脆要求 `artifacts` 字段禁止裸 glob、只接受
`dir/**` 与显式文件名——这是根仓库编排器（`e2e/scripts/run.ts` +
`discovery.ts` 的 schema 校验）的改动，属于另一个任务范围。
