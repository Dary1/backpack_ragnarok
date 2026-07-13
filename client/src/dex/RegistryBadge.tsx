// client/src/dex/RegistryBadge.tsx -- REQ-0155 Q3 (LINK-FIRST Dex
// integration). A small, self-contained adoption-state badge + mutual link
// between the browse surface (Dex) and the verify+adopt surface (the content
// data registry admin). NO component sharing (that is a deferred follow-up);
// this only reads the PUBLIC adopted-variant meta endpoint and, when a
// content_def exists for this system_name, shows its adoption state and a
// link to #/contentadmin. When no content_def exists (the common case for
// entities whose data is not yet registry-managed) it renders nothing, so
// the Dex is byte-unchanged for them.
import { useEffect, useState } from 'react';
import { contentMeta } from '../api';

export function RegistryBadge({ systemName }: { systemName: string }) {
  const [state, setState] = useState<'loading' | 'none' | 'adopted'>('loading');
  const [overall, setOverall] = useState<string | null>(null);
  const [variantNo, setVariantNo] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setState('loading');
    contentMeta(systemName).then((m) => {
      if (!live) return;
      if (!m) { setState('none'); return; }
      setState('adopted'); setVariantNo(m.variant_no);
      setOverall(m.machine_check ? m.machine_check.overall : null);
    }).catch(() => { if (live) setState('none'); });
    return () => { live = false; };
  }, [systemName]);
  if (state === 'loading' || state === 'none') return null;
  return (
    <div data-testid="dex-registry-badge" style={{ marginTop: 8, fontSize: 12 }}>
      <span style={{ background: overall === 'PASS' ? '#2e7d32' : '#a6791a', color: '#fff', padding: '1px 6px', borderRadius: 3 }}>
        data: adopted v{variantNo}{overall ? ' (' + overall + ')' : ''}
      </span>{' '}
      <a data-testid="dex-registry-link" href="#/contentadmin" style={{ color: '#C9A959' }}>manage in registry</a>
    </div>
  );
}
