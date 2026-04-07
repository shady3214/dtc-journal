export default async function handler(req, res) {
  // The full path comes in as /api/yf-quote/v8/finance/chart/...
  // Strip /api/yf-quote and forward the rest to Yahoo Finance
  const fullUrl = new URL(req.url, `http://${req.headers.host}`)
  const path = fullUrl.pathname.replace(/^\/api\/yf-quote/, '')
  const query = fullUrl.search || ''
  const target = `https://query2.finance.yahoo.com${path}${query}`

  try {
    const response = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    })
    const data = await response.text()
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json')
    res.status(response.status).send(data)
  } catch (err) {
    res.status(500).json({ error: 'Proxy failed', message: err.message })
  }
}
