import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL)?.trim();
const supabaseKey = (
  process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY ||
  process.env.REACT_APP_SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY
)?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export async function invokeSupabaseFunction(functionName, body) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_URL / SUPABASE_ANON_KEY).');
  }

  if (functionName === 'ai-chat') {
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: body,
    });

    if (error) throw error;
    return data;
  }

  // For other functions, use the Supabase client
  const response = await supabase.functions.invoke(functionName, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (response.error) {
    throw new Error(response.error.message || response.error);
  }

  return response.data ?? response;
}

