import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { post } from '../api/client'
import type { AssistantAnswer } from '../api/types'
import { AiChip, Button } from './ui'

interface Message {
  role: 'user' | 'assistant'
  text: string
  tools?: string[]
  source?: string | null
  unavailable?: boolean
}

const STARTERS = ['Which products will run out soonest?', 'What is waiting for approval?', 'Which anomalies are still open?']

const TOOL_LABEL: Record<string, string> = {
  get_low_stock: 'low stock',
  get_stock: 'stock levels',
  get_forecast: 'forecast',
  get_days_of_cover: 'days of cover',
  list_suggestions: 'suggestions',
  list_anomalies: 'anomalies',
  get_models: 'models',
}

// UI-008. The assistant only reads (its tools cannot change anything); what it looked at is shown under each answer.
export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const ask = useMutation({
    mutationFn: async (q: string) => (await post<AssistantAnswer>('/ai/ask', { question: q })).data,
    onSuccess: (data) =>
      setMessages((m) => [
        ...m,
        data.unavailable || !data.answer
          ? { role: 'assistant', text: 'The assistant is not available right now. The rest of the system is not affected; try again in a moment.', unavailable: true }
          : { role: 'assistant', text: data.answer, tools: [...new Set(data.toolCalls.map((c) => c.name))], source: data.source },
      ]),
    onError: (error) => setMessages((m) => [...m, { role: 'assistant', text: error instanceof Error ? error.message : 'Something went wrong.', unavailable: true }]),
  })

  useEffect(() => {
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight })
  }, [messages, ask.isPending])

  if (!open) return null

  const send = (text: string) => {
    const q = text.trim()

    if (!q || ask.isPending) return

    setMessages((m) => [...m, { role: 'user', text: q }])
    setQuestion('')
    ask.mutate(q)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    send(question)
  }

  return (
    <aside className="assistant" aria-label="AI assistant">
      <div className="assistant__header">
        <div>
          <h2>Ask the assistant</h2>
          <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Answers come from the system’s own data. It can look things up; it cannot change anything.</p>
        </div>
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close the assistant">
          ✕
        </Button>
      </div>
      <div className="assistant__log" ref={logRef} role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="stack">
            <p className="muted">Try one of these:</p>
            {STARTERS.map((s) => (
              <Button key={s} size="sm" onClick={() => send(s)}>
                {s}
              </Button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble--${m.role === 'user' ? 'user' : 'ai'}`}>
            {m.text}
            {m.role === 'assistant' && !m.unavailable && (
              <div className="bubble__meta">
                <AiChip>AI-written</AiChip>
                {m.tools && m.tools.length > 0 && <> looked at: {m.tools.map((t) => TOOL_LABEL[t] ?? t).join(', ')}</>}
                {m.source && <> · {m.source.split(':').slice(1).join(' · ')}</>}
              </div>
            )}
          </div>
        ))}
        {ask.isPending && (
          <div className="bubble bubble--ai" role="status">
            <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} aria-hidden="true" />
            Looking it up…
          </div>
        )}
      </div>
      <form className="assistant__form" onSubmit={submit}>
        <label htmlFor="assistant-question" className="visually-hidden">Your question</label>
        <input id="assistant-question" className="input" value={question} maxLength={500} placeholder="Ask about stock, forecasts, suggestions…" onChange={(e) => setQuestion(e.target.value)} />
        <Button type="submit" variant="ai" disabled={!question.trim() || ask.isPending}>
          Ask
        </Button>
      </form>
    </aside>
  )
}
