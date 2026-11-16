import * as Sentry from "@sentry/nextjs";
import { installEnvelopePrivacy, sentryOptions, productionEnabled, SITE_SENTRY_DSN } from "./lib/sentry";

if (productionEnabled(process.env.NODE_ENV, process.env.VERCEL_ENV) && !Sentry.getClient()) {
  try {
    Sentry.init(sentryOptions(SITE_SENTRY_DSN, process.env.SENTRY_ENVIRONMENT, process.env.SENTRY_RELEASE));
    installEnvelopePrivacy(Sentry.getClient(), process.env.SENTRY_ENVIRONMENT, process.env.SENTRY_RELEASE);
  } catch { /* Monitoring must not prevent serving requests. */ }
}
