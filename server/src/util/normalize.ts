/**
 * Normalización de etiquetas de sección/zona. Es la misma función para el
 * compilador del vault (índices de alias) y para resolver las etiquetas crudas
 * del proveedor, así que "Sección 101", "SECCION-101" y "seccion 101" coinciden.
 */
export function normalizeLabel(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Igual que normalizeLabel pero sin espacios: "Pista-A" y "PISTA A" → "pistaa". */
export function compactLabel(input: string): string {
  return normalizeLabel(input).replace(/ /g, '');
}

export function slugify(input: string): string {
  return normalizeLabel(input).replace(/ /g, '-');
}

/** Palabras genéricas que los proveedores anteponen a una sección. */
export const LABEL_PREFIX_STOPWORDS: ReadonlySet<string> = new Set([
  'sec',
  'secc',
  'seccion',
  'section',
  'sector',
  'bloque',
  'block',
  'zona',
  'zone',
  'area',
  'tribuna',
  'grada',
]);

/** Quita prefijos genéricos: "SEC 101" → "101", "Sector Norte B" → "norte b". */
export function stripLabelPrefixes(normalized: string): string {
  const words = normalized.split(' ').filter(Boolean);
  while (words.length > 1 && LABEL_PREFIX_STOPWORDS.has(words[0] as string)) words.shift();
  return words.join(' ');
}
