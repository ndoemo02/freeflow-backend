import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
);

async function testSupabase() {
  try {
    console.log('🧪 Testing Supabase connection...');
    console.log('URL:', process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
    console.log('Key:', (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY)?.substring(0, 20) + '...');
    
    const { data, error } = await supabase
      .from('restaurants')
      .select('id, name')
      .limit(3);

    if (error) throw error;

    console.log('✅ Supabase connection works!');
    console.log('Sample data:', data);
    
  } catch (err) {
    console.error('❌ Supabase test error:', err.message);
  }
}

testSupabase();
