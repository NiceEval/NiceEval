---
format: concord.document/v1
id: docs-line-width-cjk-token-exemption
title: 行宽检查的「长 token 豁免」对中文正文全失效
createdAt: 2026-07-25T18:07:03+08:00
createdAtSource:
  kind: first-recorded
  path: memory/docs-line-width-cjk-token-exemption.md
  commit: a67c8d80f4eaf4fdf2358b69d5eaa2c1758cd257
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [docs-line-width-cjk-token-exemption](docs-line-width-cjk-token-exemption\
      .md) — 行宽检查的「长 token 豁免」按空格切 token,中文整段就是一个巨长 token,三百多行中文被静默放过;豁免只认不含宽字符的
      token"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 行宽检查的「长 token 豁免」对中文正文全失效

**现象**：给 `docs/` 加行宽守护(`scripts/docs-writing-lint.ts`)并生成台账后,
台账数是 2636。把 `docs/concepts.md` 里一处 `不用“榜单”“工作台”这类别名` 改成
`不用 \`榜单\`、\`工作台\` 这类别名`(只是把引号换成行内代码、多了两个空格),
同一个文件的超宽行计数从 35 涨到 36——那一行本来就有 389 列,改动没让它变长,
它却是**新**命中。修掉豁免逻辑后台账从 2636 跳到 2938:三百多行中文一直在被静默放过。

**根因**：豁免规则是「行里有一个宽度超上限的 token 时不算超宽」,
本意是放过长 URL 和长路径——换行也救不了它们。
token 靠 `split(/\s+/)` 切,而中文正文没有空格:
一整段中文本身就是一个几百列的 token,于是**越长的中文行越容易被豁免**。
边界恰好落在「这段里有没有被空格断开」上:那一行原本 `不用“榜单”“工作台”这类` 连成一坨,
加了 `\`` 与空格后被切成几个短 token,最长的那个不再超上限,豁免消失,行就露出来了。
所以症状看着像「加空格导致行变宽」,与真实原因(豁免条件被打破)完全不沾边。

**修法**：豁免只认**不含宽字符**的 token(`!WIDE_CHAR.test(token) && width > limit`)——
不可换行是 URL / 路径 / 标识符的性质,不是中文的性质。
落点 `scripts/docs-writing-lint.ts` 的 `hasUnbreakableToken`,同批重生成
`docs/writing-baseline.json`。

**适用场景**：任何按空格切 token 的文本度量(行宽、换行、截断、宽度估算)用在中日韩正文上,
先问「没有空格时这个 token 是什么」。`split(/\s+/)` 在中文里退化成整行,
所有「按最长 token 判断」的规则都会在中文上给出相反的结论,而且是静默的:
台账/报告只会显示更少的命中,看起来像文档质量更好。

**后续**:行宽这条规则 2026-07-30 整条删除(见 [`line-width-guard-cannot-catch-long-sentences`](line-width-guard-cannot-catch-long-sentences.md)),
本条留作「按空格切 token 的度量用在中文上会全失效」这一教训的台账。
