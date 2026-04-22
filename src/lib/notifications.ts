import { isSupported, getMessaging, getToken, onMessage, type MessagePayload } from 'firebase/messaging'
import { firebaseApp, firebaseMessagingConfig } from './firebase'

export type NotificationSetupState =
  | 'ready'
  | 'unsupported'
  | 'permission-denied'
  | 'failed'

export type NotificationSetupResult = {
  state: NotificationSetupState
  token: string | null
  error: string | null
  stop: (() => void) | null
}

function canUseBrowserNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
}

export async function setupLiveSignalNotifications(onSignal: (payload: MessagePayload) => void): Promise<NotificationSetupResult> {
  if (!canUseBrowserNotifications()) {
    return {
      state: 'unsupported',
      token: null,
      error: 'Browser notifications are not available in this environment.',
      stop: null,
    }
  }

  if (Notification.permission === 'denied') {
    return {
      state: 'permission-denied',
      token: null,
      error: 'Notification permission was denied by the browser.',
      stop: null,
    }
  }

  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return {
        state: 'permission-denied',
        token: null,
        error: 'Notification permission was not granted.',
        stop: null,
      }
    }
  }

  const supported = await isSupported().catch(() => false)
  if (!supported) {
    return {
      state: 'unsupported',
      token: null,
      error: 'Firebase messaging is not supported by this browser.',
      stop: null,
    }
  }

  try {
    const messaging = getMessaging(firebaseApp)
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
    const token = firebaseMessagingConfig.vapidKey
      ? await getToken(messaging, {
          vapidKey: firebaseMessagingConfig.vapidKey,
          serviceWorkerRegistration: registration,
        })
      : await getToken(messaging, {
          serviceWorkerRegistration: registration,
        })
    const unsubscribe = onMessage(messaging, (payload) => {
      onSignal(payload)
      if (payload.notification && Notification.permission === 'granted') {
        new Notification(payload.notification.title ?? 'Trade Signal Engine', {
          body: payload.notification.body ?? '',
        })
      }
    })

    return {
      state: 'ready',
      token: token || null,
      error: token ? null : 'FCM did not return a web token.',
      stop: unsubscribe,
    }
  } catch (error) {
    return {
      state: 'failed',
      token: null,
      error: error instanceof Error ? error.message : 'Failed to initialize browser notifications.',
      stop: null,
    }
  }
}
