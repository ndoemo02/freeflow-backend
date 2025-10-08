// Check orders table schema
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xdhlztmjktminrwmzcpl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

async function checkOrdersSchema() {
  console.log('🔍 Checking orders table schema...');
  
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .limit(3);
    
    if (error) {
      console.error('❌ Orders error:', error);
      return;
    }
    
    console.log('✅ Orders table structure:');
    if (data && data.length > 0) {
      console.log('Columns:', Object.keys(data[0]));
      console.log('Sample records:', data);
    } else {
      console.log('Orders table exists but is empty');
    }
    
  } catch (error) {
    console.error('❌ Schema check error:', error);
  }
}

checkOrdersSchema();
