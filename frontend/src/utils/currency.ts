// Currencies with a dedicated glyph, shown as a prefix (e.g. "$164.99").
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  INR: '₹',
};

// Currencies without a common glyph, shown as a code prefix (e.g. "RON 164.99").
const CURRENCY_CODE_PREFIXES: Record<string, string> = {
  CHF: 'CHF ',
  CAD: 'CA$',
  AUD: 'A$',
  RON: 'RON ',
};

export function formatPrice(price: number | string | null | undefined, currency: string | null | undefined): string {
  if (price === null || price === undefined) return 'N/A';
  const numPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numPrice)) return 'N/A';

  const code = (currency || 'USD').toUpperCase();
  // Fall back to the raw currency code rather than silently defaulting to $
  // for any currency this app doesn't have a dedicated glyph for yet.
  const prefix = CURRENCY_SYMBOLS[code] ?? CURRENCY_CODE_PREFIXES[code] ?? `${code} `;
  return `${prefix}${numPrice.toFixed(2)}`;
}
