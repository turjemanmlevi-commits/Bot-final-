import { useNavigate } from 'react-router';
import { BROWSER_TEST_QUICK } from '@to/shared';
import { Api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useLive } from '../lib/store';
import { useDialog } from './Dialog';
import { Icon } from './Icon';

const AUTO = 'auto';

/**
 * «Prueba Real Madrid»: el bot abre su propio Chrome con una cuenta de «Cuentas», entra en el
 * partido elegido (los del femenino con entradas a la venta, leídos de realmadrid.com), mete las
 * entradas en el carrito, pulsa «Comprar entradas» y, con la pantalla de pago abierta, avisa por
 * Telegram con la captura y los botones. Nunca paga. Requisitos: 3 seguidas, cualquier zona, sin
 * tope de precio; si no hay 3 juntas, 2 y luego 1.
 */
export function RealTestButton({ className = 'btn', size = 15 }: { className?: string; size?: number }) {
  const ask = useDialog();
  const navigate = useNavigate();
  const s = useLive();
  const { run, busy } = useAction();

  const start = async () => {
    const accounts = Object.values(s.accounts)
      .filter((a) => a.enabled)
      .sort((a, b) => Number(b.providerId === 'real-madrid') - Number(a.providerId === 'real-madrid') || a.label.localeCompare(b.label, 'es'));
    if (accounts.length === 0) {
      await ask({ title: 'Falta una cuenta', body: 'Crea tu cuenta del Real Madrid en «Cuentas» (proveedor Real Madrid) y vuelve a pulsar.', confirmText: 'Entendido' });
      navigate('/cuentas');
      return;
    }
    const found = await run(() => Api.browserTestMatches());
    const matches = found?.matches ?? [];
    const q = BROWSER_TEST_QUICK;
    const match = await ask({
      title: 'Prueba real: el bot mete las entradas al carrito',
      body: (
        <div className="stack" style={{ gap: 8 }}>
          <div>
            Requisitos de la prueba: <b>{q.quantity} entradas seguidas</b>, cualquier zona (la más barata con sitio), sin tope de precio. Si no hay {q.quantity} juntas, prueba con 2 y
            luego con 1.
          </div>
          <div>
            El bot abre <b>su Chrome</b> con tu cuenta, entra en el partido, mete las entradas en el carrito y pulsa <b>«Comprar entradas»</b>. Con la pantalla de pago abierta te
            manda por Telegram la <b>captura</b> y los botones <b>✅ Sí, voy a pagar</b> / <b>❌ No, liberar</b>. Nunca paga.
          </div>
          {found?.error ? <div className="small muted">{found.error}. El bot buscará el partido en los catálogos de la web de entradas.</div> : null}
          {found && !found.error && matches.length === 0 ? <div className="small muted">realmadrid.com no tiene ahora partidos del femenino con entradas a la venta.</div> : null}
        </div>
      ),
      input: {
        label: 'Partido',
        options: [
          ...matches.map((m) => ({ value: m.ticketsUrl, label: m.label, hint: m.venue ?? undefined })),
          { value: AUTO, label: matches.length ? 'Automático (el más próximo a la venta)' : 'Buscar en los catálogos del femenino', hint: 'El bot lo busca él solo.' },
        ],
        defaultValue: matches[0]?.ticketsUrl ?? AUTO,
        hint: 'Partidos del femenino con entradas a la venta ahora mismo, según realmadrid.com.',
      },
      confirmText: 'Siguiente',
    });
    if (typeof match !== 'string' || !match) return;
    let accountId = accounts[0]?.id ?? '';
    if (accounts.length > 1) {
      const chosen = await ask({
        title: 'Con qué cuenta entra el bot',
        input: {
          label: 'Cuenta',
          options: accounts.map((a) => ({ value: a.id, label: `${a.label}${a.providerId === 'real-madrid' ? '' : ` · ${a.providerId}`}` })),
          defaultValue: accountId,
          hint: 'Mejor una cuenta con «Sesión guardada» en Cuentas.',
        },
        confirmText: 'Empezar la prueba',
      });
      if (typeof chosen !== 'string' || !chosen) return;
      accountId = chosen;
    }
    const r = await run(
      () => Api.browserTestStart({ ...q, eventUrl: match === AUTO ? '' : match, accountId }),
      'Prueba en marcha: mira la tarjeta «Prueba real con el navegador del bot»',
    );
    if (r) {
      navigate('/');
      setTimeout(() => document.getElementById('prueba-navegador')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150);
    }
  };

  return (
    <button type="button" className={className} onClick={() => void start()} disabled={busy}>
      <Icon name="play" size={size} /> Prueba Real Madrid
    </button>
  );
}
