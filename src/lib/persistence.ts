export function loadPersistedChoice<T extends string>(
  key: string,
  fallback: T,
  allowedValues: readonly T[],
): T {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const stored = window.localStorage.getItem(key)?.trim() as T | null;
    if (stored && allowedValues.includes(stored)) {
      return stored;
    }
  } catch {
    // Ignore storage failures and fall back to the default in-memory value.
  }
  return fallback;
}

export function loadPersistedString(key: string, fallback: string) {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const stored = window.localStorage.getItem(key)?.trim();
    if (stored) {
      return stored;
    }
  } catch {
    // Ignore storage failures and fall back to the in-memory default.
  }
  return fallback;
}

export function persistChoice(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures; the UI should remain usable without persistence.
  }
}
