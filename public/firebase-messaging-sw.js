// Service Worker for Firebase Cloud Messaging (FCM)
// Must be at the root of the site so it has root scope.

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyCHAZg3YjrWe5hIWEDRvCB37-xpVCV8sZE",
  authDomain:        "islam-life-e126e.firebaseapp.com",
  projectId:         "islam-life-e126e",
  storageBucket:     "islam-life-e126e.firebasestorage.app",
  messagingSenderId: "603554211024",
  appId:             "1:603554211024:web:dc19cbe391dbc9c1c7aad5",
});

const messaging = firebase.messaging();

// Background message handler — called when the site tab is closed/hidden
messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'إشعار جديد', {
    body:   n.body  || '',
    icon:   '/icon-192.png',
    badge:  '/icon-192.png',
    dir:    'rtl',
    lang:   'ar',
    tag:    payload.data?.taskId || 'task-notification',
    data:   payload.data || {},
  });
});

// Click on notification → focus/open the app tab
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const appClient = list.find(c => c.url.includes(self.location.origin));
      if (appClient) return appClient.focus();
      return clients.openWindow('/');
    })
  );
});
