import { nativeReuse } from "../../applications/native-reuse.ts";

export default nativeReuse.defineEval({
  test(t) {
    t.skip("mixed-outcomes intentionally skipped");
  },
});
