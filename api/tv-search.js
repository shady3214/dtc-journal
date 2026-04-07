export default async function handler(req, res) {
  const query = new URL(req.url, `http://${req.headers.host}`).searchParams.toString()
  const url = `https://symbol-search.tradingview.com/symbol_search/?${query}`

  try {
    const response = await fetch(url, {
      headers: {
        'Origin': 'https://www.tradingview.com',
        'Referer': 'https://www.tradingview.com/',
      },
    })
    const data = await response.text()
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json')
    res.status(response.status).send(data)
  } catch (err) {
    res.status(500).json({ error: 'Proxy failed', message: err.message })
  }
}
