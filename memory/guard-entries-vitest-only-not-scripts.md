# 守护入口裁决:说红绿的一律 vitest,写产物的才是脚本

**裁决**(2026-07-26):一条仓库约束只能有一个入口说它红。`scripts/` 里同时干「检查」和
「生成」两件事的,检查那一半导出成不打印、不退出的纯函数交给 `test/` 下的 vitest 调用,
生成那一半保留命令行。据此删掉 `pnpm docs:lint` 与 `pnpm tiers:check` 两个 script,
并把只存在于 `ci.yml` 里的 `diff INIT.md site/public/INIT.md` 搬成 `test/unit/` 的断言。

**曾选方案 / 否决理由**:

- **保留 `docs:lint` 作独立命令**,理由是「逐处命中要连改用什么、为什么一起打给作者,
  这是 vitest 断言给不出的」(这条曾写进 CLAUDE.md 当已批准例外)。否决:`expect` 的
  message 参数原样完整打印,不截断也不被 diff 淹没——把 `toEqual([])` 换成
  `expect(n, detail).toBe(0)`,diff 只剩 `0 → 3` 一行,详报全在 message 里。理由不成立。
- **把台账做成 file snapshot 取代棘轮**。否决:snapshot 语义是相等,`-u` 会把「变大」
  一起接受,而这份台账的全部价值是只许变小。
- **`typecheck` / mint 的 `docs:validate` 也并进三个入口**。否决:检查对象不同,各一个
  入口不违反 one way;mint 要 LTS Node 且每次拉 `mint@latest`,并进代码侧会给全部单测
  强加网络依赖。

**反直觉的一点(先否决又推翻自己)**:棘轮和 `vitest -u` 不冲突,前提是**顺序**——

```ts
expect(report.regressions.length, formatRegressionHits(report)).toBe(0); // 棘轮在前
await expect(serializeBaseline(report.actual)).toMatchFileSnapshot("../../docs/writing-baseline.json");
```

有回归时第一条断言抛出,测试终止,快照那行够不着,于是 `-u` 也写不进一个被放宽的数字。
顺序反过来就等于把守护降级成记录。四种组合都手验过:台账宽松→红、`-u`→收紧、
有回归→红且详报与旧 CLI 逐字一样、有回归时 `-u`→仍红且台账未被改写。

**顺带查实的事(这次合并的经验论据)**:`ci.yml` 把检查排成一串独立 step 时,前一步红
会掩盖后面全部步骤。main 的 CI 连续 5 次红在 `pnpm test:docs`,`tiers:check` 从未被执行
到——`examples/zh/tier2|tier3/langgraph` 落后于上游这件事因此一直没人看见(用
`git show HEAD:scripts/sync-tiers.mjs` 跑改动前的逻辑确认过是既有状态,不是重构引入)。
并进 vitest 后这些守护并列跑,一次把问题全报出来,不再互相遮挡。

**落点**:`scripts/docs-writing-lint.ts`(去 CLI 尾巴,导出 `formatRegressionHits` /
`serializeBaseline`)、`scripts/sync-tiers.mjs`(`runCheck` → 导出 `tierProblems()`,CLI 加
`process.argv[1]` 守卫)、`test/docs/docs-writing.test.ts`、`test/unit/example-tiers.test.ts`、
`test/unit/init-md-symlink.test.ts`、`.github/workflows/ci.yml`。规则已升格进 CLAUDE.md
与 `docs/engineering/testing/unit/README.md`「套件边界与仓库守护」。
