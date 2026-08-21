# Persisted Record handoff

`e2e/migrate/` 承载 producer 写入的 Record，供另一个进程中的 candidate 通过公开 CLI 读取。
该 Repo 归属 Record 域，但不取代公开 Record API owner。

## Current-to-current handoff bootstrap

bootstrap owner 把 `producer` 和 `candidate` 绑定为两个当前命令身份。
producer 运行确定性 Experiment 并持久化 Record。candidate 在同一个私有 case 项目中启动独立的
`show --run ... --json` 命令，并必须选中该次公开 Run 身份。

该 owner 只证明持久化交接和可替换的 producer 接缝。它不声称旧版兼容、旧 schema 迁移、
格式转换后的 ID 保留，也不声称已接管 legacy producer 的可靠性。

legacy migration owner 另以固定 npm alias 安装并证明旧 producer 的 registry identity；candidate 仍只来自根 runner
注入的唯一 tarball，不建立第二份 candidate 信任链。

## npm 0.13.0 to current

`e2e/migrate/test/from-0-13-0.test.ts` 是 automatic migration 的成功 Journey owner。它固定并 attested npm
`niceeval@0.13.0`（registry SRI 亦为签入 expected），由其真实 CLI 运行确定性 Experiment 产生旧 Record：

- candidate 第一次 `show --run ... --json` 在 portable Record 尚未由 Git HEAD 保存时 fail closed，提示先保存；
- 测试把 opaque Record directory 执行真实 `git add` / `git commit`；
- 第二次同一 `show` 无确认自动原地迁移，stderr 只给一次 restore commit/目标 receipt；
- 正常 show 结果仍选择同一 Run，并显示旧 producer 已证明通过的结果；
- attempt readback 保留五种已证明的 decision/label：succeeded、includes、excludes、calledTool 与 notCalledTool；
- 旧 message、tool candidates 或 matcher diagnostic 不会冒充 current source/explanation；
- 再用同一 npm 0.13.0 CLI 对已经迁移 attachment 的 Record 追加第二个 Run；保存后 current 只迁移新增的旧
  attachment，两个 Run 都保持可读。root 没有版本门，因此这里不虚构全局拒绝旧 writer 的行为。

这里的五种 assertion 是 npm 0.13.0 的版本专属样本，不是所有历史版本共享的迁移矩阵。后续若支持
`0.15.x → current`，应由独立的固定 npm alias、producer、Journey owner 和该版本实际可表达的 assertion
内容定义期望；不得修改 0.13.0 owner 来模拟 0.15.x，也不得要求两个 producer 版本产生相同的迁移后细节。
各版本 owner 只共享 Git 前置条件、root 不重写、attachment 逐步升级、失败恢复、幂等和有界读取等框架不变量。

测试不读取私有 Record 文件来断言产品结果，也不以手写 v1 fixture 作为成功 owner。explicit `niceeval migrate`
的计划、确认、诊断和 sentinel/Git 恢复继续由下列最小 owner 分别负责。

### Interrupted migration recovery

`interrupted-recovery.test.ts` 证明 sentinel 恢复、验证、清除与重试。缺少 physical write set 的旧 sentinel
只能进入人工恢复；current sentinel 绑定本次精确写集后，才可输出 Git restore 命令。

### Plan change preserves concurrent edit

`stale-plan.test.ts` 证明第二次规划发现并发编辑时保留编辑，且不输出破坏性恢复命令。

### Migration no-follow replace

`symlink-race.test.ts` 在最终 source 校验后把目标 envelope 换成指向 Record 外文件的 symlink，
证明 migration fail closed、外部文件 bytes 不变，并保留 sentinel 进入人工恢复。

### Pre-write invalid Record

`prewrite-invalid.test.ts` 证明 sealed Core invalid 在首个 portable write 前拒绝且无 sentinel。

### Pre-write cross-family invalid Record

`prewrite-cross-family-invalid.test.ts` 证明 SourceNavigation join 在首个迁移写入前 fail closed；Record bytes
保持不变，且不创建仅供写后恢复使用的 sentinel。

### Future known family

`future-version.test.ts` 证明 known family future version 返回 unsupported，不误报 invalid。

### Historical v1 labels

`historical-labels.test.ts` 证明 v1 合法 `turn01` 与大整数字符串 label 逐字迁移。

### Assertions v1 to v2

`assertions-v1.test.ts` 固定带无语义旧 root 字段的 package-owned Assertions v1 wire fixture。它经公开
`niceeval migrate --yes` 与 `show` 证明 maintenance 物理重写唯一的 current semantic entry。

fixture 保留 required-unavailable gate。迁移后 requirement 为 available/required，condition 为
unavailable/not-recorded，公开 Verdict 仍为 errored。

测试只在 migration owner 中检查 attachment envelope/payload 的 exact physical rewrite、丢弃材料的 blob closure
与 root bytes 保持不变。产品结果仍从公开 show 读取。

### Strict complete marker clean

`complete-marker-clean.test.ts` 通过公开 `niceeval clean` 证明只有零字节普通文件
`complete` 会封口 Run；非空文件或同名目录保持 incomplete，并在确认后被删除。

### Report migration metric guard

`report-guard.test.ts` 用 current candidate 的真实 `exp` 生成 current Record，再证明 Report 拒绝 ledger 缺少 denominator Slot 的伪造 metric；它不以旧 Record 的前置失败掩盖 Report 边界。

恢复与故障 owner 的 fixture 仍把旧 root 上无语义的兼容字段与 Observability schemaVersion 写成独立字面量，
不由 candidate 生成 expected；它们只拥有恢复与故障边界。Record migration 不改写 root，Observability
与 Assertions family 各自以 `1 → 2` 升级，不把旧 `niceeval.results` 或 future/unknown format 宣称为可迁移输入。
