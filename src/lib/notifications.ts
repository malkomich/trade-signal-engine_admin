import { isSupported, getMessaging, getToken, onMessage, type MessagePayload } from 'firebase/messaging'
import { firebaseApp, firebaseMessagingConfig } from './firebase'

export type NotificationSetupState =
  | 'ready'
  | 'permission-needed'
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

const DEFAULT_NOTIFICATION_TITLE = 'Trade Signal Engine'
const DEFAULT_NOTIFICATION_BODY = 'A new signal event is available.'
let currentUnsubscribe: (() => void) | null = null
const seenNotificationKeys = new Set<string>()

function notificationTag(payload: MessagePayload): string {
  return String(payload.data?.event_key ?? payload.data?.message_id ?? payload.data?.symbol ?? payload?.notification?.title ?? 'trade-signal-engine')
}

function shouldShowForegroundNotification(payload: MessagePayload): boolean {
  const type = payload.data?.type?.trim().toLowerCase()
  return type === 'decision.accepted' || type === 'decision.exited'
}

function pruneSeenNotificationKeys() {
  if (seenNotificationKeys.size <= 64) {
    return
  }
  seenNotificationKeys.clear()
}

function stopCurrentNotifications() {
  currentUnsubscribe?.()
  currentUnsubscribe = null
}

function waitForServiceWorkerActivation(registration: ServiceWorkerRegistration, timeoutMs = 8_000): Promise<ServiceWorkerRegistration> {
  if (registration.active) {
    return Promise.resolve(registration)
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now()

    const poll = () => {
      if (registration.active) {
        resolve(registration)
        return
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Service worker did not become active in time.'))
        return
      }

      window.setTimeout(poll, 100)
    }

    poll()
  })
}

async function initializeLiveSignalNotifications(
  onSignal: (payload: MessagePayload) => void,
  requestPermission: boolean,
): Promise<NotificationSetupResult> {
  if (!canUseBrowserNotifications()) {
    return {
      state: 'unsupported',
      token: null,
      error: 'Browser notifications are not available in this environment.',
      stop: null,
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

  if (!firebaseMessagingConfig.vapidKey) {
    return {
      state: 'failed',
      token: null,
      error: 'VAPID key is required to register browser push notifications.',
      stop: null,
    }
  }

  if (Notification.permission === 'default') {
    if (!requestPermission) {
      return {
        state: 'permission-needed',
        token: null,
        error: 'Notification permission has not been requested yet.',
        stop: null,
      }
    }
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

  if (Notification.permission === 'denied') {
    return {
      state: 'permission-denied',
      token: null,
      error: 'Notification permission was denied by the browser.',
      stop: null,
    }
  }

  try {
    stopCurrentNotifications()

    const messaging = getMessaging(firebaseApp)
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' })
    await registration.update().catch(() => undefined)
    const activeRegistration = (await Promise.race([
      navigator.serviceWorker.ready,
      waitForServiceWorkerActivation(registration),
    ])) as ServiceWorkerRegistration
    const token = await getToken(messaging, {
      vapidKey: firebaseMessagingConfig.vapidKey,
      serviceWorkerRegistration: activeRegistration,
    }).catch((error) => {
      throw error instanceof Error ? error : new Error('Failed to retrieve the FCM token.')
    })
    if (!token) {
      return {
        state: 'failed',
        token: null,
        error: 'FCM did not return a web token.',
        stop: null,
      }
    }
    // Foreground notifications are intentionally owned here; the service worker
    // handles background delivery and this listener only dedupes live tab events.
    const unsubscribe = onMessage(messaging, (payload) => {
      const key = notificationTag(payload)
      if (seenNotificationKeys.has(key)) {
        return
      }
      seenNotificationKeys.add(key)
      pruneSeenNotificationKeys()
      onSignal(payload)
      if (payload.notification && Notification.permission === 'granted' && shouldShowForegroundNotification(payload)) {
        new Notification(payload.notification.title ?? DEFAULT_NOTIFICATION_TITLE, {
          body: payload.notification.body ?? DEFAULT_NOTIFICATION_BODY,
          tag: notificationTag(payload),
        })
      }
    })
    currentUnsubscribe = unsubscribe

    return {
      state: 'ready',
      token,
      error: null,
      stop: stopCurrentNotifications,
    }
  } catch (error) {
    stopCurrentNotifications()
    return {
      state: 'failed',
      token: null,
      error: error instanceof Error ? error.message : 'Failed to initialize browser notifications.',
      stop: null,
    }
  }
}

export async function probeLiveSignalNotifications(onSignal: (payload: MessagePayload) => void): Promise<NotificationSetupResult> {
  return initializeLiveSignalNotifications(onSignal, false)
}

export async function setupLiveSignalNotifications(onSignal: (payload: MessagePayload) => void): Promise<NotificationSetupResult> {
  return initializeLiveSignalNotifications(onSignal, true)
}

export function stopLiveSignalNotifications() {
  stopCurrentNotifications()
}
