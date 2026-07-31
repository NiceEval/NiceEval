# 报告中立化实现:ReportTarget + 参数化页

契约单源:`docs/feature/reports/{library,architecture,view}.md`(目标与下钻 / 参数化页 / renderTarget / 通用路由与导出),覆盖类别已声明在 `docs/engineering/testing/unit/reports.md`「参数化页与下钻目标」。裁决背景见 `memory/report-target-neutral-parameterized-pages.md`。本文件只管执行顺序与验收,不复述契约。

架构结论:不需要新层。唯一架构性改动是运行时分派从 `Sample | AttemptEvidence` 双输入收敛成 `renderTarget` 单路径;其余节点都是顺着它的机械改动,全部落在既有模块边界内。

## 施工前必读(memory)

- `streamevent-new-member-cascade` — 改公开类型后先 `pnpm run build:report` 再 typecheck,否则报错落在无关文件。
- `linked-consumer-stale-dist-report` — link 消费项目验收前必须先 `build:report`。
- `optional-field-additions-need-call-site-census` — C 节点删 `attemptHref` 时,消费点普查 grep **旧名** `attemptHref`(src 内 20+ 文件已列于本 plan 生成时的 grep,含测试),逐个判定,不许留双通道。

## 树形 TODO

依赖用「⇐」标注;同缩进层内没有互相依赖的节点可并行。

- [ ] **A. 类型与装载层**(串行根,其余全部 ⇐ A)
  - 落点:`src/report/definition/report.ts`、`src/types.ts` 公开面
  - [ ] `PageDefinition{id,title,navigation,params?,load?,render}` 单形状,删 `SamplePage`/`AttemptPage` 与 `input` 枚举
  - [ ] `PageParams{encode,decode,enumerate}`、`PageLoadContext{evidence}`、`ReportTarget{page,params}` 三个公开类型
  - [ ] 装载期校验:id 唯一;`params` ⇒ 必有 `load` 且 `navigation: false`;校验不执行 load/render
  - 验收:装载期规则的完整用户反馈测试(重复 id / params 缺 load / params 带 navigation)各一条红绿
- [ ] **B. 运行时单路径** ⇐ A(与 C、F 并行)
  - 落点:`src/report/runtime/{host,page-render,resolved-page,text,web}.ts`
  - [ ] `renderTarget(definition, target, base, ctx)` 取代按 input 分派;删 `assertPageInput` 实体分支
  - [ ] paramsKey 由 `encode` 产物统一 URL 编码派生,路由/文件名/去重三处同源
  - 验收:attempt 目标与 experiment 目标走同一分派函数的行为等价测试;分派代码对两类目标零差异(按行为断言,不 grep 源码)
- [ ] **C. 宿主通道与共用函数** ⇐ A(与 B、F 并行)
  - 落点:`src/report/components/shared.ts`、`src/report/definition/tree.ts`、`src/report/components/cell.tsx`
  - [ ] `ctx.href(target): string | undefined` 取代 `ctx.attemptHref`;页不存在/encode 抛错 → undefined → 纯文本节点
  - [ ] `targetOfRefs()` 抽成共用导出;cell 多 refs 逐 ref 成链语义不变但改走目标
  - [ ] `attemptHref` 全删(含 props 覆盖路),按上面的普查清单逐点改
  - 验收:href 三态(有链接/undefined 纯文本/无假链接)各一条;双 refs 行是「旧 refs[0] 实现唯一会绿」的区分力格
- [ ] **D. chart 收 pointTarget** ⇐ C
  - 落点:`src/report/definition/primitives/chart.tsx`(:461 的 refs[0] 即病灶)
  - [ ] 删 `refs[0]` 取链;`pointTarget` 显式逐点生效,省略走 `targetOfRefs`;external 无此属性
  - 验收:显式/默认/external 三条测试;多 refs 点无链接
- [ ] **E. 标准库页** ⇐ B
  - 落点:`src/report/built-in/standard.tsx`
  - [ ] `standardAttemptPage` 重写为 params/load 形态(encode=locator、enumerate=全部 locator、load=ctx.evidence)
  - [ ] `standardExperimentPage` 新增(encode=experiment id、enumerate=toExperimentRows、load=scope 收窄)
  - 验收:params 往返 `decode(encode(p))` 深相等;enumerate 对有效根全集、收窄外不出现
- [ ] **F. ExperimentDetails 组件** ⇐ A(与 B、C 并行;E 的接线等 F)
  - 落点:新建 `src/report/components/experiment-detail/`
  - [ ] 六区块按 `docs/feature/reports/components/experiment-detail/README.md`;显式 input 或 ctx.scope 取数
  - [ ] 收窄非恰好一个实验 → 完整用户反馈报错,不静默取第一个
  - [ ] text/web 两面消费同一份转换结果;实验级 facts/notices 区块
  - 验收:单实验六区块投影、零/多实验报错、notices 落位各一条
- [ ] **G. ExperimentScatter 默认下钻** ⇐ D、E
  - 落点:`src/report/components/summaries/index.tsx`
  - [ ] 点目标默认 `{page:"experiment",params:{experiment}}`;报告无 experiment 页时点无链接
  - 验收:覆盖声明里对应两条;这就是用户截图 bug 的修复位
- [ ] **H. view 宿主** ⇐ B、E(与 I 并行)
  - 落点:`src/view/site.ts`、`src/view/app/App.tsx`、`src/view/app/lib/attempt-dialog.ts`(改名 target-dialog)
  - [ ] 路由 `#/<pageId>` 与 `#/<pageId>/<key>`;dialog 拦截按清单参数化页 id 判定,支持嵌套下钻
  - [ ] 导出按 `enumerate(有效根)` 物化 `<pageId>/<key>.html`;attempt 产物路径形状不变,新增 `experiment/`
  - [ ] 隐式补位改按 id(attempt、experiment 都补)
  - 验收:单元层测路由互转与物化清单;dialog 打开/深链/导出站几何归 e2e 报告域,本 plan 只留冒烟(见验收总表)
- [ ] **I. show 宿主** ⇐ B、E(与 H 并行)
  - 落点:`src/show/index.ts`、`src/show/command.ts`、`src/report/runtime/host.ts`
  - [ ] `@<locator>` 选 id 为 `attempt` 的参数化页,经其 load 装载;无此页 locator 纯文本
  - [ ] locator 命令生成改走目标格式化(text 宿主把可服务目标换下钻命令)
  - 验收:`show @loc --report` 有/无 attempt 页两条既有测试改断言面后仍绿
- [ ] **K. 收尾同步** ⇐ 以上全部(串行尾)
  - [ ] `pnpm run build:report` → `pnpm run typecheck`(顺序见 memory)
  - [ ] 公开面变了:`pnpm docs:reference` 重生成参考页区块;核对 `src/i18n/` 两份 `--help` 速查(本次无新 flag,预期不动)
  - [ ] `docs/source-map.md` 更新 view 深链/attempt-dialog 两行落点
  - [ ] grep 残留:src 与 docs 均搜不到 `attemptHref`、`input: "attempt"`

## 并行度速查

```text
A ──┬── B ──┬── E ──┬── G ──┐
    ├── C ──┴── D ──┘       │
    └── F ──────(E 接线)────┼── K
         B/E ── H ──────────┤
         B/E ── I ──────────┘
```

同批可派:第一批 A;第二批 B、C、F;第三批 D、E;第四批 G、H、I;收尾 K。多 agent 并行按 docs 目录边界切:B/C/D 归 report 定义域,H 归 view,I 归 show,互不踩文件;共享暂存区提交纪律见 memory `parallel-agents-shared-git-index`。

## 验收

1. **单测**:`pnpm test` 全绿,且「参数化页与下钻目标」覆盖声明的每一条都有对应用例(声明先于测试已完成)。
2. **类型链**:`pnpm run build:report` 后 `pnpm run typecheck` 绿。
3. **真机冒烟**(memory `minimal-run-verification`:两题几分钟的最小 run,不跑全量;repo 用 `/Users/ctrdh/Code/MemoryBench`,先 `pnpm run build:report`):
   - `pnpm exec niceeval view`:散点实验点点开是实验 dialog(hash `#/experiment/<key>`),modal 内点 attempt locator 嵌套打开 attempt dialog;
   - 直接落深链 `#/attempt/@<locator>` 与 `#/experiment/<key>` 均能打开;
   - `niceeval view --out site`:产物含 `attempt/` 与 `experiment/` 两目录,无 JS 打开 `experiment/<key>.html` 完整可读;
   - `niceeval show @<locator> --report`(有/无 attempt 页)行为与 docs 预期一致。
4. **文档同步**:`pnpm test:docs` 与 `pnpm test:docs-site` 绿(本次契约已先行落稿,预期只有 source-map 行需动)。
5. **回归哨**:实验散点点开不再指向任意 attempt——用户截图场景(`#/attempt/@1kp8gz7h`)不复现。
