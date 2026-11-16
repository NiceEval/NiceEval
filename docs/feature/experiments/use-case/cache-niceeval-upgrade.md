# 升级 NiceEval 后预览需要重跑的结果

升级后先执行预览，确认需要重跑的位置，再决定是否执行。
规则见[身份计算变化](../architecture/cache.md#niceeval-身份域变更)。

1. 执行 `niceeval exp compare/codex --dry`。
2. Record 格式不符时，命令明确拒绝并提示重跑或清理该存储；原文件保留。
3. Record 格式有效且当前身份相同时，符合其余资格的结果继续计入成绩。
4. NiceEval 内容组件或计算方式改变时，受影响位置显示 `niceeval-identity-changed`，要求重新执行。
   `--dry --json` 给出同一诊断与可比较的 `niceeval:` 差异。
5. 用户自己的配置变化显示具名 `config:` 差异，按[修改运行条件](cache-modify-runtime-condition.md)处理。

预览不调用模型，不迁移、改写或删除旧结果。操作者选择当前可写存储后执行实验，得到当前格式的新结果。
