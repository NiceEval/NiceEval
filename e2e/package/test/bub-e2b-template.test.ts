// Regression note: memory/bub-default-client-closure-drift.md
// rerun: pnpm e2e test --repo package -- --run test/bub-e2b-template.test.ts

import { e2bCodingAgentTemplate } from "niceeval/sandbox/e2b-template";
import { expect, test } from "vitest";

test("Bub E2B factory 固定默认模型客户端并写匹配指纹 [necase_HCCW8G5HJM4WJE3K]", () => {
  const dockerfile = e2bCodingAgentTemplate("bub").toDockerfile();

  // 默认 template 与 bubAgent() 必须安装同一个完整闭包；只钉 Bub 本体仍会让
  // any-llm-sdk / openai 随构建日期漂移，并让 Adapter 拒绝预装 marker 后重装。
  expect(dockerfile).toContain(
    "printf '%s\\n' 'bub==0.4.0' 'any-llm-sdk==1.17.0' 'openai==2.31.0' > /tmp/bub-override.txt",
  );
  expect(dockerfile).toContain(
    "printf '%s' 'f0e63d4164fe' > /home/user/.local/share/niceeval/bub-install-hash",
  );
});
