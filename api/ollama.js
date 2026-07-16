export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  const apiKey = process.env.VITE_OLLAMA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OLLAMA_API_KEY not configured on server' });
  }

  try {
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    const parsed = body ? JSON.parse(body) : {};
    const response = await fetch('https://ollama.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(parsed),
    });

    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Ollama proxy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
