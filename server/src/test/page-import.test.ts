/**
 * «📥 Enviar a la sala»: de la página oficial que la persona tiene abierta a un
 * evento rellenado (sin API ni claves). Capturas con la forma de las webs
 * reales: datos del evento para buscadores (schema.org), título, fechas y las
 * líneas que hablan de la venta y del límite.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanTitle, decodeCapture, findDates, isoToLocal, parsePageCapture, providerForHost, type ImportContext, type PageCapture } from '@to/shared';

const TZ = 'Europe/Madrid';
/** Martes 29 de septiembre de 2026, 10:00 en Madrid. */
const AT = '2026-09-29T08:00:00.000Z';

const ctx: ImportContext = {
  timeZone: TZ,
  venues: [
    { venueId: 'movistar-arena', name: 'Movistar Arena', city: 'Madrid', aliases: ['WiZink Center', 'Palacio de los Deportes'] },
    { venueId: 'estadio-santiago-bernabeu', name: 'Estadio Santiago Bernabéu', city: 'Madrid', aliases: ['Santiago Bernabéu', 'Bernabéu'], clubs: ['Real Madrid'] },
    { venueId: 'palau-sant-jordi', name: 'Palau Sant Jordi', city: 'Barcelona', aliases: [] },
    { venueId: 'madrid-arena', name: 'Madrid Arena', city: 'Madrid', aliases: [] },
  ],
  providers: [
    { providerId: 'ticketmaster', url: 'https://www.ticketmaster.es' },
    { providerId: 'entradas-com', url: 'https://www.entradas.com' },
    { providerId: 'real-madrid', url: 'https://www.realmadrid.com/es-ES/entradas' },
    { providerId: 'manual', url: null },
  ],
};

function capture(p: Partial<PageCapture>): PageCapture {
  return { v: 1, url: 'https://example.com/', canonical: null, title: '', h1: null, meta: {}, ld: [], times: [], lines: [], selection: null, at: AT, ...p };
}

describe('fechas escritas en la página', () => {
  const ref = Date.parse(AT);
  const one = (s: string) => findDates(s, ref, TZ)[0];

  it('entiende los formatos habituales', () => {
    assert.deepEqual([one('Sábado, 4 de octubre de 2026 · 21:00 h')?.date, one('Sábado, 4 de octubre de 2026 · 21:00 h')?.time], ['2026-10-04', '21:00']);
    assert.equal(one('Lunes 29 de septiembre a las 10:00')?.time, '10:00');
    assert.equal(one('vie, 9 oct 2026 · 20:30')?.date, '2026-10-09');
    assert.equal(one('vie, 9 oct 2026 · 20:30')?.time, '20:30');
    assert.deepEqual([one('04/10/2026 21:00')?.date, one('04/10/2026 21:00')?.time], ['2026-10-04', '21:00']);
    assert.deepEqual([one('Oct 4, 2026 9:00 PM')?.date, one('Oct 4, 2026 9:00 PM')?.time], ['2026-10-04', '21:00']);
    assert.equal(one('Apertura: 2026-10-01T10:00')?.time, '10:00');
    assert.equal(one('Domingo 11 de octubre, 21h')?.time, '21:00');
    assert.equal(one('jueves 1 de octubre a las 10.00h')?.time, '10:00');
  });

  it('sin año: el próximo; «mar» es martes delante del día y marzo detrás', () => {
    assert.equal(one('15 de enero a las 10:00')?.date, '2027-01-15');
    assert.equal(one('4 de octubre')?.date, '2026-10-04');
    assert.equal(one('mar 6 oct 20:00')?.date, '2026-10-06');
    assert.equal(one('6 mar 2027')?.date, '2027-03-06');
  });

  it('no confunde horas, precios ni cantidades con fechas', () => {
    assert.deepEqual(findDates('Apertura de puertas 19.30 · Precio 45.50 € · Jornada 8', ref, TZ), []);
    assert.equal(one('Hasta 4 de octubre')?.time, null);
  });

  it('fechas de schema.org: con zona se pasan a Madrid; sin zona son hora de España; sin hora, pendiente', () => {
    assert.deepEqual(isoToLocal('2026-10-27T21:00:00+01:00', TZ), { local: '2026-10-27T21:00', timeTBA: false });
    assert.deepEqual(isoToLocal('2026-10-01T08:00:00Z', TZ), { local: '2026-10-01T10:00', timeTBA: false });
    assert.deepEqual(isoToLocal('2026-10-27T21:00:00', TZ), { local: '2026-10-27T21:00', timeTBA: false });
    assert.deepEqual(isoToLocal('2026-10-27', TZ), { local: '2026-10-27T00:00', timeTBA: true });
    assert.equal(isoToLocal('mañana', TZ), null);
  });

  it('nombre del evento a partir del título', () => {
    assert.equal(cleanTitle('Entradas Morat - Los Estadios 2026 | Ticketmaster España'), 'Morat - Los Estadios 2026');
    assert.equal(cleanTitle('Real Madrid - Atlético de Madrid | Entradas | Real Madrid CF'), 'Real Madrid - Atlético de Madrid');
    assert.equal(cleanTitle('Aitana entradas - entradas.com'), 'Aitana');
    assert.equal(cleanTitle('Entradas'), null);
  });

  it('web de venta por el dominio', () => {
    assert.equal(providerForHost('www.ticketmaster.es', ctx.providers), 'ticketmaster');
    assert.equal(providerForHost('www.entradas.com', ctx.providers), 'entradas-com');
    assert.equal(providerForHost('www.realmadrid.com', ctx.providers), 'real-madrid');
    assert.equal(providerForHost('www.atleticodemadrid.com', ctx.providers), null);
  });
});

describe('páginas oficiales → evento', () => {
  it('Ticketmaster: datos del evento de la página + preventa y límite del texto', () => {
    const r = parsePageCapture(
      capture({
        url: 'https://www.ticketmaster.es/event/morat-los-estadios-2026-entradas/1234567?language=es-es',
        canonical: 'https://www.ticketmaster.es/event/morat-los-estadios-2026-entradas/1234567',
        title: 'Entradas Morat - Los Estadios 2026 | Ticketmaster España',
        h1: 'Morat - Los Estadios 2026',
        ld: [
          JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'MusicEvent',
            name: 'Morat - Los Estadios 2026',
            url: 'https://www.ticketmaster.es/event/morat-los-estadios-2026-entradas/1234567',
            startDate: '2026-10-27T21:00:00+01:00',
            eventStatus: 'https://schema.org/EventScheduled',
            location: { '@type': 'Place', name: 'Movistar Arena', address: { '@type': 'PostalAddress', addressLocality: 'Madrid', addressCountry: 'ES' } },
            offers: { '@type': 'AggregateOffer', lowPrice: '45.00', highPrice: '120.00', priceCurrency: 'EUR', availability: 'https://schema.org/InStock', validFrom: '2026-10-02T10:00:00+02:00' },
            performer: [{ '@type': 'MusicGroup', name: 'Morat' }],
          }),
        ],
        lines: ['mar, 27 oct 2026 · 21:00', 'Movistar Arena, Madrid', 'Preventa Movistar+: miércoles 30 de septiembre a las 10:00', 'Hay un límite de 6 entradas por cliente.'],
      }),
      ctx,
    );
    assert.equal(r.providerId, 'ticketmaster');
    assert.equal(r.events.length, 1);
    const e = r.events[0];
    assert.ok(e);
    assert.equal(e.name, 'Morat - Los Estadios 2026');
    assert.equal(e.startsAtLocal, '2026-10-27T21:00');
    assert.equal(e.timeTBA, false);
    assert.equal(e.venueId, 'movistar-arena');
    assert.equal(e.url, 'https://www.ticketmaster.es/event/morat-los-estadios-2026-entradas/1234567');
    assert.deepEqual(e.sales, [
      { name: 'Preventa Movistar+', startsAtLocal: '2026-09-30T10:00' },
      { name: 'Venta general', startsAtLocal: '2026-10-02T10:00' },
    ]);
    assert.deepEqual(e.limit, { perCustomer: 6, semantics: 'PER_HOLDER', text: 'Hay un límite de 6 entradas por cliente.' });
    assert.deepEqual(e.price, { min: 45, max: 120, currency: 'EUR' });
    assert.equal(e.from, 'structured');
  });

  it('entradas.com: recinto de otra ciudad reconocido y límite por pedido', () => {
    const r = parsePageCapture(
      capture({
        url: 'https://www.entradas.com/event/aitana-palau-sant-jordi-20456789/',
        title: 'Aitana entradas - entradas.com',
        ld: [
          JSON.stringify([
            {
              '@context': 'http://schema.org',
              '@type': 'Event',
              name: 'Aitana - Cuarto Azul World Tour',
              startDate: '2026-11-14T21:00:00.000+01:00',
              location: { '@type': 'Place', name: 'Palau Sant Jordi', address: { addressLocality: 'Barcelona' } },
              offers: [
                { '@type': 'Offer', price: '39.00', priceCurrency: 'EUR', availability: 'http://schema.org/InStock' },
                { '@type': 'Offer', price: '65,00', priceCurrency: 'EUR', availability: 'http://schema.org/InStock' },
              ],
            },
          ]),
        ],
        lines: ['Límite de compra: 4 entradas por pedido.'],
      }),
      ctx,
    );
    assert.equal(r.providerId, 'entradas-com');
    const e = r.events[0];
    assert.ok(e);
    assert.equal(e.venueId, 'palau-sant-jordi');
    assert.equal(e.startsAtLocal, '2026-11-14T21:00');
    assert.equal(e.limit.perCustomer, 4);
    assert.deepEqual(e.price, { min: 39, max: 65, currency: 'EUR' });
    assert.deepEqual(e.sales, []);
  });

  it('realmadrid.com (sin datos para buscadores): partido, fecha, estadio, fases de venta y límite leídos del texto', () => {
    const r = parsePageCapture(
      capture({
        url: 'https://www.realmadrid.com/es-ES/entradas/futbol/laliga/real-madrid-atletico-de-madrid',
        title: 'Real Madrid - Atlético de Madrid | Entradas | Real Madrid CF',
        h1: 'Real Madrid - Atlético de Madrid',
        lines: [
          'LaLiga EA Sports · Jornada 8',
          'Sábado, 4 de octubre de 2026 · 21:00 h',
          'Estadio Santiago Bernabéu',
          'Venta Socios Abonados: lunes 29 de septiembre a las 10:00',
          'Venta general: miércoles 1 de octubre a las 10:00',
          'Venta hasta el 4 de octubre a las 20:00',
          'Máximo 4 entradas por socio y partido.',
        ],
      }),
      ctx,
    );
    assert.equal(r.providerId, 'real-madrid');
    const e = r.events[0];
    assert.ok(e);
    assert.equal(e.name, 'Real Madrid - Atlético de Madrid');
    assert.equal(e.startsAtLocal, '2026-10-04T21:00');
    assert.equal(e.venueId, 'estadio-santiago-bernabeu');
    assert.deepEqual(e.sales, [
      { name: 'Venta Socios Abonados', startsAtLocal: '2026-09-29T10:00' },
      { name: 'Venta general', startsAtLocal: '2026-10-01T10:00' },
    ]);
    assert.equal(e.limit.perCustomer, 4);
    assert.equal(e.from, 'text');
  });

  it('una página con varias fechas (gira) las da todas, por fecha, y la de esta página primero', () => {
    const ev = (date: string, city: string, venue: string, url: string) => ({ '@type': 'MusicEvent', name: 'Quevedo', startDate: date, url, location: { name: venue, address: { addressLocality: city } } });
    const r = parsePageCapture(
      capture({
        url: 'https://www.ticketmaster.es/artist/quevedo-entradas/999',
        ld: [
          JSON.stringify({
            '@graph': [
              ev('2027-03-12T21:00:00+01:00', 'Barcelona', 'Palau Sant Jordi', 'https://www.ticketmaster.es/event/2'),
              ev('2027-03-06T21:00:00+01:00', 'Madrid', 'Movistar Arena', 'https://www.ticketmaster.es/event/1'),
              ev('2027-03-20T21:00:00+01:00', 'Sevilla', 'Estadio de La Cartuja', 'https://www.ticketmaster.es/event/3'),
            ],
          }),
        ],
      }),
      ctx,
    );
    assert.deepEqual(
      r.events.map((e) => [e.startsAtLocal, e.venueId]),
      [
        ['2027-03-06T21:00', 'movistar-arena'],
        ['2027-03-12T21:00', 'palau-sant-jordi'],
        ['2027-03-20T21:00', null],
      ],
    );
    assert.equal(r.events[2]?.venueName, 'Estadio de La Cartuja');
  });

  it('un evento cancelado se marca; la oferta «2 entradas por 60 €» no es un límite', () => {
    const r = parsePageCapture(
      capture({
        url: 'https://www.ticketmaster.es/event/x/1',
        ld: [JSON.stringify({ '@type': 'Event', name: 'X', startDate: '2026-11-01T20:00:00+01:00', eventStatus: 'https://schema.org/EventCancelled' })],
        lines: ['Oferta: 2 entradas por 60 €'],
      }),
      ctx,
    );
    assert.equal(r.events[0]?.status, 'CANCELLED');
    assert.equal(r.events[0]?.limit.perCustomer, null);
  });

  it('lo que llega en la dirección se valida (y lo roto se descarta)', () => {
    const c = capture({ url: 'https://www.ticketmaster.es/event/x/1', title: 'X', lines: ['a', 'b'] });
    const back = decodeCapture(`#importar=${encodeURIComponent(JSON.stringify(c))}`);
    assert.equal(back?.url, c.url);
    assert.deepEqual(back?.lines, ['a', 'b']);
    assert.equal(decodeCapture('#importar=%7Bmal'), null);
    assert.equal(decodeCapture(`#importar=${encodeURIComponent(JSON.stringify({ v: 2, url: 'x' }))}`), null);
  });
});
