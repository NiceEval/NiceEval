# Use Case · 机器出口与错误文案:容差 golden

## 场景

`--json` 机器摘要、JUnit 出口与错误/用法文案是**每个字符都是契约**的表面:字段名、折叠规则(`failed` → `<failure>`、`errored` → `<error>`)、错误消息的措辞本身就是公开承诺(错误信息要直接说明问题和下一步)。这类表面适合整段 golden,而不是逐条 `includes`。

## 现行断言

摘自 `e2e/report/scripts/verify-format.ts`、`e2e/cli/scripts/verify.ts`、`verify-readback.ts`:

```ts
// ① JUnit 折叠:逐子串探测
assert.ok(failXml.includes("<failure"), "...");
assert.ok(!failXml.includes("<error"), "...");

// ② --json 摘要:手工逐字段断言,覆盖到哪算哪
const summary = JSON.parse(readFileSync("summary.json", "utf8"));
assert.equal(summary.evals.length, 2, "...");

// ③ 空结果文案:整份输出全等——这是罕见的「现行写法已经是 golden」
assert.equal(noMatches, "0 matches in 1 attempt\n", "...");
```

①② 的问题不是脆,是**覆盖有洞**:子串探测证明「出现过」,证明不了「没有多余的、结构对的」;新增字段悄悄漂移不会被发现。③ 的方向对,但每处手写全等没有归一与更新流。

## 候选写法

```ts
test("deliberate-fail 的 JUnit 折叠", async () => {
  await cli("pnpm exec niceeval exp deliberate-fail --force --json --junit fail.xml", { expect: "nonzero" });
  await expect(readFileSync("fail.xml", "utf8")).toMatchScrubbedFileSnapshot("golden/deliberate-fail.junit.xml");
});

test("--json 摘要", async () => {
  const summary = readFileSync("summary.json", "utf8");
  await expect(summary).toMatchScrubbedFileSnapshot("golden/summary.json", {
    scrub: [{ pattern: /"seed":\s*\d+/g, tag: "SEED" }],   // 仓库自定义规则示例
  });
});

test("--grep 空结果文案", async () => {
  const { stdout } = await cli(`pnpm exec niceeval show tool-call --grep zzz`);
  await expect(stdout).toMatchScrubbedFileSnapshot("golden/grep-no-match.txt");
});
```

golden 落盘后(耗时、成本、locator 已被内置 scrub 表归一):

```xml
<testsuite name="deliberate" tests="1" failures="1" errors="0" time="[DURATION]">
  <testcase name="deliberate-fail/gate" time="[DURATION]">
    <failure message="gate · equals(3)">…</failure>
  </testcase>
</testsuite>
```

- 整段 golden 天然断言「不多不少」:漂移进来的新字段、丢失的字段都在 diff 里现形,补掉子串探测的覆盖洞。
- 易变值(时间、成本、locator)由内置 scrub 表统一归一,不再是「这条断言恰好绕开了它」。
- 契约变更时 `vitest -u` 重写 golden,diff 就是 review 面——出口格式变化的影响面一目了然。

## 边界

- **适用判据**:表面窄且稳、每个字符都是契约。`--json`、JUnit、错误文案、`--help` 用法块符合;渲染大面(榜单、报告页)不符合——那是第一层的领域,整页上 golden 等于把脆断言搬进数据文件。
- scrub 后逐字符全等,没有行内通配——需要行级容差说明表面不够窄稳,换第一层。
