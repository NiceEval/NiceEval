# referencesAnyPath silently accepts unsupported glob patterns

公开 referencesAnyPath(["secrets/**"]) 构造成功，但不匹配 secrets/api.key；随包示例使用这一输入，容易使禁区断言静默放行。预期拒绝 * 与 ? 并解释不支持 glob，目录前缀直接写目录名。

复现：从已安装 niceeval/expect 导入 referencesAnyPath，传入上述路径。环境：Linux、Node 24+、pnpm 11；NiceEval 当前 main 候选。来源：NiceEval-Eval dogfood 与公开示例；已脱敏，无秘密或私有资料。
