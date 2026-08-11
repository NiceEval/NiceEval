# Limits

- Sandbox reuse 本来就只恢复 workdir，workdir 外状态会跨 Attempt 存续。
- Agent 可以修改本题工作树中的 `.git`，因此下一题不能直接信任这份 metadata。
- 一份包含组内全部 commits 的 seed 会让同组对象位于同一 Sandbox；知道 OID 的 Agent 可能读取其它题的对象。
- 完全隔离未来历史需要 fresh Sandbox 或逐 commit 安全投影，与“同一 Sandbox 一次下载后任意切换”不是同一个保证。
- 组内只保证互斥使用实例；业务顺序仍由 Sequence 声明。
- `replace-sandbox` 会失去实例内 seed，新实例必须重新访问 origin。
- private repository 的鉴权仍使用 Sandbox 的 Git 机制，本设计不建立宿主凭据存储。
