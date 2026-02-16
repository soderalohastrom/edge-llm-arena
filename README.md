# Hoʻokūkū Ao ☁️ — Edge LLM Arena

**"Cloud Contest"** — Compare AI models side-by-side, for free, on Cloudflare's edge.

One prompt, two models, zero API keys. Watch them race.

## Why

In this day and age, any app can have a brain — for free. Cloudflare Workers AI gives you Llama, Qwen, Gemma, Mistral, GPT-OSS, DeepSeek, and more, all running at the edge with zero cost (10K neurons/day free tier). No credit card. No API keys. Just a Worker and a system prompt.

This app lets you **compare 16 models head-to-head** to find the right one for your use case.

## Quick Start

```bash
# 1. Deploy the edge worker (one-time)
cd worker
pnpm install
pnpm run deploy
# Note the URL it gives you

# 2. Configure
cd ..
cp .env.example .env
# Edit .env with your worker URL

# 3. Run
pnpm install
pnpm dev
```

## Features

- **Side-by-side comparison** — same prompt, same system prompt, different models
- **16 free models** — from 1B to 120B parameters
- **Streaming responses** — watch tokens arrive in real-time
- **Reasoning models** — Qwen3 and DeepSeek show their thinking process
- **Editable system prompt** — shape the AI per request
- **Timing** — see exact latency from the edge

## Available Models

| Tier | Model | Params | Notes |
|------|-------|--------|-------|
| 💚 Budget | IBM Granite Micro | ~3B | Cheapest per neuron |
| 💚 Budget | Llama 3.2 1B | 1B | Ultra-light |
| 💚 Budget | Llama 3.2 3B | 3B | Light tasks |
| 💛 Sweet-spot | Qwen3 30B-A3B (MoE) | 30B/3B | 30B brain at 3B cost |
| 💛 Sweet-spot | Llama 3.1 8B Fast | 8B | Speed king |
| 💛 Sweet-spot | GLM 4.7 Flash | ~7B | 131K context |
| 💜 Heavy | Gemma 3 12B | 12B | Google quality |
| 💜 Heavy | Mistral Small 3.1 24B | 24B | Vision + text |
| 💜 Heavy | Llama 4 Scout | 17B×16E | Multimodal MoE |
| 💜 Heavy | OpenAI GPT-OSS 20B/120B | 20-120B | Open-weight reasoning |
| 💜 Heavy | QwQ 32B | 32B | Deep reasoning |
| ❤️ Beast | Llama 3.3 70B Fast | 70B | Maximum capability |

## Stack

- **Frontend:** Vite + React + TypeScript + Tailwind CSS
- **Backend:** Cloudflare Worker + AI binding (free)
- **Auth:** None needed
- **Database:** None needed
- **Cost:** $0

## The Pattern

```
[Simple UI] → [CF Worker + AI binding + system prompt] → [smart response]
```

That's it. That's the whole architecture for adding AI to any app. Free, fast, edge-deployed.

## Name

**Hoʻokūkū Ao** (Hawaiian) — "Cloud Contest." Because even AI deserves a little aloha. 🤙🏼

---

*Ma ka hana ka ʻike* — In working, one learns.
