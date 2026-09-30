/**
 * Botón «📥 Enviar a la sala»: un marcador del navegador. En la página del
 * evento de la web oficial (que la persona tiene abierta), recoge lo que la
 * página enseña —los datos del evento que publica para los buscadores, el
 * título, las fechas y las líneas de la venta y del límite— y abre la sala con
 * el evento relleno. Nada más: no pulsa nada, no entra en la cuenta ni compra.
 */

import { useEffect, useRef, useState } from 'react';
import { useToast } from '../lib/hooks';
import { Icon } from './Icon';

/** Código del marcador (se ejecuta en la página del evento, en el navegador de la persona). */
function bookmarkletSource(origin: string): string {
  return `(function(){var S=${JSON.stringify(origin)},d=document,t=function(x){return String(x||'').replace(/\\s+/g,' ').trim()};
var K=/(\\d{1,2}[:.h]\\d{2}|\\d{1,2}\\s*(de\\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic|jan|apr|aug|dec)|\\d{1,2}\\/\\d{1,2}|l[ií]mite|limit|m[áa]ximo|hasta|venta|preventa|on ?sale|presale|estadio|arena|palacio|palau|pabell|recinto|teatro|auditorio|toros|ifema)/i;
var L=[],seen={};(d.body?d.body.innerText:'').split(/\\n+/).forEach(function(l){l=t(l);if(l.length>2&&l.length<300&&K.test(l)&&!seen[l]&&L.length<160){seen[l]=1;L.push(l)}});
var M={};[].forEach.call(d.querySelectorAll('meta[property^="og:"],meta[name="description"],meta[name^="twitter:"]'),function(m){var k=m.getAttribute('property')||m.getAttribute('name');if(k&&!M[k])M[k]=t(m.getAttribute('content')).slice(0,300)});
var J=[];[].forEach.call(d.querySelectorAll('script[type="application/ld+json"]'),function(s){var x=s.textContent||'';if(J.length<8&&/Event|Festival/.test(x))J.push(x.slice(0,40000))});
var T=[];[].forEach.call(d.querySelectorAll('time[datetime]'),function(e){if(T.length<30)T.push([e.getAttribute('datetime'),t(e.innerText).slice(0,80)])});
var c=d.querySelector('link[rel="canonical"]'),h=d.querySelector('h1'),sel=t(window.getSelection?getSelection():'');
var D={v:1,url:location.href,canonical:c?c.href:null,title:t(d.title).slice(0,300),h1:h?t(h.innerText).slice(0,300):null,meta:M,ld:J,times:T,lines:L,selection:sel?sel.slice(0,3000):null,at:new Date().toISOString()};
var u=S+'/eventos#importar='+encodeURIComponent(JSON.stringify(D));var w=window.open(u,'_blank');if(!w)location.href=u;})();`;
}

export function bookmarkletHref(origin: string): string {
  return `javascript:${encodeURIComponent(bookmarkletSource(origin))}`;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** El botón para arrastrar a la barra de marcadores, con los pasos. */
export function SendToSalaButton({ compact = false }: { compact?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const toast = useToast();
  const [open, setOpen] = useState(!compact);
  const href = bookmarkletHref(window.location.origin);

  // React no deja poner «javascript:» en un enlace: se pone directamente en el elemento.
  useEffect(() => {
    ref.current?.setAttribute('href', href);
  }, [href, open]);

  const button = (
    <a
      ref={ref}
      className="btn primary"
      draggable
      onClick={(e) => {
        e.preventDefault();
        toast('No lo pulses aquí: arrástralo a la barra de marcadores y púlsalo en la página del evento.', 'info');
      }}
      title="Arrástrame a la barra de marcadores"
      style={{ cursor: 'grab' }}
    >
      📥 Enviar a la sala
    </a>
  );

  if (!open) {
    return (
      <div>
        <button type="button" className="btn sm ghost wrap" onClick={() => setOpen(true)}>
          ¿No tienes el botón «📥 Enviar a la sala»? Instálalo (1 minuto)
        </button>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 10 }}>
        {button}
        <span className="small ink2">← arrástralo a la barra de marcadores (se hace una vez)</span>
      </div>
      <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
        <li>
          Si no ves la barra de marcadores, pulsa <b>Ctrl + Mayús + B</b> (Chrome y Edge).
        </li>
        <li>
          Arrastra el botón <b>📥 Enviar a la sala</b> hasta esa barra y suéltalo.
        </li>
        <li>
          En la web oficial, abre la página del evento y pulsa el marcador: se abre la sala con el evento relleno.
        </li>
      </ol>
      <div className="small muted">
        ¿No se deja arrastrar?{' '}
        <button
          type="button"
          className="btn sm ghost"
          onClick={() =>
            void copy(href).then((ok) =>
              toast(ok ? 'Copiado: crea un marcador nuevo (Ctrl + D), cambia su dirección por lo copiado y llámalo «Enviar a la sala».' : 'No se pudo copiar.', ok ? 'info' : 'error'),
            )
          }
        >
          <Icon name="copy" size={12} /> Copiar el código del marcador
        </button>
      </div>
    </div>
  );
}
