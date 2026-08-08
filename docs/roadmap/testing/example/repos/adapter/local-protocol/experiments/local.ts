import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";

// 无密钥：adapter 只 fetch 仓库自有的本地 HTTP fixture，不触任何 provider。
// 测试通过 LOCAL_BACKEND_URL 把 agent 指向 5xx fixture；这里的默认值只保证
// discover / dry-run 阶段可读，不是被测路径。
const BASE_URL = process.env.LOCAL_BACKEND_URL ?? "http://127.0.0.1:34101";

export default defineExperiment({
  description:
    "本地协议 backend（uiMessageStreamAgent 指向仓库自有 fixture）：只证明传输与错误分类，" +
    "不冒充 live 兼容性；真实 provider 兼容性由 main / nightly lane 的 live Repo 证明",
  agent: uiMessageStreamAgent({ url: `${BASE_URL}/api/chat` }),
  attempts: 1,
});
