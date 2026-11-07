# 设计讨论从源码反推现状，两次被推翻

- **现象**：讨论设计问题（「X 有没有某字段」「要不要加 Y 能力」）时，agent 去 grep `src/` 反推当前契约。两次成本：commit da12b05 推翻了一整篇按源码反推重写的 scoring 文档；2026-07-14 讨论 coding agent 配置面时 agent 又直奔 `src/` 查 `McpServer` / codex config 形状，被用户打断。
- **根因**：两个引导缺口叠加。① 「设计问题以 docs 声明为准」只存在于口头，CLAUDE.md 路由表把 source-map 摆成无限定的同级入口；② docs 里的形状声明是描述性 prose（如「都能表达 command、args 和 env」），没有穷尽性承诺，agent 无法确定「没写 = 没有」还是「没写 = 文档漏了」，回答否定式问题的理性选择就是回源码。
- **修法**（已升格为规则，本条为出处，2026-07-14）：CLAUDE.md 路由表给 source-map 加「仅实现与核对阶段」限定；`docs/README.md` 写入查询纪律（docs 未声明 = 未定稿，先补契约）与穷尽形状约定（TS interface 代码块或字段表，未列出的字段即不存在）；`docs/feature/README.md` 与 `_template/architecture.md` 把数据建模（实体从属、关联方式、生命周期）+ 穷尽形状纳入 architecture.md 职责。
