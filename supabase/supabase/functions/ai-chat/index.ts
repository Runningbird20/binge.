const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

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

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'messages is required' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.7,
      }),
    });

    const groqData = await groqRes.json();

    if (!groqRes.ok) {
      return new Response(JSON.stringify(groqData), {
        status: groqRes.status,
        headers: corsHeaders,
      });
    }

    return new Response(
      JSON.stringify({
        content: groqData?.choices?.[0]?.message?.content ?? '',
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