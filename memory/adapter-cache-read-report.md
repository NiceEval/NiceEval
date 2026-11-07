# Adapter 缺少按模型用途的原生缓存读取率判定

用户需要在 eval 中按 modelSlot 判定缓存读取率，并在 Query、Show 与 View 中核对相同的数值及输入覆盖率。旧版只提供 token 总量，各项目自行选择分母和缺失口径，无法统一判断无样本与不完整账本。

目标契约见 docs/feature/adapters/library/README.md 的缓存读取率。采用含缓存输入总量作为分母，按物理调用的 token 加权，缺失、零分母及未声明完整的账本不可判定。
