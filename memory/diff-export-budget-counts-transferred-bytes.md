# 裁决:diff 导出预算只数真正传输的字节,超限文本逐文件显式省略

- **裁决**(2026-07-30):`workspace.diff` 的 64 MiB 单窗口预算只约束真正要传输的文本
  before/after 字节。二进制本就只记字节数不传内容,不计入预算;超过单文件阈值(1 MiB)
  的文本按二进制同款处理——`WindowChange.elided`(reason: `binary` | `oversized-text`)
  记 status 与字节数、内容显式省略,同样不占预算。仍然越界才报执行错误。
- **起因**:MemoryBench sqlite-with-gcov,agent 编译 SQLite 产出的 .o/.gcno 按旧口径
  「二进制按尺寸计」把预算吃爆,可判分 attempt(run-tests.sh 已给退出码)被打成 errored;
  下游连续两轮撞上,`diff.ignore` 排不掉(是真实 agent 产出)。旧口径自相矛盾:
  预算名义上护传输通道,数的却是永不传输的字节。
- **曾选方案(否决)**:「旁路采集失败一律降级为 warning 保判定」(下游诉求)——与
  telemetry 裁决同判,采集失败不静默降级;「按消费面作废判定」(中间提案)——被逐文件
  elided 取代,粒度更细且不需要新机制:没消费 diff 的题天然不受影响,消费了被省略内容的
  断言在读取时刻如实报证据不可用。
- **连带**:`binary` 字段并入 `elided`,破坏兼容读取,schemaVersion 11→12;契约落
  docs/feature/sandbox/architecture.md「导出往返是常数次」与
  docs/feature/record/architecture.md 的 diff.json 形状。
- **修法落点**(2026-07-30 已实现):`src/runner/ledger.ts` 导出脚本两段式分类
  (numstat 二进制位 × cat-file 尺寸,预算检查先于内容传输),`src/scoring/diff.ts` 派生视图
  `DiffFileSummary.elided`,报告面 text/web 共用 `diffElidedLabel`;回归=33 MiB `.o` +
  34 MiB 超限文本的窗口放行,65×1 MiB 纯文本仍拒绝。消费面:`t.sandbox.diff.get`/`matches`
  对被省略内容读取时刻大声报错,`notInDiff` 走既有 unavailable 折叠;
  逐断言 unavailable 记录需要 FileRef 式哨兵值,裁定不做(判定殊途同归,只丢一条记录)。
