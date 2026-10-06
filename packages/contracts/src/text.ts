export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

export function normalizeSku(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '-');
}

export function collapseWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

export function slugify(input: string): string {
  return collapseWhitespace(input)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
