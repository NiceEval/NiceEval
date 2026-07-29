# 读数矩阵

矩阵先由 `aggregate()` 产生 EvidenceRow，再用普通 `toMatrixRows(points)`
整形成组件需要的 rows。整形不重新聚合，也不改变 MetricValue refs。

`toMatrixRows()` 属于矩阵显示 package，不进入公共计算内核。
