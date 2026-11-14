import { defineAdapter } from "niceeval";
import { defineJudge } from "niceeval/expect";
import { judgeImage } from "niceeval/judge";
export const imageAdapter = defineAdapter({ name: "show-image", create: () => ({}) });
const quality = defineJudge({ rubric: "Assess the supplied screenshot." });
export default imageAdapter.defineScoreEval({ test(t) {
  t.judge({ screenshot: judgeImage({ body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"), mediaType: "image/png" }) }, quality).score(1).label("Screenshot");
} });
