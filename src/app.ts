import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

// Import Routes
import authRoutes from './routes/authRoutes';
import syncRoutes from './routes/syncRoutes';
import documentRoutes from './routes/documentRoutes';

dotenv.config();

// --- 0. VALIDATE REQUIRED ENV VARS AT STARTUP ---
const requiredEnv = ['JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`❌ Missing required env var: ${key}`);
  }
}
if ((process.env.JWT_SECRET as string).length < 32) {
  // Refuse to boot with a weak JWT secret. This is signed server-side and
  // must have enough entropy to resist offline brute-force.
  throw new Error('❌ JWT_SECRET must be at least 32 characters');
}

const app = express();
const PORT = process.env.PORT || 5000;

// --- 1. SECURITY MIDDLEWARE ---
app.use(helmet());

// CORS: allowlist from env (comma-separated). Fallback to no-origin (same-origin)
// rather than the insecure `origin: '*'` + `credentials: true` combination, which
// is both spec-invalid and exposes cookie-authenticated endpoints to any site.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser clients (mobile apps, curl) that send no Origin header.
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, false);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// Lower JSON body limit: the previous 50mb limit made the server trivial to
// exhaust via a flood of large POSTs. File uploads go through multer, not JSON.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Global light rate limiter as a baseline (per-IP). Per-route limiters are
// applied to sensitive endpoints (auth, password reset, public uploads).
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
app.use(globalLimiter);

// --- 2. ROUTES API ---
app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/documents', documentRoutes);

// Test Route
app.get('/', (req, res) => {
  res.send('AIStudyBuddy API (No Socket Mode) is running...');
});

// --- 3. KHỞI CHẠY SERVER ---
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✨ Mode: REST API only (Pull mechanism)`);
});
