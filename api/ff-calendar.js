// api/ff-calendar.js
// Vercel serverless proxy for ForexFactory calendar JSON
// Avoids CORS issues when running as a web app

export default async function handler(req, res) {
  try {
    const response = await fetch(
      'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json',
          'Referer': 'https://www.forexfactory.com/',
        },
      }
    )

    if (!response.ok) {
      res.status(response.status).json({ error: 'Upstream fetch failed' })
      return
    }

    const data = await response.json()

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'public, s-maxage=300') // Cache 5 minutes
    res.status(200).json(data)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
}
