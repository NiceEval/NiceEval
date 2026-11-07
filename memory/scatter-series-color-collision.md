# scatter-series-color-collision

## 现象

`niceeval view` 的成本 × 通过率散点里,bub 与 codex 两个不同 series 显示同一个蓝色,多条同色线叠在一起完全不可辨;图例里也是两个蓝点。真实复现:coding-agent-memory-evals 的 compare 组(bub / claude-code / codex 三 agent)。

## 根因

`src/report/react/colors.ts` 的配色是「series 键 FNV-1a 散列 % 6 色板」——为了跨图/跨组件同键同色(好设计),但没有任何图内冲突消解。`"bub"` 与 `"codex"` 恰好散列进同一格(c0 蓝),`"claude-code"` 落 c5 橙。散列碰撞对 6 格色板是常态,不是小概率。

## 修法

同图冲突消解让位跨图稳定:新增 `colorIndicesForKeys(keys)`(`src/report/react/colors.ts`)——每个键仍以散列格为起点(无冲突时与跨图配色一致),同图撞色时按图例顺序线性探测下一个空色格;键数超过色板(6)后无空格可探,回落散列格复用。`MetricScatter` / `MetricLine` 的系列上色与图例改走这张图内映射;跨块单键着色(`colorClassForKey`,如表格里的 agent 名)不变,仍然全局稳定。契约句在 `docs/feature/reports/library/metric-views.md`「MetricScatter」,锁定测试在 `src/report/report.test.ts`(labels 维度、series 归类与 connect 分区)。

适用场景:任何「稳定散列上色 + 有限色板」的图,都需要一层图内实际键集合的冲突消解;只裁跨图稳定或只裁图内可辨都是错的,先探测、探不动再复用是两者的折中。
