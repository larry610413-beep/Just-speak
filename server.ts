import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Provide API key to frontend via API endpoint as a fallback
  app.get('/api/config', (req, res) => {
    res.json({ 
      apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.VITE_GEMINI_API_KEY || '' 
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, { index: false }));
    app.get('*', async (req, res) => {
      try {
        const fs = await import('fs');
        let html = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8');
        // Inject the API key into the window object so the frontend can find it
        // We check multiple possible environment variable names used by the platform
        const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.VITE_GEMINI_API_KEY || '';
        const apiKeyScript = `<script>window.GEMINI_API_KEY = ${JSON.stringify(apiKey)};</script>`;
        html = html.replace('<head>', `<head>${apiKeyScript}`);
        res.send(html);
      } catch (e) {
        res.sendFile(path.join(distPath, 'index.html'));
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
