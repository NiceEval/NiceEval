# 材料验收问答 —— Lifecycle

定义 source 和 selector 不启动 I/O。Adapter create 建立资源，assertions factory 只绑定 read 并组装便捷方法。
绑定阶段结束后冻结 source 映射；应用动作完成后 closeQA 同步读取当前材料并快照，不隐式补跑。

受管 callback 在 Attempt scope 内遍历全部冻结项。partial、unknown、空集或容量不足均在模型调用前终结。
完整非空材料进入既有受管 classify，预算、重试、取消和审计仍属于同一 entry。
collector 在封口前等待，取消保持 interruption；原语与 app 生命周期结束后不能发送或改写 sealed entry。

应用 cleanup 持有资源；source 不创建 Session、Sandbox、额外 runtime 或后台任务。
每个测试的 fake HTTP 使用私有端口，owner teardown 终止连接并核对资源回收。
