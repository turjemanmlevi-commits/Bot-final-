/* Shared pure checks; no cookies, storage, network, or DOM side effects. */
(function (root) {
  'use strict';
  const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
  const normal = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  function money(text) {
    let value = normal(text).replace(/[^\d.,]/g, '');
    if (!value) return null;
    if (value.includes(',')) value = value.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(value)) value = value.replace(/\./g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
    const minor = Math.round(Number(value) * 100);
    return integer(minor) ? minor : null;
  }
  function validCart(cart, binding) {
    if (!cart || cart.verified !== true || cart.eventRef !== binding.eventRef || cart.accountId !== binding.accountId || !normal(cart.cartRef) || !Array.isArray(cart.items)) return false;
    let url;
    try { url = new URL(cart.openUrl); } catch { return false; }
    if (!['https:', 'http:'].includes(url.protocol) || !binding.recipe.allowedOrigins.includes(url.origin)) return false;
    return cart.items.every((item) => normal(item.offerRef) && normal(item.sectionLabel) && integer(item.qty, 1) && integer(item.unitPrice, 1));
  }
  function confirms(command, before, after, binding) {
    if (!validCart(before, binding) || before.items.length !== 0 || !validCart(after, binding)) return false;
    if (!integer(command.qty, 1) || !integer(command.unitPrice, 1) || command.accountId !== binding.accountId || command.eventRef !== binding.eventRef) return false;
    return after.items.length > 0 && after.items.every((item) => item.offerRef === command.offerRef && item.unitPrice === command.unitPrice)
      && after.items.reduce((sum, item) => sum + item.qty, 0) === command.qty;
  }
  root.TicketCartEvidence = Object.freeze({ integer, normal, money, validCart, confirms });
})(globalThis);
