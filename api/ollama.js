export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  const serverApiKey = process.env.VITE_OLLAMA_API_KEY;
  const clientAuth = req.headers.authorization;
  const authHeader = clientAuth || (serverApiKey ? `Bearer ${serverApiKey}` : '');

  // Extract the path after /ollama (e.g. /ollama/v1/chat/completions -> /v1/chat/completions)
  const path = (req.url || '').replace(/^\/ollama/, '') || '/v1/chat/completions';
  const baseUrl = process.env.VITE_OLLAMA_BASE_URL || 'https://ollama.com';

  try {
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    const headers = { 'Content-Type': 'application/json' };
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const parsed = body ? JSON.parse(body) : {};
    const target = `${baseUrl}${path}`;
    const response = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(parsed),
    });

    const text = await response.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const data = JSON.parse(text);
      res.status(response.status).json(data);
    } catch {
      res.status(response.status).send(text);
    }
  } catch (err) {
    console.error('Ollama proxy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
