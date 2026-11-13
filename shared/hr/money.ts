/** All money is integer paise. Never use floats for amounts. */
export type Paise = number;

export function rupeesToPaise(r: number | string): Paise {
  const n = typeof r === "string" ? Number(r.replace(/[,\s₹]/g, "")) : r;
  if (!Number.isFinite(n)) throw new Error("Invalid amount");
  return Math.round(n * 100);
}

/** Basis points of an amount, rounded half up to the nearest paise. */
export function bps(amount: Paise, basisPoints: number): Paise {
  return Math.floor((amount * basisPoints + 5000) / 10000);
}

/** Indian digit grouping, e.g. 12,34,567.00 */
export function formatINR(p: Paise, symbol = "₹"): string {
  const neg = p < 0;
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${neg ? "-" : ""}${symbol}${grouped}.${String(paise).padStart(2, "0")}`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + " Hundred"); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}

/** "Rupees Forty Five Thousand Only" using lakh/crore. */
export function amountInWords(p: Paise): string {
  if (p < 0) return "Minus " + amountInWords(-p);
  let rupees = Math.floor(p / 100);
  const paise = p % 100;
  if (rupees === 0 && paise === 0) return "Rupees Zero Only";
  const units: [number, string][] = [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"]];
  const parts: string[] = [];
  for (const [v, name] of units) {
    if (rupees >= v) { parts.push(below1000(Math.floor(rupees / v)) + " " + name); rupees %= v; }
  }
  if (rupees > 0) parts.push(below1000(rupees));
  let out = "Rupees " + (parts.join(" ") || "Zero");
  if (paise) out += " and " + below1000(paise) + " Paise";
  return out + " Only";
}
