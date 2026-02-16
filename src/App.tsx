import { useState, useEffect, useCallback } from 'react'

const EDGE_URL = import.meta.env.VITE_EDGE_URL || 'http://localhost:8787'

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant running on Cloudflare's edge network. You are fast, concise, and slightly sassy. Keep responses focused and useful.`

type ModelInfo = { label: string; params: string; tier: string }

function tierColor(tier: string) {
  switch (tier) {
    case 'budget': return 'text-emerald-400'
    case 'sweet-spot': return 'text-amber-400'
    case 'standard': return 'text-blue-400'
    case 'heavy': return 'text-purple-400'
    case 'beast': return 'text-red-400'
    default: return 'text-white/50'
  }
}

function tierBadge(tier: string) {
  const colors: Record<string, string> = {
    budget: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    'sweet-spot': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    standard: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    heavy: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    beast: 'bg-red-500/15 text-red-400 border-red-500/30',
  }
  return colors[tier] || 'bg-white/10 text-white/50 border-white/20'
}

interface PaneState {
  model: string
  output: string
  loading: boolean
  elapsed: number | null
  error: string | null
}

function useStreamRequest() {
  const stream = useCallback(async (
    systemPrompt: string,
    userInput: string,
    model: string,
    onChunk: (text: string) => void,
    onDone: (elapsed: number) => void,
    onError: (err: string) => void,
  ) => {
    const start = performance.now()
    try {
      const response = await fetch(EDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: systemPrompt, prompt: userInput, model, stream: true }),
      })

      if (!response.ok) {
        const errText = await response.text()
        onError(`Error ${response.status}: ${errText}`)
        return
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let result = ''
      let reasoning = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                // Format 1: Simple {response: "..."} (Llama, Mistral, etc.)
                if (parsed.response) {
                  result += parsed.response
                  onChunk(result)
                }
                // Format 2: OpenAI-compatible {choices: [{delta: {content, reasoning_content}}]}
                else if (parsed.choices?.[0]?.delta) {
                  const delta = parsed.choices[0].delta
                  if (delta.reasoning_content) {
                    reasoning += delta.reasoning_content
                    onChunk(reasoning + (result ? '\n\n---\n\n' + result : '\n\n⏳ thinking...'))
                  }
                  if (delta.content) {
                    result += delta.content
                    onChunk(reasoning ? '💭 ' + reasoning + '\n\n---\n\n' + result : result)
                  }
                }
              } catch { /* partial */ }
            }
          }
        }
        // Final: show clean output (reasoning collapsed if there's actual content)
        if (result && reasoning) {
          onChunk('💭 [reasoning hidden — ' + reasoning.length + ' chars]\n\n' + result)
        }
      }
      onDone(Math.round(performance.now() - start))
    } catch (err) {
      onError(`Network error: ${err}`)
    }
  }, [])

  return stream
}

function ResponsePane({
  pane,
  models,
  onModelChange,
}: {
  pane: PaneState
  models: Record<string, ModelInfo>
  onModelChange: (model: string) => void
}) {
  const info = models[pane.model]
  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Model selector */}
      <div className="flex items-center gap-2 mb-2">
        <select
          value={pane.model}
          onChange={(e) => onModelChange(e.target.value)}
          className="flex-1 bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
        >
          {Object.entries(models).map(([key, m]) => (
            <option key={key} value={key}>
              {m.label} ({m.params}) — {m.tier}
            </option>
          ))}
        </select>
      </div>

      {/* Model info badge */}
      {info && (
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${tierBadge(info.tier)}`}>
            {info.tier}
          </span>
          <span className={`text-[10px] ${tierColor(info.tier)}`}>{info.params}</span>
          {pane.elapsed !== null && (
            <span className="text-[10px] text-emerald-400/80 font-mono ml-auto">{pane.elapsed}ms ⚡</span>
          )}
          {pane.loading && (
            <span className="text-[10px] text-indigo-400 font-mono ml-auto animate-pulse">streaming...</span>
          )}
        </div>
      )}

      {/* Output */}
      <textarea
        value={pane.error || pane.output}
        readOnly
        placeholder="Response will appear here..."
        className={`flex-1 min-h-[200px] bg-black/30 border border-white/15 rounded-xl px-4 py-3 text-sm font-mono resize-none focus:outline-none ${
          pane.error ? 'text-red-400/90' : 'text-emerald-200/90'
        } placeholder-white/20`}
      />

      {pane.output && !pane.error && (
        <button
          onClick={() => navigator.clipboard.writeText(pane.output)}
          className="mt-2 self-end px-3 py-1 text-[10px] text-white/50 hover:text-white/80 border border-white/15 rounded-lg hover:border-white/30 transition-all"
        >
          📋 Copy
        </button>
      )}
    </div>
  )
}

function App() {
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [userInput, setUserInput] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [models, setModels] = useState<Record<string, ModelInfo>>({})

  const [paneA, setPaneA] = useState<PaneState>({
    model: 'llama-8b-fast', output: '', loading: false, elapsed: null, error: null,
  })
  const [paneB, setPaneB] = useState<PaneState>({
    model: 'qwen3-moe', output: '', loading: false, elapsed: null, error: null,
  })

  const stream = useStreamRequest()

  // Fetch model catalog on mount
  useEffect(() => {
    fetch(`${EDGE_URL}/models`)
      .then((r) => r.json())
      .then((data: { models: Record<string, ModelInfo> }) => setModels(data.models))
      .catch(() => {})
  }, [])

  const sendBoth = useCallback(() => {
    if (!userInput.trim()) return
    const prompt = userInput.trim()

    // Reset both panes
    setPaneA((p) => ({ ...p, output: '', loading: true, elapsed: null, error: null }))
    setPaneB((p) => ({ ...p, output: '', loading: true, elapsed: null, error: null }))

    // Fire both simultaneously
    stream(
      systemPrompt, prompt, paneA.model,
      (text) => setPaneA((p) => ({ ...p, output: text })),
      (elapsed) => setPaneA((p) => ({ ...p, loading: false, elapsed })),
      (err) => setPaneA((p) => ({ ...p, loading: false, error: err })),
    )
    stream(
      systemPrompt, prompt, paneB.model,
      (text) => setPaneB((p) => ({ ...p, output: text })),
      (elapsed) => setPaneB((p) => ({ ...p, loading: false, elapsed })),
      (err) => setPaneB((p) => ({ ...p, loading: false, error: err })),
    )
  }, [userInput, systemPrompt, paneA.model, paneB.model, stream])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      sendBoth()
    }
  }

  const isLoading = paneA.loading || paneB.loading

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">☁️</span>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Hoʻokūkū Ao <span className="text-white/40 font-normal text-sm">Edge LLM Arena</span></h1>
            <p className="text-[10px] text-white/40">Compare models side-by-side · Cloudflare Workers AI · Free Edge Inference</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSystem(!showSystem)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
              showSystem
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                : 'border-white/20 text-white/50 hover:border-white/40'
            }`}
          >
            🧠 System Prompt {showSystem ? '▾' : '▸'}
          </button>
          <span className="text-xs px-3 py-1.5 rounded-full border border-emerald-500/50 bg-emerald-500/10 text-emerald-400">
            ☁️ {Object.keys(models).length} models · Free
          </span>
        </div>
      </header>

      {/* System Prompt */}
      {showSystem && (
        <div className="px-6 py-3 bg-white/5 border-b border-white/10">
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="w-full h-24 bg-black/30 border border-white/20 rounded-lg px-4 py-3 text-sm text-amber-200/90 font-mono resize-y focus:outline-none focus:border-amber-500/50"
            placeholder="System prompt — shared by both models..."
          />
          <div className="flex justify-between items-center mt-1">
            <p className="text-[10px] text-white/40">Same system prompt for both models — isolates the model as the variable.</p>
            <button
              onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
              className="text-[10px] text-white/40 hover:text-white/60 transition-colors"
            >
              Reset default
            </button>
          </div>
        </div>
      )}

      {/* Main: Input left, two response panes right */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Input pane */}
        <div className="lg:w-[340px] flex flex-col p-4 border-r border-white/5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-white/60 uppercase tracking-wider">Prompt</label>
            <span className="text-[10px] text-white/30">⌘+Enter</span>
          </div>
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask something — both models answer simultaneously..."
            className="flex-1 min-h-[150px] bg-black/30 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 font-mono resize-none focus:outline-none focus:border-indigo-500/50 transition-colors"
          />
          <button
            onClick={sendBoth}
            disabled={isLoading || !userInput.trim()}
            className={`mt-3 w-full px-6 py-2.5 rounded-xl font-medium text-sm transition-all ${
              isLoading
                ? 'bg-indigo-800 text-indigo-300 cursor-wait'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-lg hover:shadow-indigo-500/20'
            } disabled:opacity-40`}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">☁️</span> Racing...
              </span>
            ) : (
              '☁️ Send to Both'
            )}
          </button>
        </div>

        {/* Response panes */}
        <div className="flex-1 flex flex-col md:flex-row gap-3 p-4 min-h-0">
          <ResponsePane
            pane={paneA}
            models={models}
            onModelChange={(m) => setPaneA((p) => ({ ...p, model: m }))}
          />
          <div className="hidden md:flex items-center">
            <div className="w-px h-full bg-white/10" />
            <span className="absolute text-[10px] text-white/30 bg-slate-900 px-1 -ml-2">VS</span>
          </div>
          <ResponsePane
            pane={paneB}
            models={models}
            onModelChange={(m) => setPaneB((p) => ({ ...p, model: m }))}
          />
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-2 flex items-center justify-between text-[10px] text-white/30">
        <span>Hoʻokūkū Ao — Cloud Contest · Same prompt, same system — only the model differs</span>
        <span>No API keys · No data persisted · 10K free neurons/day</span>
      </footer>
    </div>
  )
}

export default App
