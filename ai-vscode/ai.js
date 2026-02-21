import 'dotenv/config';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const userText = process.argv.slice(2).join(' ') || 'Merhaba test mesajı.';
const res = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'Kısa ve net yanıt ver.' },
    { role: 'user', content: userText }
  ],
  temperature: 0.2
});

console.log(res.choices?.[0]?.message?.content?.trim() ?? '(boş)');
