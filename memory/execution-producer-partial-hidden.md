# 现象

Adapter 通过 recordTrace 上报 collection.state=partial、限制说明和空事件集。show --execution 却只显示外层 Generic execution traces complete、complete preview 与 Continuation complete，未解释生产者声明的缺失。

## 边界

外层捕获成功、生产者证据完整性、列表分页是否结束是三个不同事实。空索引不能证明应用没有事件。保留每条 trace 的完整性与限制，摘要与稳定详情引用共用正式投影，不加入具体应用概念。

## 验收

安装候选经公开 Adapter 记录 partial 空集与非空事件后，Query、show 与 Insight 必须保留限制。完整列表不升级证据完整性，分页仍可继续至末页。不依赖付费模型。
