/* eslint-disable no-undef */
importScripts('/firebase-config.js')
importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-messaging-compat.js')

firebase.initializeApp(self.__TRADE_SIGNAL_ENGINE_FIREBASE_CONFIG__)

const DEFAULT_NOTIFICATION_TITLE = 'Trade Signal Engine'
const DEFAULT_NOTIFICATION_BODY = 'A new signal event is available.'

function notificationTag(payload) {
  return String(
    payload?.data?.event_key ?? payload?.data?.message_id ?? payload?.data?.symbol ?? payload?.notification?.title ?? 'trade-signal-engine',
  )
}

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || DEFAULT_NOTIFICATION_TITLE
  const body = payload?.notification?.body || DEFAULT_NOTIFICATION_BODY
  self.registration.showNotification(title, {
    body,
    tag: notificationTag(payload),
    renotify: false,
  })
})
