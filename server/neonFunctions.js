function getFunctionBaseUrl() {
  return process.env.NEON_FUNCTION_HELLO_BASE_URL || '';
}

function isConfigured() {
  return Boolean(getFunctionBaseUrl());
}

async function callHelloFunction() {
  const baseUrl = getFunctionBaseUrl();
  if (!baseUrl) {
    throw new Error('NEON_FUNCTION_HELLO_BASE_URL is not configured.');
  }

  const normalizedUrl = baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${normalizedUrl}/`);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Neon Function returned status ${response.status}: ${text}`);
  }

  return {
    ok: true,
    status: response.status,
    url: normalizedUrl,
    message: text.trim(),
  };
}

async function healthCheck() {
  const baseUrl = getFunctionBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      configured: false,
      error: 'NEON_FUNCTION_HELLO_BASE_URL not configured',
    };
  }

  try {
    const result = await callHelloFunction();
    return {
      ok: true,
      configured: true,
      url: result.url,
      message: result.message,
      status: result.status,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      url: baseUrl,
      error: err.message,
    };
  }
}

module.exports = {
  isConfigured,
  getFunctionBaseUrl,
  callHelloFunction,
  healthCheck,
};

