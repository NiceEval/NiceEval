# 质量成本前沿

内建首页先用 `aggregate()` 产生 Experiment 级质量与成本 points，
再用报告旁 `paretoFrontier()` 标出前沿。
前沿是普通数组算法，不是公共 Calculation，也不是 Scatter 的隐藏默认。

通过制使用 `passRate`；计分制使用显式计分 Calculation；
混合题型分开显示，不能把不同单位压成一个主读数。
