# Handle 追加评分 —— Lifecycle

定义不启动 I/O，Adapter create 与 cleanup 继续拥有应用资源。
便捷方法登记冻结 collection 并返回 SelectionHandle；作者同步追加 judge 完成 evaluator 的选择。
配置阶段结束后才能启动 candidate 遍历，未追加 judge 使用 Boolean 存在性。

未知或空材料不调用模型；完整匹配材料进入现有受管 gateway。
collector 必须对未转换与已转换 entry 都只求值一次，封口和取消拒绝迟到转换。
测试服务私有端口与 teardown 测试涉及范围两种终态及转换竞态。
