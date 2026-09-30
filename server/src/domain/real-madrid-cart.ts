/**
 * Parser for the visible summary supplied by the Real Madrid page adapter.
 * Parsing a screenshot transcription is NOT a browser readback or a reservation.
 * This module deliberately returns no verified flag, cart ID, expiry or account.
 * A live adapter must establish those independently before notifying Telegram.
 */
export interface RealMadridSummaryInput {
  expectedEventTitle: string;
  eventTitle: string;
  itemTexts: string[];
  quantityText: string;
  feesText: string;
  totalText: string;
}

const normal = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
function euros(text: string): number | null {
  const match = /^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*€$/.exec(normal(text));
  if (!match) return null;
  const amount = Number(match[1]!.replace(/\./g, '')) * 100 + Number(match[2]);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

export function parseRealMadridVisibleSummary(input: RealMadridSummaryInput) {
  if (!normal(input.expectedEventTitle) || normal(input.eventTitle).toLocaleUpperCase('es') !== normal(input.expectedEventTitle).toLocaleUpperCase('es')) return null;
  const quantityMatch = /^(\d+)\s+Entradas?$/i.exec(normal(input.quantityText));
  const quantity = quantityMatch ? Number(quantityMatch[1]) : NaN;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100 || input.itemTexts.length !== quantity) return null;
  const total = euros(input.totalText);
  const feeMatch = /^Gastos de gesti[oó]n\s+(.+)$/i.exec(normal(input.feesText));
  const fees = feeMatch ? euros(feeMatch[1]!) : null;
  // Absence of a fee line does not mean zero fees.
  if (total === null || fees === null) return null;
  const items = [];
  const seen = new Set<string>();
  for (const text of input.itemTexts) {
    const m = /^(.+?)\s+Fila\s+(\d+)\s*-\s*Asiento\s+(\d+)\s*-\s*Puerta\s+(.+?)\s*-\s*(.+?)\s+((?:\d[\d.]*)?,\d{2}\s*€)$/i.exec(normal(text));
    if (!m) return null;
    const unitPrice = euros(m[6]!);
    if (unitPrice === null || unitPrice <= 0) return null;
    const section = m[1]!, row = m[2]!, seat = m[3]!;
    const key = JSON.stringify([section.toLocaleUpperCase('es'), Number(row), Number(seat)]);
    if (seen.has(key)) return null;
    seen.add(key);
    items.push({ section, row, seat, gate: m[4]!, fare: m[5]!, unitPrice });
  }
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice, 0);
  if (!Number.isSafeInteger(subtotal + fees) || subtotal + fees !== total) return null;
  return { eventTitle: normal(input.eventTitle), quantity, items, subtotal, fees, total, currency: 'EUR' as const };
}
