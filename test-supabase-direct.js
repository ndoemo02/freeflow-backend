// Test Supabase z kluczami bezpośrednio
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xdhlztmjktminrwmzcpl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY';

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

async function checkBusinesses() {
  console.log('🔍 Checking businesses in database...');
  
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, is_active, is_verified')
      .limit(10);

    if (error) {
      console.error('❌ Database error:', error);
      return;
    }

    console.log('✅ Found businesses:', data);
    
    if (data && data.length > 0) {
      console.log('\n📋 Available business IDs:');
      data.forEach(business => {
        console.log(`- ${business.id} (${business.name}) - Active: ${business.is_active}, Verified: ${business.is_verified}`);
      });
    } else {
      console.log('❌ No businesses found in database');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkBusinesses();





