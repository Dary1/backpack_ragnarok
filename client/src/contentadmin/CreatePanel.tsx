// client/src/contentadmin/CreatePanel.tsx -- REQ-0157. The DEDICATED create
// flow: its state is NEVER fed by selection (the REQ-0155 page kept a
// permanent create form beside the list -- the same accidental-create trap
// REQ-0156 removed from artadmin). Live validation: name regex / reserved /
// duplicate. Keeps the REQ-0155 e2e field testids (cd-kind, cd-system-name,
// cd-schema-ref, cd-brief, cd-create).
import { useState } from 'react';
import { createContentDef } from '../api';
import type { ContentDefDto } from '../api';
import { KINDS, validateNewName } from './contentShared';
import type { Kind } from './contentShared';

export function CreatePanel({ existing, onCreated, onClose, report }: {
  existing: ContentDefDto[];
  onCreated: (d: ContentDefDto) => void;
  onClose: () => void;
  report: (m: string, kind: 'ok' | 'err') => void;
}) {
  const [kind, setKind] = useState<Kind>('po_def');
  const [systemName, setSystemName] = useState('');
  const [schemaRef, setSchemaRef] = useState('content/vocab.json');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);

  const nameError = validateNewName(systemName, existing);
  const canCreate = !busy && systemName !== '' && !nameError;

  async function doCreate() {
    if (!canCreate) return;
    setBusy(true);
    try {
      const r = await createContentDef({ system_name: systemName, kind, brief, schema_ref: schemaRef });
      report('created ' + r.def.system_name, 'ok');
      onCreated(r.def);
    } catch (e) {
      report('create failed: ' + (e as Error).message, 'err');
    } finally { setBusy(false); }
  }

  return (
    <div data-testid="cd-create-panel" className="panel panel-pad ca-create">
      <div className="aa-ws-head">
        <span className="den t-h3 gold-text">New content</span>
        <button type="button" data-testid="cd-create-close" className="btn btn-ghost aa-btn-sm" onClick={onClose}>close</button>
      </div>
      <div className="aa-form">
        <label className="aa-field">
          <span className="t-micro">kind</span>
          <select data-testid="cd-kind" className="aa-input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="aa-field">
          <span className="t-micro">system_name (shared with the artwork facet)</span>
          <input data-testid="cd-system-name" className="aa-input" value={systemName}
            onChange={(e) => setSystemName(e.target.value)} placeholder="[A-Za-z0-9_]+" />
        </label>
        <label className="aa-field">
          <span className="t-micro">schema_ref (vocab the data must satisfy)</span>
          <input data-testid="cd-schema-ref" className="aa-input" value={schemaRef}
            onChange={(e) => setSchemaRef(e.target.value)} />
        </label>
        <label className="aa-field aa-field--wide">
          <span className="t-micro">brief (the commission text -- what this content should be)</span>
          <textarea data-testid="cd-brief" className="aa-input aa-textarea" rows={3} value={brief}
            onChange={(e) => setBrief(e.target.value)} />
        </label>
        {nameError && <div data-testid="cd-create-error" className="aa-error">{nameError}</div>}
        <div>
          <button data-testid="cd-create" type="button" className="btn" disabled={!canCreate}
            onClick={() => { void doCreate(); }}>{busy ? 'creating...' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}
