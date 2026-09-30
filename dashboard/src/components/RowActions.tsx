import type { ReactNode } from 'react';

/** Native disclosure: keyboard-accessible, no hidden destructive default action. */
export function RowActions({ label, children }: { label: string; children: ReactNode }) {
  return <details className="row-actions" onClick={(e) => e.stopPropagation()}>
    <summary className="btn sm" aria-label={`Acciones de ${label}`} title={`Acciones de ${label}`}>⋯</summary>
    <div className="stack" style={{ gap: 6, padding: '8px 0' }}>{children}</div>
  </details>;
}
