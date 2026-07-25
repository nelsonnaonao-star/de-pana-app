import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.redon.app',
  appName: 'Red On',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: ['*'],
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      showSpinner: false,
      launchShowDuration: 3000,
      launchAutoHide: false,
      backgroundColor: '#111827',
    },
  },
};

export default config;
