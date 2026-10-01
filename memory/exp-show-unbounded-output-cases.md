---
format: concord.document/v1
id: exp-show-unbounded-output-cases
title: exp-show-unbounded-output-cases
createdAt: 2026-07-15T14:38:21+08:00
createdAtSource:
  kind: first-recorded
  path: memory/exp-show-unbounded-output-cases.md
  commit: 389e2ead7116a0220950f340f2c56c8ef42a1585
description: exp/show 实测输出违反已有 human 契约:全 reused 缺 FAILURES、per-config 复用清单铺开、0s 却 $7 成本口径矛盾、show Result 单元格 dump 整段 stdout
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 代码侧已修(2026-07-15):反馈状态把「最终结果集」与「本次实际派发」拆成两层。carry 的失败在 plan 阶段静态注入终局 FAILURES,不伪装成刚发生的 failure event；token/cost 只由 fresh `attempt:complete` 累计,全复用固定显示 `0s · 0 new tok · $0.00`；Reuse 只显示聚合数量；0 eval 选择在调度/落盘前非零退出。断言摘要统一先折单行、再做 240 字符安全上限,完整证据仍留在 show/view。类型检查、反馈/runner/scoring 定向测试与空选择 CLI e2e 已通过。全量 CLI profile 与 sandbox hook 的确定性 mock 也已在 `test/fixtures/cli-output-profiles/agents/mock.ts`、`test/fixtures/sandbox-hooks/experiments/order/mock.ts` 显式声明 `completeCoverage`，不再因 Adapter 省略 coverage = unknown 而把 `succeeded()` 降成 unavailable；两份 spawn 级测试隔离重跑通过。真机 full-reuse 仍需单独复核。"
    proof: []
    source:
      path: memory/exp-show-unbounded-output-cases.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:071386b6440390f097527da9300a1ec3100f237e776655f05f84d08d8271cda3
---

**现象**（2026-07-15 在 coding-agent-memory-evals 真机跑,50 attempts 全命中缓存）:

`pnpm exec niceeval exp dev-e2b` 的 human 结束反馈:
1. 17 failed 却**没有 `FAILURES` 区块**,一条 locator 都没给,直接跳到 `Results:`——违反 cli.md「failed>0 必列 FAILURES + 下钻命令」。
2. `Reuse:` 头把 5 个 config 各自的 10 个 reused eval id **逐条铺开**成一面墙,每个 config 还重复同一组 id——违反「human 不逐条列 attempt 日志」。
3. 结论行 `0s · 10.0M tok · $7.04`:时长是本次 wall-clock(全 reused 所以 ~0s),但 tok/$ 是把 50 条 reused 的**历史成本累加**进去——**时长记本次、成本记累计**,自相矛盾。
4. Results 路径 `dev-e2b_bub-e2b/<ts>-<id>`(下划线扁平)与 docs 声明的嵌套 `dev-e2b/bub-e2b/<snapshot>` 不一致(扁平命名本身是 results/architecture.md#28 定义的目录清洗规则,但 cli.md 的示例用嵌套占位符,两处对不上)。

`pnpm exec niceeval show` 的榜单:
5. `memory/terminal-pypi-server` 那条 `commandSucceeded()` 失败的 Result 单元格**把整段 pytest stdout(`{"stdout":"\n> test\n..."}` 数百行)原样 dump**,在表里逐行铺开约 30 行——违反 show.md:66「一条 Attempt 子行最多占两行」与 display.md:100「commandSucceeded received 是 `exit 1 · "…stderr tail"`」。

**根因**:两类。契约缺口:human「全部命中缓存/零派发」这条边界路径 docs 从没作为独立 case 定稿,成本对 reused 的计入口径也没写;**display-cell 截断**(值先折单行再宽度截断)一直没被定义——只定义了 artifact 级 256 KiB「大值截断」,但那是 events.json 体积护栏,不是终端单元格护栏,单元格保留了值自带的换行就撑高了。实现 bug:show 的摘要生成器没按 display.md 把 `received` 塑成 `exit N · "…tail"`,而是塞了原始 `{stdout}` JSON。

**修法**:
- 契约侧已补(先文档):`docs/feature/experiments/cli.md` 加「全部命中缓存」小节(fail/pass/空选择三 case)+ 成本口径不变式(headline tok/$ 只算本次新派发,reused 历史成本不进这行,`0s · 0 new tok · $0.00`)+ Reuse 不 per-config 展开。`display.md` 契约一把「压成有界单元格」拆成两步(先折单行、再宽度截断),点名 commandSucceeded 例子。`show.md` 裸 show 段加截断 worked example。
- 代码侧已修(2026-07-15):反馈状态把「最终结果集」与「本次实际派发」拆成两层。carry 的失败在 plan 阶段静态注入终局 FAILURES,不伪装成刚发生的 failure event；token/cost 只由 fresh `attempt:complete` 累计,全复用固定显示 `0s · 0 new tok · $0.00`；Reuse 只显示聚合数量；0 eval 选择在调度/落盘前非零退出。断言摘要统一先折单行、再做 240 字符安全上限,完整证据仍留在 show/view。类型检查、反馈/runner/scoring 定向测试与空选择 CLI e2e 已通过。全量 CLI profile 与 sandbox hook 的确定性 mock 也已在 `test/fixtures/cli-output-profiles/agents/mock.ts`、`test/fixtures/sandbox-hooks/experiments/order/mock.ts` 显式声明 `completeCoverage`，不再因 Adapter 省略 coverage = unknown 而把 `succeeded()` 降成 unavailable；两份 spawn 级测试隔离重跑通过。真机 full-reuse 仍需单独复核。

- show Result 单元格侧已修(2026-07-15):两步压缩的第二步「按宽度截断」落地——`src/scoring/display.ts` 加 `fitCompactAssertionSummary`(优先级让位:标题先截、matcher 次之、expected/received 最后),`src/report/primitives.tsx` 的 `TableColumn` 加 `maxLines`(text 面收口),`src/report/text/table.ts` 收口实现,`src/report/text/faces.ts` 三个实体列表面接预算。`commandSucceeded` 的 received 塑形修在 `src/context/context.ts::previewCheckedValue`(按值形状分层投影:首行 `exit N · "…尾部摘要"`,随后 `output tail:` 保留换行的长尾部——received 是 eval 侧命令输出唯一的家,只存单行摘要会把证据丢掉),evidence=命令行靠 `CommandResult.command`(`src/runner/attempt.ts::withCommandTiming` 附加)。

适用场景:任何终端表格/单元格渲染值时都要过「值先折单行」这步;任何「全 X」边界态(全 reused、全 pass、空选择)都要显式当独立 case 定稿,别假设通用路径自动覆盖。收口任何值时同步给「更进一步」的下钻入口(首页 → result.json),收缩不能切断取证链。
