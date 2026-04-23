import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

export type FirebaseWebConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
  measurementId?: string
  vapidKey?: string
}

const runtimeConfig = globalThis.__TRADE_SIGNAL_ENGINE_FIREBASE_CONFIG__ as Partial<FirebaseWebConfig> | undefined

function resolveFirebaseConfig(): FirebaseWebConfig {
  const pick = (envValue: string | undefined, runtimeValue: string | undefined, name: string) => {
    const candidate = (envValue?.trim() || runtimeValue?.trim() || '').trim()
    if (!candidate) {
      throw new Error(`Firebase configuration value ${name} is required.`)
    }
    return candidate
  }

  return {
    apiKey: pick(import.meta.env.VITE_FIREBASE_API_KEY, runtimeConfig?.apiKey, 'apiKey'),
    authDomain: pick(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, runtimeConfig?.authDomain, 'authDomain'),
    projectId: pick(import.meta.env.VITE_FIREBASE_PROJECT_ID, runtimeConfig?.projectId, 'projectId'),
    storageBucket: pick(
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      runtimeConfig?.storageBucket,
      'storageBucket',
    ),
    messagingSenderId: pick(
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      runtimeConfig?.messagingSenderId,
      'messagingSenderId',
    ),
    appId: pick(import.meta.env.VITE_FIREBASE_APP_ID, runtimeConfig?.appId, 'appId'),
    measurementId:
      (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim() ||
        runtimeConfig?.measurementId?.trim() ||
        undefined),
  }
}

export function getFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) {
    return getApp()
  }
  return initializeApp(resolveFirebaseConfig())
}

export const firebaseApp = getFirebaseApp()
export const auth = getAuth(firebaseApp)
export const db = getFirestore(firebaseApp)

export const firebaseMessagingConfig = {
  vapidKey:
    import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim() ||
    runtimeConfig?.vapidKey?.trim() ||
    '',
}
