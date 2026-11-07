# CLI stdout 提前关闭产生未捕获 EPIPE

## 问题与根因

安装后 query discover 写入已经关闭的 stdout 管道时，Node Writable 异步发出 error。同步 write 的异常捕获无法接收该事件，CLI 因而打印未捕获异常堆栈退出。

## 修复边界

CLI 进程边界拥有 stdout 的 EPIPE 处理。管道关闭应结束输出并沿既有中断路径释放运行资源，不调用 process.exit 跳过 finalizer；其它流错误不能被静默吞掉。

## 验证

从安装后 binary 启动 query discover，下游立即关闭 stdout，核对退出和 stderr。旧候选红灯与同一 owner 的修复候选可靠性接管完成后再解决。
