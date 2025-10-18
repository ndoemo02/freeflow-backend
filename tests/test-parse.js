// tests/test-parse.js
import { parseOrderItems } from "../api/brain/intent-router.js";

// Mock catalog dla testu
const mockCatalog = [
  { id: "1", name: "Zupa czosnkowa", price: 14.9, restaurant_id: "r1", restaurant_name: "Test Restaurant" },
  { id: "2", name: "Frytki", price: 8.5, restaurant_id: "r1", restaurant_name: "Test Restaurant" },
  { id: "3", name: "Pizza Margherita", price: 25.0, restaurant_id: "r2", restaurant_name: "Pizzeria" }
];

console.log("🧪 Testing parseOrderItems...");

try {
  // Test 1: Pozycje dostępne
  console.log("\n📋 Test 1: Dostępne pozycje");
  const result1 = parseOrderItems("zamów czosnkową i frytki", mockCatalog);
  
  if (!result1?.groups?.length) {
    console.error("❌ Parser returned empty result!");
    console.error("Result:", result1);
    process.exit(1);
  }
  
  console.log("✅ Test 1 OK - Found groups:", result1.groups.length);
  console.log("📋 Total items:", result1.groups.reduce((sum, g) => sum + g.items.length, 0));
  console.log("⚠️ Unavailable:", result1.unavailable?.length || 0);
  
  // Test 2: Pozycja niedostępna
  console.log("\n📋 Test 2: Niedostępna pozycja");
  const result2 = parseOrderItems("zamów burgera i frytki", mockCatalog);
  
  console.log("✅ Test 2 OK - Found groups:", result2.groups.length);
  console.log("⚠️ Unavailable:", result2.unavailable?.length || 0);
  if (result2.unavailable?.length > 0) {
    console.log("   Items:", result2.unavailable.join(", "));
  }
  
  // Test 3: Pusty katalog
  console.log("\n📋 Test 3: Pusty katalog");
  const result3 = parseOrderItems("zamów czosnkową", []);
  
  if (!result3.missingAll) {
    console.error("❌ Test 3 failed - missingAll should be true!");
    process.exit(1);
  }
  
  console.log("✅ Test 3 OK - missingAll:", result3.missingAll);
  console.log("⚠️ Unavailable:", result3.unavailable?.length || 0);
  
  // Test 4: Null katalog
  console.log("\n📋 Test 4: Null katalog");
  const result4 = parseOrderItems("zamów margherita", null);
  
  if (!result4.missingAll) {
    console.error("❌ Test 4 failed - missingAll should be true!");
    process.exit(1);
  }
  
  console.log("✅ Test 4 OK - missingAll:", result4.missingAll);
  
  console.log("\n✅ Parser sanity OK - All tests passed!");
  
} catch (error) {
  console.error("❌ Parser test failed:", error.message);
  console.error(error.stack);
  process.exit(1);
}
