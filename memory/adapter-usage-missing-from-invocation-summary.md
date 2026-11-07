# Invocation 汇总遗漏 Adapter 逐调用用量

## 问题与根因

安装后 CLI 的 exp --json 终态汇总只读取 EvalResult.usage，未读取已经捕获的 Adapter usage attachment。缺失值用零填充，使完整逐调用记录被误报为零消耗，不完整记录也失去覆盖信息。

## 修复边界

复用逐调用 token 投影，按互斥输入桶汇总 fresh Attempts。只有完整、有效且可安全累加的指标才输出；未知或部分记录省略对应指标，完整的零用量保留零。沿用现有可选字段，不增加第二份持久化用量事实。

## 验证

安装后 CLI 场景覆盖完整调用与 partial seal，检查严格解码的终态 summary。取得同一 owner 的旧候选红灯和修复候选可靠性接管后再解决。
