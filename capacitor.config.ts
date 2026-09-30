import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.redon.app',
  appName: 'WEPA',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: ['*'],
  },
  loggingBehavior: 'production',
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      showSpinner: false,
      // FASE 1: la duración deja de ser el camino normal de salida. El splash
      // nativo lo retira React cuando confirma el primer frame WebView
      // (doble requestAnimationFrame). Los 8 s son solo el watchdog nativo
      // que el plugin ejecuta vía launchAutoHide; ver SplashScreen.java:143,
      // donde postDelayed solo libera el splash si isAutoHide() es true.
      launchShowDuration: 8000,
      launchAutoHide: true,
      backgroundColor: '#0A1F1C',
      androidSplashResourceName: 'splash',
      androidScaleType: 'FIT_XY',
    },
  },
};

export default config;
