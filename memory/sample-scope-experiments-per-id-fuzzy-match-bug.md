---
name: sample-scope-experiments-per-id-fuzzy-match-bug
description: Sample.scope({experiments}) 逐 id 单独求匹配丢失「精确 id 优先于前缀」规则,同族实验被误合并
metadata:
  type: project
---

已修。`Sample.scope({ experiments: [id] })` 内部把每个候选 `AttemptHandle.experimentId`
单独喂给 `matchExperimentSelector([id], prefix)`(`src/sample/index.ts` 的 `experimentMatch`)。
`matchExperimentSelector` 本身有「精确 id 优先于前缀」的规则(先找 `ids.find(x => x===selector)`,
命中就只返回它,不再往下走前缀/namePrefix 分支),但这条规则要看到完整候选 id 集合才成立——
逐个单独判断时,永远看不到「集合里另有一个 id 精确等于 selector」这件事。

**现象**:`compare/codex-gpt-5.6-luna` 是一个真实存在的 experiment id,同时
`compare/codex-gpt-5.6-luna--mempal`、`compare/codex-gpt-5.6-luna--nowledge` 是它的同族变体
(用 `--` 而非 `/` 分隔后缀,不构成路径级子目录)。用前者窄化时,`namePrefix` 分支会把后两者也
当前缀命中,`base.scope({ experiments: ["compare/codex-gpt-5.6-luna"] })` 窄化出 3 个实验而不是 1 个。

**根因**:`experimentMatch` 对每个 id 单独调用 `matchExperimentSelector([id], prefix)`,而不是
对完整 id 全集调用一次再取交集——后者(`filterExperiments`,同文件里给 CLI `--exp` 用的既有正确
实现)已经是对的写法:`matched = new Set(prefixes.flatMap(p => matchExperimentSelector(ids, p)))`,
对全集求一次,「精确匹配」自然会抢在「前缀匹配」之前生效并排除同族变体。`scope()` 内联重新发明了
一份错误版本。

**触发面**:任何调用方拿着一个已知的精确 experiment id 去 `sample.scope({experiments:[id]})`
窄化,只要存在一个「该 id 是另一个 id 的无分隔符前缀」的同族变体,就会窄化过宽。

**修法**:`src/sample/index.ts` 的 `scope()` 改成一次性对 `[...runs, ...attempts, ...historyAttempts]`
的 `experimentId` 全集求 `matchExperimentSelector` 匹配集合(`Set`),`experimentMatch` 只做集合成员
判断,不再逐 id 调用。

由 [[report-target-neutral-parameterized-pages]] 的 `standardExperimentPage.load` 真机静态导出冒烟
测试暴露(`ExperimentDetails needs a scope narrowed to exactly one experiment, but the given input
narrowed to 3`)。CLI `--exp` 路径走 `filterExperiments`,不受此 bug 影响;只有代码内部直接调用
`sample.scope({experiments:[...]})` 的调用点会中招。
