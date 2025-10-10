// Test CORS configuration for /api/brain endpoint

const testCors = async () => {
  const backendUrl = 'https://freeflow-backend.vercel.app';
  const frontendOrigin = 'https://freeflow-frontend-seven.vercel.app';
  
  console.log('🧪 Testing CORS configuration...');
  console.log('Backend URL:', backendUrl);
  console.log('Frontend Origin:', frontendOrigin);
  
  try {
    // Test preflight request (OPTIONS)
    console.log('\n1. Testing preflight request (OPTIONS)...');
    const preflightResponse = await fetch(`${backendUrl}/api/brain`, {
      method: 'OPTIONS',
      headers: {
        'Origin': frontendOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });
    
    console.log('Preflight Status:', preflightResponse.status);
    console.log('CORS Headers:');
    console.log('  Access-Control-Allow-Origin:', preflightResponse.headers.get('access-control-allow-origin'));
    console.log('  Access-Control-Allow-Methods:', preflightResponse.headers.get('access-control-allow-methods'));
    console.log('  Access-Control-Allow-Headers:', preflightResponse.headers.get('access-control-allow-headers'));
    
    // Test actual POST request
    console.log('\n2. Testing actual POST request...');
    const postResponse = await fetch(`${backendUrl}/api/brain`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': frontendOrigin
      },
      body: JSON.stringify({
        text: 'Test message',
        userId: 'test-user'
      })
    });
    
    console.log('POST Status:', postResponse.status);
    console.log('CORS Headers:');
    console.log('  Access-Control-Allow-Origin:', postResponse.headers.get('access-control-allow-origin'));
    
    const responseData = await postResponse.json();
    console.log('Response Data:', responseData);
    
    if (preflightResponse.status === 200 && postResponse.status === 200) {
      console.log('\n✅ CORS test PASSED!');
    } else {
      console.log('\n❌ CORS test FAILED!');
    }
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
};

testCors();
