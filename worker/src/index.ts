/**
 * Cloud Llama Edge Worker 🦙☁️
 * Free multi-model inference on Cloudflare's edge.
 * No API keys needed — uses the AI binding.
 *
 * POST / or /chat — chat completion (streaming SSE or JSON)
 *   Body: { system?, prompt?, messages?, model?, stream? }
 * POST /runoff — parallel multi-model inference (non-streaming)
 *   Body: { system?, prompt, models?: string[] }
 * GET /health — status + available models
 */

export interface Env {
  AI: Ai;
}

const MODELS: Record<string, { id: string; label: string; params: string; tier: string }> = {
  'granite-micro':    { id: '@cf/ibm-granite/granite-4.0-h-micro',          label: 'IBM Granite 4.0 Micro',      params: '~3B',       tier: 'budget' },
  'llama-1b':         { id: '@cf/meta/llama-3.2-1b-instruct',               label: 'Llama 3.2 1B',               params: '1B',        tier: 'budget' },
  'llama-3b':         { id: '@cf/meta/llama-3.2-3b-instruct',               label: 'Llama 3.2 3B',               params: '3B',        tier: 'budget' },
  'qwen3-moe':        { id: '@cf/qwen/qwen3-30b-a3b-fp8',                   label: 'Qwen3 30B-A3B (MoE)',        params: '30B/3B',    tier: 'sweet-spot' },
  'llama-8b-fast':    { id: '@cf/meta/llama-3.1-8b-instruct-fp8-fast',      label: 'Llama 3.1 8B Fast',          params: '8B',        tier: 'sweet-spot' },
  'llama-8b':         { id: '@cf/meta/llama-3.1-8b-instruct',               label: 'Llama 3.1 8B',               params: '8B',        tier: 'standard' },
  'glm-flash':        { id: '@cf/zai-org/glm-4.7-flash',                    label: 'GLM 4.7 Flash',              params: '~7B',       tier: 'sweet-spot' },
  'gemma-12b':        { id: '@cf/google/gemma-3-12b-it',                    label: 'Gemma 3 12B',                params: '12B',       tier: 'heavy' },
  'mistral-24b':      { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1 24B',      params: '24B',       tier: 'heavy' },
  'llama4-scout':     { id: '@cf/meta/llama-4-scout-17b-16e-instruct',      label: 'Llama 4 Scout (MoE)',        params: '17B×16E',   tier: 'heavy' },
  'gpt-oss-20b':      { id: '@cf/openai/gpt-oss-20b',                       label: 'OpenAI GPT-OSS 20B',         params: '20B',       tier: 'heavy' },
  'gpt-oss-120b':     { id: '@cf/openai/gpt-oss-120b',                      label: 'OpenAI GPT-OSS 120B',        params: '120B',      tier: 'heavy' },
  'qwq-32b':          { id: '@cf/qwen/qwq-32b',                             label: 'QwQ 32B (Reasoning)',        params: '32B',       tier: 'heavy' },
  'qwen-coder-32b':   { id: '@cf/qwen/qwen2.5-coder-32b-instruct',         label: 'Qwen 2.5 Coder 32B',        params: '32B',       tier: 'heavy' },
  'deepseek-r1-32b':  { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',label: 'DeepSeek R1 Distill 32B',    params: '32B',       tier: 'heavy' },
  'llama-70b':        { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',     label: 'Llama 3.3 70B Fast',         params: '70B',       tier: 'beast' },
};

const DEFAULT_MODEL = 'llama-8b-fast';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // Health + model catalog
    if (url.pathname === '/health' || url.pathname === '/models') {
      return Response.json({
        status: 'ok',
        defaultModel: DEFAULT_MODEL,
        models: Object.fromEntries(
          Object.entries(MODELS).map(([key, m]) => [key, { label: m.label, params: m.params, tier: m.tier }])
        ),
      }, { headers: CORS });
    }

    // Chat endpoint
    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/chat')) {
      try {
        const body = (await request.json()) as {
          messages?: { role: string; content: string }[];
          system?: string;
          prompt?: string;
          model?: string;
          stream?: boolean;
        };

        // Resolve model
        const modelKey = body.model || DEFAULT_MODEL;
        const modelEntry = MODELS[modelKey];
        if (!modelEntry) {
          return Response.json(
            { error: `Unknown model: ${modelKey}`, available: Object.keys(MODELS) },
            { status: 400, headers: CORS }
          );
        }

        const messages: { role: string; content: string }[] = [];
        if (body.system) messages.push({ role: 'system', content: body.system });
        if (body.messages) messages.push(...body.messages);
        else if (body.prompt) messages.push({ role: 'user', content: body.prompt });

        if (messages.length === 0) {
          return Response.json({ error: 'Provide messages[], or prompt, or both' }, { status: 400, headers: CORS });
        }

        const wantStream = body.stream !== false;

        if (wantStream) {
          const stream = await env.AI.run(modelEntry.id as BaseAiTextGenerationModels, {
            messages,
            stream: true,
            max_tokens: 2048,
          });
          return new Response(stream as ReadableStream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'X-Model': modelEntry.id,
              ...CORS,
            },
          });
        }

        const result = await env.AI.run(modelEntry.id as BaseAiTextGenerationModels, { messages, max_tokens: 2048 });
        return Response.json(
          { result: (result as { response: string }).response, model: modelEntry.id },
          { headers: CORS }
        );
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : 'Unknown error' },
          { status: 500, headers: CORS }
        );
      }
    }

    // Runoff endpoint — parallel non-streaming inference across multiple models
    if (request.method === 'POST' && url.pathname === '/runoff') {
      try {
        const body = (await request.json()) as {
          system?: string;
          prompt: string;
          models?: string[];
        };

        if (!body.prompt) {
          return Response.json({ error: 'prompt is required' }, { status: 400, headers: CORS });
        }

        const modelKeys = body.models?.length
          ? body.models.filter((k) => MODELS[k])
          : Object.keys(MODELS);

        if (modelKeys.length === 0) {
          return Response.json(
            { error: 'No valid models specified', available: Object.keys(MODELS) },
            { status: 400, headers: CORS }
          );
        }

        const messages: { role: string; content: string }[] = [];
        if (body.system) messages.push({ role: 'system', content: body.system });
        messages.push({ role: 'user', content: body.prompt });

        const settled = await Promise.allSettled(
          modelKeys.map(async (key) => {
            const model = MODELS[key];
            const start = Date.now();
            const result = await env.AI.run(model.id as BaseAiTextGenerationModels, {
              messages,
              max_tokens: 2048,
            });
            return {
              model: key,
              label: model.label,
              tier: model.tier,
              params: model.params,
              response: (result as { response: string }).response,
              latency_ms: Date.now() - start,
            };
          })
        );

        const results = settled.map((s, i) =>
          s.status === 'fulfilled'
            ? s.value
            : {
                model: modelKeys[i],
                label: MODELS[modelKeys[i]].label,
                tier: MODELS[modelKeys[i]].tier,
                params: MODELS[modelKeys[i]].params,
                response: null,
                latency_ms: null,
                error: s.reason?.message || 'Unknown error',
              }
        );

        return Response.json({ results }, { headers: CORS });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : 'Unknown error' },
          { status: 500, headers: CORS }
        );
      }
    }

    return Response.json(
      { error: 'Not found', endpoints: ['POST / or /chat', 'POST /runoff', 'GET /health', 'GET /models'] },
      { status: 404, headers: CORS }
    );
  },
};
