import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ezemaacyyvbpjlagchds.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6ZW1hYWN5eXZicGpsYWdjaGRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3ODU1MzYsImV4cCI6MjA3NTM2MTUzNn0.uRKmqxL0Isx3DmOxmgc_zPwG5foYXft9WpIROoTTgGU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testSupabase() {
  try {
    console.log('🧪 Testing Supabase connection...');
    console.log('URL:', SUPABASE_URL);
    console.log('Key:', SUPABASE_ANON_KEY.substring(0, 20) + '...');
    
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
