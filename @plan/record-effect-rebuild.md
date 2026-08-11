# Record Effect 重构 TODO

本计划只负责执行编排；目标契约仍以 `docs/` 为唯一真源。树中 `[P]` 表示可与同级节点并行，`[S→X]` 表示必须等待节点 X 验收通过。每个节点完成后独立提交，禁止把其它并发改动带入提交。

```text
Record Effect 重构
├─ D 文档契约冻结
│  ├─ [P] D1 Record：Core、RecordAttachment、complete、clean、相邻 migration
│  ├─ [P] D2 Analysis / Projection：SelectionRequest、SampleHandle、ProjectedSample
│  ├─ [P] D3 Report：Report 作者 API、Calculation、PageFamily、固定 ReportExecution
│  ├─ [P] D4 Assertions：assert-first 运行事实、Verdict/Score Attachment 写入边界
│  ├─ [S→D1..D4] D5 顶层 architecture、concepts、source-map、CLI、docs-site/zh 同步
│  └─ [S→D5] D6 Sol design_grill 只审外部契约、核心数据模型与 Effect 边界
├─ R Record 实现 [S→D6]
│  ├─ [P] R1 model/codec：IDs、Core、Attachment envelope、exact Schema、错误 ADT
│  ├─ [P] R2 platform：FileSystem、maintenance lock、writer lock、entropy、Git preflight Tags/Layers
│  ├─ [S→R1,R2] R3 reader：current-major gate、complete 过滤、Core/Attachment 局部错误隔离
│  ├─ [S→R1,R2] R4 writer：Effect Scope session、并发门、direct write、complete-last、clean
│  ├─ [S→R1,R2] R5 migration：adjacent registry、preflight、Git clean/confirmation、逐步执行
│  └─ [S→R3..R5] R6 public exports 与 CLI 接线；删除旧 Graph/Store/journal 生产入口
├─ A Assertions 对接 [S→D6]
│  ├─ [P] A1 assert-first collector/result 归一化
│  ├─ [P] A2 Assertions、Verdict、Score、Evaluation Attachment definitions/projectors/migrations
│  └─ [S→A1,A2,R4] A3 Runner/producer typed write 接线，Pass/Score 都写 Verdict
├─ S Analysis / Projection 实现 [S→R3]
│  ├─ S1 SelectionRequest → AnalysisSampleHandle，保持完整 expected-slot 分母
│  ├─ S2 RecordAttachment projector 与三种声明式访问
│  └─ [S→S1,S2] S3 exhaustive ProjectedSample、coverage、局部数据状态与 Effect 错误边界
├─ P Report 实现 [S→S3,A3]
│  ├─ [P] P1 defineReport / Calculation / Page / PageFamily / Download 作者 API
│  ├─ [P] P2 closed semantic document 与 text/web 同源 renderer
│  ├─ [S→P1,P2] P3 executeReport：静态 I/O 依赖闭包、内存动态 route、内建 problems
│  ├─ [S→P3] P4 show：每次命令固定一个 ReportExecution
│  ├─ [S→P3] P5 view：每次 rebuild 固定一个 ReportExecution，成功替换、失败保留 last-good
│  └─ [S→P3] P6 static export：数据 warning 可导出，执行失败 fail closed
├─ C 性能与生命周期 [S→R3,R4,S3,P3]
│  ├─ [P] C1 Stream：Run 扫描与 blob I/O 的有界消费
│  ├─ [P] C2 并发：独立 owner/Attachment 读取，bounded concurrency，确定性归并
│  ├─ [P] C3 Scope：session/reader/file handle/lock/finalizer；中断不产生 complete
│  └─ C4 不优化小型 Core JSON；不把 Stream 暴露进自包含 Sample/ReportExecution
└─ V 验收 [S→R6,A3,S3,P4..P6,C1..C4]
   ├─ V1 `pnpm typecheck`
   ├─ V2 `pnpm lint`
   ├─ V3 `pnpm run build:report`
   ├─ [P] V4 `pnpm e2e --repo record`
   ├─ [P] V5 `pnpm e2e --repo eval`
   ├─ [P] V6 `pnpm e2e --repo runner`
   ├─ [P] V7 `pnpm e2e --repo report`
   ├─ V8 真实中断检查：未 complete 目录不可读、clean 可确认删除、下一次运行正常
   └─ V9 三个全新场景副本各一次、同一副本连续两次、默认并行一次、单文件一次、资源终结收据
```

## 实现边界

- 内部函数一路返回 Effect；只有现有明确需要 Promise 的最外层兼容 facade 才运行一次 runtime，禁止底层 `Effect.runPromise*`。
- 纯计算保持纯函数。文件、锁、并发、取消、资源生命周期进入 Effect；外部能力用精确 `Context.Tag` 和 `Layer`。
- Run 直接写入目标目录，所有 durable 内容成功关闭后最后创建零字节 `complete`。中断或失败不补 marker；未 complete 目录不是公开 Run。
- Record v1 只保存身份、owner、精确引用和发布结构；Assertions、Verdict、Score、Evaluation、diagnostics 等是独立版本的 `RecordAttachment`。
- Core major 与每个 Attachment family 只提供相邻迁移。普通 open 不自动迁移；CLI 只组合已注册的 `vN → vN+1`。
- Projector 只解释一个 owner 的一个 Attachment。Analysis selection、reuse planning 与 Report Calculation 不叫 projector。
- Record v1 只公开 exact JSON Attachment 与 owner-local blob closure；事件流确实成为产品需求时，再发布具名 media/API。
- Stream 只用于真正可增量的 Run 扫描与 blob I/O；Core、AnalysisSample、ProjectedSample 和 ReportExecution 是有界、自包含值。
- custom Eval/Report 是受信任扩展，不承诺 JavaScript 沙箱；数据损坏、typed failure、defect 与 interruption 不互相伪装。

## 验收原则

- 文档：链接与术语 lint 无双真源；公开 TypeScript/Effect 片段用仓库锁定的 Effect 3.22.1 做真实编译检查。
- Record：complete-last、current-major gate、Attachment 局部错误隔离、writer lock、read/write Scope、adjacent migration 和 Git preflight 都通过公开 API/CLI 观察。
- Assertions：assert-first 不改变 Record Core；Pass 与 Score Attempt 都有 Verdict，Score 另有 Score；既有 assertion E2E 全过。
- Report：作者只看到数据声明、Calculation 与展示；每个 execution 冻结；热重载保留；非致命数据状态显示 warning，不阻塞正常页面。
- 性能：并发有上限、输出顺序确定；Stream 不造成全量缓冲；Scope 关闭后无锁、文件句柄、server、watcher 或子进程泄漏。
- 自动化：只迁移或修复既有 E2E owner，不新增 `src/**/*.test.*`、`test/unit/**` 或 `e2e/**` 测试文件。
