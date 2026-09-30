import { defineJudge } from "niceeval";
import { equals } from "niceeval/expect";
import { judgeImage } from "niceeval/judge";
import { screenshotBytes } from "../fixtures/judge-image.ts";
import { markerApplication } from "./assertion-judge-fake.eval.ts";

const quality = defineJudge({ name: "admission-quality", rubric: "The text is useful.", maxMaterialBytes: 128 });
const foreign = { name: "forged-match" } as unknown as typeof quality;

export default markerApplication.defineEval({
  description: "无效 Judge 材料与伪造 Match 在登记前被拒绝",
  async test(t) {
    let accessorCalls = 0;
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const invalid = [
      undefined, [undefined], Array(1), NaN, Infinity, 1n, () => 1,
      new Date(0), cycle, "x".repeat(129),
      { get content() { accessorCalls += 1; return "not-a-snapshot"; } },
      { toJSON() { accessorCalls += 1; return "not-a-snapshot"; } },
    ];
    const rejected = invalid.map((value) => {
      try { t.check(value, quality); return false; }
      catch (error) { return error instanceof TypeError; }
    });
    const sugarRejected = invalid.map((value) => {
      try { t.judge(value, quality); return false; }
      catch (error) { return error instanceof TypeError; }
    });
    let reflected = 0;
    const material = new Proxy({}, { ownKeys() { reflected += 1; return []; } });
    let foreignRejected = false;
    try { t.check(material, foreign); }
    catch (error) { foreignRejected = error instanceof TypeError; }
    let foreignSugarRejected = false;
    try { t.judge(material, foreign); }
    catch (error) { foreignSugarRejected = error instanceof TypeError; }
    const imageBytes = screenshotBytes();
    const zeroWidth = imageBytes.slice();
    zeroWidth.fill(0, 16, 20);
    const tooManyPixels = imageBytes.slice();
    new DataView(tooManyPixels.buffer).setUint32(16, 16_777_217);
    const imageInputs: unknown[] = [
      { body: new Uint8Array(4 * 1024 * 1024 + 1), mediaType: "image/png" },
      { body: imageBytes, mediaType: "image/jpeg" },
      { body: imageBytes.subarray(0, 12), mediaType: "image/png" },
      { body: imageBytes.subarray(0, 24), mediaType: "image/png" },
      { body: new Uint8Array([255, 216, 255, 192, 0, 7, 8, 0, 1, 0, 1]), mediaType: "image/jpeg" },
      { body: zeroWidth, mediaType: "image/png" },
      { body: tooManyPixels, mediaType: "image/png" },
      { body: imageBytes, mediaType: "image/svg+xml" },
      { get body() { accessorCalls += 1; return imageBytes; }, mediaType: "image/png" },
    ];
    const imagesRejected = imageInputs.map((value) => {
      try { judgeImage(value as Parameters<typeof judgeImage>[0]); return false; }
      catch (error) { return error instanceof TypeError; }
    });
    const imageQuality = defineJudge({ name: "image-admission", rubric: "Assess only supplied evidence." });
    let repeatedImagesRejected = false;
    const image = judgeImage({ body: imageBytes, mediaType: "image/png" });
    try { t.judge({ images: [image, image, image, image, image] }, imageQuality); }
    catch (error) { repeatedImagesRejected = error instanceof TypeError; }
    t.check({ rejected, sugarRejected, accessorCalls, reflected, foreignRejected, foreignSugarRejected, imagesRejected, repeatedImagesRejected }, equals({
      rejected: Array(12).fill(true), sugarRejected: Array(12).fill(true), accessorCalls: 0, reflected: 0, foreignRejected: true, foreignSugarRejected: true,
      imagesRejected: Array(9).fill(true), repeatedImagesRejected: true,
    })).gate().label("Judge admission is atomic");
  },
});
