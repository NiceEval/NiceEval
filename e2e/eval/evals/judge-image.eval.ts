import { defineAdapter } from "niceeval";
import { defineJudge } from "niceeval/expect";
import { judgeImage } from "niceeval/judge";
import { screenshotBytes } from "../fixtures/judge-image.ts";

export const imageApplication = defineAdapter({
  name: "judge-image-application",
  create: () => ({ screenshot: screenshotBytes }),
});

const quality = defineJudge({
  rubric: "Use the supplied screenshot only as supplementary evidence for the described action.",
});

export default imageApplication.defineScoreEval({
  description: "Judge sees the immutable screenshot and its original evidence remains reviewable",
  test(t) {
    const bytes = t.screenshot();
    const image = judgeImage({ body: bytes, mediaType: "image/png" });
    bytes.fill(0);
    const material = { action: "original-action", screenshot: image };
    t.judge(material, quality).score(4).label("Screenshot quality");
    material.action = "MUTATED_AFTER_REGISTRATION";
  },
});
