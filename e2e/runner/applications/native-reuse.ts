import { defineAdapter } from "niceeval";

export const nativeReuse = defineAdapter({
  name: "native-reuse",
  behaviorRevision: process.env.NICEEVAL_E2E_ADAPTER_REVISION || undefined,
  create: () => ({ value: () => 42 }),
});
