/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyAEnPeQJlPcYnJIV9rjRgROU-mRvoGMDFA',
  authDomain: 'trade-signal-engine.firebaseapp.com',
  projectId: 'trade-signal-engine',
  storageBucket: 'trade-signal-engine.firebasestorage.app',
  messagingSenderId: '616349678895',
  appId: '1:616349678895:web:95a2b698c7f6769723f5da',
  measurementId: 'G-T2BP0YX4LQ',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'Trade Signal Engine'
  const body = payload?.notification?.body || 'A new signal event is available.'
  self.registration.showNotification(title, { body })
})
