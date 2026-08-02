/** An Instrument's id is its normalized (lowercased) symbol — a domain
 * rule, not view logic, so it lives here rather than inline in a page. */
export function instrumentIdFromSymbol(symbol: string): string {
  return symbol.trim().toLowerCase();
}
