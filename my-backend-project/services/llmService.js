// services/llmService.js — Anthropic/OpenAI/Gemini adaptörü + AILog kaydı
const axios = require('axios');
const AILog = require('../models/AILog');

const AI_PROVIDER   = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_KEY    = process.env.OPENAI_API_KEY    || '';
const GEMINI_KEY    = process.env.GEMINI_API_KEY    || '';
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 30000);

const DEFAULT_MODEL = {
  anthropic: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
  openai:    process.env.AI_MODEL || 'gpt-4o-mini',
  gemini:    process.env.AI_MODEL || 'gemini-1.5-flash',
};

// USD / 1K token maliyeti (yaklaşık, model bazlı)
const COST_PER_1K = {
  'claude-haiku-4-5-20251001': { input: 0.00025,  output: 0.00125 },
  'claude-sonnet-4-6':         { input: 0.003,    output: 0.015   },
  'claude-opus-4-7':           { input: 0.015,    output: 0.075   },
  'gpt-4o-mini':               { input: 0.00015,  output: 0.0006  },
  'gpt-4o':                    { input: 0.005,    output: 0.015   },
  'gemini-1.5-flash':          { input: 0.000075, output: 0.0003  },
  'gemini-1.5-pro':            { input: 0.00125,  output: 0.005   },
  'gemini-2.0-flash':          { input: 0.0001,   output: 0.0004  },
};

function calcCost(model, inputTokens, outputTokens) {
  const r = COST_PER_1K[model] || { input: 0.001, output: 0.003 };
  return (inputTokens / 1000) * r.input + (outputTokens / 1000) * r.output;
}

async function callAnthropic({ systemPrompt, messages, maxTokens }) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY tanımlı değil');
  const model = DEFAULT_MODEL.anthropic;
  const start = Date.now();

  const resp = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model, max_tokens: maxTokens, system: systemPrompt, messages },
    {
      timeout: AI_TIMEOUT_MS,
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }
  );

  const u = resp.data?.usage || {};
  return {
    content:          resp.data?.content?.[0]?.text || '',
    promptTokens:     u.input_tokens  || 0,
    completionTokens: u.output_tokens || 0,
    totalTokens:      (u.input_tokens || 0) + (u.output_tokens || 0),
    durationMs:       Date.now() - start,
    model,
    provider:         'anthropic',
  };
}

async function callOpenAI({ systemPrompt, messages, maxTokens }) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY tanımlı değil');
  const model = DEFAULT_MODEL.openai;
  const start = Date.now();
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const resp = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model, max_tokens: maxTokens, messages: allMessages, response_format: { type: 'json_object' } },
    {
      timeout: AI_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    }
  );

  const u = resp.data?.usage || {};
  return {
    content:          resp.data?.choices?.[0]?.message?.content || '',
    promptTokens:     u.prompt_tokens     || 0,
    completionTokens: u.completion_tokens || 0,
    totalTokens:      u.total_tokens      || 0,
    durationMs:       Date.now() - start,
    model,
    provider:         'openai',
  };
}

async function callGemini({ systemPrompt, messages, maxTokens }) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY tanımlı değil');
  const model = DEFAULT_MODEL.gemini;
  const start = Date.now();

  // Gemini mesaj formatına dönüştür
  const contents = [];
  if (systemPrompt) {
    contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
    contents.push({ role: 'model', parts: [{ text: 'Anlaşıldı.' }] });
  }
  for (const m of messages) {
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    });
  }

  const resp = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
    {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
      },
    },
    { timeout: AI_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
  );

  const candidate = resp.data?.candidates?.[0];
  const content = candidate?.content?.parts?.[0]?.text || '';
  const u = resp.data?.usageMetadata || {};

  return {
    content,
    promptTokens:     u.promptTokenCount     || 0,
    completionTokens: u.candidatesTokenCount || 0,
    totalTokens:      u.totalTokenCount      || 0,
    durationMs:       Date.now() - start,
    model,
    provider:         'gemini',
  };
}

/**
 * Ana LLM çağrısı. Her çağrı AILog'a kaydedilir.
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {Array}  opts.messages  — [{role:'user'|'assistant', content:'...'}]
 * @param {number} [opts.maxTokens=512]
 * @param {string} [opts.action='chat'] — AILog.action
 * @param {*}      [opts.hospitalId]
 * @param {*}      [opts.userId]
 */
async function llmChat({ systemPrompt, messages, maxTokens = 512, action = 'chat', hospitalId, userId }) {
  let result = null;
  let success = true;
  let errorCode = null;

  try {
    if (AI_PROVIDER === 'openai') {
      result = await callOpenAI({ systemPrompt, messages, maxTokens });
    } else if (AI_PROVIDER === 'gemini') {
      result = await callGemini({ systemPrompt, messages, maxTokens });
    } else {
      result = await callAnthropic({ systemPrompt, messages, maxTokens });
    }
    return result;
  } catch (err) {
    success = false;
    errorCode = String(err?.response?.status || err?.code || 'UNKNOWN');
    throw err;
  } finally {
    try {
      const costUsd = result
        ? calcCost(result.model, result.promptTokens, result.completionTokens)
        : 0;
      await AILog.create({
        hospitalId:       hospitalId || null,
        userId:           userId     || null,
        action,
        provider:         result?.provider || AI_PROVIDER,
        model:            result?.model    || '',
        promptTokens:     result?.promptTokens     || 0,
        completionTokens: result?.completionTokens || 0,
        totalTokens:      result?.totalTokens      || 0,
        costUsd,
        durationMs:       result?.durationMs || 0,
        success,
        errorCode,
      });
    } catch { /* log kaydı başarısız olsa da işlemi engelleme */ }
  }
}

module.exports = { llmChat, AI_PROVIDER };
