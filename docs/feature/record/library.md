# Record Library

Library 接收的 root 永远是实际 Record root。它不会补接 <code>.niceeval</code>、<code>record</code> 或其它后缀。bundled CLI 才负责把项目 root 映射到默认位置。

Library 只面向单操作 root。调用方必须让 reader、writer 和人工编辑互不并发；同时取得第二个 lease 以 <code>record-root-busy</code> 失败，不产生快照、合并或 last-write-wins 语义。ReportExecution 形成后的 view/export 不再访问 root，不占用 lease。

## 创建与打开

```ts
type RecordRoot = string;

function createRecordWriter(input: {
  root: RecordRoot;
  writerId: string;
}): Promise<RecordWriter>;

function openRecordWriter(input: {
  root: RecordRoot;
  writerId: string;
}): Promise<RecordWriter>;

function openRecordReader(input: {
  root: RecordRoot;
}): Promise<RecordReader>;

interface RecordOperation {
  [Symbol.asyncDispose](): Promise<void>;
}

interface RecordWriter extends RecordOperation {
  readonly root: RecordRoot;
  readonly writerId: string;
}
```

<code>createRecordWriter()</code> 只认领不存在的精确 root，并写入唯一的 <code>record.json</code>。它不领养已有目录、父目录或 sibling。

<code>openRecordWriter()</code> 与 <code>openRecordReader()</code> 只先验证根目录、精确根文件和根级保留布局。它们不 eager 扫描全部 Run、Member、Attempt 或 descriptor；具体导航入口按 [Architecture](architecture.md#读取不变量) 的错误作用域验证。

<code>writerId</code> 是一个不透明、单段的目录身份。它不能包含分隔符、点段、NUL 或绝对前缀。writer 只可创建和删除自己的 <code>.tmp/&lt;writerId&gt;</code>。

三个 open/create 入口成功时都取得该 root 的独占 lease。推荐用 <code>await using</code> 约束作用域；async dispose 先拒绝新方法调用、等待已经开始的方法结束，再关闭句柄并释放 lease。writer dispose 还删除本 owner 已关闭且未发布的临时内容；进程崩溃才会留下 orphan。dispose 完成后，同一 root 的下一个 open/create 才允许成功。

Runner 在开始本次 Record 规划和任何 Run 写入前取得 writer。它持有到所有本次 Run 已写入 <code>completedAt</code>、<code>InvocationReceipt</code> 已形成，随后 dispose。

CLI show/view 从选择 Sample 到 <code>buildReportInput()</code> 完成持有 reader，随后在执行 Report、启动 server 或 export 前 dispose。<code>clean</code> 在检查与删除本 writer 临时目录的整个操作中持有同一 root lease。

人工编辑者无法由 Library 自动加锁。编辑前必须确认没有 active lease，并在编辑结束前独占该目录。

## Writer

writer 将经过验证的 Run、Member、Attempt、通道 descriptor 和通道字节写入 Record。它负责维持 [Architecture](architecture.md) 的精确对象、目录匹配和通道隔离；调用方不能要求它接受额外核心字段。

一次 Attempt 的写入顺序固定如下：

1. 在自己的临时目录形成完整 Attempt 目录、通道和 blobs。
2. 验证 <code>attempt.json</code>、descriptor、路径、完整度状态和 blob 引用。
3. 以同一文件系统的一次目录 rename 发布正式 Attempt。
4. 写入或更新引用该 Attempt 的 Member 与 Run 局部事实。

第 3 步之前的文件不属于正式 Attempt。第 3 步之后，正式目录缺少 <code>attempt.json</code> 仍是 invalid，而不是可恢复的半成品。

Run 的 <code>run.json</code>（包括 descriptor、coverage 与 <code>completedAt</code>）、Member 和其它可更新核心 JSON，都先写入本 writer 的同文件系统临时普通文件。校验、flush/fsync、close 后再 atomic replace。writer 不能直接截断正式 JSON；平台没有所需原语时写入失败。

打开本 writer 尚未完成的 Run owner 后，writer 只修改调用方明确交付给它的具名通道。其它合法 descriptor 按原值原序保留，对应文件不删不改，也不做垃圾回收。新增 name/path 与任何既有 descriptor 冲突时失败；现有 descriptor 连 name/path 都无法安全读出时，该 Run owner 只读，写入返回 <code>record-owner-descriptor-invalid</code>。正式 Attempt 发布后不再由 writer 打开或更新，因此它的 <code>attempt.json</code>、channel 文件和 blob 总是一起形成、一起发布。

writer 不把 Invocation 建成目录。它只在 Invocation 开始、完成或中断时维护内存状态，并返回下列窄 receipt。

```ts
type InvocationReceipt = {
  invocationId: InvocationId;
  runIds: readonly RunId[];
  startedAt: UtcMillis;
  completedAt?: UtcMillis;
  completion: "completed" | "interrupted" | "failed";
};
```

receipt 不复制 locator、Verdict、usage、cost 或计数。需要这些数据的调用方重新打开 reader，并按明确的 Run、Member 或 Attempt 读取。

writer 的 async dispose 在正常返回或作用域抛错时都删除自己的未发布临时内容。只有进程崩溃、强杀或断电导致 dispose 未完成时才保留现场；目录停稳后，owner-aware clean 才可删除已确认 orphan 的对应目录。

## Reader

```ts
interface RecordReader extends RecordOperation {
  readonly root: RecordRoot;

  record(): Promise<{ format: "niceeval.record" }>;
  runs(): Promise<readonly CoreRead<RunDocument>[]>;
  run(runId: RunId): Promise<CoreRead<RunDocument>>;
  member(runId: RunId, slotId: SlotId): Promise<CoreRead<MemberDocument>>;
  attempt(attemptId: AttemptId): Promise<CoreRead<AttemptDocument>>;
  descriptors(owner: ChannelOwner): Promise<readonly DescriptorRead[]>;

  inspectChannel<T>(input: ChannelRequest<T>): Promise<ChannelRead<T>>;
}

type CoreRead<T> =
  | { readonly state: "read"; readonly value: T }
  | { readonly state: "missing" }
  | { readonly state: "invalid"; readonly issues: NonEmptyRecordIssues };
```

<code>runs()</code> 按规范 encoded <code>runId</code> 的 UTF-8 bytes 升序返回每个目录的 <code>CoreRead</code>。其中任何 invalid 都让 latest indeterminate；显式选择只处理目标 <code>run()</code>。

latest 在每个目标 Experiment 内只考虑 read 且存在 <code>completedAt</code> 的 Run，再按 <code>completedAt</code>、<code>runId</code> 升序稳定排序后各取最后一项。目标集合为空或任一目标组没有完成 Run，都由 Sample 返回 <code>sample-latest-unavailable</code>。未完成 Run 必须显式选择。

<code>missing</code> 让上层按语境形成 run-not-found、not-recorded 或 invalid reference。核心 JSON、identity、目录匹配或 no-follow 失败都进入当前导航的 <code>CoreRead.invalid</code>，并保留非空具名 issues。Sample 把 Member/Attempt 的 invalid 隔离到 slot；它不依赖异常猜测作用域。

reader 先读取 core-only 对象，再按 entry 或单通道请求解码 descriptor。<code>run()</code>、<code>runs()</code> 与 <code>attempt()</code> 返回的 <code>channels</code> 仍是 raw JSON entries；一个坏 entry 不让核心导航失败。<code>descriptors()</code> 逐项返回有效 descriptor 或局部 issue，因此诊断工具也能看到无法关联名称的坏 entry。

```ts
type ChannelOwner =
  | { kind: "run"; runId: RunId }
  | { kind: "attempt"; attemptId: AttemptId };

type ChannelRequest<T> = {
  owner: ChannelOwner;
  name: string;
  decoder?: ChannelDecoder<T>;
};

interface ChannelDecoder<T> {
  readonly mediaTypes: readonly [string, ...string[]];
  decode(
    bytes: Uint8Array,
    descriptor: ChannelDescriptor,
    context: ChannelDecodeContext,
  ): Promise<ChannelDecodeResult<T>>;
}

interface ChannelDecodeContext {
  readAttemptBlob(ref: AttemptBlobRef): Promise<BlobRead>;
}

type BlobRead =
  | { readonly state: "read"; readonly bytes: Uint8Array }
  | { readonly state: "invalid"; readonly issues: NonEmptyIssues };

type ChannelDecodeResult<T> =
  | { readonly state: "complete"; readonly value: T }
  | {
      readonly state: "partial";
      readonly value: T;
      readonly decoded: number;
      readonly total: number;
      readonly issues: NonEmptyIssues;
    }
  | { readonly state: "invalid"; readonly issues: NonEmptyIssues };
```

<code>inspectChannel()</code> 是单通道四态读取边界。Record→Reports composition adapter 按 ReportPlan 调用它，并把每项结果保存在 ReportInput；单个 invalid 不会让其它 requirement 消失。

没有同名 entry 时返回 unavailable。collected entry 没有 decoder 时返回 unsupported。decoder 不接受 media type、throw、返回 invalid/非法联合或无法建立值时，都返回 <code>ChannelRead.invalid</code>；合法 partial 结果映射为 <code>read</code> 与 decoding partial。

只有 Attempt owner 的 decoder context 可以读取 blob。它只接受 canonical <code>AttemptBlobRef</code>，以 no-follow 方式读取当前 Attempt 的普通文件；越界、缺失或 symlink 形成具名 invalid，权限与 I/O 仍由 <code>RecordReadError</code> 拒绝整个调用。Run owner 调用该方法也返回 invalid。decoder 只能取得 bytes，不能取得 root 或实际路径；自定义 JSON parser 完全没有 blob context。

## ChannelRead

durable collection coverage 与 decode coverage 是两条独立轴。它们使用以下穷尽联合，不能折叠成空数组、<code>null</code> 或一个宽泛状态。

```ts
type RecordIssue = {
  code: string;
  message: string;
  path?: string;
};

type ChannelIssue = RecordIssue & {
  channelName: string;
};

type NonEmptyRecordIssues = readonly [RecordIssue, ...RecordIssue[]];
type NonEmptyIssues = readonly [ChannelIssue, ...ChannelIssue[]];

type DescriptorRead =
  | {
      readonly state: "valid";
      readonly index: number;
      readonly descriptor: ChannelDescriptor;
    }
  | {
      readonly state: "invalid";
      readonly index: number;
      readonly raw: JsonValue;
      readonly name?: string;
      readonly path?: string;
      readonly issues: NonEmptyRecordIssues;
    };

type ChannelRead<T> =
  | {
      state: "read";
      value: T;
      collection: CollectedCoverage;
      decoding:
        | { state: "complete" }
        | {
            state: "partial";
            decoded: number;
            total: number;
            issues: NonEmptyIssues;
          };
    }
  | {
      state: "unavailable";
      collection: UnavailableCoverage;
    }
  | {
      state: "unsupported";
      collection: CollectedCoverage;
      descriptor: ChannelDescriptor;
      issues: NonEmptyIssues;
    }
  | {
      state: "invalid";
      collection?: Coverage;
      issues: NonEmptyIssues;
    };
```

<code>complete</code> 或 <code>partial</code> 的 collection 来自 descriptor。decoding 只说明这次 decoder 成功处理了多少内容；未知 event 让已知 JSONL channel 的 decoding 成为 partial，而不改变 collection。

下表固定常见情况的解释。

| 情况 | ChannelRead |
|---|---|
| 已知 requirement 没有同名 descriptor | <code>unavailable</code>，reason 为 <code>not-collected</code> |
| 未采集 | <code>unavailable</code>，reason 为 <code>not-collected</code> |
| 不适用 | <code>unavailable</code>，reason 为 <code>not-applicable</code> |
| 用户删除 channel 文件 | <code>invalid</code>，issue 为 <code>channel-file-missing</code> |
| 损坏、越界或非法路径 | <code>invalid</code> |
| unavailable descriptor 且文件不存在 | <code>unavailable</code>，不要求 decoder |
| unavailable descriptor 却存在文件 | <code>invalid</code>，issue 为 <code>channel-unavailable-has-file</code> |
| collected channel 没有可用 decoder | <code>unsupported</code> |
| 已知 JSONL 的未知 event | <code>read</code>，decoding 为 <code>partial</code> |

<code>inspectChannel()</code> 可返回任一 <code>ChannelRead</code>，让诊断页显示事实状态。未请求的 invalid 或 unknown 通道不阻止其它读取；被请求的 invalid 原样进入该 requirement，并只让对应 consumer 失败。

被请求的 <code>unavailable</code> 与 <code>unsupported</code> 可以进入明确的页面状态。unsupported 不表示业务未采集，invalid 也不表示未采集。

## 内建 decoder

<code>niceeval.verdict</code> 和 <code>niceeval.eligibility</code> 的精确永久 payload、media type 与 carry 完整度前置条件只由 [Record Architecture](architecture.md#通道语义与兼容性) 定义。它们不能增加字段；破坏既有解释时更换完整格式名。

其它内建 decoder 可以退役。退役 reader 仍保留 descriptor，并只将依赖它的 detail 或 Calculation 标为 unsupported。

eligibility decoder 将 fingerprint 与 config identity 读为 <code>{ domain, value }</code>。它只在 domain 逐字相同下比较 value。

duration decoder 将值读为 <code>{ domain, milliseconds }</code>。它拒绝负数和非安全整数，并只允许 carry timeout 比较当前认可的同 domain 值。

## Typed errors

错误对象的 <code>code</code> 是机器契约，message 只服务人读反馈。每个异步入口只使用自己的错误类。

```ts
class RecordCreateError extends Error {
  readonly code:
    | "record-root-invalid"
    | "record-root-exists"
    | "record-root-busy"
    | "record-create-permission-denied"
    | "record-create-io-failure";
}

class RecordOpenError extends Error {
  readonly code:
    | "record-root-missing"
    | "record-format-invalid"
    | "record-core-invalid"
    | "record-root-busy"
    | "record-open-permission-denied"
    | "record-open-io-failure";
}

class RecordWriteError extends Error {
  readonly code:
    | "record-writer-closed"
    | "record-input-invalid"
    | "record-custom-fact-too-large"
    | "record-owner-descriptor-invalid"
    | "record-attempt-publish-failed"
    | "record-write-permission-denied"
    | "record-write-io-failure";
}

class RecordReadError extends Error {
  readonly code:
    | "record-read-permission-denied"
    | "record-read-io-failure";
}
```

<code>RecordOpenError.record-core-invalid</code> 只描述 root 级 <code>record.json</code> 或保留布局。Run、Member 与 Attempt 导航问题由 <code>CoreRead.invalid</code> 返回；descriptor 路径和 semantic conflict 由对应 <code>ChannelRead.invalid</code> 保存。

权限和 I/O 不能伪装成 <code>unavailable</code>、<code>unsupported</code> 或 <code>invalid</code>。reader 已经形成的其它结果保持有效。

## 非职责

Library 不提供跨 Record 复制、发布、同步、共享或历史 revision API。它也不提供页面计算或报告渲染 API。

选择可比较对象属于 [Sample](../sample/README.md)。Record→Reports composition 与静态交付物属于 [Reports](../reports/README.md)；纯 Report runtime 只接收已经形成的内存输入。
