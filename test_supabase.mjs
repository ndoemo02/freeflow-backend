import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xdhlztmjktminrwmzcpl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

async function testConnection() {
  try {
    console.log('Testing Supabase connection...');
    
    // Test basic connection
    const { data: healthData, error: healthError } = await supabase
      .from('profiles')
      .select('count')
      .limit(1);
    
    if (healthError) {
      console.error('Health check error:', healthError);
      return;
    }
    
    console.log('Health check OK');
    
    // Test specific user query
    const { data: userData, error: userError } = await supabase
      .from('profiles')
      .select('id, email, user_type, business_id')
      .eq('id', '66051f90-6486-4ce3-b771-f51d3d39a8e9')
      .single();
    
    if (userError) {
      console.error('User query error:', userError);
      return;
    }
    
    console.log('User data:', userData);
    
  } catch (err) {
    console.error('Test error:', err);
  }
}

testConnection();
