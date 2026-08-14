# Reports 用例

契约单源始终在 [Report Library](../library.md)。本目录按用户目标说明怎样用同一份闭合 execution 呈现终端、网页和静态站。

- [比较质量与成本](比较质量与成本.md)：选择多个 Run，保留分母和 Evidence 后比较质量、时长与成本。
- [核对数据完整度](核对数据完整度.md)：让 partial、empty、unsupported 和 failed 保持可见。
- [分享静态报告站](分享静态报告站.md)：导出断网可读的完整页面与下载 closure。
- [制作可访问页面](制作可访问页面.md)：让 text、Web 与无 JavaScript 阅读共享同一事实。

每个用例都从 CLI 已选择的 Sample 开始。Report callback 只能从 Sample 取得 rows 或领域视图，结束后只留下 ClosedReportTree；它不能回到 Record 或在 renderer 中再次取数。
