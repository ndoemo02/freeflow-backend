// api/_cors.js
export function applyCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (res.req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}
