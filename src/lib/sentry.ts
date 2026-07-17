import * as Sentry from '@sentry/capacitor';
import { Capacitor } from '@capacitor/core';

export function initSentryCapacitor() {
  if (!Capacitor.isNativePlatform()) return;

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: 'staging',
    enableAutoSessionTracking: true,
    sessionTrackingIntervalMillis: 30000,
    tracesSampleRate: 1.0,
    attachStacktrace: true,
    beforeSend(event, hint) {
      if (event.exception) {
        const error = hint.originalException;
        if (error instanceof Error) {
          event.tags = {
            ...event.tags,
            platform: Capacitor.getPlatform(),
            native: 'true',
          };
        }
      }
      return event;
    },
  });

  Sentry.setTag('platform', Capacitor.getPlatform());
  Sentry.setTag('appVersion', '0.0.0');
}