# Lifecycle

运行正常完成或中断后关闭 authoring，封存断言，然后开启 Attempt 总 cleanup 时段。
逆序释放 Agent、Adapter、Sandbox 和其他资源，共享剩余时限，最后关闭采集并发布。
取消不表示物理请求已结束，失败和缺失回执保留 unknown。
时段耗尽会影响尚未执行的后续 finalizer，必须提供强制资源回收保障。
验收包含所有应用与 Provider 的排空，不能只通过普通 Adapter 就宣称资源总预算可用。
