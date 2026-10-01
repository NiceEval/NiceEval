# 验收场景

- AC-1：执行截止时 Adapter 同步 abort listener 读到 timeout、毫秒上限和配置层；迟到断言被拒绝。
- AC-2：首次 SIGINT 后读到 cancelled；cleanup signal 尚未取消，真实尾部请求完成后才上报用量和发布。
- AC-3：声明 95000 ms cleanup，实际排空超过 30000 ms 后仍可完成归档。回调共享同一个 deadline，不能逐项续期。
- AC-4：声明较小合法预算，非合作 cleanup 到期后晚到 usage/attach/trace 全部拒绝，已有分数和附件保留。
- AC-5：正常完成、执行异常、创建途中取消均运行 LIFO cleanup；异步 handoff 不越过同一时限。
- AC-6：非法预算在定义阶段失败；默认保持 30000 ms；cleanup metadata 深度只读且首次原因不被后续事件改写。
- AC-7：cleanup 返回失败或超时不冒充资源已结清；第二次 OS signal 可以强制退出。
