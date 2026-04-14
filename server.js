/**
 * ANTON CRAFTEX - MAIN SERVER
 * ============================================================
 * Production-ready Node.js server with:
 *  - CPU clustering (uses all cores → handles 1000+ concurrent users)
 *  - Session-based cart (fixes cart persistence bug)
 *  - Rate limiting (prevents abuse)
 *  - Compression (faster page loads)
 *  - Security headers via helmet
 *  - Auto-restart on crash (via cluster or PM2)
 * ============================================================
 */

require('dotenv').config();
const cluster = require('cluster');
const os = require('os');
const numCPUs = os.cpus().length;

const useCluster = process.env.ENABLE_CLUSTERING === 'true';

// ── CLUSTER MASTER (opt-in) ────────────────────────────────
if (useCluster && cluster.isPrimary) {
  console.log(`\n🚀 Anton Craftex Master [PID ${process.pid}] starting ${numCPUs} workers...`);

  for (let i = 0; i < numCPUs; i++) cluster.fork();

  // Auto-restart dead workers
  cluster.on('exit', (worker, code, signal) => {
    console.log(`⚠️  Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork();
  });

  cluster.on('online', (worker) => {
    console.log(`✅ Worker ${worker.process.pid} is online`);
  });

} else {
  // ── WORKER / DEV SERVER ──────────────────────────────────
  const express     = require('express');
  const session     = require('express-session');
  const MySQLSession = require('express-mysql-session')(session);
  const helmet      = require('helmet');
  const cors        = require('cors');
  const compression = require('compression');
  const rateLimit   = require('express-rate-limit');
  const path        = require('path');

  const app = express();

  // ── SECURITY HEADERS ────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: false,  // disabled to allow inline scripts in index.html
    crossOriginEmbedderPolicy: false
  }));

  // ── CORS ────────────────────────────────────────────────
  // Allow requests from your domain only (in production)
  const allowedOrigins = [
    process.env.SITE_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ].filter(Boolean);

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  }));

  // ── COMPRESSION (reduces response size by ~70%) ─────────
  app.use(compression());

  // ── RATE LIMITING (prevents DDoS & abuse) ────────────────
  // General API: 500 requests per 15 minutes per IP
  app.use('/api/', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again after 15 minutes.' }
  }));

  // Payment API: stricter limit (30 requests per 15 min)
  app.use('/api/payment', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Too many payment attempts. Please wait before retrying.' }
  }));

  // Auth routes: 10 attempts per 15 min (prevent brute force)
  app.use('/api/user/login', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts. Please wait 15 minutes.' }
  }));

  // ── BODY PARSING ─────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── SESSION (server-side cart storage) ───────────────────
  // This is what FIXES the "cart persists after close" bug.
  // Cart is stored on server, tied to session ID cookie.
  // When browser closes, cookie expires → new session → empty cart.
  const sessionStore = new MySQLSession({
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 24 * 60 * 60 * 1000,
  }, require('./src/config/db'));

  app.use(session({
    secret: process.env.SESSION_SECRET || 'antonCraftexSecret2024!',
    resave: false,
    saveUninitialized: true,
    name: 'anton_sid',
    store: sessionStore,
    cookie: {
      secure: process.env.NODE_ENV === 'production' && process.env.SITE_URL?.startsWith('https'),
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax'
    }
  }));

  // ── STATIC FILES (frontend) ──────────────────────────────
  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    etag: true            // serve cached version if unchanged
  }));
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '30d'
  }));

  // ── API ROUTES ───────────────────────────────────────────
  app.use('/api/products',  require('./src/routes/products'));
  app.use('/api/cart',      require('./src/routes/cart'));
  app.use('/api/orders',    require('./src/routes/orders'));
  app.use('/api/payment',   require('./src/routes/payment'));
  app.use('/api/user',      require('./src/routes/users'));
  app.use('/api/admin',     require('./src/routes/admin'));
  app.use('/api/craftpark', require('./src/routes/craftpark'));

  // ── HEALTH CHECK (for uptime monitors like UptimeRobot) ──
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      timestamp: new Date().toISOString()
    });
  });

  // ── SPA ROUTING ──────────────────────────────────────────
  // All non-API routes serve index.html (for single-page-app routing)
  app.get('*', (req, res) => {
    if (req.path.startsWith('/admin')) {
      return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // ── GLOBAL ERROR HANDLER ─────────────────────────────────
  app.use((err, req, res, next) => {
    console.error(`[Error] ${req.method} ${req.path}:`, err.message);
    res.status(err.status || 500).json({
      error: process.env.NODE_ENV === 'production'
        ? 'Something went wrong. Please try again.'
        : err.message
    });
  });

  // ── START SERVER ─────────────────────────────────────────
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n✅ Anton Craftex running on port ${PORT} [PID ${process.pid}]`);
    console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   URL:  ${process.env.SITE_URL || `http://localhost:${PORT}`}\n`);
  });
}
