# Cases

| ID | 输入 | 必须观察到的结果 |
|---|---|---|
| P1 | 十个 slots 引用同一个 Attempt | 输出仍有十个 Sample-aligned entries，物理读取可以去重 |
| P2 | excluded、not-recorded、core-invalid 与 included 混合 | 前三类不读 package；included 保留完整读取状态 |
| P3 | 第一个 payload 决定是否第二次读取 Sources | PLAN 必须明确动态读取是否合法，以及 host 能承诺什么 |
| P4 | graph closure 后代码尝试增加依赖 | static graph PLAN 必须拒绝；direct call PLAN 必须说明它没有 closure guarantee |
