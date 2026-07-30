# link 开发树写出的 producer.version 恒是占位号,恢复提示照抄它就不可执行

## 现象

版本不兼容的快照在扫描时给的提示是「用写这份结果的那个版本去看」:

```text
⚠ .niceeval/2026-07-10T08-00-00-000Z: written by niceeval 0.4.6 (schemaVersion 11);
  this CLI reads schemaVersion 13.
  Run `npx niceeval@0.4.6 view .niceeval/2026-07-10T08-00-00-000Z` to view it.
```

在 `pnpm link` 到本地开发树的消费项目(MemoryBench 这类)里,这条命令一律执行不了:
`0.4.6` 是仓库 `package.json` 里长期不动的占位号,npm 上的 `0.4.6` 与写这份结果的
那棵工作树没有任何关系——它可能早了几十个 commit,也可能压根不含当时那个 schema。

跨过好几个 schemaVersion 的语料库里,不同时期的快照全都自称 `0.4.6`,
提示因此既指不出真正的版本,也无法把几批历史彼此区分开。

## 根因

发版流程里版本号只在 CI 的 runner 本地写入:标签名解析出版本 → 写进 `package.json` → publish,
**不写回仓库**(见 CLAUDE.md「Release」)。所以 main 上的 `version` 是一个恒定占位值,
而 `producer.version` 忠实地记录了写盘那一刻 `package.json` 里的东西。

落盘侧没有做错任何事:`producer` 的用途在契约里就是「拼 npx 提示」,不是 schema 判据
([字段规则](../docs/feature/record/architecture.md#字段规则))。
错的是这个用途在「跑的不是已发布版本」时无解——工作树没有可安装的坐标。

## 修法

未定,留待裁决。已经想到的几个方向各有代价,记在这里免得下次重新想一遍:

- **落盘时补一个「不是发布版」的标记**,让读取面据此改口(不给 npx 命令,改说
  「这份结果由未发布的开发树写出」)。诚实,但要往永久稳定的 `producer` 上加字段。
- **开发树落盘时写 git 描述**(`0.4.6+g<sha>` 一类)。指得出是哪棵树,但提示仍不可执行,
  且把版本号变成了两种语法。
- **什么都不改**,接受「dogfooding 的语料只能用同一棵树读」。

裁决前不要顺手改文案:提示那句话现在至少是对已发布版本正确的。
