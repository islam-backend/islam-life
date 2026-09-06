// Firebase web config is public by design — the apiKey is not a secret.
// Real security lives in firestore.rules / storage.rules and the
// invite-only sign-in gate (functions/auth.js). Safe to commit.

export const firebaseConfig = {
  apiKey: 'AIzaSyCHAZg3YjrWe5hIWEDRvCB37-xpVCV8sZE',
  authDomain: 'islam-life-e126e.firebaseapp.com',
  projectId: 'islam-life-e126e',
  storageBucket: 'islam-life-e126e.firebasestorage.app',
  messagingSenderId: '603554211024',
  appId: '1:603554211024:web:dc19cbe391dbc9c1c7aad5',
}

// Cloud Messaging → Project Settings → Cloud Messaging → Web Push
// certificates → Generate key pair. Needed for push notifications.
export const vapidKey = 'PASTE_YOUR_VAPID_KEY_HERE'
