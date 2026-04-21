# Trade Signal Engine Admin

Vue admin console served from Firebase Hosting for session triage, signal review, and configuration management.

## Stack

- Vue 3
- Vite
- Firebase Hosting + Firestore

## External integrations

- `Firebase Hosting` serves the admin console.
- `Firebase Auth` gates read access before the dashboard loads live data.
- `Firestore` is the operational read model for sessions, signals, and versioned configs.

## Config workflow

- The config editor can save a candidate snapshot from the current session values.
- Version history rows can be promoted or rolled back explicitly.
- The active session keeps a frozen `config_version` reference until a version change is applied.

## Run

```bash
npm install
npm run dev
```

## Test

```bash
npm test
```

## Build

```bash
npm run build
```

## Deploy

```bash
npm run deploy
```

## Firebase config

Configure these environment variables (typically in a .env file) to override the built-in defaults:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

The Firebase Hosting target is `admin`, mapped to `trade-signal-engine`.

## Data model

- `market_sessions`
- `signal_events`
- `config_versions`
