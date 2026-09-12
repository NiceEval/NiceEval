import { defineApplication } from "niceeval";

export const nativeReuse = defineApplication({
  name: "native-reuse",
  behaviorRevision: process.env.NICEEVAL_E2E_APP_REVISION || undefined,
  create: () => ({ value: () => 42 }),
});
