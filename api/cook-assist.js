// POST /api/cook-assist
//
// Three cook-mode tasks behind one endpoint, so the key guard, model
// constant and error handling exist once rather than three times:
//
//   { task: 'translate',       text, language }        -> { text }
//   { task: 'generate-steps',  name, ingredients }     -> { steps: string[] }
//   { task: 'sequence',        dishes: [...] }         -> { sequence, totalTime, tips }
//
// Keeping this server-side is what stops the Gemini key reaching the browser.

import { GoogleGenerativeAI } from '@google/generative-ai'

const MODEL = 'gemini-3.6-flash'
const TASKS = ['translate', 'generate-steps', 'sequence']

function getModel(apiKey, json = true) {
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: MODEL,
    generationConfig: {
      ...(json ? { responseMimeType: 'application/json' } : {}),
      maxOutputTokens: 4096,
      temperature: 0.4,
    },
  })
}

function parseModelJson(text) {
  const cleaned = String(text).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  return JSON.parse(cleaned)
}

const PROMPTS = {
  translate: ({ text, language }) =>
    `Translate this cooking step to ${language}. It will be read aloud to someone cooking, so use natural spoken ${language}, keep Indian ingredient names recognisable, and keep all numbers and times exactly as given.
Respond with ONLY a JSON object: {"text": "<the translation>"}

Step: ${text}`,

  'generate-steps': ({ name, ingredients }) =>
    `Generate step-by-step cooking instructions for this Indian dish based on its ingredients.

Dish: ${name}
Ingredients: ${ingredients}

Return 6 to 10 numbered steps, clear and beginner-friendly, with realistic cooking times stated in the text (for example "cook for 5 minutes", "pressure cook for 3 whistles"). Do not prefix the steps with "STEP 1:" — just the instruction text.
Respond with ONLY a JSON object: {"steps": ["<step 1>", "<step 2>", ...]}`,

  sequence: ({ dishes }) =>
    `You are helping someone cook this Indian meal for their family. Here are ${dishes.length} dishes with their preparation steps and cook times:

${JSON.stringify(dishes, null, 2)}

Suggest an intelligent cooking sequence that:
1. Starts with the dish that takes longest first (usually dal or rice)
2. Identifies which steps can happen in PARALLEL (for example: "while dal cooks in the pressure cooker, chop vegetables for the sabzi")
3. Ends with everything ready at roughly the same time

Respond with ONLY a JSON object:
{"sequence": [{"dishName": "<name>", "recipeId": "<id>", "startAt": "minute 0", "durationMin": <int>, "steps": ["<what to do in this block>"], "parallelWith": ["<other dish name>"]}],
 "totalTime": <int minutes>,
 "tips": ["<practical tip>", ...]}`,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed. Use POST.' })
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (apiKey.length <= 30 || /^(your-|<|changeme|placeholder)/i.test(apiKey)) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY is not set.',
      hint: 'Put your real key in .env.local (local) or the Vercel project environment variables (deployed), then restart the dev server.',
    })
  }

  const body = req.body || {}
  const { task } = body
  if (!TASKS.includes(task)) {
    return res.status(400).json({ error: `"task" must be one of: ${TASKS.join(', ')}` })
  }

  // Per-task input validation, so a bad request never becomes a wasted call.
  if (task === 'translate' && (!body.text || !body.language)) {
    return res.status(400).json({ error: 'translate needs "text" and "language".' })
  }
  if (task === 'generate-steps' && (!body.name || !body.ingredients)) {
    return res.status(400).json({ error: 'generate-steps needs "name" and "ingredients".' })
  }
  if (task === 'sequence' && (!Array.isArray(body.dishes) || body.dishes.length === 0)) {
    return res.status(400).json({ error: 'sequence needs a non-empty "dishes" array.' })
  }

  let raw
  try {
    const result = await getModel(apiKey).generateContent(PROMPTS[task](body))
    raw = result.response.text()
  } catch (err) {
    return res.status(502).json({
      error: 'Gemini request failed.',
      detail: err?.message || String(err),
      model: MODEL,
      task,
    })
  }

  let data
  try {
    data = parseModelJson(raw)
  } catch (err) {
    return res.status(502).json({
      error: 'Gemini returned text that is not valid JSON.',
      detail: err?.message || String(err),
      task,
      raw: String(raw).slice(0, 1200),
    })
  }

  // Shape checks — the UI should never receive a half-formed payload.
  if (task === 'translate' && typeof data.text !== 'string') {
    return res.status(502).json({ error: 'Translation response had no text.', raw: data })
  }
  if (task === 'generate-steps') {
    const steps = Array.isArray(data.steps) ? data.steps.filter((s) => typeof s === 'string' && s.trim()) : []
    if (steps.length === 0) {
      return res.status(502).json({ error: 'Step generation returned no steps.', raw: data })
    }
    return res.status(200).json({ steps, model: MODEL, generated: true })
  }
  if (task === 'sequence' && !Array.isArray(data.sequence)) {
    return res.status(502).json({ error: 'Sequence response had no sequence array.', raw: data })
  }

  return res.status(200).json({ ...data, model: MODEL, task })
}
