# Reports 用例

契约单源始终在 [Report Library](../library.md)。本目录按用户目标说明怎样用同一份 ClosedSiteRevision 呈现终端、
网页和静态站。

- [比较质量与成本](比较质量与成本.md)：在固定分母上保留 Evidence 后比较多个 Run 的质量、时长与成本。
- [审阅一次 Run 的闭合结果](审阅一次Run怎样采用结果.md)：从 Run ID 核对固定 Sample，再沿 locator 下钻 immutable Attempt 与 File Changes 轨迹。
- [核对数据完整度](核对数据完整度.md)：让 partial、empty、unsupported、failed、File Changes 空态与 RecordAttachment 问题保持可见。
- [分享静态报告站](分享静态报告站.md)：导出断网可读的完整页面、下载 closure 与自包含目录。
- [制作可访问页面](制作可访问页面.md)：让 text、表格、Web 与无 JavaScript 阅读共享同一事实与状态。

每个用例都从 CLI 已选择的 Sample 开始。Report callback 只能从 Sample 取得 rows 或领域视图；Host 完整枚举、关闭和
校验后形成 ClosedSiteRevision。renderer、HTTP 请求和浏览器导航都不能回到 Record 或再次取数。
