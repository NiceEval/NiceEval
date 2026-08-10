# Record 架构

本页是 Record 的唯一落盘契约。核心文件中的对象都是精确对象：未列出的字段不存在，出现未知字段即为 invalid。通道内容可以演进，但不能借核心文件悄悄改变协议。

## 根目录与停稳边界

bundled CLI 将项目 root 映射到 <code>&lt;project&gt;/.niceeval/record/</code>。该目录的完整布局如下。

```text
record.json
runs/<encoded-runId>/run.json
runs/<encoded-runId>/members/<encoded-slotId>.json
runs/<encoded-runId>/channels/**
runs/<encoded-runId>/blobs/sha256/<digest>
attempts/<encoded-attemptId>/attempt.json
attempts/<encoded-attemptId>/channels/**
attempts/<encoded-attemptId>/blobs/**
.tmp/<writerId>/**
```

Invocation 没有目录。它只通过 Runner 或 Library 返回的 <code>InvocationReceipt</code> 表示。

停稳表示该 root 没有 active writer、reader 或受控编辑。所有受支持的 root 操作先取得同一把跨进程 operation lock。Sample 与 ReportInput 的构造发生在 reader 持锁期间；writer 从规划前一直持锁到本次全部 Run 收尾。受控编辑、删除和 clean 也在完整检查与修改期间持锁。

operation lock 由操作系统绑定进程或文件描述符，并在进程退出时释放。它不是带超时的 lease，不允许接管，也不把锁文件内容当作 owner 真源。实现先对最近存在祖先执行 symbolic-link resolution，再把剩余规范路径拼回，以同一个 physical root 作为锁身份；路径别名不能取得第二把锁。

锁锚是 canonical physical root 的 sibling <code>&lt;root-basename&gt;.niceeval-operation-lock</code>，因此 root 不存在时也能先加锁。所有 create/open/maintenance 入口都先锁定锚，再检查或建立 root。锚是保留的普通文件，内容永远无义，受控操作不删除或替换它。平台无法提供进程崩溃释放的跨进程互斥时，入口以 <code>record-operation-lock-unsupported</code> 失败。

同一 root 的 writer、reader 和受控编辑互斥，本格式不支持并发快照或多 writer 合并。直接使用其它编辑器改写文件会绕过 operation lock；这种并发修改不在支持范围内，也没有 revision 或 hash 用来检测。ReportExecution 形成后已经自包含，view 与静态 export 不再持有或读取 Record。运行中的反馈由 Runner 处理。

根文件精确为下列对象，不能附加字段。

```json
{ "format": "niceeval.record" }
```

根目录只接受这份核心布局。其它根文件统一是 <code>record-format-invalid</code>，reader 不再细分其成因。

## 核心文件

下列 TypeScript 形状既定义字段，也定义字段穷尽性。<code>channels</code> 保存尚未解码的 JSON entries，不是通道数据的内联副本。reader 逐项解码，不能因一项损坏而拒绝整个 Run 或 Attempt 核心。

```ts
type RunDocument = {
  runId: RunId;
  experimentId: ExperimentId;
  startedAt: UtcMillis;
  completedAt?: UtcMillis;
  expectedSlots: readonly ExpectedSlot[];
  channels: readonly JsonValue[];
};

type ExpectedSlot = {
  slotId: SlotId;
  evalId: EvalId;
  attempt: number;
};

type MemberDocument =
  | {
      kind: "executed";
      runId: RunId;
      slotId: SlotId;
      attemptId: AttemptId;
    }
  | {
      kind: "carried";
      runId: RunId;
      slotId: SlotId;
      attemptId: AttemptId;
    }
  | {
      kind: "accepted";
      runId: RunId;
      slotId: SlotId;
      attemptId: AttemptId;
    };

type AttemptDocument = {
  attemptId: AttemptId;
  origin: { runId: RunId; slotId: SlotId };
  eval: { evalId: EvalId; attempt: number };
  channels: readonly JsonValue[];
};

type ChannelDescriptor = {
  name: ChannelName;
  path: ChannelPath;
  mediaType: ChannelMediaType;
  coverage: Coverage;
};

type ChannelName = string;
type ChannelPath = string;
type ChannelMediaType = string;
type AttemptBlobRef = string;
type RunSourceBlobRef = string;

type Coverage =
  | { state: "complete" }
  | { state: "partial"; reason: string }
  | { state: "unavailable"; reason: string };

type CollectedCoverage = Exclude<Coverage, { state: "unavailable" }>;
type UnavailableCoverage = Extract<Coverage, { state: "unavailable" }>;
```

<code>ExpectedSlot.attempt</code> 是非负安全整数。每个 Run 的 <code>slotId</code> 唯一，<code>(evalId, attempt)</code> 也必须唯一。一个 Member 文件只对应一个已声明 slot；Member 的目录名、文件内容和 Run 身份必须逐项一致。

Member 指向的 Attempt 必须存在，且它的 <code>eval</code> 与目标 slot 相符。<code>executed</code> 还要求 Attempt 的 <code>origin</code> 是同一个 Run 和 slot。<code>carried</code> 与 <code>accepted</code> 可以采用另一个 origin 的 Attempt。

每个 Attempt 还必须通过反向 origin 校验：origin Run 存在，origin slot 属于它的 expected slots，且该 slot 的 <code>executed</code> Member 指回同一个 <code>attemptId</code>。缺少任一环都使 Attempt 在当前导航中 invalid。目录已经发布但没有这条反向锚的 Attempt 是 unanchored orphan；它不是业务数据、不能成为 carry 或 accept 候选，也不能经 locator 打开。

rename 不形成第四种 Member。carry、accept、rename 的上下文、provenance 和 diagnostics 写入 Run 的通道，并以 <code>slotId</code> 和 <code>attemptId</code> 关联。Member 不复制这些事实，也不复制 Attempt 的业务值。

<code>reason</code> 是非空 NFC 文本，说明该通道的局部原因。内建的未采集和不适用分别使用 <code>not-collected</code> 与 <code>not-applicable</code>。截断、脱敏、采样、过滤和近似的业务影响不进入永久 descriptor；若它们使承诺的持久集合不完整，coverage 是 <code>partial</code>，细节由具名通道自己表达。

<code>invocationId</code> 不属于 Run 核心。需要调用 provenance 的 writer 可以写可选的 Run-owned <code>niceeval.run-provenance</code> document；它缺失时只让请求该事实的消费者得到 unavailable。<code>InvocationReceipt</code> 仍返回本次调用的身份、Run 与起止时间。

## 身份、路径与时间

<code>runId</code>、<code>slotId</code>、<code>attemptId</code> 和 <code>invocationId</code> 都是 128-bit opaque ID。它们的规范字符串都是 26 个大写 Crockford Base32 字符。

- 字母表为 <code>0123456789ABCDEFGHJKMNPQRSTVWXYZ</code>。
- 首字符只能是 <code>0</code> 到 <code>7</code>。
- <code>I</code>、<code>L</code>、<code>O</code> 和 <code>U</code> 不合法。
- 文件路径只使用对应 ID 的规范编码，不使用显示名或摘要。

Attempt locator 是 <code>@</code> 加完整 <code>attemptId</code>。它可逆地表达全部 128 bit，不截短、不散列，因此没有摘要碰撞的寻址歧义。

<code>experimentId</code> 和 <code>evalId</code> 是 NFC Unicode、大小写敏感的文本。它们不参与目录路径。

所有时间使用精确的 RFC 3339 UTC 毫秒形式：<code>YYYY-MM-DDTHH:mm:ss.sssZ</code>。<code>startedAt</code> 是 Run 在持锁 writer 内建立的时点；<code>completedAt</code> 是初始 writer 停止拥有该 Run 的时点，不表示内容从此冻结。

latest 对每个目标 Experiment 分别选择一个存在 <code>completedAt</code> 的 Run。目标集合由调用方明确给出，或由所有可读 Run 核心中的 Experiment identity 推导；每组按 <code>completedAt</code> 升序，再按 <code>runId</code> 的 UTF-8 bytes 升序稳定排序，并取最后一项。目标集合为空或任一目标组没有完成 Run 都明确失败。未完成的 Run 只能通过显式选择读取。

扫描器按规范 encoded ID 的 UTF-8 bytes 升序处理目录。重复 identity、目录与内容身份不符、或任何 case-fold 冲突都为 invalid。

## 通道目录与文件归属

Run 和 Attempt 各自拥有自己的 <code>channels</code>。同一 owner 内，descriptor 的 <code>name</code> 和 <code>path</code> 各自唯一，且两者都必须在 case-fold 后仍唯一。重复、case-fold 冲突或 path overlap 只使参与冲突的 descriptor 无效，不使无关通道或 Attempt 核心失效。

<code>ChannelName</code> 是 3 至 253 个 lowercase ASCII 字符组成的反向域名。它至少含两个点分 label；每个 label 长 1 至 63，只含 <code>a-z</code>、<code>0-9</code> 和内部连字符，首尾必须是字母或数字。任何大写、Unicode 或空 label 都非法。

<code>ChannelPath</code> 是 lowercase ASCII POSIX 相对路径，总长不超过 240 bytes。它必须以 <code>channels/</code> 开头；之后至少一段，每段长 1 至 80，只含 <code>a-z</code>、<code>0-9</code>、点、下划线和连字符，首尾必须是字母或数字。它拒绝空段、点段、反斜线、NUL、绝对前缀，以及彼此重叠或互为前缀的路径。

<code>AttemptBlobRef</code> 使用相同的 segment、长度和 canonical ASCII 规则，但必须以 <code>blobs/</code> 开头。它只能出现在 Attempt-owned 专用通道 document 中，不能出现在 Run 通道或 generic custom fact。

<code>RunSourceBlobRef</code> 精确为 <code>blobs/sha256/&lt;digest&gt;</code>。digest 是源文件原始 UTF-8 bytes 的 SHA-256 小写十六进制值。它只由 Run-owned <code>niceeval.sources</code> decoder 使用，不是全局内容地址、Record identity 或防伪证明。

<code>ChannelMediaType</code> 是不带参数的 lowercase ASCII <code>type/subtype</code>，总长不超过 127 bytes。type 与 subtype 各长 1 至 63，首字符是字母或数字，其余只含字母、数字、<code>!</code>、<code>#</code>、<code>$</code>、<code>&amp;</code>、<code>^</code>、<code>_</code>、点、加号或连字符。

所有 descriptor 字符串只接受上述 canonical ASCII，因此 NFC 与 Unicode case-fold 没有多种结果；case-fold 固定为逐 byte 的 ASCII lowercase。输入本来就必须 lowercase，所以 exact uniqueness 同时兑现 case-fold uniqueness。

每个 raw entry 单独解码为有效 descriptor 或具名 issue。只有 raw 字段本身是 string 且满足对应完整 canonical 语法时，才算安全读出 <code>name</code> 或 <code>path</code>。损坏 entry 若仍能安全读出 name，只让该名称的请求 invalid。owner 中存在无法安全读出 name 的 entry 时，任何没有匹配到有效同名 descriptor 的请求也返回 invalid；reader 不能把未知损坏 entry 冒充成 unavailable。明确匹配到其它有效名称的请求仍可独立读取。writer 遇到无法安全识别 name 或 path 的 entry 时，把该 owner 当作只读，避免误改未知数据。

reader 必须先验证完整 descriptor 语法，再以不跟随 symbolic link 的方式读取 path；非法 path 只使该 descriptor 对应的请求 invalid。

通道文件只能归其 descriptor 的 owner。Run 和 Attempt 不共享文件，也不借 link 指向彼此的目录。Attempt 内的 blob 只能由该 Attempt 的通道引用；blob 不跨 Attempt 去重。Run source blob 只在同一个 Run 内按 digest 去重。reader 通过 decoder context 读取普通、非 symbolic link 文件，不把磁盘路径交给 Report。

descriptor 未引用的 channel 文件和 source manifest 未引用的 Run blob 不参与读取，也不让 owner invalid。它们只能随 owner 删除；没有独立 GC。被 descriptor 或 manifest 引用的文件缺失、越界或内容不符时，对应请求 invalid。

<code>mediaType</code> 只描述字节编码，不承载语义版本。每个内建 decoder 按 <code>name</code> 限制可接受的编码；同一编码不能让两个不同名称自动共享语义。

Coverage 说明持久化集合的状态。它不说明 reader 是否完全解码，也不能被 decode 结果改写。

## 通道语义与兼容性

内建 channel 和 event 名称都是 <code>niceeval.&lt;descriptive-concept&gt;</code>。名称不得带数字版本后缀，发布后也不得复用含义。

自定义 JSON 事实的 descriptor <code>name</code> 使用用户的反向域 namespace，并永不复用含义；<code>niceeval.*</code> 只保留给内建通道。它的通用 transport 精确为下列 document，media type 只能是 <code>application/json</code>。

```ts
type CustomFactDocument = {
  observedAt: UtcMillis;
  value: JsonValue;
};

const CUSTOM_FACT_MAX_BYTES = 65_536;
```

同一 owner 与 name 只允许一个自定义 document。第二次写入是 typed write error，不替换旧值、不追加；多值由调用方一次写成 JSON array。

writer 补齐 <code>observedAt</code> 后，以 ECMAScript <code>JSON.stringify(document)</code> 的紧凑结果计算 UTF-8 byte length。超过 65,536 bytes 时，<code>fact()</code> 以 <code>record-custom-fact-too-large</code> 拒绝，且不建立 descriptor 或文件。

人工编辑得到的超限 document 在读取时是同名 <code>ChannelRead.invalid</code>。未知字段、非法 <code>observedAt</code>、非 JSON value 或无效 UTF-8 同样 invalid。通用自定义事实不支持 JSONL、blob 或任意路径查找。

兼容添加只能是可选字段，或旧 decoder 可以忽略的 event variant。删除、改名、改类型、改判别方式或改含义时，必须发布全新的描述性 channel 或 event 名称。

若两个互斥的 channel 同时声称表达同一个 normalized fact，只有请求该 normalized fact 的读取成为 <code>channel-semantic-conflict</code> invalid，并列出参与冲突的 descriptor。reader 不猜测优先级，也不让无关通道失效。

新 reader 必须打开每一份核心形状有效的 <code>niceeval.record</code>。未知或已退役 channel 仅使该通道成为 unsupported，不使无关事实或整个 Record 失败。旧 reader 打开带新通道的 Record 时，仍读取核心文件并保留未知 descriptor。

<code>niceeval.verdict</code> 与 <code>niceeval.eligibility</code> 是仅有的 planner-critical channel。两者都是 Attempt-owned <code>application/json</code> document，payload 是精确对象且永久不扩展。

```ts
type VerdictDocument = {
  state: "passed" | "failed" | "errored" | "skipped";
};

type EqualityToken = {
  domain: string;
  value: string;
};

type DurationToken = {
  domain: string;
  milliseconds: number;
};

type EligibilityDocument = {
  inputIdentity: EqualityToken;
  configIdentity: EqualityToken;
  executionDuration: DurationToken;
};
```

所有嵌套对象同样精确。未知字段、缺失字段、其它 Verdict 判别值或其它 media type 都使该通道 invalid。<code>domain</code> 和 <code>value</code> 是非空 NFC 文本；<code>milliseconds</code> 是非负安全整数。Assertion、diagnostic 引用和人读摘要属于其它业务通道，不进入 Verdict。

<code>niceeval.assertions</code> 是 Attempt-owned、<code>application/json</code> 的永久 presentation channel。它不进入核心，也不参与 planner 或 carry；其冻结 document、限制与派生规则由 [Assertions Architecture](../assertions/architecture.md#稳定落盘投影) 单点定义。

永久 presentation 表示 decoder 与标准消费链都不能退役：Attempt → <code>niceeval.assertions</code> → 内建 decoder → 标准 FactRequirement → 标准 Attempt detail。未来的新 Assertions 语义使用新的描述性 channel，但旧通道仍能从显式选择的旧 Run 进入标准详情。

<code>niceeval.sources</code> 是 Run-owned、<code>application/json</code> 的源码快照清单。实际源码只保存在同一 Run 的 digest blob 中；carried 或 accepted Member 不复制它。document 是精确对象：

```ts
type SourcesDocument = {
  files: readonly SourceSnapshot[];
  limitations: readonly SourceLimitation[];
};

type SourceSnapshot = {
  path: string;
  digest: Sha256Digest;
  byteLength: number;
};

type SourceLimitation = {
  kind: "truncated" | "redacted" | "omitted";
  path: string;
  reason: string;
};

type Sha256Digest = string;
```

<code>path</code> 使用 Assertions source path 的项目相对 POSIX 规则。<code>digest</code> 精确为 64 个 lowercase hex 字符；<code>byteLength</code> 是非负安全整数。每个 <code>(path, digest)</code> 唯一，同一路径可以有多个内容版本；相同 digest 在 Run 内只保存一份 <code>blobs/sha256/&lt;digest&gt;</code>。blob 必须是合法 UTF-8，实际 byte length 与 SHA-256 必须匹配清单，否则该 fact invalid。

collection complete 要求 <code>limitations</code> 为空。collection partial 要求至少一项 limitation，并逐项说明截断、脱敏或未纳入的路径与原因。collection unavailable 不写 document 或 blob。decoder 只返回结构化源码值和 bytes，不暴露 Record root 或实际路径。

自动 carry 只使用下列输入：

- 完整 Verdict；
- 完整 eligibility 中两项 identity 的同 domain 相等比较；
- execution duration 的同 domain timeout 比较；
- 本次 Invocation 的 <code>--rerun</code> 和 <code>--keep-sandbox</code> policy。

<code>--keep-sandbox</code> 直接关闭本次自动 carry。planner 只有在两个通道均为 <code>read</code>、collection complete、decoding complete 且 payload 通过精确校验时才比较；其它状态一律具名说明并执行。

identity 配方加入输入时必须更换对应 domain，不能在同一 domain 下改变闭包。新持久 gate 若无法归约为现有 identity、duration 或本次 policy，就不能参与本格式的自动 carry，也不能新增 planner-critical channel；产品若必须加入它，必须更换整个格式名，让旧 planner 在根格式处失败。

[Observability 标准通道表](../../observability.md#内建业务通道闭环)中的 decoder、branded FactRequirement 与标准 presentation 都永久保留。表外的非 planner-critical 内建 decoder 可以退役；退役后，只有依赖该通道的 detail 或 Calculation 成为 unsupported。

## Eligibility、duration 与采用

eligibility 保存 opaque equality token。input 与 config identity 都使用上文冻结的 <code>{ domain, value }</code>。

只有 <code>domain</code> 逐字相同才比较 <code>value</code>。输入配方改变时发布新的 domain，不能猜测两种 domain 兼容。

duration 保存 <code>{ domain, milliseconds }</code>。<code>milliseconds</code> 是非负安全整数，由该 domain 定义的 timeout 区间以单调时钟向上取整得到。

carry 的 timeout 判断只比较当前认可且 domain 相同的 duration。domain 不同意味着不可采用，不能通过数值比较补猜结果。

## 混合存储与可见性

按发生顺序、高频、追加量大，且未知 variant 可以安全保留的事实使用 JSONL event channel。例如包含 message 与 tool event 的 conversation，以及 diagnostics。

单一终态值、需要人工直接编辑的值，或需要高频随机读取的值使用 document channel。例如 verdict、eligibility、assertions、usage、timing summary、diff 和 commands manifest。sources 使用 Run-owned document 与 Run-local digest blobs。

大文本或二进制内容使用 Attempt-owned blob。通道 document 保存对本 Attempt blob 的引用，不让 blob 成为跨 owner 的共享对象。

writer 必须先在 <code>.tmp/&lt;writerId&gt;/</code> 内完整形成 Attempt 目录，再以同一文件系统的一次目录 rename 发布到不存在的正式 Attempt 路径。正式 Attempt 缺少 <code>attempt.json</code> 一律为 invalid。发布后的 Attempt 对 writer 是只读整体；后续业务修改只允许用户在 root 停稳时人工完成。

新 <code>run.json</code>、Member、Run descriptor/coverage 更新和最终 <code>completedAt</code> 更新，也必须先在本 writer 的临时目录形成同文件系统普通文件。Run source blob 在 descriptor 可见前完成写入、校验和去重。writer 精确校验、flush/fsync 并 close 后，再用单文件 rename 或 atomic replace 发布；每次 rename 后还 fsync 对应 parent directory。平台无法提供所需原语时写入失败，不能降级为直接截断正式 JSON。

单文件替换和新 Attempt 目录发布具有 crash atomicity。一次受控编辑若跨 descriptor 与 payload、多个通道或多个核心文件，只保证 operation lock 内互斥，不承诺崩溃后的全有或全无。中断后 reader 按普通规则返回 channel-local 或 core invalid；实现不能为此重新引入 journal、revision、Graph 或 Store 事务。

正常退出时，writer 只删除自己的临时目录。崩溃留下的 orphan 只能在目录停稳后由 owner-aware clean 删除；clean 不得删除另一个 writer 的临时目录。

受控删除在 operation lock 内先穷尽反向引用。删除 Run 会同时影响它的 Member、Run-owned facts、source blobs 和以它为 origin 的 Attempt；只要目标外仍有 Member 引用这些 Attempt，普通删除就拒绝且零写入。强制的直接文件修改可以留下 dangling reference，下一次读取必须明确诊断为 invalid。

unanchored Attempt 只允许由显式 orphan clean 删除。clean 在同一把锁内扫描全部 Run、Member 与 Attempt，重新确认目标没有有效 origin 锚且没有 Member 引用，再按明确的 <code>attemptId</code> 删除；它不把正式且可达的历史数据当作可回收缓存。

## 格式演进边界

本格式取消全局整数格式版本，但不允许核心协议漂移。下列变化必须更换整个格式名：

- identity 的 owner、编码或唯一性；
- expected membership 的含义；
- Member 的三态或引用规则；
- Attempt origin；
- Run 的 identity、<code>experimentId</code>、<code>startedAt</code>、<code>completedAt</code> UTC 毫秒语义与 latest 排序；
- Attempt 的 identity 与 <code>eval</code>；
- channel descriptor、path 或 coverage 协议；
- root layout 或原子可见性规则。

新增领域事实、可选字段、可忽略 event variant、未知 channel 或允许退役的局部 decoder，都不属于全局格式变化。它们遵守通道名称和局部 unsupported 规则；Observability 标准通道表中的 decoder 与消费链不在可退役集合内。

## 读取不变量

错误作用域固定为五层。

| 层级 | 例子 | 结果 |
|---|---|---|
| root-global | root、权限/I/O、精确根文件或根级保留布局无效 | open reader 失败 |
| selection-global | 显式 Run 无法形成 expected slots、latest 候选不穷尽、额外 Member | Sample selection 失败 |
| slot-local | 已声明 slot 的 Member 或 Attempt 核心/引用错误 | 该 slot 为 invalid |
| channel-local | descriptor、文件、字节或 semantic conflict 无效 | 对应 ChannelRead invalid |
| consumer-local | Report-local parser 或已声明输入失败 | 对应 consumer result 失败 |

<code>openRecordReader()</code> 只验证 root、精确 <code>record.json</code> 与根级保留布局，不扫描全部 Run、Member、Attempt 或 descriptor。Record root、保留目录、Run/Attempt 目录和全部核心 JSON 都必须是普通且非 symbolic link 的对应文件类型；每次导航都以 no-follow 操作核对。

显式选择只读取所选 Run 及其引用；未选择 Run 的内容错误不阻断它。导航一个 namespace 时可以扫描同级 entry metadata、规范名字、重复与 case-fold 冲突，但不能跟随 link 或读取未选择实体的内容。root 或根级保留目录是 link 属于 root-global；所选 Run 目录或 <code>run.json</code> 是 link 属于 selection-global；Member、Attempt 目录或它们的核心文件是 link 属于 slot-local。latest 必须读取每个 Run 核心，因此候选中的 link 使选择失败。

latest 必须穷尽所有可能候选；任一 Run 无法可靠提供 <code>runId</code>、<code>experimentId</code> 或 <code>completedAt</code> 时 selection 明确失败，不能静默跳过。已选 Run 下没有对应 expected slot 的额外 Member 同样使该 Run selection 失败。已声明 slot 的 Member 或 Attempt 核心引用错误只进入该 slot 的 invalid 状态。

通道按下列顺序读取：

1. 已知 requirement 没有同名 descriptor 时返回 unavailable，reason 为 <code>not-collected</code>。
2. 逐项解码 raw descriptor entries，并只关联同名 entry；同名 entry 损坏时该通道 invalid，不能触碰其 path。
3. coverage unavailable 要求文件不存在；不存在时直接返回 unavailable，即使没有 decoder。文件存在是 <code>channel-unavailable-has-file</code> invalid。
4. complete 或 partial 要求普通、非 symlink 文件存在；缺失是 <code>channel-file-missing</code> invalid。
5. collected channel 没有可用 decoder 时返回 unsupported，不猜测字节。自定义 JSON requirement 提供的固定 transport 与局部 parser 是明确 decoder，不把其它未知 channel 自动当成自定义事实。
6. 已知 decoder 遇 media type 不匹配、文件级非法编码或无法建立值时返回 invalid。只有可隔离的逐 event 问题才返回 read 与 decoding partial。

持久化 collection coverage 与 decode coverage 永不折叠。未知 event 可能使一个已知 JSONL 通道的 decoding 成为 partial，但不改变该通道的 durable coverage。

未请求的未知或 invalid 通道不阻止其它通道读取、Sample 形成或静态 export。被请求的 invalid 通道必须失败；被请求的 unavailable 或 unsupported 通道可由页面明确呈现。

人工删除通道文件是 <code>channel-file-missing</code> invalid。损坏和越界同样是 invalid。它们都不能伪装成未采集；unsupported 也不等于业务上的 unavailable。目录停稳是调用前置条件；本格式没有 revision/hash，因此不承诺检测读取期间的并发修改。
