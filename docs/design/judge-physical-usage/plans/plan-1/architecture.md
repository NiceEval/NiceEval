# 账本与证据

## 所属关系

每个已执行 Attempt 恰有一个私有 Judge collector。Assertion runtime 从它获得绑定 entryIndex 的能力，所有 scope 共用。
物理键是 originRunId + originAttemptId + judge + entryIndex + logicalOrdinal + transmissionOrdinal。

局部 callId 为 judge:<entryIndex>:<logicalOrdinal>:<transmissionOrdinal>。entryIndex 从 0 开始，另两项从 1 开始。
登记时固定 entryIndex，延迟 material QA 只使用该能力，不在求值完成后读取 entries.length。

发布时使用同一次 PreparedAssertionsAttachment.entryIds 将 entryIndex 绑定为 entryId，账本保存该正式 ID。
entryId 使用正式 AssertionEntryId Schema；引用不一致为发布错误，不能把数组序号当 detail identity。

Query call 保留 entryId，客户端通过当前 Attempt locator 与 entryId 调用 assertion.detail；origin 由现有身份查找固定。
若详情读取不可用仍保留账本金额和调用行，不能据此抹去费用。
不以模型、Provider、QA 结果、响应 ID 或引用 Run 去重。只登记 NiceEval 发起的 HTTP 请求，不推断网关内部重试。

## 持久形状

新增 Attempt family niceeval.judge-usage，revision 1。不新增 SQL 表，不改写历史应用 usage family。
附件通过现有 attachment manifest/body 事务随 Attempt 发布；所有 current/persistence/reader 注册保持同一 revision。

```ts
interface JudgeUsageCall {
  callId: string;
  entryIndex: number;
  entryId: string;
  logicalOrdinal: number;
  transmissionOrdinal: number;
  operation: "score" | "classify" | "extract" | "batchClassify";
  requestModel: string;
  transportProvider: "openai" | "vercel" | "openrouter" | "typesafe";
  provider: string | null;
  model: string | null;
  status: "succeeded" | "failed" | "cancelled" | "unknown";
  httpStatus: number | null;
  inputTokens: number | null;
  inputTotalTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cost: { amount: string; currency: string; source: { kind: "reported"; id: string } } | null;
  receipt: {
    state: "available" | "unavailable";
    reason: string | null;
    responseDigest: string | null;
    fields: readonly { path: string; value: string | number | null }[];
  };
}
interface JudgeUsageAttachment {
  collection: CollectionState;
  calls: readonly JudgeUsageCall[];
  priceReceipts: readonly JudgePriceReceipt[];
}
```

requestModel、响应 model 和价证 selector 均最长 8192 UTF-8 bytes，保留 Provider 的现有合法输入。
其它身份最长 256 bytes，数值数量为非负安全整数，金额为既有 canonical decimal，币种用既有 CurrencyCode。
不得截断 requestModel 或价证 selector。超长响应 model 记 null 和固定限制原因，不影响独立有效的 token/费用。

HTTP status 为 100–599 或 null。callId 必须由三个序号生成，唯一；同一步重试 ordinal 连续，不跨 entry。
collection complete 说明全部进入边界的请求已登记，不保证远端物理完成或费用已知。
待决请求内部保留 pending，发布前投影 unknown；取消表示本地终止等待，不证明服务端停工。

receipt 只保存白名单字段及完整有界响应的 SHA-256，不保存 Authorization、URL、headers、任意错误消息或业务正文。
fields 最多 24 项，path 最长 128 bytes，字符串值最长 8192 bytes，receipt 最多 32 KiB。
白名单 path 唯一并按字典序排列；只保留已验证的 scalar 字段，不复制 provider error message。

解码非法字段只使对应观察未知，保留固定 reason。receipt available 表示完整 body 可解码且至少一项白名单事实可用。
无 body、取消、超限、非法 JSON、缺少字段分别用 response-unavailable、cancelled、response-too-large、invalid-json、usage-not-reported。
字段值非法用 invalid-usage；独立有效字段仍保留，reason 可与 available 并存。

超大响应不能解码截断 JSON，也不生成完整响应 digest。响应边界保留 httpStatus，费用未知。

## 响应映射

映射只由显式 Provider 协议选择；读取 2xx 与非 2xx 的同层回执，早于 QA 内容解码。
Chat 协议读取 usage.prompt_tokens、usage.completion_tokens、usage.prompt_tokens_details.cached_tokens。

inputTotalTokens 为 prompt_tokens；cache-read 来自 cached_tokens，OpenRouter cache-write 来自 usage.prompt_tokens_details.cache_write_tokens。
只有 read/write 两桶都有明确值且总和不大于 prompt 时，inputTokens 才为 prompt-read-write。

任一 cache 桶缺失为 null，不能把 prompt-cached 当已知 fresh input；当前映射不声明任何字段省略时为零。
prompt 明确为 0 且没有正数/非法/矛盾子桶时，由非负总量证明 input/read/write 均为 0。
子桶和超过总量或与完整互斥桶不一致时，相关 token 指标未知并保存 invalid-usage；不能制造已知费用小计。

usage.total_tokens 用于一致性核对；totalTokens 由已知 inputTotalTokens+outputTokens 推导，不再加 cache 或 reasoning。
矛盾或负数不静默修正，相关指标未知；其它独立有效费用仍可保留。

Vercel Chat 的 reported 金额与 serving provider 保持未知；当前没有经核对的原始 Chat 回执证明这两个字段的协议路径。
已保存的 Responses JSON 中 provider_metadata.gateway.cost 与 provider_metadata.gateway.routing.finalProvider 仅证明 Responses，不授权 Chat 映射。

人工构造的 Chat fixture 只验证 token 与显式 pricing，不作为供应商费用路径的证据。
OpenRouter 的金额读取 usage.cost，币种 USD；serving provider 读取响应 provider。OpenAI 与 TypeSafe 没有正式费用字段时保持未知。
model 只读取响应 model；请求配置单独在 requestModel，不冒充实际模型。transportProvider 永远是显式 Provider 类型。

TypeSafe systemone 读取 usage.input_tokens 为 inputTotalTokens，usage.output_tokens 为 outputTokens，先于 answers 解码。
20/10 回执得到 totalTokens=30；三次传输合计 60/30/90，能力拒绝不增加调用。
其 cache 桶与互斥 fresh input 无证明为 null；费用无已支持字段时仍未知。

金额允许有限非负 number 或 canonical decimal string，number 先走既有精确定点转换；reported 0 永远优先。
这些路径以协议资料和真实 fixture 为证，不按 hostname 或模型前缀推导 provider。

## 显式估价

复用 defineConfig.pricing 的 exact/prefix selector、rates、digest、source、缺桶与定点算法，按 requestModel 选择并封存证明。
选择请求模型表示作者明确接受该配置价格基准，不宣称回退模型实际售价。不得使用未封存的内置价格或读取时重新定价。

Judge validator 将 proof.pricing.requestModel 绑定 call.requestModel，不能沿用应用 validator 与 call.model 的比较。
每 call 至多一条 proof，存在 reported cost 时禁止同 call 的 estimate；proof bucket 与已证明的互斥 token 逐项对应。

缺 reported 才估价；缺桶或缺费率保留 partial，不能用 known subtotal 通过预算。已有 reported 不追加估价。
内部共用纯金额/分桶算法，Judge proof kind 为 judge-call-price-estimate，应用 proof kind 和历史字节不变。

## 容量与封存

collector 使用现有 defineRecordAttachment 正式编码通道，不扩大全局 Record 限制。
上限为 payload canonical JSON 1,048,576 bytes、100,000 nodes、10,000 object keys、深度 64，以及最多 4000 物理调用。

4000 仅为 count 上限，不承诺最坏字段和价证下仍能到达。发送前预留附件 framing、entryId、当前完整 ledger、打开项最坏终态和新项最坏终态。
预留基于已知 requestModel/selector/profile 的实际编码和未知回执字段的明示最大长度，同时核对 bytes/nodes/keys/depth。
不得只预留固定 4096 bytes 元数据。内部共享 Record 当前编码上限和计量，避免两份不同限制。

预留不足则 ScoreMatch unavailable/judge-usage-capacity-exceeded，零新发送；已有项不截断、不采样、不丢弃。
已预留响应字段超界只保存有界 reason 与未知对应字段，不得令终态对象超过预留或拒绝发布已发生的费用。
终态后退还保守预留与实际编码的差额，使正常小回执不会长期占用最坏槽位。
新的已执行 Attempt 即使创建应用失败也发布空账本；未执行或跳过的 Attempt 不虚构 collector。

## 读取与合计

Inspection 在同一 origin Attempt PublicationCutoff 读取应用与 Judge 附件。缺 Judge family 为 unavailable；已被当前 reader 接受的 family 编码损坏为 invalid。
未来 revision 遵守既有 reader session 的 unsupported-format 边界，不承诺一定形成 judgeUsage.invalid。

新完整空账本证明零发送；旧 Record即使无 QA 或有成功 audit 也不补空账本。
query totals 从全部 calls 和价证计算，预览只控制返回行。保持独立请求/token/cost 完整度；unknown outcome 不自动抹除已知金额。
引用 Run 读取 origin，不复制 ledger；experiment.get 按 origin 去重，沿用每 origin Attempt 展示。

## 取舍与资料

独立 family 增加一个封存对象，换取完整性不依赖 Assertion 审计预算与业务成功。
审计仍保留评分材料和理由；失败费用只需白名单回执，避免保留任意失败正文产生凭据风险。
协议参考：[Vercel provider metadata](https://vercel.com/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering)、

[OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)。

费用 complete 只表示登记调用在所声明 inference 回执或显式估价范围内完整，不是完整账户账单；网关附加服务费不在本次投影范围。
未来启用 Vercel Chat reported 路径须先核对原始 Chat 传输回执或明确协议资料；AI SDK 的 camelCase 展示与 Responses 回执均不能单独证明该路径。
