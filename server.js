import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// Middleware
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const allowedMethods = (process.env.CORS_ALLOWED_METHODS || 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  .split(',')
  .map(method => method.trim().toUpperCase())
  .filter(Boolean);

const allowedHeaders = (process.env.CORS_ALLOWED_HEADERS || '')
  .split(',')
  .map(header => header.trim())
  .filter(Boolean);

const allowCredentials = process.env.CORS_ALLOW_CREDENTIALS === 'true';

const corsOptions = {
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: allowCredentials,
  methods: allowedMethods,
  allowedHeaders: allowedHeaders.length ? allowedHeaders : undefined
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Ensure responses always contain the negotiated CORS headers
app.use((req, res, next) => {
  if (allowCredentials) {
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  next();
});

app.use(express.json());

// Load API routes dynamically
const apiDir = path.join(__dirname, 'api');
const apiFiles = fs.readdirSync(apiDir).filter(file => file.endsWith('.js'));

for (const file of apiFiles) {
  const routeName = path.basename(file, '.js');
  const modulePath = `./api/${file}`;
  
  try {
    const { default: handler } = await import(modulePath);
    
    app.all(`/api/${routeName}`, async (req, res) => {
      try {
        await handler(req, res);
      } catch (error) {
        console.error(`Error in /api/${routeName}:`, error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });
    
    console.log(`Loaded API route: /api/${routeName}`);
  } catch (error) {
    console.error(`Failed to load API route ${routeName}:`, error.message);
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'FreeFlow Backend API',
    endpoints: apiFiles.map(file => `/api/${path.basename(file, '.js')}`)
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  apiFiles.forEach(file => {
    const routeName = path.basename(file, '.js');
    console.log(`  - /api/${routeName}`);
  });
});
