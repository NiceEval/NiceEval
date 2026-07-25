import { defineConfig } from "niceeval";

// 注:这个 app 的 .env 把标准的 OPENAI_API_KEY / OPENAI_BASE_URL 挪用给了 DeepSeek
// (agent.py 里 ChatOpenAI 直接读这两个 env 名)。niceeval 的 judge(t.judge.autoevals.*)
// 不碰这两个名字:端点写在 judge.baseUrl,key 只读 NICEEVAL_JUDGE_KEY(或 judge.apiKeyEnv
// 指定的变量名),judge 走独立凭证,不和应用的模型配置互相干扰。
export default defineConfig({
  name: { "zh-CN": "LangGraph 示例", en: "LangGraph example" },
  judge: { model: "gpt-5.4" },
  timeoutMs: 120_000,
  // 被测应用是用户自己起的长驻服务,别开太高并发。
  maxConcurrency: 2,
});
