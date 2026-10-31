import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.islamlife.taskmanager',
  appName: 'Task Manager',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    FirebaseAuthentication: {
      // We keep using the Firebase JS SDK (src/lib/firebase/app.ts) as the
      // single source of truth for the session — this plugin is only used
      // to get a native Google ID token, which AuthProvider then exchanges
      // via signInWithCredential(). Without this flag the plugin would also
      // sign in to a *second*, native Firebase Auth instance we never read.
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
}

export default config
