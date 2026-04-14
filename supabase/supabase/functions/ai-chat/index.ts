const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

const defaultSystemPrompt = [
  'You are the binge media assistant.',
  'Answer in concise natural prose.',
  'Do not use markdown formatting such as bold, bullets, or numbered lists unless the user explicitly asks for it.',
  'When recommending titles from binge, do not output a standalone bullet list or numbered list of titles.',
  'Mention titles naturally in the explanation and let the UI render the direct binge links separately.',
  'If you share multiple titles, keep the explanation short and readable and limit yourself to at most 5 titles.',
].join(' ');

function resolveTemperature(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }

  return 0.7;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({
        ok: true,
        message: 'ai-chat is live',
        hasGroqKey: !!Deno.env.get('GROQ_API_KEY'),
        hasTavilyKey: !!Deno.env.get('TAVILY_API_KEY'),
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    const groqApiKey = Deno.env.get('GROQ_API_KEY');
    const tavilyApiKey = Deno.env.get('TAVILY_API_KEY');

    if (!groqApiKey) {
      return new Response(
        JSON.stringify({ error: 'Missing GROQ_API_KEY secret' }),
        { status: 500, headers: corsHeaders }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const messages = Array.isArray(body.messages) ? body.messages : null;
    const systemPromptOverride =
      typeof body.systemPromptOverride === 'string' && body.systemPromptOverride.trim()
        ? body.systemPromptOverride.trim()
        : defaultSystemPrompt;
    const includeWebSearch = body.includeWebSearch !== false;
    const webSearchQuery =
      typeof body.webSearchQuery === 'string' && body.webSearchQuery.trim()
        ? body.webSearchQuery.trim()
        : '';
    const temperature = resolveTemperature(body.temperature);

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'messages is required' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const groqMessages = [
      { role: 'system', content: systemPromptOverride },
      ...messages,
    ];

    // Get AI response from Groq
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        temperature,
      }),
    });

    const groqData = await groqRes.json();

    if (!groqRes.ok) {
      return new Response(JSON.stringify(groqData), {
        status: groqRes.status,
        headers: corsHeaders,
      });
    }

    const content = groqData?.choices?.[0]?.message?.content ?? '';
    let webSources = [];

    // Search for sources using Tavily if available
    if (includeWebSearch && tavilyApiKey && messages.length > 0) {
      const lastMessage = webSearchQuery || messages[messages.length - 1]?.content || '';
      try {
        const tavilyRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: tavilyApiKey,
            query: lastMessage,
            max_results: 5,
            include_answer: true,
          }),
        });

        if (tavilyRes.ok) {
          const tavilyData = await tavilyRes.json();
          webSources = (tavilyData.results || []).map((result: any) => ({
            title: result.title,
            url: result.url,
            source: new URL(result.url).hostname,
            snippet: result.snippet || result.content,
          }));
        }
      } catch (searchError) {
        console.error('Tavily search error:', searchError);
        // Continue without sources if search fails
      }
    }

    return new Response(
      JSON.stringify({
        content,
        webSources,
        siteSources: [],
        systemPrompt: systemPromptOverride,
        raw: groqData,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
