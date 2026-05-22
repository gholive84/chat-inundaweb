// Adapter OpenAI Chat Completions
const axios = require('axios');

/**
 * Chama OpenAI Chat Completions.
 * @param {object} opts
 *   - apiKey, model, systemPrompt, messages (array {role, content}), maxTokens, temperature
 * @returns string da resposta
 */
async function chat({ apiKey, model = 'gpt-4o-mini', systemPrompt, messages, maxTokens = 1024, temperature = 0.7 }) {
  if (!apiKey) throw new Error('AI: api_key vazia');
  const payload = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages,
    ],
    max_tokens: maxTokens,
    temperature,
  };
  const { data } = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 60000,
  });
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

module.exports = { chat };
