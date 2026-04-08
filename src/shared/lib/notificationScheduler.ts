/**
 * Notification Scheduler
 *
 * Polls every 30 seconds to check for:
 *  1. Upcoming high-impact forex news events (ForexFactory calendar)
 *  2. New York market open (9:30 AM ET)
 *  3. London market open (8:00 AM GMT)
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
  // During EDT (summer DST) NY 9:30 = 13:30 UTC
  // During EST (winter)     NY 9:30 = 14:30 UTC
  const now = new Date()
  const estOffset = isDst(now) ? 4 : 5 // hours behind UTC
  return 9 + estOffset  // 9 AM ET in UTC hours
}

function getNyOpenUtcMinute(): number {
  return 30 // always :30
}

/**
 * Rough DST check for US Eastern (second Sun Mar → first Sun Nov).
 */
function isDst(date: Date): boolean {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset()
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset()
  return date.getTimezoneOffset() < Math.max(jan, jul)
}

// ── Notification permission ────────────────────────────────────────

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}

export function sendTestNotification() {
  if (!('Notification' in window)) {
    alert('Notifications are not supported in this browser/environment.')
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


function sendNotification(title: string, body: string, icon?: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, {
      body,
      icon: icon || '/favicon.ico',
      tag: title, // prevent duplicate stacking
      requireInteraction: false,
    })
    // Auto-close after 10s
    setTimeout(() => n.close(), 10_000)
  } catch {
    // Some browsers block notifications from file:// URLs in dev — ignore
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
    const todayStr = now.toISOString().slice(0, 10)
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
          `London session opens in ${mins} minute${mins !== 1 ? 's' : ''}. High liquidity period beginning.`,
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
