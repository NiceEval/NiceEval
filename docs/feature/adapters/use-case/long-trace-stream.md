# 流式保存长局轨迹并按事件查看

## 用户目标

应用作者评估一个长时间运行的多 actor 实时系统，例如 11 个 AI 人物同时行动、一局 30–90 分钟的游戏。
一局有几十万条逻辑事件，作者要把全部事件保存进 Record，事后在 NiceEval 里按完整时间线查看，并直接跳到某个业务事件。
Attempt 被取消时，已经保存的那段轨迹仍要能读，并且明确标出缺口。

## 起始状态

项目已有一个 `defineAdapter` 实现，`create(ctx)` 驱动游戏服务器并能逐行读取本局录像，录像每行可转换为一个 `ExecutionTraceEvent`。
游戏服务器另把原始录像存档在自己的系统里，以 `matchId` 定位。
以下观察结果均为预期输出，未实际运行游戏服务器。

## 完整路径

1. 在 Adapter 中用流工厂提交本局事件，并记录原始存档的出处。 {#stream}

   ```ts
   const finished = ctx.recordTrace({
     traceId: "match",
     schema: { id: "example.arena/v1" },
     archive: { system: "arena-replay", locator: { matchId } },
     events: {
       stream: async function* (signal) {
         for await (const line of game.replay({ signal })) {
           yield { kind: "event", event: toTraceEvent(line) };
         }
         yield game.cancelled
           ? { kind: "end", collection: { state: "partial", limitations: [{ code: "match-cancelled", message: "Match stopped early." }] } }
           : { kind: "end", collection: { state: "complete", limitations: [] } };
       },
     },
   });
   ctx.onCleanup(async () => {
     game.stop();
     await finished;
   });
   ```

   预期输出：Attempt 运行期间 Adapter 进程的内存不随局长增长，框架只持有当前批次与当前事件。
   流结束后 `finished` 得到 `ending.kind` 为 `declared` 的 receipt，`eventCount` 等于本局事件数。

2. 运行 Experiment，局结束后查看这次 Attempt 的 execution outline。 {#outline}

   ```sh
   niceeval show @<locator> execution --trace match
   ```

   预期输出：trace 头部显示 `complete`、事件数与 `archive: arena-replay {"matchId":"…"}`；第一页按接纳顺序列出事件，末尾 `Next` 给出续读命令。

3. 已知某个业务事件的导入 key 时，查出它的稳定 ID，再从它开始读。 {#jump}

   ```sh
   niceeval show @<locator> execution keys --trace match --key tick-184220.kill
   niceeval show @<locator> execution --trace match --from evt_<id>
   niceeval show @<locator> evt_<id>
   ```

   预期输出：第一条命令返回该 key 的 `eventId` 与 evidence 映射；第二条从该事件开始列出后续事件；第三条显示该事件的完整展示块、payload 与关系。

4. 按 `Next` 中的 `--continuation` 续读到轨迹末尾。 {#continue}

   预期输出：每页事件数与字节数受固定页大小限制，续读不重复、不跳过事件，最后一页没有 `next-page` link。

5. 取消一局进行中的 Attempt，再查看它的 outline。 {#cancel}

   预期输出：Attempt 为 `cancelled` 或 `errored`，与轨迹完整性分开显示。
   producer 在 cleanup 预算内交出 `end` 时，轨迹显示 producer 声明的 `match-cancelled`。
   producer 没有及时结束时，轨迹显示 `niceeval.trace-stream-cut` 与舍弃条数，outline 只列出可验证的前缀。

## 结果

| 情形 | 轨迹 collection | outline 内容 | Attempt |
|---|---|---|---|
| 正常结束并声明 complete | `complete` | 全部事件 | 按断言决定 |
| producer 声明 partial | `partial`，producer 的 limitation | 全部已提交事件 | 与轨迹无关 |
| 迭代器抛错、未交出 `end` 或接纳时段结束 | `partial`，`niceeval.trace-stream-cut` | 最长有效前缀 | 与轨迹无关 |
| 事件非法、key 重复或引用缺失 | 该 trace 没有快照，登记采集失败 | 无此 trace | 与轨迹无关 |
| 数据库写入失败 | — | Attempt 不发布 | 按发布失败处理 |

## 完成判据

- 一条 30–90 分钟量级、几十万条事件的流完整提交，期间框架持有的内存不随事件数增长。
- 从 `show` 与 View 两个实际入口都能看到目标事件，`execution keys` 与 `--from` 直接定位，不需要从头翻页。
- 续读覆盖整条轨迹，每页受固定页大小限制。
- 取消后的 Attempt 在 `show` 与 View 中显示可验证前缀及其缺口原因；`archive` 只被显示，读取过程不访问游戏服务器。

契约由 [流式提交事件](../library/README.md#流式提交事件)、[外部存档出处](../library/README.md#外部存档出处)
与 [按导入 key 查找](../../inspection/cli.md#按导入-key-查找) 定义。
