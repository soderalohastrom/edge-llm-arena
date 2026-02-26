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

interface RunoffResult {
  model: string
  label: string
  tier: string
  params: string
  response: string | null
  latency_ms: number | null
  error?: string
  score: number | null
  notes: string
}

type ActiveTab = 'arena' | 'runoff'

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

function RunoffView({
  systemPrompt, models, runoffPrompt, setRunoffPrompt,
  selectedModels, setSelectedModels,
  results, setResults, running, setRunning,
}: {
  systemPrompt: string
  models: Record<string, ModelInfo>
  runoffPrompt: string
  setRunoffPrompt: (v: string) => void
  selectedModels: Set<string>
  setSelectedModels: (v: Set<string>) => void
  results: RunoffResult[]
  setResults: (v: RunoffResult[]) => void
  running: boolean
  setRunning: (v: boolean) => void
}) {
  const modelKeys = Object.keys(models)

  const toggleModel = (key: string) => {
    const next = new Set(selectedModels)
    next.has(key) ? next.delete(key) : next.add(key)
    setSelectedModels(next)
  }

  const toggleAll = () => {
    setSelectedModels(selectedModels.size === modelKeys.length ? new Set() : new Set(modelKeys))
  }

  const runAll = async () => {
    if (!runoffPrompt.trim() || selectedModels.size === 0) return
    setRunning(true)
    setResults([])
    try {
      const res = await fetch(`${EDGE_URL}/runoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: systemPrompt,
          prompt: runoffPrompt.trim(),
          models: [...selectedModels],
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setResults(
        (data.results || []).map((r: RunoffResult) => ({ ...r, score: null, notes: '' }))
      )
    } catch (err) {
      setResults([{
        model: 'error', label: 'Network Error', tier: '', params: '',
        response: null, latency_ms: null, error: `${err}`, score: null, notes: '',
      }])
    } finally {
      setRunning(false)
    }
  }

  const updateResult = (idx: number, patch: Partial<RunoffResult>) => {
    setResults(results.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  const sorted = [...results].sort((a, b) => (a.latency_ms ?? Infinity) - (b.latency_ms ?? Infinity))

  return (
    <div className="flex-1 flex flex-col p-4 min-h-0 overflow-auto">
      {/* Test prompt */}
      <div className="mb-4">
        <label className="text-xs font-medium text-white/60 uppercase tracking-wider mb-2 block">Test Prompt</label>
        <textarea
          value={runoffPrompt}
          onChange={(e) => setRunoffPrompt(e.target.value)}
          placeholder="The prompt to evaluate across all selected models..."
          className="w-full h-24 bg-black/30 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 font-mono resize-y focus:outline-none focus:border-indigo-500/50"
        />
      </div>

      {/* Model selection */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wider">
            Models ({selectedModels.size}/{modelKeys.length})
          </label>
          <button onClick={toggleAll} className="text-[10px] text-indigo-400 hover:text-indigo-300">
            {selectedModels.size === modelKeys.length ? 'Deselect All' : 'Select All'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {modelKeys.map((key) => {
            const m = models[key]
            const selected = selectedModels.has(key)
            return (
              <button key={key} onClick={() => toggleModel(key)}
                className={`text-[11px] px-3 py-1 rounded-full border transition-all ${
                  selected ? tierBadge(m.tier) : 'border-white/10 text-white/30 hover:border-white/20'
                }`}
              >
                {m.label} ({m.params})
              </button>
            )
          })}
        </div>
      </div>

      {/* Run All */}
      <button onClick={runAll}
        disabled={running || !runoffPrompt.trim() || selectedModels.size === 0}
        className={`mb-4 w-full px-6 py-2.5 rounded-xl font-medium text-sm transition-all ${
          running
            ? 'bg-indigo-800 text-indigo-300 cursor-wait'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-lg hover:shadow-indigo-500/20'
        } disabled:opacity-40`}
      >
        {running ? (
          <span className="flex items-center justify-center gap-2">
            <span className="animate-spin">☁️</span> Running {selectedModels.size} models...
          </span>
        ) : (
          `Run All (${selectedModels.size} models)`
        )}
      </button>

      {/* Results table */}
      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10 mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-3 py-2 text-left text-[10px] text-white/50 uppercase">#</th>
                <th className="px-3 py-2 text-left text-[10px] text-white/50 uppercase">Model</th>
                <th className="px-3 py-2 text-left text-[10px] text-white/50 uppercase">Tier</th>
                <th className="px-3 py-2 text-right text-[10px] text-white/50 uppercase">Latency</th>
                <th className="px-3 py-2 text-left text-[10px] text-white/50 uppercase min-w-[300px]">Response</th>
                <th className="px-3 py-2 text-center text-[10px] text-white/50 uppercase w-20">Score</th>
                <th className="px-3 py-2 text-left text-[10px] text-white/50 uppercase min-w-[150px]">Notes</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const origIdx = results.indexOf(r)
                return (
                  <tr key={r.model} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 text-xs text-white/30 font-mono">{i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="font-medium text-white/90 text-xs">{r.label}</span>
                      <span className={`ml-2 text-[10px] ${tierColor(r.tier)}`}>{r.params}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${tierBadge(r.tier)}`}>{r.tier}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-emerald-400/80">
                      {r.latency_ms !== null ? `${r.latency_ms}ms` : '--'}
                    </td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="text-red-400 text-xs">{r.error}</span>
                      ) : (
                        <pre className="text-xs text-emerald-200/80 whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">{r.response}</pre>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <select value={r.score ?? ''}
                        onChange={(e) => updateResult(origIdx, { score: e.target.value ? Number(e.target.value) : null })}
                        className="bg-black/40 border border-white/15 rounded px-2 py-1 text-xs text-white w-14 text-center appearance-none"
                      >
                        <option value="">--</option>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.notes}
                        onChange={(e) => updateResult(origIdx, { notes: e.target.value })}
                        placeholder="..."
                        className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white/80 focus:outline-none focus:border-indigo-500/50"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Agent API panel */}
      <details className="mt-auto">
        <summary className="text-xs text-white/40 cursor-pointer hover:text-white/60 select-none">
          Agent API
        </summary>
        <div className="mt-2 bg-black/30 border border-white/10 rounded-xl p-4 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-white/50 uppercase">Endpoint</span>
              <button onClick={() => navigator.clipboard.writeText(`${EDGE_URL}/runoff`)}
                className="text-[10px] text-white/40 hover:text-white/60">Copy</button>
            </div>
            <code className="text-xs text-indigo-300 font-mono">POST {EDGE_URL}/runoff</code>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-white/50 uppercase">Example curl</span>
              <button onClick={() => navigator.clipboard.writeText(
                `curl -s -X POST ${EDGE_URL}/runoff -H "Content-Type: application/json" -d '${JSON.stringify({ system: systemPrompt, prompt: runoffPrompt || '<test prompt>', models: [...selectedModels] })}'`
              )} className="text-[10px] text-white/40 hover:text-white/60">Copy</button>
            </div>
            <pre className="text-[11px] text-emerald-200/70 font-mono whitespace-pre-wrap bg-black/40 rounded-lg p-3 overflow-x-auto">
{`curl -s -X POST ${EDGE_URL}/runoff \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
    system: systemPrompt.slice(0, 80) + (systemPrompt.length > 80 ? '...' : ''),
    prompt: runoffPrompt || '<test prompt>',
    models: [...selectedModels].slice(0, 3).concat(selectedModels.size > 3 ? ['...'] : []),
  }, null, 2)}'`}
            </pre>
          </div>
          <div>
            <span className="text-[10px] text-white/50 uppercase block mb-1">Response shape</span>
            <pre className="text-[11px] text-amber-200/70 font-mono whitespace-pre-wrap bg-black/40 rounded-lg p-3">
{`{
  "results": [
    {
      "model": "llama-8b-fast",
      "label": "Llama 3.1 8B Fast",
      "tier": "sweet-spot",
      "params": "8B",
      "response": "...",
      "latency_ms": 342
    }
  ]
}`}
            </pre>
          </div>
        </div>
      </details>
    </div>
  )
}

function App() {
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [userInput, setUserInput] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [models, setModels] = useState<Record<string, ModelInfo>>({})
  const [activeTab, setActiveTab] = useState<ActiveTab>('arena')
  const [runoffPrompt, setRunoffPrompt] = useState('')
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [runoffResults, setRunoffResults] = useState<RunoffResult[]>([])
  const [runoffRunning, setRunoffRunning] = useState(false)

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
      .then((data: { models: Record<string, ModelInfo> }) => {
        setModels(data.models)
        setSelectedModels(new Set(Object.keys(data.models)))
      })
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
        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-white/5 rounded-full p-1 border border-white/10">
          {(['arena', 'runoff'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeTab === tab
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {tab === 'arena' ? 'Arena' : 'Runoff'}
            </button>
          ))}
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

      {activeTab === 'arena' ? (
        /* Arena: Input left, two response panes right */
        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
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
      ) : (
        <RunoffView
          systemPrompt={systemPrompt}
          models={models}
          runoffPrompt={runoffPrompt}
          setRunoffPrompt={setRunoffPrompt}
          selectedModels={selectedModels}
          setSelectedModels={setSelectedModels}
          results={runoffResults}
          setResults={setRunoffResults}
          running={runoffRunning}
          setRunning={setRunoffRunning}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-2 flex items-center justify-between text-[10px] text-white/30">
        <span>Hoʻokūkū Ao — {activeTab === 'arena' ? 'Same prompt, same system — only the model differs' : 'Parallel model evaluation · Agent-compatible API'}</span>
        <span>No API keys · No data persisted · Free Edge Inference</span>
      </footer>
    </div>
  )
}

export default App
