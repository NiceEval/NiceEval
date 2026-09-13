import { equals } from "niceeval/expect";
import { nativeReuse } from "../applications/native-reuse.ts";

export default nativeReuse.defineEval({ test(t) { t.check(t.value(), equals(42)); } });
