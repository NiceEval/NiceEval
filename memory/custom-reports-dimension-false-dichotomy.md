---
format: concord.document/v1
id: custom-reports-dimension-false-dichotomy
title: custom-reports 文档假二分:把读者从自定义维度推向改 experiment
createdAt: 2026-07-11T15:14:43+08:00
createdAtSource:
  kind: first-recorded
  path: memory/custom-reports-dimension-false-dichotomy.md
  commit: 0546ed7e2cea9ca8efc6a148b5f87f9de8014b4c
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
    statement: "- 已修 [custom-reports-dimension-false-dichotomy](custom-reports-dimension-false-dichotomy.md) — custom-reports guide 曾写「内置维度覆盖不了的都走 flag()」,漏讲自定义维度 `{name, of}`,把下游 agent 推去改 8 个 experiment 文件;修法=「换分组:三种维度」三路并列 + 选择判据(guide 讲联合类型要逐臂对照导出面)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# custom-reports 文档假二分:把读者从自定义维度推向改 experiment

**现象**:下游项目(fasteval)里,agent 想在报告里按「记忆条件(baseline / agents-md / mempal)」分组,照着 `docs-site/zh/guides/custom-reports.mdx` 的指引直接去改了 8 个 `experiments/compare/*.ts` 文件加 `flags: { memory: … }`,被用户拦下——「自定义一个报告不应该要改 experiment」。追查发现不是理解力问题:文档原文写「内置维度(`agent`、`model`、`experiment`、`evalGroup`……)覆盖不了的变量**都**走它[`flag()`]」,这是一个全称假命题。

**根因**:`Dimension` 的第三条臂 `{ name, of: (attempt) => string }`(自定义维度,报告本地、零 experiment 改动)在 `src/report/types.ts` 定义、`src/report/index.ts` 公开导出、`report.test.ts` 有覆盖、内部 `docs/reports.md` 也写了,但公开站两篇 guide(custom-reports.mdx、report-components.mdx)只字未提,且 164 行的全称句主动关掉了这条路。「变量来自配置,不来自命名」的反模式警告本身成立,但它有两种修法(声明成 flags / 报告里派生),文档只讲了改 experiment 那种。设计层没有问题——分层(experiment 管怎么跑、report 管怎么摆)和逃生舱都在,坏的是文档契约。

**修法**(2026-07-11):重写 `custom-reports.mdx` 分组小节为「换分组:三种维度」——内置 / 自定义 `{name, of}` / `flag()` 三路并列,给出判据(能从已有数据**派生**的用自定义维度;是 experiment 要**声明**的配置才进 flags;数值轴只收 `flag()`),并说破诚实取舍:区分条件只体现在文件命名里时 `of` 会退化成解析名字,那是该搬回 flags 的信号。`report-components.mdx` 维度槽提法同步;`docs/reports.md` Dimension 小节补同一条判据。英文 guide 待翻译流程按中文同步。

**复盘钩子**:公开 guide 对一个导出联合类型只讲部分臂时,漏讲的臂等于不存在——agent 和用户都会把 guide 的话当契约全集执行。写 guide 时对照导出类型逐臂过一遍;`reference/` 下目前没有 report API 参考页,guide 是唯一公开面,这个校验更不能省。
