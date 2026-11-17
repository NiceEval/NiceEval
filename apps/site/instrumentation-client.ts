import * as Sentry from "@sentry/nextjs";
import { browserProfilePolicy } from "./lib/sentry-browser";
import {
  productionEnabled,
  privacyTransport,
  SITE_SENTRY_DSN,
  installEnvelopePrivacy,
  sentryOptions,
} from "./lib/sentry";

if (productionEnabled(process.env.NODE_ENV, process.env.NEXT_PUBLIC_VERCEL_ENV) && !Sentry.getClient()) {
  try {
    const profile = browserProfilePolicy(process.env.NEXT_PUBLIC_SENTRY_RELEASE || "");
    Sentry.init({
      ...sentryOptions(
        SITE_SENTRY_DSN,
        process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
        process.env.NEXT_PUBLIC_SENTRY_RELEASE,
        profile,
      ),
      parentSpanIsAlwaysRootSpan: false,
      profileLifecycle: "trace",
      profileSessionSampleRate: 0.1,
      transport: privacyTransport(
        Sentry.makeFetchTransport,
        SITE_SENTRY_DSN,
        process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
        process.env.NEXT_PUBLIC_SENTRY_RELEASE,
        profile,
      ),
      integrations: (defaults) => [
        ...defaults.filter(
          (integration) => !["BrowserSession", "Breadcrumbs", "BrowserTracing"].includes(integration.name),
        ),
        Sentry.browserTracingIntegration({ traceXHR: false }),
        Sentry.browserSessionIntegration(),
        ...(profile.enabled ? [Sentry.browserProfilingIntegration()] : []),
      ],
      // This landing has no business API. No fetch/XHR destination receives headers.
      tracePropagationTargets: [],
    });
    installEnvelopePrivacy(
      Sentry.getClient(),
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      process.env.NEXT_PUBLIC_SENTRY_RELEASE,
      profile,
    );
  } catch {
    /* Monitoring must not prevent hydration. */
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
