# Materialization Cache —— Use Cases

作者不管理缓存，只声明要从哪个不可变 commit 开始。以下例子分别展示题组复用、重复运行、Sandbox 复用、并发、故障与输入边界。

- [同仓库多道题](同仓库多道题.md)
- [同一 commit 多次运行](同一commit多次运行.md)
- [Sandbox 复用仍隔离 Git](Sandbox复用仍隔离Git.md)
- [并行运行共享宿主获取](并行运行共享宿主获取.md)
- [缓存损坏与 origin 不可用](缓存损坏与origin不可用.md)
- [检出到子目录](检出到子目录.md)
- [不支持的 Git repository 输入](不支持的Git输入.md)

字段与错误边界以 [Library](../library.md) 为准，完整内部时序见 [Lifecycle](../lifecycle.md)。
