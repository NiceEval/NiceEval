# 默认 Bub 的模型客户端闭包随安装日期漂移

**现象（2026-08-19）**：同一个 `bub==0.4.0` 配置此前能跑，重新安装后 session/recall 请求突然以
`prompt_cache_retention` 不受网关模型支持而返回 400；单轮 Eval 仍能通过。

**根因**：Bub 的 PyPI metadata 没有锁住模型客户端。当天 resolver 选到了
`any-llm-sdk==1.17.0` 与 `openai==2.31.0`，请求协议随传递依赖变化。最初修复只让运行时
`bubAgent()` 写三行 override 并把闭包纳入 marker，却遗漏了公开 `e2bCodingAgentTemplate("bub")`
与 Vercel snapshot builder；预装配方仍会漂移，marker 也必然与 Adapter 分叉。

**修法**：默认 Bub 0.4.0 同批固定上述两个客户端；Adapter、E2B 与 Vercel 都用相同三行 override
计算安装 marker。显式选择其它 Bub 版本时不套用 0.4.0 的闭包。已发布旧制品保持不可变，严格 marker
探测会让它们在首次使用时回退到运行时重装，不覆盖旧 tag。

**防线**：`e2e/package/test/bub-e2b-template.test.ts` 从安装后的公开 factory 读取 E2B 原生
Dockerfile，锁定三行 override 与匹配 marker；真实 Bub live owner继续验证安装后的运行路径。
