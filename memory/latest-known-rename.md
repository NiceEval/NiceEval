# 裁决:`latestPerEval` 改名 `latestKnown`,并撤销「名字自解释」的宣称

**日期**:2026-07-26

## 裁决

选择器对改成 `latestRuns()` / `latestKnown()`,`Sample.mode` 的取值同步改成
`"latest-runs"` / `"latest-known"`。`docs/feature/sample/library.md`「两个选择器」一节按新框架重写:
两者的区别**不是粒度,是要不要跨 Run 缝合**。

## 曾选方案与否决理由

- **`latestPerEval`(2026-07-25 定的名,本次推翻)**。它宣传的是遍历单位「每个 eval 取最新」,而这个
  选择器真正需要读者警惕的是**跨 Run 缝合**——把当前 Run 没跑的题从 configHash 相同的旧 Run 里捞
  回来。名字把唯一的风险点藏进了一个人畜无害的 `PerEval`;`PerEval` 在 eval 工具语境里还二义
  (每道题 / 每个 eval 文件)。用户读文档时直接反馈「看不懂」。
- **`latest(record, { unit: "run" | "eval" })` 合成一个函数**。否决:两者差的不只是 unit,共用名字会
  把缝合语义压得更隐蔽。
- **`stitchLatest`**(把缝合摆进名字)。否决:动词感强,读起来像内部实现名,和同层的
  `latestRuns` 不成对。
- **`currentStanding`**。否决:赛事口吻,与 `Sample` / `coverage` 那套统计学隐喻不同源。

`latestKnown` 取「记录里已经知道的最新判定」,与 `coverage.missingEvalIds`(还不知道的题)读起来是
同一套隐喻。

## 连带撤销的一句宣称

旧稿写着「名字里的 `Runs` 与 `PerEval` 就是这个区别的全部说明——不需要额外记忆哪个是哪个」,而同一
节紧接着就要写一整段跨历史拼接的前提。**自解释的宣称和紧随其后的前提小节同时存在,本身就是名字没
承担区分工作的证据**;改名后这句删掉,换成「`Known` = 记录里已经知道的」加一句指向前提小节的话。

前一轮的整套改名裁决见 [record-sample-report-three-layer-split](record-sample-report-three-layer-split.md)
(那张表里 `latestPerEval` 那一行已被本条推翻)。
