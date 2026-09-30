(function () {
  'use strict';
  if (window.top !== window || globalThis.__ticketOrchestratorInstalled) return;
  globalThis.__ticketOrchestratorInstalled = true;
  const E = TicketCartEvidence;
  let binding = null, running = false, executing = false, timer = null, timerDue = Infinity;
  const fixtureCart = {
    rootSelector: '[data-ticket-fixture="cart"][data-cart-ready="true"]', itemSelector: '[data-cart-item]',
    eventRefAttribute: 'data-event-ref', offerRefAttribute: 'data-offer-ref', qtyAttribute: 'data-qty',
    unitPriceAttribute: 'data-unit-price', sectionAttribute: 'data-section', cartRefAttribute: 'data-cart-ref', expiresAtAttribute: 'data-expires-at',
  };
  const visible = (element) => !!element && element.getClientRects().length > 0;
  const query = (selector, root = document) => { try { return root.querySelector(selector); } catch { return null; } };
  const all = (selector, root = document) => { try { return [...root.querySelectorAll(selector)]; } catch { return []; } };
  const number = (value) => /^\d+$/.test(value || '') && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function challenge() {
    const text = (document.body?.innerText || '').slice(0, 3500);
    if (/queue-it|waitingroom|waiting-room/.test(location.hostname + location.pathname) || query('[data-ticket-queue="waiting"]')) return { session: 'CHALLENGE_REQUIRED', queue: 'WAITING', detail: 'Espera a que la cola oficial te dé paso.' };
    const fixture = query('[data-ticket-challenge="captcha"]');
    const containers = all('.g-recaptcha, .h-captcha, .cf-turnstile, #challenge-running, #challenge-stage, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"]');
    const unresolved = containers.some((element) => {
      if (!visible(element)) return false;
      // Read a provider-produced response only to observe completion; never create or alter it.
      const scope = element.closest('form') || element.parentElement;
      const response = scope && query('[name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]', scope);
      return !response?.value;
    });
    if (visible(fixture) || unresolved || /verifica que eres humano|checking your browser|verificaci[oó]n de seguridad en curso/i.test(document.title)) return { session: 'CHALLENGE_REQUIRED', queue: 'PASSED', challenge: 'CAPTCHA', detail: 'Resuelve la comprobación humana en esta pestaña; continuaré al terminar.' };
    if (all('input[type="password"]').some(visible) || query('[data-ticket-session="logged-out"]')) return { session: 'LOGGED_OUT', queue: 'PASSED', detail: 'Inicia sesión con la cuenta asociada a esta pestaña.' };
    if (text.length < 1000 && /access denied|acceso denegado/i.test(text)) return { session: 'CHALLENGE_REQUIRED', queue: 'BLOCKED', detail: 'La tienda ha bloqueado el acceso; requiere tu intervención.' };
    return { session: 'READY', queue: 'PASSED' };
  }

  function inventory() {
    if (!binding) return [];
    if (binding.recipe.id === 'fixture-v1') {
      const root = query('[data-ticket-fixture="inventory"]');
      if (!root || root.getAttribute('data-event-ref') !== binding.eventRef) return [];
      return all('[data-offer-ref]', root).map((row) => ({ offerRef: row.getAttribute('data-offer-ref'), sectionLabel: E.normal(row.getAttribute('data-section')),
        row: null, seats: [], qtyMin: 1, qtyMax: number(row.getAttribute('data-qty-max')), unitPrice: number(row.getAttribute('data-unit-price')), currency: 'EUR' }))
        .filter((offer) => offer.offerRef && offer.sectionLabel && E.integer(offer.qtyMax, 1) && E.integer(offer.unitPrice, 1));
    }
    if (binding.recipe.id !== 'entradas-fastbooking-v1' || new URL(binding.eventUrl).pathname.replace(/\/$/, '') !== location.pathname.replace(/\/$/, '')) return [];
    return all('div.fastbooking-item.js-fast-booking-row').map((row) => {
      const input = query('input.js-fast-booking-item', row);
      return { offerRef: input?.value, sectionLabel: E.normal(query('.pc-list-category span', row)?.textContent), row: null, seats: [], qtyMin: 1,
        qtyMax: number(input?.getAttribute('data-max')), unitPrice: E.money(query('.ticket-type-price', row)?.textContent), currency: 'EUR' };
    }).filter((offer) => offer.offerRef && offer.sectionLabel && E.integer(offer.qtyMax, 1) && E.integer(offer.unitPrice, 1));
  }

  function cart() {
    const recipe = binding?.recipe.cart || (binding?.recipe.id === 'fixture-v1' ? fixtureCart : null);
    if (!recipe) return null;
    const root = query(recipe.rootSelector);
    if (!root || !visible(root) || root.getAttribute('aria-busy') === 'true') return null;
    const eventRef = root.getAttribute(recipe.eventRefAttribute);
    if (eventRef !== binding.eventRef) return null;
    const cartRef = root.getAttribute(recipe.cartRefAttribute);
    if (!cartRef) return null;
    const items = all(recipe.itemSelector, root).map((row) => ({ offerRef: row.getAttribute(recipe.offerRefAttribute), sectionLabel: E.normal(row.getAttribute(recipe.sectionAttribute)),
      row: null, seats: [], qty: number(row.getAttribute(recipe.qtyAttribute)), unitPrice: number(row.getAttribute(recipe.unitPriceAttribute)), idempotencyKey: null }));
    const expiry = recipe.expiresAtAttribute ? root.getAttribute(recipe.expiresAtAttribute) : null;
    const result = { verified: true, accountId: binding.accountId, eventRef, cartRef, items, openUrl: location.href, expiresAt: expiry && Number.isFinite(Date.parse(expiry)) ? new Date(expiry).toISOString() : null };
    return E.validCart(result, binding) ? result : null;
  }

  function snapshot() {
    const state = challenge();
    const allowed = !!binding?.recipe.allowedOrigins.includes(location.origin);
    const offers = allowed && state.session === 'READY' ? inventory() : [];
    const currentCart = allowed && state.session === 'READY' ? cart() : null;
    const reviewed = binding?.recipe.id === 'fixture-v1' || (binding?.recipe.id === 'entradas-fastbooking-v1' && !!binding.recipe.cart);
    const supported = allowed && reviewed && !!currentCart;
    return { observedAt: new Date().toISOString(), url: location.href, supported, ...state, offers, cart: currentCart,
      detail: state.detail || (binding?.recipe.id === 'observe-only-v1' ? 'El selector de asientos de esta web todavía no es compatible. La pestaña está conectada solo para abrirla en su misma sesión.' : !reviewed ? 'Esta web necesita una receta de carrito verificada. No se pulsará añadir hasta poder comprobar el resultado.' : !currentCart ? 'No encuentro evidencia verificable del carrito de este evento. La operación está detenida.' : 'Página conectada y carrito verificable.') };
  }

  async function quantity(command) {
    if (binding.recipe.id === 'fixture-v1') {
      const input = query('[data-ticket-quantity]');
      if (!input || input.disabled) return false;
      input.value = String(command.qty);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return Number(input.value) === command.qty;
    }
    const display = query('#stepper-amount');
    if (!display) return false;
    for (let count = 0; count < 20; count++) {
      const actual = number(E.normal(display.textContent));
      if (actual === command.qty) return true;
      if (actual === null) return false;
      const button = query(actual < command.qty ? '.js-stepper-more' : '.js-stepper-less');
      if (!button || button.disabled) return false;
      button.click();
      await sleep(40);
      if (challenge().session !== 'READY') return false;
    }
    return false;
  }

  async function execute(command) {
    if (executing) return { outcome: { status: 'AMBIGUOUS', detail: 'Ya hay una selección en curso en esta pestaña.' } };
    executing = true;
    try {
      let before = snapshot();
      const reject = (detail) => ({ snapshot: before, outcome: { status: 'REJECTED', detail } });
      if (before.session !== 'READY' || before.queue !== 'PASSED') return { waitingChallenge: true };
      if (command.accountId !== binding.accountId || command.eventRef !== binding.eventRef) return reject('La orden no coincide con la cuenta y el evento conectados.');
      if (!before.supported || !before.cart || before.cart.items.length) return reject('Se necesita un carrito vacío verificado antes de añadir; comprueba el carrito en esta pestaña.');
      const offer = before.offers.find((item) => item.offerRef === command.offerRef);
      if (!offer || offer.unitPrice !== command.unitPrice || !E.integer(command.qty, 1) || command.qty > offer.qtyMax) return reject('Oferta, cantidad o precio han cambiado.');
      let selected, button;
      if (binding.recipe.id === 'fixture-v1') {
        const root = query('[data-ticket-fixture="inventory"]');
        const row = all('[data-offer-ref]', root).find((item) => item.getAttribute('data-offer-ref') === command.offerRef);
        selected = row && query('input[type="radio"]', row);
        button = query('[data-ticket-add]');
      } else if (binding.recipe.id === 'entradas-fastbooking-v1') {
        selected = all('input.js-fast-booking-item').find((item) => item.value === command.offerRef);
        button = query('button.js-fast-booking-action');
      }
      if (!selected || !button || selected.disabled || button.disabled || !visible(button)) return reject('No hay controles compatibles habilitados para esta oferta.');
      if (!selected.checked) selected.click();
      if (!selected.checked || !await quantity(command)) return reject('La web no aceptó la selección y cantidad solicitadas.');
      before = snapshot();
      if (before.session !== 'READY') return { waitingChallenge: true };
      const currentOffer = before.offers.find((item) => item.offerRef === command.offerRef);
      if (!selected.checked || button.disabled || !before.cart || before.cart.items.length || !currentOffer || currentOffer.unitPrice !== command.unitPrice) return reject('La selección cambió antes de añadir.');
      const acknowledged = await chrome.runtime.sendMessage({ type: 'before-click', commandId: command.id, beforeCart: before.cart });
      if (!acknowledged?.ok) return reject('No se ha podido registrar el intento de forma segura.');
      button.click();
      schedule(30);
      return { submitted: true };
    } finally { executing = false; }
  }

  function schedule(delay = 160) {
    const due = Date.now() + delay;
    if (timer !== null && timerDue <= due) return;
    clearTimeout(timer);
    timerDue = due;
    timer = setTimeout(() => { timer = null; timerDue = Infinity; void tick(); }, delay);
  }
  async function tick() {
    if (running) { schedule(200); return; }
    running = true;
    try {
      binding = await chrome.runtime.sendMessage({ type: 'binding' });
      if (!binding) return;
      const result = await chrome.runtime.sendMessage({ type: 'tick', snapshot: snapshot() });
      if (result?.detail) document.documentElement.dataset.ticketOrchestrator = result.detail;
    } catch { /* A reload of the extension or a disconnected local panel is not a reason to click. */ }
    finally { running = false; schedule(1000); }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'wake') { schedule(0); respond({ ok: true }); return; }
    if (message.type === 'execute') {
      binding = message.binding;
      execute(message.command).then(respond).catch(() => respond({ outcome: { status: 'AMBIGUOUS', detail: 'La página cambió durante la selección. Comprueba el carrito antes de repetir.' } }));
      return true;
    }
  });
  new MutationObserver((records) => {
    if (records.some((record) => record.attributeName !== 'data-ticket-orchestrator')) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  document.addEventListener('change', () => schedule(0), true);
  document.addEventListener('visibilitychange', () => schedule(0));
  schedule(0);
})();
