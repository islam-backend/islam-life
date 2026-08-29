// ℹ️ هذا الملف عام (public) — الأمان الفعلي عبر Firestore Security Rules
// الـ apiKey بتاع Firebase Web ليس سراً (راجع توثيق Firebase الرسمي).

// 🔒 الإيميل الوحيد المسموح له بالدخول (يُتحقق منه على الخادم في الـ rules)
export const allowedEmail = 'islam.walied96@gmail.com';


// VAPID key: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
// Paste the "Key pair" value here (looks like: BH...)
export const vapidKey = 'PASTE_YOUR_VAPID_KEY_HERE';

export const firebaseConfig = {
  apiKey: "AIzaSyCHAZg3YjrWe5hIWEDRvCB37-xpVCV8sZE",
  authDomain: "islam-life-e126e.firebaseapp.com",
  projectId: "islam-life-e126e",
  storageBucket: "islam-life-e126e.firebasestorage.app",
  messagingSenderId: "603554211024",
  appId: "1:603554211024:web:dc19cbe391dbc9c1c7aad5"
};
