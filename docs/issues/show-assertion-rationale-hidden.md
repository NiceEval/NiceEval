# Show assertion detail hides recorded Judge rationale

下游 dogfood 从已安装的 NiceEval CLI 观察到 `show @<locator> --assertions --entry <entryId> --full` 未显示 query detail 可读取的 Judge rationale，并建议同一条命令。预期显示已保存的理由且不重复建议当前调用。

复现：以本地 HTTP Judge fixture 执行 Experiment，再通过公开 query 获取 entryId 并运行上述 show 命令。环境：Linux、Node 24+、pnpm 11；候选为当前 main checkout。来源：NiceEval-Eval dogfood，经 synthetic fixture 脱敏复现；不含秘密或私有资料。
