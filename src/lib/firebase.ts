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
  measurementId: string
}

function resolveFirebaseConfig(): FirebaseWebConfig {
  const runtimeConfig = globalThis.__TRADE_SIGNAL_ENGINE_FIREBASE_CONFIG__ as Partial<FirebaseWebConfig> | undefined
  const pick = (runtimeValue: string | undefined, envValue: string | undefined, name: string) => {
    const candidate = (runtimeValue ?? envValue ?? '').trim()
    if (!candidate) {
      throw new Error(`Firebase configuration value ${name} is required.`)
    }
    return candidate
  }

  return {
    apiKey: pick(runtimeConfig?.apiKey, import.meta.env.VITE_FIREBASE_API_KEY, 'apiKey'),
    authDomain: pick(runtimeConfig?.authDomain, import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, 'authDomain'),
    projectId: pick(runtimeConfig?.projectId, import.meta.env.VITE_FIREBASE_PROJECT_ID, 'projectId'),
    storageBucket: pick(
      runtimeConfig?.storageBucket,
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      'storageBucket',
    ),
    messagingSenderId: pick(
      runtimeConfig?.messagingSenderId,
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      'messagingSenderId',
    ),
    appId: pick(runtimeConfig?.appId, import.meta.env.VITE_FIREBASE_APP_ID, 'appId'),
    measurementId: pick(
      runtimeConfig?.measurementId,
      import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
      'measurementId',
    ),
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
const firebaseConfig = resolveFirebaseConfig()

export const firebaseMessagingConfig = {
  projectId: firebaseConfig.projectId,
  messagingSenderId: firebaseConfig.messagingSenderId,
  vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim() || '',
}
