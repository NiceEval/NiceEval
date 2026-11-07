# 时效从 Scope 警告降级为行级 provenance,覆盖缺口从警告改为数据+占位行

- **裁决**(2026-07-22,用户发起「不该通过 ScopeWarnings 展示,该在通过率/eval 行上提示,或允许过滤」):
  - `stale-snapshot` kind 删除——携带与跨快照拼接是 attempt 的时效属性(`attempt.carried` + historical 判定),报告在行上标 `↩ <时距>`,Experiment 副行汇总 `↩ n/m attempts`。
  - `partial-coverage` kind 删除——覆盖缺口物化为 `scope.coverage`(`knownEvalIds` / `missingEvalIds`),榜单渲染成「当前配置下无结果」占位行 + 补跑命令;CI 判 `missingEvalIds.length`。
  - warnings 全集缩到定位不到行的三种:`unfinished-snapshot` / `missing-startedAt` / `unreadable-snapshot`;ScopeWarnings 的 integrity/freshness 两档类别制随之删除。
  - 新增 `fresh` 口径(`latest/current({ fresh: true })`、CLI `--fresh`)只看新执行,被排除的题转占位行。
- **曾选方案**:页面级 ScopeWarnings 折叠区承载 partial-coverage(徽标 `coverage n/m`)与 stale-snapshot(徽标 `{gap} behind`,附「没改就可忽略」并列条件)。
- **否决理由**:① 警告粒度与事实粒度错位——「这行是旧的/缺的」是行级事实,聚合成页面脚注后读者无法定位到行;② carry 是 fingerprint 担保的正常功能,一个需要自带「多数情况请忽略」免责声明的警告不该是警告(警告疲劳,淹没 unreadable 这类真问题);③ 缺题没有行可标恰好说明该**造行**(占位行),把分母缺口摆进读者正在看的表里,先例是构建系统逐条目标 FROM-CACHE 而非页面横幅。
- **落点**:docs/feature/results/library.md、reports/library/{entity-lists,site-components}.md、show.md、view.md、show/default-report.md、error-feedback.md、两份测试覆盖规范;实现计划 plan/provenance-over-warnings.md。英文 docs-site 明确不动(用户指示)。
