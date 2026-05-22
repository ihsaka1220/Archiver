/**
 * AI summary + tag generation.
 * Supports OpenAI-compatible APIs and Anthropic.
 */

const BASE_SYSTEM_PROMPT = `你是一个内容整理助手，负责把长内容整理成“清晰、分段、可快速阅读”的中文摘要。

你的目标不是摘抄原文，也不是只压缩成一句话，而是基于原文做结构化复盘，让用户一眼看懂这篇内容在讲什么、为什么值得看、哪些观点最重要。

请在 summary 中输出 3-4 个自然段，并严格遵守以下要求：
1. 段落之间必须使用空行分隔，也就是使用 "\\n\\n" 分段，禁止输出一整段没有分隔的大段文字。
2. 每个自然段聚焦一个主题，每段建议 2-3 句，整体要有信息密度，但也要让人能顺着读下去。
3. 第 1 段交代主题背景、讨论对象和这篇内容试图解决的问题，让用户先建立整体认识。
4. 中间 1-2 段重点梳理作者的核心观点、论证逻辑、关键案例、方法、步骤或结论，优先保留真正有信息量的内容。
5. 最后 1 段总结这篇内容的亮点、适用场景、局限、注意点或可借鉴之处，形成收束，而不是突然结束。
6. 可以使用“主题背景：”“核心观点：”“关键启发：”“适用场景：”这类短提示语作为段首，但不要使用 Markdown 标题、列表符号或编号。
7. summary 默认控制在 180-320 个汉字；如果原文很短，可以略短；如果原文信息特别密集，可以适度更长，但不要为了简短牺牲关键信息。
8. 不要空泛复述“文章很好”“值得一看”这类套话，尽量说出具体观点、方法、争议点或结论。
9. 必须忠于原文，不要臆造原文没有提到的事实、数据、观点或结论。

此外：
- category：从给定分类列表中选择最合适的一个，优先复用已有分类。
- tags：提取 3-5 个关键标签，每个标签 2-6 个汉字，尽量具体，避免空泛词。`;

const OUTPUT_PROMPT = `严格按照以下 JSON 格式返回，不要有任何额外文字：
{"summary":"...","category":"...","tags":["...","..."]}`;

export async function generateSummaryAndTags(item, settings) {
  if (!settings.aiEnabled || !settings.aiApiKey) return item;

  const text = buildInputText(item);
  if (!text.trim()) return item;

  try {
    const parsed = await requestAiResult(text, settings);
    return {
      ...item,
      summary: parsed.summary ?? item.summary,
      category: parsed.category ?? item.category,
      tags: Array.isArray(parsed.tags) ? parsed.tags : item.tags,
      aiProcessed: true,
    };
  } catch (e) {
    console.warn('[archiver] AI processing failed:', e.message);
    return item;
  }
}

export async function testAiSettings(settings) {
  if (!settings.aiEnabled) {
    return { ok: false, error: '请先开启 AI 自动摘要开关' };
  }
  if (!settings.aiApiKey) {
    return { ok: false, error: '请先填写 API Key' };
  }

  const sampleText =
    '标题：为什么有些技术文章读完之后仍然抓不住重点？\n\n' +
    '内容：优秀的摘要应该提炼核心观点、适用场景和结论，而不是简单截取开头几句话。' +
    '请用测试结果证明当前模型配置已经成功生效。';

  try {
    const parsed = await requestAiResult(sampleText, settings);
    return {
      ok: true,
      provider: settings.aiProvider || 'openai',
      model: settings.aiModel || defaultModel(settings),
      preview: parsed.summary || '',
    };
  } catch (e) {
    return {
      ok: false,
      provider: settings.aiProvider || 'openai',
      model: settings.aiModel || defaultModel(settings),
      error: e.message,
    };
  }
}

function buildInputText(item) {
  return [item.title, item.description, item.content].filter(Boolean).join('\n\n');
}

async function requestAiResult(text, settings) {
  const categories = settings.customCategories ?? [];
  const userPrompt = `分类列表：${categories.join('、')}\n\n内容：\n${text.slice(0, 3000)}`;
  const systemPrompt = buildSystemPrompt();

  let raw;
  if (settings.aiProvider === 'anthropic') {
    raw = await callAnthropic(userPrompt, settings, systemPrompt);
  } else {
    raw = await callOpenAI(userPrompt, settings, systemPrompt);
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI 返回结果不是有效 JSON');
  }
  if (!parsed.summary || typeof parsed.summary !== 'string') {
    throw new Error('AI 返回结果缺少 summary 字段');
  }
  parsed.summary = normalizeSummaryText(parsed.summary);
  return parsed;
}

async function callOpenAI(userPrompt, settings, systemPrompt) {
  const baseUrl = normalizeOpenAIBaseUrl(settings.aiBaseUrl);
  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.aiApiKey}`,
    },
    body: JSON.stringify({
      model: settings.aiModel || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 420,
    }),
  });

  if (!resp.ok) throw await buildApiError('OpenAI', resp);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(userPrompt, settings, systemPrompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.aiApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: settings.aiModel || 'claude-haiku-4-5-20251001',
      max_tokens: 420,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!resp.ok) throw await buildApiError('Anthropic', resp);
  const data = await resp.json();
  return data.content?.[0]?.text ?? '';
}

function defaultModel(settings) {
  return settings.aiProvider === 'anthropic'
    ? 'claude-haiku-4-5-20251001'
    : 'gpt-4o-mini';
}

function buildSystemPrompt() {
  return [BASE_SYSTEM_PROMPT, OUTPUT_PROMPT].join('\n\n');
}

function normalizeOpenAIBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'https://api.openai.com';

  return raw
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
}

function normalizeSummaryText(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function buildApiError(provider, resp) {
  const detail = extractApiErrorMessage(await safeReadText(resp));
  const suffix = detail ? ` - ${detail}` : '';
  return new Error(`${provider} API error: ${resp.status}${suffix}`);
}

async function safeReadText(resp) {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}

function extractApiErrorMessage(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw);
    return String(
      parsed?.error?.message ??
        parsed?.error?.code ??
        parsed?.message ??
        parsed?.msg ??
        ''
    ).trim();
  } catch {
    return raw.slice(0, 200);
  }
}
