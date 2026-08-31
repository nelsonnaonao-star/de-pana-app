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
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      showSpinner: false,
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0A1F1C',
      androidSplashResourceName: 'splash',
      androidScaleType: 'FIT_XY',
    },
  },
};

export default config;
