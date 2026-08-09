# 从脚本复核事实

你需要自定义审计逻辑，不想让脚本依赖页面字段或可变的最新 head。
脚本先打开 Record，再固定这次读取的 `RecordGraphRef`；随后得到的 Run、Contribution 与 Attempt handle 都绑定同一 revision。

```ts
import { join } from "node:path";
import {
  builtins,
  openRecord,
  openRecordStore,
} from "niceeval/record";

const root = join(process.cwd(), ".niceeval");
await using store = await openRecordStore(root);
await using record = await openRecord(store);
const attempt = await record.resolveAttempt("@01J8ZK3M6P4T7V9X2C5N8QW0RY");

for await (const observation of attempt.observations().events()) {
  if (observation.state === "available") {
    console.log(observation.event.name, observation.event.stream.sequence);
  } else {
    console.warn(observation.causes);
  }
}

const verdict = await record.project(attempt, builtins.verdict);
console.log(record.ref, verdict);
```

直接遍历 Observation 适合自定义取证；稳定的 execution、timing、usage、diff、Assertion 与 Verdict 读面使用 Projector。
Projector 通过 `ProjectionReadContext` 读取事实，框架自动形成 `basedOn` 和 verification，脚本不需要猜哪些文件构成依据。

若 locator 来自多份已显式打开的 Record，使用 `recordId:@locator` 消除歧义。
需要稍后重开同一 revision 时保存完整 `RecordGraphRef`，并调用 `openRecordGraph(store, ref)`；
再次调用 `openRecord(store)` 才表示接受该调用时 bound Layout 的 head。
