import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRealMadridVisibleSummary } from '../domain/real-madrid-cart';

// Transcription of the user's screenshots, not a fixture claiming a live reservation.
const input = {
  expectedEventTitle: '(UWCL) REAL MADRID CF - PARIS FC', eventTitle: '(UWCL) REAL MADRID CF - PARIS FC',
  itemTexts: ['0012', '0010', '0008', '0006'].map((seat) => `TRIBUNA LAT. OESTE - 202\nFila 0006 - Asiento ${seat} - Puerta 1 - General\n24,00 €`),
  quantityText: '4 Entradas', feesText: 'Gastos de gestión 4,00 €', totalText: '100,00 €',
};

test('la selección aportada son cuatro entradas de 24 euros más cuatro euros de gastos', () => {
  const parsed = parseRealMadridVisibleSummary(input)!;
  assert.equal(parsed.quantity, 4);
  assert.equal(parsed.subtotal, 9600);
  assert.equal(parsed.fees, 400);
  assert.equal(parsed.total, 10000);
  assert.deepEqual(parsed.items.map((i) => i.seat), ['0012', '0010', '0008', '0006']);
  assert.equal('verified' in parsed, false);
  assert.equal('cartRef' in parsed, false);
});
test('no trata el subtotal de 96 euros como el total de compra', () => {
  assert.equal(parseRealMadridVisibleSummary({ ...input, totalText: '96,00 €' }), null);
});
test('rechaza gastos omitidos, desconocidos o de otra moneda', () => {
  for (const feesText of ['', 'Gastos de gestión incluidos', 'Gastos de gestión 4,00 USD']) assert.equal(parseRealMadridVisibleSummary({ ...input, feesText }), null);
});
test('rechaza cantidades distintas y asientos repetidos', () => {
  assert.equal(parseRealMadridVisibleSummary({ ...input, quantityText: '3 Entradas' }), null);
  assert.equal(parseRealMadridVisibleSummary({ ...input, itemTexts: Array(4).fill(input.itemTexts[0]) }), null);
});
test('no acepta el carrito de otro evento ni filas de asiento incompletas', () => {
  assert.equal(parseRealMadridVisibleSummary({ ...input, eventTitle: 'Real Madrid - otro rival' }), null);
  assert.equal(parseRealMadridVisibleSummary({ ...input, itemTexts: input.itemTexts.map((t) => t.replace('Asiento', 'Selección')) }), null);
});
test('no presupone un límite de cuatro para todos los partidos', () => {
  const one = { ...input, itemTexts: input.itemTexts.slice(0, 1), quantityText: '1 Entrada', feesText: 'Gastos de gestión 1,00 €', totalText: '25,00 €' };
  assert.equal(parseRealMadridVisibleSummary(one)?.quantity, 1);
});
