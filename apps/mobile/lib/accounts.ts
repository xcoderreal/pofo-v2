/** An Account's id is derived from its name (a slug) — a domain rule, not
 * view logic, so it lives here rather than inline in a page. */
export function accountIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
