---
format: concord.document/v1
id: received-ansi-control-bytes-leak
title: received/expected 里的 ANSI 控制字节泄漏进展示面
createdAt: 2026-07-21T15:36:37+08:00
createdAtSource:
  kind: first-recorded
  path: memory/received-ansi-control-bytes-leak.md
  commit: e1b22cdc6e6791557bacc6cc465edad07e1f68e5
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [received-ansi-control-bytes-leak](received-ansi-control-bytes-leak.md) —
      `received`(jest/vitest 命令输出)的 ANSI 着色码在 exp/show/report
      里显成乱码:`summaryText` 只折 `\\s` 不覆盖 ESC/BEL/BS;修为新增 `stripControl`(去
      ANSI+不可打印控制字节、保留 glyph 与换行),summaryText 与两个报告详情面共用,原始字节仍存
      artifact(`src/scoring/display.ts` +
      `AttemptAssertions/AttemptSource.tsx`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# received/expected 里的 ANSI 控制字节泄漏进展示面

## 现象

真机 `pnpm exec niceeval exp compare/codex`(coding-agent-memory-evals)与 `niceeval show`:
失败断言的 `received: exit 1 · "…"` 行出现乱码 glyph——`.Ⴣ)`、`↓`、代码帧 `^`、
`28| } 29| ›` 之类,好几个失败(react-tooltip/pr-970、yet-another-react-lightbox/…)都有。
`received` 是被测命令(jest/vitest)的 stdout/stderr。exp 三种 profile、show/view 比较列表都能复现。

## 根因

`summaryText`(`src/scoring/display.ts`)当时只做 `value.replace(/\s+/g, " ")` 折空白。JS `\s`
只覆盖 `space \t \n \r \f \v`,**不覆盖** ESC(0x1B)、BEL(0x07)、BS(0x08)等控制字节。
jest/vitest 几乎总把代码帧、行号、`✕` 用 ANSI 转义(`ESC[2m…ESC[22m` 等)着色,这些 ESC 原样
穿透进摘要行,终端重新解释成乱码——被 240 字符单行截断从转义序列中间切开时尤其乱。HTML 报告
(`AttemptAssertions.tsx` / `AttemptSource.tsx`)则把 `ESC[2m28|ESC[22m` 当字面文本渲染。

漏网原因:`ci.test.ts`「不出现任何 ANSI 控制字符」只喂干净 fixture(`received=3`),断言的是
niceeval **自己生成的帧**不含 ESC,从没覆盖「捕获内容本身带 ANSI」这条路径;docs 里 agent/ci 的
「无 ANSI / 输出不含 ANSI」也被读成「不写自己的框」而非「捕获内容也剥净」,歧义让 bug 藏住。

## 修法

剥控制字节是**渲染时**规则,不改存进 `AssertionResult`/artifact 的原始字节(完整证据不失真)。

- `src/scoring/display.ts` 新增导出 `stripControl()`:去 ANSI CSI(SGR/光标)、OSC(连 payload)与
  其余不可打印 C0/C1(含裸 ESC/BEL/BS),保留可打印字符与结构性换行(`✕ › ↓ │` 等 ≥ U+2020 保留)。
  `summaryText` = `stripControl` + 折单行 + 240 截断——一处收口覆盖 exp human/agent/ci 永久行/handoff、
  `show` 终端面(`src/show/render.ts` 本就走 summaryText)、比较列表(entity-lists→primaryAssertionSummary)。
- 报告详情面直接消费 `AssertionResult` 不过 summaryText,单独补 `stripControl`:
  `AttemptAssertions.tsx`(expected/received/reason)、`AttemptSource.tsx`(expected/received/evidence/reason)。
  注意:改 `src/report/**` 后 CLI 行为要 `pnpm run build:report` 才生效(见 [[report-src-changes-need-dist-rebuild]])。
- 契约单源在 `docs/feature/scoring/library/display.md` 契约一「折单行规则」+ 通用渲染规则;
  `docs/feature/experiments/cli.md` received 截断段与 agent/ci 的「无 ANSI」条消歧到「捕获内容也剥净」。
- 测试登记 `docs/engineering/testing/unit/scoring.md` 展示投影段,新增 `src/scoring/display.test.ts`
  用 `String.fromCharCode` 造真实控制字节(源码里别嵌裸控制字符)验剥净 + 保留 glyph + 保留换行。

适用场景:任何把捕获输出(命令 stdout/stderr、源码、evidence)放进展示面的地方,都过 `stripControl`;
新增展示面若绕开 summaryText 直接渲染 `AssertionResult` 字段,记得补这一步。相关:分层塑形见
[[exp-show-unbounded-output-cases]]。

## 反直觉点

工具链坑:Write/Edit 工具会把 new_string 里的**真实控制字节**吞掉,导致正则里嵌裸 ESC/BEL 会被
静默清空成错误正则。正则里的控制字节一律用 \u001B / \u0007 这类 ASCII 转义写,别嵌真字节。
