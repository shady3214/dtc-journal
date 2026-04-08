import { useState, useEffect, useCallback } from 'react'
import { getApi, analyzeJournalEntry } from '../../shared/lib/api'
import type { JournalEntry, JournalAiFeedback } from '../../shared/types/domain'
import { useAccount } from '../../shared/contexts/AccountContext'

const BIASES = ['Bullish', 'Bearish', 'Neutral']
const SESSIONS = ['Asian', 'London', 'New York']
const GRADES = ['A', 'B', 'C', 'D', 'F']
const MOODS = [1, 2, 3, 4, 5]
const MOOD_LABELS = ['Terrible', 'Bad', 'Neutral', 'Good', 'Great']

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDateLabel(date: string): string {
  const d = new Date(date + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function hasContent(entry: JournalEntry): boolean {
  return !!(
    entry.preBias || entry.preSession || entry.preLevels || entry.prePlan ||
    entry.postWentWell || entry.postWentWrong || entry.postLessons ||
    entry.postMood || entry.postGrade
  )
}

const emptyEntry = (date: string): JournalEntry => ({
  date,
  preBias: '',
  preSession: '',
  preLevels: '',
  prePlan: '',
  postWentWell: '',
  postWentWrong: '',
  postLessons: '',
  postMood: 0,
  postGrade: '',
})

/* ── Journal AI Feedback Modal ──────────────────────────────── */

function JournalAiModal({ feedback, onClose }: { feedback: JournalAiFeedback; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="ai-modal-backdrop" onClick={onClose}>
      <div className="ai-modal journal-ai-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ai-modal-header">
          <div className="ai-modal-title-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <h3 className="ai-modal-title">Mentor Feedback</h3>
            <span className="ai-modal-pair">
              {new Date(feedback.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
          <button className="ai-modal-close" onClick={onClose}>×</button>
        </div>

        {/* Main mentor paragraph */}
        <div className="journal-ai-mentor-block">
          <p className="journal-ai-mentor-text">{feedback.mentor}</p>
        </div>

        {/* Contradiction */}
        {feedback.contradiction && (
          <div className="journal-ai-section journal-ai-contradiction">
            <div className="journal-ai-section-header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Contradiction Spotted</span>
            </div>
            <p>{feedback.contradiction}</p>
          </div>
        )}

        {/* Emotional flag */}
        {feedback.emotionalFlag && (
          <div className="journal-ai-section journal-ai-flag">
            <div className="journal-ai-section-header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
              </svg>
              <span>Emotional Flag</span>
            </div>
            <p>{feedback.emotionalFlag}</p>
          </div>
        )}

        {/* Strength */}
        {feedback.strength && (
          <div className="journal-ai-section journal-ai-strength">
            <div className="journal-ai-section-header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>What You Did Well</span>
            </div>
            <p>{feedback.strength}</p>
          </div>
        )}

        {/* Focus question */}
        <div className="journal-ai-section journal-ai-question">
          <div className="journal-ai-section-header">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Sit With This Tonight</span>
          </div>
          <p className="journal-ai-question-text">"{feedback.focusQuestion}"</p>
        </div>

        <p className="ai-modal-timestamp">Generated {new Date(feedback.createdAt).toLocaleString()}</p>
      </div>
    </div>
  )
}

/* ── Read-only summary (collapsed) ─────────────────────────── */

function JournalSummary({ entry, expanded, onToggle, onEdit, onAiFeedback, aiBusy, hasCachedFeedback }: {
  entry: JournalEntry
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onAiFeedback: () => void
  aiBusy: boolean
  hasCachedFeedback: boolean
}) {
  const hasPre = !!(entry.preBias || entry.preSession || entry.preLevels || entry.prePlan)
  const hasPost = !!(entry.postWentWell || entry.postWentWrong || entry.postLessons || entry.postMood || entry.postGrade)

  return (
    <div className="card journal-saved-card">
      {/* Collapsed summary header — always visible */}
      <button type="button" className="journal-summary-toggle" onClick={onToggle}>
        <div className="journal-summary-left">
          <span className={`journal-chevron ${expanded ? 'open' : ''}`}>&#9662;</span>
          <span className="journal-summary-title">Journal Entry</span>
          <div className="journal-summary-badges">
            {entry.preBias && (
              <span className="j-badge j-badge-bias">{entry.preBias}</span>
            )}
            {entry.preSession && (
              <span className="j-badge j-badge-session">{entry.preSession}</span>
            )}
            {entry.postGrade && (
              <span className="j-badge j-badge-grade">{entry.postGrade}</span>
            )}
            {entry.postMood > 0 && (
              <span className="j-badge j-badge-mood">{MOOD_LABELS[entry.postMood - 1]}</span>
            )}
          </div>
        </div>
        <span className="journal-summary-hint">{expanded ? 'Collapse' : 'View details'}</span>
      </button>

      {/* Expanded read-only details */}
      {expanded && (
        <div className="journal-expanded">
          {hasPre && (
            <div className="journal-ro-section">
              <h4>Pre-Session Plan</h4>
              <div className="journal-ro-grid">
                {entry.preBias && (
                  <div className="journal-ro-item">
                    <span className="journal-ro-label">Market Bias</span>
                    <span className="journal-ro-value">{entry.preBias}</span>
                  </div>
                )}
                {entry.preSession && (
                  <div className="journal-ro-item">
                    <span className="journal-ro-label">Session Focus</span>
                    <span className="journal-ro-value">{entry.preSession}</span>
                  </div>
                )}
              </div>
              {entry.preLevels && (
                <div className="journal-ro-block">
                  <span className="journal-ro-label">Key Levels / Zones</span>
                  <p className="journal-ro-text">{entry.preLevels}</p>
                </div>
              )}
              {entry.prePlan && (
                <div className="journal-ro-block">
                  <span className="journal-ro-label">Trading Plan</span>
                  <p className="journal-ro-text">{entry.prePlan}</p>
                </div>
              )}
            </div>
          )}

          {hasPost && (
            <div className="journal-ro-section">
              <h4>Post-Session Review</h4>
              {entry.postWentWell && (
                <div className="journal-ro-block">
                  <span className="journal-ro-label">What went well?</span>
                  <p className="journal-ro-text">{entry.postWentWell}</p>
                </div>
              )}
              {entry.postWentWrong && (
                <div className="journal-ro-block">
                  <span className="journal-ro-label">What went wrong?</span>
                  <p className="journal-ro-text">{entry.postWentWrong}</p>
                </div>
              )}
              {entry.postLessons && (
                <div className="journal-ro-block">
                  <span className="journal-ro-label">Lessons Learned</span>
                  <p className="journal-ro-text">{entry.postLessons}</p>
                </div>
              )}
              <div className="journal-ro-grid">
                {entry.postMood > 0 && (
                  <div className="journal-ro-item">
                    <span className="journal-ro-label">Mood</span>
                    <span className="journal-ro-value">{entry.postMood} — {MOOD_LABELS[entry.postMood - 1]}</span>
                  </div>
                )}
                {entry.postGrade && (
                  <div className="journal-ro-item">
                    <span className="journal-ro-label">Grade</span>
                    <span className="journal-ro-value">{entry.postGrade}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="journal-ro-actions">
            <button className="btn-secondary" onClick={onEdit}>Edit Entry</button>
            <button
              className="journal-ai-btn"
              onClick={onAiFeedback}
              disabled={aiBusy}
            >
              {aiBusy ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="spin">
                    <path d="M21 12a9 9 0 11-6.219-8.56" />
                  </svg>
                  Analysing...
                </>
              ) : hasCachedFeedback ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                  View Feedback
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                  Mentor Feedback
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Editable form ─────────────────────────────────────────── */

function JournalForm({ entry, onUpdate, onSave, onCancel, showCancel }: {
  entry: JournalEntry
  onUpdate: (partial: Partial<JournalEntry>) => void
  onSave: () => void
  onCancel?: () => void
  showCancel: boolean
}) {
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    onSave()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <>
      {/* Pre-Session Plan */}
      <div className="card journal-section">
        <h3>Pre-Session Plan</h3>

        <div className="field" style={{ marginTop: 12 }}>
          <span>Market Bias</span>
          <div className="pill-group">
            {BIASES.map((b) => (
              <button
                key={b}
                type="button"
                className={`pill-btn ${entry.preBias === b ? 'active' : ''}`}
                onClick={() => onUpdate({ preBias: b })}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <span>Session Focus</span>
          <div className="pill-group">
            {SESSIONS.map((s) => (
              <button
                key={s}
                type="button"
                className={`pill-btn ${entry.preSession === s ? 'active' : ''}`}
                onClick={() => onUpdate({ preSession: s })}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <span>Key Levels / Zones</span>
          <textarea
            rows={3}
            value={entry.preLevels}
            onChange={(e) => onUpdate({ preLevels: e.target.value })}
            placeholder="Support/resistance levels, order blocks, FVGs, POIs..."
          />
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <span>Trading Plan</span>
          <textarea
            rows={3}
            value={entry.prePlan}
            onChange={(e) => onUpdate({ prePlan: e.target.value })}
            placeholder="What setups am I looking for? What are my rules for today?"
          />
        </div>
      </div>

      {/* Post-Session Review */}
      <div className="card journal-section" style={{ marginTop: 16 }}>
        <h3>Post-Session Review</h3>

        <div className="field" style={{ marginTop: 12 }}>
          <span>What went well?</span>
          <textarea
            rows={3}
            value={entry.postWentWell}
            onChange={(e) => onUpdate({ postWentWell: e.target.value })}
            placeholder="Good execution, patience, followed the plan..."
          />
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <span>What went wrong?</span>
          <textarea
            rows={3}
            value={entry.postWentWrong}
            onChange={(e) => onUpdate({ postWentWrong: e.target.value })}
            placeholder="Mistakes, emotional decisions, missed opportunities..."
          />
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <span>Lessons Learned</span>
          <textarea
            rows={3}
            value={entry.postLessons}
            onChange={(e) => onUpdate({ postLessons: e.target.value })}
            placeholder="Key takeaways from today's session..."
          />
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <span>Emotional State</span>
          <div className="pill-group">
            {MOODS.map((m) => (
              <button
                key={m}
                type="button"
                className={`pill-btn mood-pill ${entry.postMood === m ? 'active' : ''}`}
                onClick={() => onUpdate({ postMood: m })}
                title={MOOD_LABELS[m - 1]}
              >
                {m} — {MOOD_LABELS[m - 1]}
              </button>
            ))}
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <span>Session Grade</span>
          <div className="pill-group">
            {GRADES.map((g) => (
              <button
                key={g}
                type="button"
                className={`pill-btn grade-pill ${entry.postGrade === g ? 'active' : ''}`}
                onClick={() => onUpdate({ postGrade: g })}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Save / Cancel */}
      <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn-primary" onClick={handleSave}>Save Entry</button>
        {showCancel && (
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        )}
        {saved && <span className="save-toast" style={{ margin: 0 }}>Saved!</span>}
      </div>
    </>
  )
}

/* ── Main Page ─────────────────────────────────────────────── */

export function JournalPage() {
  const { refreshKey } = useAccount()
  const [date, setDate] = useState(todayStr)
  const [entry, setEntry] = useState<JournalEntry>(emptyEntry(date))
  const [loading, setLoading] = useState(false)
  // mode: 'view' = show saved summary, 'edit' = show form
  const [mode, setMode] = useState<'view' | 'edit'>('edit')
  const [expanded, setExpanded] = useState(false)
  // Track whether a saved entry exists for this date
  const [hasSaved, setHasSaved] = useState(false)
  // AI feedback
  const [aiFeedback, setAiFeedback] = useState<JournalAiFeedback | null>(null)
  const [showAiModal, setShowAiModal] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const loadEntry = useCallback(async (d: string) => {
    setLoading(true)
    setAiFeedback(null)
    setShowAiModal(false)
    setAiError(null)
    try {
      const existing = await getApi().getJournalEntry(d)
      if (existing && hasContent(existing)) {
        setEntry(existing)
        setMode('view')
        setHasSaved(true)
        setExpanded(false)
        // Restore cached AI feedback if it was previously generated and saved
        if (existing.aiFeedback) {
          setAiFeedback(existing.aiFeedback)
        }
      } else {
        setEntry(emptyEntry(d))
        setMode('edit')
        setHasSaved(false)
        setExpanded(false)
      }
    } catch {
      setEntry(emptyEntry(d))
      setMode('edit')
      setHasSaved(false)
      setExpanded(false)
    }
    setLoading(false)
  }, [])

  const handleAiFeedback = async () => {
    // If feedback is already cached, just open the modal (no API call)
    if (aiFeedback) {
      setShowAiModal(true)
      return
    }
    setAiBusy(true)
    setAiError(null)
    try {
      const feedback = await analyzeJournalEntry(entry)
      setAiFeedback(feedback)
      setShowAiModal(true)
      // Persist the feedback onto the journal entry so it loads back next time
      const updatedEntry = { ...entry, aiFeedback: feedback }
      setEntry(updatedEntry)
      await getApi().saveJournalEntry(updatedEntry)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      if (msg === 'NO_TRADES') {
        setAiError('No trades logged for this day yet. Log your trades first, then come back for mentor feedback.')
      } else {
        setAiError(msg)
      }
    } finally {
      setAiBusy(false)
    }
  }

  useEffect(() => {
    loadEntry(date)
  }, [date, loadEntry, refreshKey])

  const goDay = (offset: number) => {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + offset)
    setDate(d.toISOString().slice(0, 10))
  }

  const goToday = () => setDate(todayStr())
  const isToday = date === todayStr()

  const handleUpdate = (partial: Partial<JournalEntry>) => {
    setEntry((prev) => ({ ...prev, ...partial }))
  }

  const handleSave = async () => {
    await getApi().saveJournalEntry(entry)
    setHasSaved(true)
    setMode('view')
    setExpanded(true) // show expanded briefly so user sees what they saved
  }

  const handleEdit = () => {
    setMode('edit')
    setExpanded(false)
  }

  const handleCancel = () => {
    // Reload the saved version
    loadEntry(date)
  }

  return (
    <>
      {aiFeedback && showAiModal && (
        <JournalAiModal feedback={aiFeedback} onClose={() => setShowAiModal(false)} />
      )}

      {/* Date navigation */}
      <div className="journal-date-nav">
        <button className="mini-btn" onClick={() => goDay(-1)}>&larr;</button>
        <div className="journal-date-center">
          <span className="journal-date-label">{formatDateLabel(date)}</span>
          {!isToday && (
            <button className="btn-secondary journal-today-btn" onClick={goToday}>Today</button>
          )}
        </div>
        <button className="mini-btn" onClick={() => goDay(1)}>&rarr;</button>
      </div>

      {aiError && (
        <div className="card" style={{ marginBottom: 12, padding: '12px 16px', borderColor: 'var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--negative)', fontSize: 13 }}>
          {aiError}
        </div>
      )}

      {loading ? (
        <p className="muted" style={{ textAlign: 'center', padding: 40 }}>Loading...</p>
      ) : mode === 'view' && hasSaved ? (
        <JournalSummary
          entry={entry}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          onEdit={handleEdit}
          onAiFeedback={handleAiFeedback}
          aiBusy={aiBusy}
          hasCachedFeedback={!!aiFeedback}
        />
      ) : (
        <JournalForm
          entry={entry}
          onUpdate={handleUpdate}
          onSave={handleSave}
          onCancel={hasSaved ? handleCancel : undefined}
          showCancel={hasSaved}
        />
      )}
    </>
  )
}
