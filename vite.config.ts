import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/tv-search': {
        target: 'https://symbol-search.tradingview.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tv-search/, '/symbol_search/'),
        headers: {
          'Origin': 'https://www.tradingview.com',
          'Referer': 'https://www.tradingview.com/',
        },
      },
      '/api/yf-quote': {
        target: 'https://query2.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yf-quote/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      },
      '/api/ff-calendar': {
        target: 'https://nfs.faireconomy.media',
        changeOrigin: true,
        secure: false,
        rewrite: () => '/ff_calendar_thisweek.json',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.forexfactory.com/',
          'Origin': 'https://www.forexfactory.com',
        },
      },
      '/api/ff-calendar-next': {
        target: 'https://nfs.faireconomy.media',
        changeOrigin: true,
        secure: false,
        rewrite: () => '/ff_calendar_nextweek.json',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.forexfactory.com/',
          'Origin': 'https://www.forexfactory.com',
        },
      },
    },
  },
})
