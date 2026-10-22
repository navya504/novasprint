import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';

export function modelSettings(settings = {}) {
  const provider = (process.env.MODEL_PROVIDER || settings.modelProvider || 'ollama').toLowerCase();
  if (provider === 'nebius') {
    return {
      provider,
      baseUrl: (process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1').replace(/\/+$/, ''),
      model: process.env.NEBIUS_MODEL || 'zai-org/GLM-5.3-Flash',
      apiKey: process.env.NEBIUS_API_KEY || '',
      temperature: 0,
      maxRetries: 1,
      timeout: 120000
    };
  }
  return {
    provider: 'ollama',
    baseUrl: process.env.OLLAMA_BASE_URL || settings.ollamaBaseUrl || 'http://127.0.0.1:11434',
    model: process.env.OLLAMA_MODEL || settings.ollamaModel || 'qwen3:8b',
    temperature: 0,
    maxRetries: 1
  };
}

export function modelConfigured(settings) {
  const config = modelSettings(settings);
  return Boolean(config.model && (config.provider !== 'nebius' || config.apiKey));
}

export function createChatModel(settings, { outputTokens } = {}) {
  const config = modelSettings(settings);
  if (config.provider === 'nebius') {
    if (!config.apiKey) throw new Error('Set NEBIUS_API_KEY in the local .env file.');
    return new ChatOpenAI({
      model: config.model,
      apiKey: config.apiKey,
      configuration: { baseURL: config.baseUrl },
      temperature: config.temperature,
      ...(outputTokens ? { maxTokens: outputTokens } : {}),
      maxRetries: config.maxRetries,
      timeout: config.timeout
    });
  }
  return new ChatOllama({ ...config, ...(outputTokens ? { numPredict: outputTokens } : {}) });
}

export async function modelHealth(settings) {
  const config = modelSettings(settings);
  if (config.provider === 'nebius') {
    if (!config.apiKey) return { provider: config.provider, connected: false, model: config.model, models: [], error: 'NEBIUS_API_KEY is missing from the local .env file.' };
    try {
      const response = await fetch(`${config.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) return { provider: config.provider, connected: false, model: config.model, models: [], error: `Nebius Token Factory returned HTTP ${response.status}. Check the Token Factory API key and base URL.` };
      const body = await response.json();
      const models = (body.data || []).map(item => item.id).filter(Boolean);
      const available = models.includes(config.model);
      return { provider: config.provider, connected: true, model: config.model, models, error: available ? null : `Selected model is not available to this Nebius account: ${config.model}.` };
    } catch {
      return { provider: config.provider, connected: false, model: config.model, models: [], error: 'Nebius Token Factory is not reachable at the configured API URL.' };
    }
  }
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return { provider: config.provider, connected: false, model: config.model, models: [], error: `Ollama returned ${response.status}.` };
    const body = await response.json();
    const models = (body.models || []).map(item => item.name);
    return { provider: config.provider, connected: true, model: config.model, models, error: config.model && !models.includes(config.model) ? 'Selected model is not installed in Ollama.' : null };
  } catch {
    return { provider: config.provider, connected: false, model: config.model, models: [], error: 'Ollama is not reachable at the configured local address.' };
  }
}
