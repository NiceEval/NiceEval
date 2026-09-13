import { defineJudge } from "niceeval";
import { markerApplication } from "./assertion-judge-fake.eval.ts";

const pendingQuality = defineJudge({ name: "pending-quality", rubric: "The post contains the marker." });

export default markerApplication.defineScoreEval({
  description: "Attempt 取消保留 Judge 请求尝试事实与完整材料",
  judge: pendingQuality,
  async test(t) {
    t.check({ post: t.post(), criterion: "pending-marker" }, pendingQuality).score(10).label("Pending Judge");
  },
});
