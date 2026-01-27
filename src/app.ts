import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Import Routes
import authRoutes from './routes/authRoutes';
import syncRoutes from './routes/syncRoutes';
import documentRoutes from './routes/documentRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- 1. MIDDLEWARE ---
app.use(cors({
  origin: '*', // Chấp nhận mọi nguồn kết nối từ App
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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