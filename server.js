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

const corsOptions = buildCorsOptions(process.env.CORS_ALLOWED_ORIGINS);

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use((req, res, next) => {
  if (req.method === 'OPTIONS' && !res.headersSent) {
    res.sendStatus(corsOptions.optionsSuccessStatus);
    return;
  }

  next();
});

function buildCorsOptions(allowedOriginsValue) {
  const normalizedValue = typeof allowedOriginsValue === 'string' ? allowedOriginsValue.trim() : '';

  const options = {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200
  };

  if (!normalizedValue) {
    return options;
  }

  if (normalizedValue === '*') {
    return options;
  }

  const allowedOrigins = normalizedValue
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    return options;
  }

  const allowedOriginsSet = new Set(allowedOrigins);

  return {
    ...options,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, allowedOriginsSet.has(origin));
    }
  };
}

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

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log('Available endpoints:');
    apiFiles.forEach(file => {
      const routeName = path.basename(file, '.js');
      console.log(`  - /api/${routeName}`);
    });
  });
}

export { app };
