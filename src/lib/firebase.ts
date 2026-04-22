import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const defaultFirebaseConfig = {
  apiKey: 'AIzaSyAEnPeQJlPcYnJIV9rjRgROU-mRvoGMDFA',
  authDomain: 'trade-signal-engine.firebaseapp.com',
  projectId: 'trade-signal-engine',
  storageBucket: 'trade-signal-engine.firebasestorage.app',
  messagingSenderId: '616349678895',
  appId: '1:616349678895:web:95a2b698c7f6769723f5da',
  measurementId: 'G-T2BP0YX4LQ',
}

function resolveFirebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || defaultFirebaseConfig.apiKey,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || defaultFirebaseConfig.authDomain,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || defaultFirebaseConfig.projectId,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || defaultFirebaseConfig.storageBucket,
    messagingSenderId:
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || defaultFirebaseConfig.messagingSenderId,
    appId: import.meta.env.VITE_FIREBASE_APP_ID || defaultFirebaseConfig.appId,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || defaultFirebaseConfig.measurementId,
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
  projectId: defaultFirebaseConfig.projectId,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || defaultFirebaseConfig.messagingSenderId,
  vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim() || '',
}
