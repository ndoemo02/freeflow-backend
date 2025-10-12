export function getIntent(text) {
  text = text.toLowerCase();

  if (text.includes("pizza") || text.includes("jedzenie")) return "food";
  if (text.includes("taxi") || text.includes("podwóz")) return "taxi";
  if (text.includes("hotel") || text.includes("nocleg")) return "hotel";

  return "smalltalk";
}
