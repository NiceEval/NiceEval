# 设计裁决:否决删除 `copySnapshots`——携带条目让子集 cp 结构性不可行

## 裁决

2026-07-22,「删除 `copySnapshots`、让手工 cp 成为合法子集拷贝」的提案被否决,`copySnapshots` 保留。它的不可替代核心被重新认定为**携带条目物化**(解引用 `artifactBase` 复制成自包含产物),而非此前 docs 叙事强调的挑选 / 瘦身 / 预检 / `knownEvalIds` 补记——那四件里前三件确实只是 cp+脚本可 DIY 的便利。同日两处判据修正落进 docs:发布纪律的判据从「离开本机」改为「跨出可信边界」(进 Git / 静态托管 / 对外分享;CI job artifact 整根回传属边界内搬运,不经管线);library.md 的 copySnapshots 节补上「为什么不能 cp」的契约理由与「产物自包含」细节条。

## 曾选方案与否决理由

- **删除提案的完整形态**:`writer` 落盘快照时就 stamp 当时的 `knownEvalIds` 并集(格式已允许 `writer.snapshot()` 声明该字段),让每份快照天生自带覆盖事实 → 手工 cp 语义无损 → `copySnapshots` 退化为便利脚本,可删。论据链在「挑 / 瘦 / 查都可 DIY,唯一 cp 做不到的只有 knownEvalIds」时成立。
- **否决理由**:论据链漏了 `result.json` 的两类条目契约(architecture.md#resultjson)——运行器**默认**把上一轮 fingerprint 匹配的终态结果携带合入最新快照,携带条目的 artifact 以 `artifactBase` 指向**原快照**的 attempt 目录,最新快照在常态下不自包含。手工 cp 单个快照目录出去,携带条目的 events / trace / sources 懒加载「如实」返回 `null`,零报错;writer-stamp 修不了这个(它是存储去重结构,不是缺一个字段),解引用物化必须格式感知,只能是库原语。整根搬运不受影响(`artifactBase` 相对结果根)。
- **教训**:这次险些按不完整分析定案——「X 没有不可替代价值、可删」的结论,必须先穷尽 architecture 层的落盘语义(尤其引用/去重结构),不能只读 library 层的 API 叙事;library 叙事没把真正的不可替代性写在正面也是诱因,已修。

## 落点

docs:`docs/feature/results/library.md`(copySnapshots 节开头补「格式感知是子集复制的正确性前提」段 + 契约细节首条「产物自包含」;两类数据段判据改「跨出可信边界」)、`docs/feature/reports/use-case/results-root-and-snapshot.md`(line 5 两类来源分性质)。src 无改动。
