# 裁决:删除沙箱注入,行为断言收进宿主侧 t.o11y

- **裁决**(2026-07-29):沙箱内不落任何框架文件、不注入任何框架环境变量。行为断言由
  `TestContext` 的只读 getter `t.o11y`(读取时从累积事件现算 `O11ySummary`)在宿主侧承担;
  安装 manifest 由 adapter 宿主侧内存对象直接交 runner 存 artifact。契约单源
  `docs/observability.md`「宿主侧行为断言:t.o11y」。
- **起因(下游踩坑)**:消费仓库在 `test()` 里 `git clone <url> .` 报 exit 128——workdir 里
  已有 `__niceeval__/results.json`,且实现比旧契约声明的「首次 send 后才写」更早创建(漂移)。
  旧设计还有 eval-awareness(目录名直接告诉 agent 在被 niceeval 评测)与篡改面。
- **曾选方案与否决理由**:
  1. 留在 workdir + 文档声明保留路径:agent 读得到、归因排除要加特例,
     且与分类账「workdir 保持素净」原则自相矛盾。
  2. 搬 workdir 外 + `NICEEVAL_RESULTS` env 注入用户命令(当日翻案,部分 docs 编辑已落又撤):
     env 只为伺服「沙箱内读行为数据」这个通道,而该通道本身是宿主侧断言面的劣化复刻——
     事件流住宿主侧,`t.*` 断言严格更强。用户裁决「env 越少越好」后连通道一起删。
- **修法落点**:docs 已重写(observability.md、architecture.md、getting-started.md、
  source-map.md、sandbox/library.md、testing/unit/eval.md、docs-site official-adapters);
  实现删 `src/o11y/sandbox-results.ts` 注入链、`src/agents/manifest.ts` 改内存转运、
  `src/context/context.ts` 加 `t.o11y`。
