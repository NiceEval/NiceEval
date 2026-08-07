import { defineConfig } from "niceeval";

// judge.model 进 configHash（docs/feature/experiments/cache.md「指纹:两个哈希嵌套」）。
// 「配置变化触发指纹门」的测试在隔离副本里改它，不改这份共享 config 再写回。
export default defineConfig({
  judge: { model: "gpt-5.6-luna" },
});
