# 随包 INDEX.md 正文：手写任务表两连翻案为「打包时从 frontmatter 生成」

**日期**：2026-07-17。**触发**：用户先提议「mdx 加 description、INDEX.md 生成树状」，随后再纠正「是打包的时候 cp 进去 + 生成」。同一天内两次翻案，最终形态见 `docs/engineering/agent-docs/README.md`。

## 裁决

包根 `INDEX.md` 是**构建产物**（gitignore，不签入）：`prepare`（`pnpm run build:index`）在本地安装与发版 CI 的 install 时，读签入的 `INDEX.template.md`（手写导语 + 空 `bundled-docs-tree` 区块），把 `docs-site/zh` 各页 frontmatter `title`/`description` 拼成的文档树填进区块后写出——与 `dist/report/**`、发版时 runner 本地写 `package.json` 版本号同一个「源签入、产物现场生成」模型。守护是「可生成」而非「没漂移」：`test/docs-site/bundled-docs-index.test.ts` 用生成器纯函数在内存生成一次（缺 description 红灯、逐页校验非入口页不漏），prepare 在发布路径上是最后闸门。

## 曾选方案与否决理由（按翻案顺序）

1. **手写任务→页面表 + 覆盖方向守护**（当日上午定稿，plan 未实现即作废）：否决。① 「任务措辞不存在于 frontmatter」被实测推翻：51/51 页已有任务视角的路由级 description（docs-site/AGENTS.md 的任务标题纪律早已把措辞压进 frontmatter）；② 单源关系是反的：页面自述先在，手写索引行是复述，复述必然漂移，路径守护保证不了措辞同步；③ 跨页组合路由 agent 扫带自述的树可自行完成，人工表是纯维护成本。
2. **生成产物签入 git + vitest 漂移守护**（第一次翻案后的中间态，落地数小时即被用户纠正）：否决。签入论据「files 白名单要求文件在场」不成立——prepare 在打包前生成即可在场，`dist/report` 就是现例；「diff 可评审」对确定性生成物价值近零（真正该评审的是 mdx frontmatter 的 diff）；代价却是真实的：每次改页面都背「跑 pnpm docs:reference」的再生成义务 + 一条漂移守护，git 里多一份会脏的生成物。打包时生成把这两样全部消灭。
3. **「不新增生成脚本」反对生成**：不适用——挂进已批准的 `scripts/generate-reference.ts` 同一例外（文案单源在内容紧邻处、生成器只拼装），`build:index` 是 build 步骤（`build:report` 先例），不是守护脚本。

## 保留的相邻裁决

入口不变（包根 `INDEX.md` 单点路由，见 [ai-bundled-docs-root-index](ai-bundled-docs-root-index.md)）；页面级路由不做 anchor 级、不加第二个 frontmatter 字段（理由在 agent-docs 契约正文）。若 onboarding eval 显示 agent 路由质量不足，有证据时可在模板手写导语区补一张小的任务组合表——策展的回归条件，不是默认状态。
