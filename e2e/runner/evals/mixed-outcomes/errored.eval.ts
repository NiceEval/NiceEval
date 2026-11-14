import { nativeReuse } from "../../applications/native-reuse.ts";

export default nativeReuse.defineEval({
  test() {
    throw new Error("mixed-outcomes error body remains auditable");
  },
});
