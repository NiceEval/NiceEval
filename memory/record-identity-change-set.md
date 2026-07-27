# Record 身份变更集：runId、可逆目录编码、60 bit locator、schemaVersion 11

**日期**：2026-07-27

## 裁决

`bcb82b60` 一次改了四件 Record 身份相关的事，理由当时没有落任何文档（commit message 是
`update`）。补记如下，四件是一个整体：改了身份就必须升版，升版按本仓「不做兼容机制」原则
让旧数据读不出。

- **`runId`（UUID v4，写进 `run.json`）**：目录名是人读定位名，移动、改名、发布都会变；
  同毫秒并发创建还要靠随机后缀避让。Run 需要一个不随这些变动的权威身份。
  代价是它**不可从业务身份重建**——契约措辞必须写成「同一份已持久化 Run 内稳定」，
  不能沿用旧的「确定性派生」暗示。
- **目录名改 percent-encoding**：旧规则把非 `[\w.@-]` 一律换 `_`，是**有损**的——
  两个不同 experimentId 会清洗成同一个目录名。改成可逆编码后投影一一对应。
  `.` / `..` 整段额外编码，防止取得路径语义。
- **locator 60 bit（12 位 Crockford base32，共 14 字符）**：旧的 7 位 base36 ≈ 36 bit，
  在一个记录根 10⁵ 条 attempt 下碰撞概率约 7%——不够。但一度提的 100 bit 也不对：
  locator 是用户手打、粘 URL、肉眼比对的东西，21 字符是实打实的 DX 成本，而 60 bit 在
  10⁶ 条下已是 4.3×10⁻⁷。派生元组同时从 `{experimentId, startedAt, evalId, attempt}`
  换成 `{runId, evalId, attempt}`。
- **`schemaVersion` 10 → 11**：上面三项都改了格式，按 Record 的「不做兼容机制」必须升版。
  已有 `.niceeval`（当时 MemoryBench 6 / coding-agent-skill 8 / NiceEval-Eval 3 个实验目录）
  因此读不出，用户 2026-07-27 明确接受这个代价——那些 run 的结论已经进了 memory，
  原始目录不再回看。要看旧结果用 `npx niceeval@<旧版本>`。

同批补上原本缺失的**碰撞语义**（`docs/feature/record/architecture.md` 的「locator 的唯一性」）：
作用域是一个记录根；locator 是派生值，撞了不能靠重算躲开，所以写入侧抛
`LocatorCollisionError` 中止、读取侧抛 `AmbiguousLocatorError` 不返回任意一条。
旧文档对碰撞零覆盖，位宽讨论在这一条补齐之前是空转。

## 曾选方案与否决理由

- **100 bit / 20 位 body**：否决。没有与手输成本相称的碰撞模型，多出的 8 个字符每次下钻都要付。
- **回退整批 Record 变更、保住旧数据**：否决（用户裁决）。矛盾点在于 `architecture.md` 与
  `library.md` 曾各写一份互斥的 locator 契约——那个矛盾已通过单源化消除，与保不保留无关。
- **撞了返回第一条**：否决。用户会看着别人的 attempt 以为是自己那条，比报错严重得多。

`retryAttempts` 与本组无关，是用量核算需要保留被自动重试吸收的物理 send，见
[[streamevent-new-member-cascade]] 一带的执行面改动。
