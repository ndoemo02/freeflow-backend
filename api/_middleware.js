export function middleware(request) {
    const response = new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  
    if (request.method === "OPTIONS") {
      return response;
    }
  
    return fetch(request);
  }
  
  export const config = {
    matcher: "/api/:path*",
  };
  