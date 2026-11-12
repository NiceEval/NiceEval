# Show summary misspells the assertion entry count

下游 dogfood 通过公开 CLI `niceeval show @<locator>` 读取 Attempt 时，Summary 显示 `37 entrys`。预期数量文案使用稳定名词标签，例如 `entries: 37`，不根据数量分支。

复现：运行确定性 Experiment，通过收据 locator 调用 show。环境：Linux、Node 24+、pnpm 11；NiceEval 当前 main 候选。来源：NiceEval-Eval dogfood；内容已脱敏，无秘密或私有资料。
