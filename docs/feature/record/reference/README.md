# Record 外部研究索引

本目录只登记外部资料。产品行为以 [Record Architecture](../architecture.md)、[Lifecycle](../lifecycle.md) 与
[Record Library](../library.md) 为准。

| topic | primary source |
|---|---|
| Node built-in SQLite API | [Node.js `node:sqlite`](https://nodejs.org/api/sqlite.html) |
| WAL concurrency and recovery | [SQLite WAL](https://sqlite.org/wal.html) |
| online backup | [SQLite Online Backup API](https://sqlite.org/backup.html) |
| sealed-only rewrite | [SQLite `VACUUM INTO`](https://sqlite.org/lang_vacuum.html#vacuuminto) |
| statement authorization | [SQLite authorizer](https://sqlite.org/c3ref/set_authorizer.html) |
| defensive database configuration | [SQLite defensive mode](https://sqlite.org/c3ref/c_dbconfig_defensive.html) |

这些资料不替代 NiceEval 的 generic rows、writer admission、Logical Seal、RecordSnapshot、hostile-input 或 Service namespace
契约。
