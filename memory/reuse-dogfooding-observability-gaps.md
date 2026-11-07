# 复用 dogfooding:调度事实缺失、词义冲突与配额盲区

2026-07-29 下游 dogfooding(E2B 复用跑批)一批观察,按落点分流:

- **调度事实缺失(已进契约)**:setup 阶段失败的 attempt,`sandbox` 字段整个为空,
  无法归属到实例与承接序号——恰是复用模式下最需要归属的失败类型。契约已改为
  「租借时刻确定、任何阶段终结都在场」(`docs/feature/record/architecture.md` sandbox 字段
  TSDoc + `reuse.md`)。这是「记录完整性耦合 attempt 走到哪一步」模式的复发
  (前例:超时丢弃执行证据,10758545 salvage 修复)。
- **复用污染不可见(已进契约)**:`if ! command -v` 型作用域 bug 在一次性沙箱下是死代码,
  只有复用才执行到;框架此前不给任何机械线索。契约新增按承接序号聚合的收尾诊断
  (`reuse.md`「复用污染的可观察性」)。主动验证 `--reuse-verify` 后续否决:同一 Eval
  两次相同不能证明无残留,不同也可能来自 Agent 随机性。
- **词义冲突与配额盲区(部分进契约)**:首行 `reused` 实指携带、复用零显示、`PLAN` 并发数
  显示全局值、provider 活跃实例无法自查。生效并发、留存与孤儿核对已经分别进入
  Experiments CLI 和 Sandbox CLI;剩余的 `carried` 改名与复用运行级汇总收窄到
  `docs/roadmap/reuse-feedback/README.md`。
- **误报澄清**:反馈称「指纹只认 loadYaml/loadJson,readFileSync 缺口无解」——当前 HEAD
  已有 `loadText` 且指纹测试在(`src/loaders/index.ts:38`、`index.test.ts`),
  下游用的是旧发布版。不需要动 cache.md。
