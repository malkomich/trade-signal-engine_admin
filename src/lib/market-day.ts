export function currentMarketDayKey(reference = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference)
}

export function marketDayKeyForTimestamp(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  const date = value instanceof Date
    ? value
    : value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : typeof value === 'string'
        ? new Date(value)
        : typeof value === 'number'
          ? new Date(value)
          : null

  if (!date || Number.isNaN(date.getTime())) {
    return ''
  }

  return currentMarketDayKey(date)
}

export function formatMarketDayLabel(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parsed)
}

export function marketDayBounds(dayKey: string) {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (!parsed) {
    return null
  }

  const year = Number(parsed[1])
  const month = Number(parsed[2])
  const day = Number(parsed[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  const start = zonedTimeToUtc(year, month, day, 0, 0, 0, 'America/New_York')
  const end = zonedTimeToUtc(year, month, day + 1, 0, 0, 0, 'America/New_York')
  return { start, end }
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const offset = timezoneOffset(new Date(utcGuess), timeZone)
  return new Date(utcGuess - offset)
}

function timezoneOffset(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
  return asUTC - date.getTime()
}
