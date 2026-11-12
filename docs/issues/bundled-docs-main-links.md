# Bundled documentation links escape to repository main

已安装的 NiceEval INDEX 指定使用随包版本文档，但 docs-site/zh 中示例与断言参考链接到本仓库 main。旧版本的使用者可能读到另一版本的示例与内部契约。

复现：安装当前 main candidate，搜索随包 docs-site/zh 中 github.com 的 blob/tree/raw main 链接。预期示例使用包版本 tag，内部契约所需事实直接随包提供。环境：Linux、Node 24+、pnpm 11。来源：NiceEval-Eval dogfood；已脱敏，不含秘密或私有资料。
