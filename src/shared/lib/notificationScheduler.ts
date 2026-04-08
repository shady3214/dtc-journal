/**
 * Notification Scheduler
 *
 * Polls every 30 seconds to check for:
 *  1. Upcoming high-impact forex news events (ForexFactory calendar)
 *  2. New York market open (9:30 AM ET)
 *  3. London market open (8:00 AM GMT / 12:30 PM IST)
 *
 * Uses the Web Notifications API which works in both Tauri and browser.
 */

import { loadSettings } from './api'

const FF_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
const PROXY_URL = '/api/ff-calendar'

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// ── Types ──────────────────────────────────────────────────────────

export interface FfEvent {
  title: string
  country: string
  date: string       // ISO string e.g. "2024-04-05T12:30:00-0500"
  impact: 'High' | 'Medium' | 'Low' | 'Holiday'
  forecast?: string
  previous?: string
}

// ── Session times (UTC hours) ──────────────────────────────────────

/**
 * Get UTC hour of NY open (9:30 AM ET).
 * EST = UTC-5, EDT (Mar–Nov) = UTC-4
 */
function getNyOpenUtcHour(): number {
  // EDT (Mar–Nov): NY 9:30 = 13:30 UTC
  // EST (Nov–Mar): NY 9:30 = 14:30 UTC
  const now = new Date()
  const estOffset = isUsEasternDst(now) ? 4 : 5
  return 9 + estOffset
}

function getNyOpenUtcMinute(): number {
  return 30 // always :30
}

/**
 * Check if US Eastern is currently on EDT (UTC-4) vs EST (UTC-5).
 * Works correctly regardless of the user's local timezone.
 * EDT: second Sunday in March → first Sunday in November
 */
function isUsEasternDst(date: Date): boolean {
  const year = date.getUTCFullYear()

  // Second Sunday in March at 2:00 AM ET = 7:00 AM UTC
  const march = new Date(Date.UTC(year, 2, 1))
  const marchDay = march.getUTCDay() // 0=Sun
  const secondSundayMarch = 8 + (7 - marchDay) % 7 // day of month
  const dstStart = Date.UTC(year, 2, secondSundayMarch, 7, 0, 0)

  // First Sunday in November at 2:00 AM ET = 6:00 AM UTC (already EDT→EST)
  const nov = new Date(Date.UTC(year, 10, 1))
  const novDay = nov.getUTCDay()
  const firstSundayNov = 1 + (7 - novDay) % 7
  const dstEnd = Date.UTC(year, 10, firstSundayNov, 6, 0, 0)

  const t = date.getTime()
  return t >= dstStart && t < dstEnd
}

// ── Notification permission ────────────────────────────────────────

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (isTauri) {
    try {
      const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification')
      let granted = await isPermissionGranted()
      if (!granted) {
        const permission = await requestPermission()
        granted = permission === 'granted'
      }
      return granted ? 'granted' : 'denied'
    } catch {
      return 'denied'
    }
  }
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}

export async function sendTestNotification() {
  if (isTauri) {
    try {
      const { isPermissionGranted, sendNotification: tauriSend } = await import('@tauri-apps/plugin-notification')
      const granted = await isPermissionGranted()
      if (!granted) {
        alert('Notifications are not enabled. Toggle "Enable Notifications" first to grant permission.')
        return
      }
      tauriSend({ title: 'DTC Journal — Test Notification', body: 'Notifications are working! You will receive alerts for high-impact news and market opens.' })
    } catch (e) {
      alert(`Notification failed: ${e}`)
    }
    return
  }
  if (!('Notification' in window)) {
    alert('Notifications are not supported in this environment.')
    return
  }
  if (Notification.permission !== 'granted') {
    alert('Notifications are not enabled. Toggle "Enable Notifications" first to grant permission.')
    return
  }
  try {
    const n = new Notification('✅ DTC Journal — Test Notification', {
      body: 'Notifications are working! You will receive alerts for high-impact news and market opens.',
      icon: '/favicon.ico',
      tag: 'dtc-test',
    })
    setTimeout(() => n.close(), 8000)
  } catch (e) {
    alert(`Notification failed: ${e}`)
  }
}


function sendNotification(title: string, body: string, _icon?: string) {
  if (isTauri) {
    import('@tauri-apps/plugin-notification').then(({ isPermissionGranted, sendNotification: tauriSend }) => {
      isPermissionGranted().then(granted => {
        if (granted) tauriSend({ title, body })
      })
    }).catch(() => {})
    return
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, {
      body,
      icon: _icon || '/favicon.ico',
      tag: title,
      requireInteraction: false,
    })
    setTimeout(() => n.close(), 10_000)
  } catch {
    // ignore
  }
}

// ── ForexFactory calendar fetch ────────────────────────────────────

async function fetchFfCalendar(): Promise<FfEvent[]> {
  try {
    let data: any

    if (isTauri) {
      // Use Tauri command proxy to avoid CORS
      const { invoke } = await import('@tauri-apps/api/core')
      const text = await invoke<string>('proxy_ff_calendar')
      data = JSON.parse(text)
    } else {
      // Try direct fetch first (works in some environments)
      let resp: Response
      try {
        resp = await fetch(FF_CALENDAR_URL, { signal: AbortSignal.timeout(8000) })
        if (!resp.ok) throw new Error('Direct fetch failed')
        data = await resp.json()
      } catch {
        // Fallback to Vercel proxy
        resp = await fetch(PROXY_URL, { signal: AbortSignal.timeout(8000) })
        if (!resp.ok) throw new Error('Proxy fetch also failed')
        data = await resp.json()
      }
    }

    if (!Array.isArray(data)) return []
    return data as FfEvent[]
  } catch {
    return []
  }
}

// ── Scheduler class ────────────────────────────────────────────────

type NotifiedSet = Set<string>

class NotificationScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private notified: NotifiedSet = new Set()
  private cachedEvents: FfEvent[] = []
  private lastCalendarFetch = 0
  private lastNyNotifiedDate = ''
  private lastLondonNotifiedDate = ''

  start() {
    if (this.intervalId) return
    // Run immediately then every 30 seconds
    this.tick()
    this.intervalId = setInterval(() => this.tick(), 30_000)
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  restart() {
    this.stop()
    this.start()
  }

  private async tick() {
    const settings = loadSettings()
    if (!settings.notificationsEnabled) return

    const now = new Date()

    // Refresh calendar every 30 minutes
    if (now.getTime() - this.lastCalendarFetch > 30 * 60 * 1000) {
      this.cachedEvents = await fetchFfCalendar()
      this.lastCalendarFetch = now.getTime()
    }

    // Check NY/London open
    if (settings.notifyNyOpen || settings.notifyLondonOpen) {
      this.checkSessionOpen(now, settings)
    }

    // Check FF news events
    if (settings.notifyNewsEvents) {
      this.checkNewsEvents(now, settings)
    }
  }

  private checkSessionOpen(now: Date, settings: ReturnType<typeof loadSettings>) {
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const nyMinsBefore = settings.notifyNyOpenMinutesBefore ?? 15
    const londonMinsBefore = nyMinsBefore // reuse same lead time for London

    // NY Open check
    if (settings.notifyNyOpen) {
      const nyOpenUtc = new Date(now)
      nyOpenUtc.setUTCHours(getNyOpenUtcHour(), getNyOpenUtcMinute(), 0, 0)
      const nyMinUntil = (nyOpenUtc.getTime() - now.getTime()) / 60_000

      if (
        nyMinUntil > 0 &&
        nyMinUntil <= nyMinsBefore &&
        this.lastNyNotifiedDate !== todayStr
      ) {
        this.lastNyNotifiedDate = todayStr
        const mins = Math.round(nyMinUntil)
        sendNotification(
          '🗽 New York Market Opens Soon',
          `NYSE opens in ${mins} minute${mins !== 1 ? 's' : ''}. Get ready — 9:30 AM ET volatility ahead.`,
        )
      }
    }

    // London Open check
    if (settings.notifyLondonOpen) {
      const londonHourUtc = isLondonBst(now) ? 7 : 8
      const londonOpenUtc = new Date(now)
      londonOpenUtc.setUTCHours(londonHourUtc, 0, 0, 0)
      const londonMinUntil = (londonOpenUtc.getTime() - now.getTime()) / 60_000

      if (
        londonMinUntil > 0 &&
        londonMinUntil <= londonMinsBefore &&
        this.lastLondonNotifiedDate !== todayStr
      ) {
        this.lastLondonNotifiedDate = todayStr
        const mins = Math.round(londonMinUntil)
        sendNotification(
          '🇬🇧 London Market Opens Soon',
          `London session opens in ${mins} minute${mins !== 1 ? 's' : ''} (8:00 AM GMT / 12:30 PM IST). High liquidity period beginning.`,
        )
      }
    }
  }

  private checkNewsEvents(now: Date, settings: ReturnType<typeof loadSettings>) {
    const watchedCurrencies = settings.notifyCurrencies ?? ['USD', 'EUR', 'GBP', 'JPY', 'CAD']
    const minutesBefore = settings.notifyMinutesBefore ?? 15

    for (const event of this.cachedEvents) {
      // Only high impact
      if (event.impact !== 'High') continue

      // Only watched currencies
      if (!watchedCurrencies.includes(event.country)) continue

      const eventTime = new Date(event.date)
      const msUntil = eventTime.getTime() - now.getTime()
      const minUntil = msUntil / 60_000

      // Within the alert window but not past yet
      if (minUntil < 0 || minUntil > minutesBefore) continue

      // Build unique key from event date + title to avoid re-notifying
      const key = `${event.date}|${event.title}|${event.country}`
      if (this.notified.has(key)) continue

      this.notified.add(key)
      const mins = Math.round(minUntil)
      const timeStr = eventTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      sendNotification(
        `⚡ ${event.country} High Impact News — ${event.title}`,
        `${mins > 0 ? `In ${mins} min (${timeStr})` : 'Right now!'} ${event.forecast ? `• Forecast: ${event.forecast}` : ''} ${event.previous ? `• Previous: ${event.previous}` : ''}`.trim(),
      )
    }

    // Clean up stale keys older than 2 hours (keep memory bounded)
    if (this.notified.size > 200) {
      this.notified.clear()
    }
  }
}

function isLondonBst(date: Date): boolean {
  // BST last Sunday in March → last Sunday in October
  const month = date.getUTCMonth() // 0-indexed
  if (month > 2 && month < 9) return true  // Apr–Sep definitely BST
  if (month < 2 || month > 9) return false // Jan–Feb, Nov–Dec definitely GMT
  // March and October: rough check
  if (month === 2) return date.getUTCDate() >= 25  // last week of March
  return date.getUTCDate() < 25  // first three weeks of October
}

// Singleton
export const notificationScheduler = new NotificationScheduler()
