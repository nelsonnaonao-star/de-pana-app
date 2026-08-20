import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.redon.app',
  appName: 'Red On',
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
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: '#F1F5F6',
    },
  },
};

export default config;
