# bub trace 静默消失:tapestore-otel 插件被 TapeEntry 类身份漂移打死

## 现象

bub 的 eval 跑完没有 `trace.json`、runner 日志里没有 `trace:N span` 行,其余一切正常(events/断言/用量都在)。同一台机器上 07-06 的 run 还有 trace,07-07 就没了——niceeval 代码零改动(`src/agents/bub.ts`、`src/o11y/otlp/*` 自 v0.3.0 起无 diff)。

沙箱里 bub 的 stderr 有 `tapestore.otel.export_failed` warning + pydantic `ValidationError: Input should be a dictionary or an instance of TapeEntry … input_type=TapeEntry`(值就是 TapeEntry 却被判不是),但 adapter 只读 tape、不读 stderr,所以这条线索在 eval 侧不可见。

## 根因

bub ≥ 0.3.10 把 tape 模块 vendor 成 `bub.tape`(不再从 `republic` 取),运行时构造的是 `bub.tape.TapeEntry`;而 `bub-tapestore-otel` 插件的 pydantic 投影模型用 `from republic import TapeEntry` 做字段校验——两个类字段完全相同但身份不同,isinstance 校验失败,`OTelTapeStore.append` 把异常吞成 warning → 每条 entry 都发不出 span → 0 trace。

触发条件是**全新安装**:`ensureBub` 的 install spec 未锁 bub 版本(`--prerelease allow` + fork 分支会移动),`~/.cache/niceeval/bub-checkpoint-*.bin` 存在时复用旧安装不受影响,缓存被清(或 INSTALL_HASH 变化)后新装才踩中。这也是"昨天还好好的、今天突然没 trace"的原因。

## 修法

**已切回上游(2026-07-11)**:给上游发的 PR bubbuild/bub-contrib#49 被 close,维护者自己的 #50(feat: compatibility with bub 0.3.10dev,2026-07-09 merge)覆盖了类漂移问题——插件全面改为 `from bub.tape import TapeEntry`,不再从 `republic` 导入。`OTEL_PLUGIN` 默认值已改指上游 main(插件不发 PyPI,git 依赖是唯一装法);上游要求 bub ≥ 0.3.10dev,与 `BUB_OVERRIDE` fork 分支(基于 0.3.10dev)兼容,插件导入的 `TapeEntry/TapeStore/AsyncTapeStore/TapeQuery/is_async_tape_store` 在 fork 的 `bub.tape` 里都有。注意 `BUB_OVERRIDE` 本体 fork **不能**一起退役:上游 `model_runner.py` tool-call 分支仍是 `response_text=None`,86fbd0fe 的修复没进上游。

当时修在插件 fork(`CorrectRoadH/bub-contrib` 分支 `fix/tapestore-otel-tape-entry-validation`,commit `7c84cc7`):

1. `TapeEntry` 优先 `from bub.tape import`,ImportError 回退 `republic`(兼容新老 bub);
2. `TraceProjection.entries` 类型放宽为 `list[Any]`——entries 是内部载荷,对它做类身份校验只会在未来任何一次漂移时把全部 span 再次静默吞掉。

修完要 `rm ~/.cache/niceeval/bub-checkpoint-*.bin`(INSTALL_HASH 只含 spec 字符串,分支 tip 动了 hash 不变,不清缓存装不到新代码)。验证:重跑后 runner 日志出现 `trace:27 span`、trace.json 落盘。

## 复现/验证工具(下次可照抄)

- 宿主机直接驱动插件全链路,不依赖外部代理:mock OpenAI(SSE chat.completion.chunk + usage)+ `makeTraceReceiver` 起在本机,`BUB_API_BASE` 指 mock、`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 指 receiver,跑一条 `bub run`。一次就能看到 `export_failed` 或 span 到达。
- receiver 的 protobuf 解析路径此前零测试覆盖,已补 `src/o11y/otlp/parse.test.ts`(手编码 OTLP protobuf,不引 opentelemetry 依赖)。

## 待复盘

bub 安装 spec 不锁版本是刻意的(跟上游 fork 分支走),代价就是这类漂移。若再发生第三次,考虑把 `BUB_OVERRIDE`/`OTEL_PLUGIN` 钉到 commit 而不是分支,代价是升级要手动动 spec。
