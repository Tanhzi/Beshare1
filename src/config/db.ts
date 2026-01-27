// src/config/db.ts
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
// CHÚ Ý: Dùng SERVICE_ROLE_KEY (tìm trong Supabase > Settings > API)
// Key này có quyền tối cao, tuyệt đối không lộ ra Frontend
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log('✅ Connected to Supabase Admin Client');

export default supabase;