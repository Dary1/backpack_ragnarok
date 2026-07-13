// client/src/contentadmin/ContentAdminPage.tsx -- REQ-0155 content-data
// registry admin. One screen for ALL adoption-verified NON-VISUAL content:
// for each content (kind + system_name) hold N generated data variants,
// machine-check them, record an advisory agent review, let the USER adopt
// exactly one, and serve/export the adopted variant -- identical in shape to
// the artwork registry (REQ-0151), reusing REQ-0152's chip UX grammar.
// Generation is agent-session driven (Q1): "Generate N" produces a commission
// payload; the agent session POSTs the variants back to the receiving API
// (exercised here via the paste-and-ingest box). Auth reuses admin.cjs
// (item_admin) via the api.ts helpers' X-Auth-Token header.
import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '../store';
import {
  listContentDefs, createContentDef, getContentDef, commissionContent,
  ingestVariants, reviewVariant, editVariant, adoptVariantApi, deleteVariantApi,
} from '../api';
import type { ContentDefDto, ContentVariantDto, MachineCheck, AgentReview, ContentCommission } from '../api';

type Kind = 'po_def' | 'si_def' | 'monster_def' | 'unit_def' | 'tm_def';
const KINDS: Kind[] = ['po_def', 'si_def', 'monster_def', 'unit_def', 'tm_def'];

function overallColor(o: string): string { return o === 'PASS' ? '#2e7d32' : '#992222'; }
function checkColor(ok: boolean, applicable: boolean): string { return !applicable ? '#555' : ok ? '#2e7d32' : '#992222'; }
function reviewColor(v: string): string { return v === 'recommend' ? '#2e7d32' : v === 'concern' ? '#a6791a' : '#666'; }

function prettyLines(o: unknown): string[] { return JSON.stringify(o, Object.keys(o as object).length ? undefined : undefined, 1).split('\n'); }

function CheckChips({ v, expanded, onToggle }: { v: ContentVariantDto; expanded: Record<string, boolean>; onToggle: (k: string) => void }) {
  const mc: MachineCheck = v.machine_check || { overall: 'FAIL', checks: [] };
  return (
    <div data-testid={'checks-' + v.variant_no} style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
      <span data-testid={'overall-' + v.variant_no} style={{ background: overallColor(mc.overall), color: '#fff', padding: '1px 6px', borderRadius: 3, fontSize: 11, fontWeight: 700 }}>{mc.overall}</span>
      {(mc.checks || []).map((c) => {
        const key = v.variant_no + '|' + c.name;
        return (
          <span key={c.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <button type="button" data-testid={'check-' + v.variant_no + '-' + c.name} onClick={() => onToggle(key)}
              title={c.detail}
              style={{ background: checkColor(c.ok, c.applicable), color: '#fff', border: 'none', padding: '1px 5px', borderRadius: 3, cursor: 'pointer', fontSize: 10 }}>
              {c.name} {!c.applicable ? 'n/a' : c.ok ? 'ok' : 'x'}
            </button>
            {expanded[key] && <span data-testid={'check-detail-' + v.variant_no + '-' + c.name} style={{ fontSize: 10, color: '#bbb', fontFamily: 'monospace', maxWidth: 260 }}>{c.detail}</span>}
          </span>
        );
      })}
    </div>
  );
}

function ReviewChip({ v }: { v: ContentVariantDto }) {
  const r: AgentReview | null = v.agent_review;
  if (!r) return <span data-testid={'review-' + v.variant_no} style={{ fontSize: 10, color: '#888' }}>no review</span>;
  return (
    <span data-testid={'review-' + v.variant_no} title={r.rationale}
      style={{ background: reviewColor(r.verdict), color: '#fff', padding: '1px 6px', borderRadius: 3, fontSize: 10 }}>
      <b data-testid={'review-verdict-' + v.variant_no}>{r.verdict}</b>: {r.rationale.slice(0, 40)}{r.rationale.length > 40 ? '…' : ''}
    </span>
  );
}

// Minimal line-level JSON diff between two variants' data.
function DiffView({ a, b }: { a: ContentVariantDto; b: ContentVariantDto }) {
  const la = prettyLines(a.data), lb = prettyLines(b.data);
  const n = Math.max(la.length, lb.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const l = la[i] ?? '', r = lb[i] ?? '';
    const diff = l !== r;
    rows.push(
      <div key={i} style={{ display: 'flex', gap: 8, background: diff ? '#2a1a1a' : 'transparent' }}>
        <pre style={{ margin: 0, flex: 1, color: diff ? '#e88' : '#9a9', fontSize: 11 }}>{l}</pre>
        <pre style={{ margin: 0, flex: 1, color: diff ? '#8e8' : '#9a9', fontSize: 11 }}>{r}</pre>
      </div>
    );
  }
  return <div data-testid="diff-view" style={{ background: '#111', padding: 8, maxHeight: 320, overflow: 'auto' }}>
    <div style={{ display: 'flex', gap: 8, color: '#C9A959', fontSize: 11 }}><div style={{ flex: 1 }}>variant {a.variant_no}</div><div style={{ flex: 1 }}>variant {b.variant_no}</div></div>
    {rows}
  </div>;
}

export function ContentAdminPage({ locale }: { locale: Locale }) {
  void locale;
  const [defs, setDefs] = useState<ContentDefDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [def, setDef] = useState<ContentDefDto | null>(null);
  const [variants, setVariants] = useState<ContentVariantDto[]>([]);
  const [artworkFacet, setArtworkFacet] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string>('');
  // create form
  const [kind, setKind] = useState<Kind>('po_def');
  const [systemName, setSystemName] = useState<string>('');
  const [brief, setBrief] = useState<string>('');
  const [schemaRef, setSchemaRef] = useState<string>('content/vocab.json');
  // commission + ingest
  const [genN, setGenN] = useState<number>(5);
  const [commission, setCommission] = useState<ContentCommission | null>(null);
  const [ingestText, setIngestText] = useState<string>('');
  // diff
  const [diffA, setDiffA] = useState<number | ''>('');
  const [diffB, setDiffB] = useState<number | ''>('');
  // review + edit per-variant drafts
  const [reviewDraft, setReviewDraft] = useState<Record<number, { verdict: string; rationale: string }>>({});
  const [editOpen, setEditOpen] = useState<number | null>(null);
  const [editText, setEditText] = useState<string>('');

  const refreshList = useCallback(async () => {
    try { const r = await listContentDefs(); setDefs(r.defs); } catch (e) { setMsg('list: ' + (e as Error).message); }
  }, []);
  const loadDetail = useCallback(async (name: string) => {
    try { const r = await getContentDef(name); setDef(r.def); setVariants(r.variants); setArtworkFacet(!!r.artwork_facet); } catch (e) { setMsg('detail: ' + (e as Error).message); }
  }, []);
  useEffect(() => { void refreshList(); }, [refreshList]);
  useEffect(() => { if (selected) void loadDetail(selected); }, [selected, loadDetail]);

  async function doCreate() {
    setMsg('creating...');
    try {
      const r = await createContentDef({ system_name: systemName, kind, brief, schema_ref: schemaRef });
      setMsg('created ' + r.def.system_name);
      await refreshList(); setSelected(r.def.system_name);
    } catch (e) { setMsg('create failed: ' + (e as Error).message); }
  }
  async function doCommission() {
    if (!selected) return;
    try { const r = await commissionContent(selected, genN); setCommission(r.commission); setMsg('commission for ' + r.commission.count + ' variants ready -- hand to an agent session'); }
    catch (e) { setMsg('commission: ' + (e as Error).message); }
  }
  async function doIngest() {
    if (!selected) return;
    setMsg('ingesting...');
    try {
      const parsed = JSON.parse(ingestText);
      const arr = Array.isArray(parsed) ? parsed : (parsed.variants || [parsed]);
      const r = await ingestVariants(selected, arr);
      setMsg('ingested ' + r.created.length + ' variant(s); machine checks ran');
      setIngestText(''); await loadDetail(selected);
    } catch (e) { setMsg('ingest: ' + (e as Error).message); }
  }
  async function doReview(no: number) {
    if (!selected) return;
    const d = reviewDraft[no] || { verdict: 'neutral', rationale: '' };
    try { await reviewVariant(selected, no, { verdict: d.verdict, rationale: d.rationale, agent: 'reviewer-agent', model: 'claude-opus-4.8' }); setMsg('review recorded for variant ' + no); await loadDetail(selected); }
    catch (e) { setMsg('review: ' + (e as Error).message); }
  }
  async function doAdopt(no: number, overall: string) {
    if (!selected) return;
    const override = overall === 'FAIL' ? window.confirm('Variant ' + no + ' FAILED machine checks. Adopt anyway (override)?') : false;
    if (overall === 'FAIL' && !override) { setMsg('adoption cancelled (FAIL needs override)'); return; }
    try { const r = await adoptVariantApi(selected, no, override); setMsg('adopted variant ' + no + (r.export_error ? (' (export warning: ' + r.export_error + ')') : ' + exported')); await loadDetail(selected); await refreshList(); }
    catch (e) { setMsg('adopt: ' + (e as Error).message); }
  }
  async function doDelete(no: number) {
    if (!selected) return;
    try { await deleteVariantApi(selected, no); setMsg('deleted variant ' + no); await loadDetail(selected); }
    catch (e) { setMsg('delete: ' + (e as Error).message); }
  }
  async function doEditSubmit(no: number) {
    if (!selected) return;
    try {
      const data = JSON.parse(editText);
      const r = await editVariant(selected, no, data);
      setMsg('edit created new variant ' + r.variant.variant_no + ' (parent ' + no + ')');
      setEditOpen(null); setEditText(''); await loadDetail(selected);
    } catch (e) { setMsg('edit: ' + (e as Error).message); }
  }

  const adoptedId = def ? def.adopted_variant_id : null;
  const va = variants.find((v) => v.variant_no === diffA);
  const vb = variants.find((v) => v.variant_no === diffB);

  return (
    <div data-testid="contentadmin" style={{ padding: 16, display: 'flex', gap: 24, color: '#eee' }}>
      <div style={{ minWidth: 340 }}>
        <h2>Content Data Registry Admin</h2>
        <div data-testid="cd-msg" style={{ minHeight: 20, color: '#C9A959' }}>{msg}</div>
        <fieldset style={{ border: '1px solid #555', padding: 10 }}>
          <legend>Create content</legend>
          <div><label>kind{' '}
            <select data-testid="cd-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label></div>
          <div><label>system_name <input data-testid="cd-system-name" value={systemName} onChange={(e) => setSystemName(e.target.value)} /></label></div>
          <div><label>schema_ref <input data-testid="cd-schema-ref" value={schemaRef} onChange={(e) => setSchemaRef(e.target.value)} style={{ width: 180 }} /></label></div>
          <div>brief<br /><textarea data-testid="cd-brief" value={brief} rows={2} cols={40} onChange={(e) => setBrief(e.target.value)} /></div>
          <button data-testid="cd-create" type="button" onClick={() => { void doCreate(); }}>Create</button>
        </fieldset>
        <h3>Content defs</h3>
        <ul data-testid="cd-list" style={{ listStyle: 'none', padding: 0 }}>
          {defs.map((d) => (
            <li key={d.system_name}>
              <button type="button" data-testid={'cd-select-' + d.system_name} onClick={() => setSelected(d.system_name)}
                style={{ fontWeight: selected === d.system_name ? 'bold' : 'normal' }}>
                {d.system_name} [{d.kind}]{d.adopted_variant_id ? ' *' : ''}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div style={{ flex: 1 }}>
        {def ? (
          <div data-testid="cd-detail">
            <h3>{def.system_name} [{def.kind}]{adoptedId ? ' (adopted)' : ''}</h3>
            <div data-testid="cd-brief-view" style={{ color: '#bbb', marginBottom: 6 }}>{def.brief}</div>
            <div style={{ marginBottom: 6, fontSize: 12 }}>
              {artworkFacet
                ? <span data-testid="cd-artwork-facet" style={{ color: '#2e7d32' }}>artwork facet: present -- <a data-testid="cd-dex-link" href={'#/dex/' + def.system_name} style={{ color: '#C9A959' }}>view in Dex</a></span>
                : <span data-testid="cd-artwork-facet" style={{ color: '#888' }}>artwork facet: none (data-only entity)</span>}
            </div>
            <fieldset style={{ border: '1px solid #555', padding: 8, marginBottom: 8 }}>
              <legend>Generate (agent-session driven)</legend>
              <label>N <input data-testid="cd-gen-n" type="number" min={1} max={20} value={genN} onChange={(e) => setGenN(Number(e.target.value) || 1)} style={{ width: 48 }} /></label>{' '}
              <button data-testid="cd-commission" type="button" onClick={() => { void doCommission(); }}>Generate N more (commission)</button>
              {commission && <pre data-testid="cd-commission-out" style={{ background: '#111', padding: 6, fontSize: 11, whiteSpace: 'pre-wrap' }}>{commission.instructions}</pre>}
              <div style={{ marginTop: 6 }}>Ingest variants JSON (the receiving API -- an agent session POSTs here):</div>
              <textarea data-testid="cd-ingest-json" value={ingestText} rows={4} cols={60} placeholder='{"variants":[{"data":{...},"provenance":{"source":"llm","model":"...","prompt":"...","params":{}}}]}' onChange={(e) => setIngestText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 11 }} />
              <div><button data-testid="cd-ingest" type="button" onClick={() => { void doIngest(); }}>Ingest + run machine checks</button></div>
            </fieldset>
            <h4>Variants ({variants.length})</h4>
            <table data-testid="cd-variants" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: '#C9A959' }}><th>variant_no</th><th>machine checks</th><th>agent review</th><th>source</th><th>created</th><th>actions</th></tr></thead>
              <tbody>
                {variants.map((v) => {
                  const isAdopted = adoptedId != null && v.id === adoptedId;
                  const overall = (v.machine_check && v.machine_check.overall) || 'FAIL';
                  const draft = reviewDraft[v.variant_no] || { verdict: 'neutral', rationale: '' };
                  return (
                    <tr key={v.variant_no} data-testid={'variant-' + v.variant_no} style={{ borderTop: '1px solid #333', background: isAdopted ? '#1c1c10' : 'transparent' }}>
                      <td style={{ verticalAlign: 'top' }}>{v.variant_no}{isAdopted ? <b data-testid={'variant-adopted-' + v.variant_no}> ADOPTED</b> : ''}</td>
                      <td style={{ verticalAlign: 'top' }}><CheckChips v={v} expanded={expanded} onToggle={(k) => setExpanded((e) => ({ ...e, [k]: !e[k] }))} /></td>
                      <td style={{ verticalAlign: 'top' }}>
                        <ReviewChip v={v} />
                        <div style={{ marginTop: 3 }}>
                          <select data-testid={'review-verdict-select-' + v.variant_no} value={draft.verdict} onChange={(e) => setReviewDraft((s) => ({ ...s, [v.variant_no]: { ...draft, verdict: e.target.value } }))}>
                            <option value="recommend">recommend</option><option value="neutral">neutral</option><option value="concern">concern</option>
                          </select>
                          <input data-testid={'review-rationale-' + v.variant_no} placeholder="rationale (required)" value={draft.rationale} onChange={(e) => setReviewDraft((s) => ({ ...s, [v.variant_no]: { ...draft, rationale: e.target.value } }))} style={{ width: 120 }} />
                          <button data-testid={'review-submit-' + v.variant_no} type="button" onClick={() => { void doReview(v.variant_no); }}>save</button>
                        </div>
                      </td>
                      <td data-testid={'variant-source-' + v.variant_no} style={{ verticalAlign: 'top' }}>{v.provenance.source}{v.provenance.parent_variant_id ? ' (<-' + v.provenance.parent_variant_id + ')' : ''}</td>
                      <td style={{ verticalAlign: 'top', color: '#999' }}>{(v.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                      <td style={{ verticalAlign: 'top' }}>
                        <button data-testid={'adopt-' + v.variant_no} type="button" disabled={isAdopted} onClick={() => { void doAdopt(v.variant_no, overall); }}>Adopt</button>{' '}
                        <button data-testid={'delete-' + v.variant_no} type="button" disabled={isAdopted} onClick={() => { void doDelete(v.variant_no); }}>Delete</button>{' '}
                        <button data-testid={'edit-open-' + v.variant_no} type="button" onClick={() => { setEditOpen(v.variant_no); setEditText(JSON.stringify(v.data, null, 1)); }}>Edit as new</button>
                        {editOpen === v.variant_no && (
                          <div>
                            <textarea data-testid={'edit-json-' + v.variant_no} value={editText} rows={6} cols={50} onChange={(e) => setEditText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 11 }} />
                            <div><button data-testid={'edit-submit-' + v.variant_no} type="button" onClick={() => { void doEditSubmit(v.variant_no); }}>Create edited variant</button></div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <h4>JSON diff between two variants</h4>
            <div style={{ marginBottom: 6 }}>
              <label>A <select data-testid="diff-a" value={diffA} onChange={(e) => setDiffA(e.target.value ? Number(e.target.value) : '')}>
                <option value="">-</option>{variants.map((v) => <option key={v.variant_no} value={v.variant_no}>{v.variant_no}</option>)}
              </select></label>{' '}
              <label>B <select data-testid="diff-b" value={diffB} onChange={(e) => setDiffB(e.target.value ? Number(e.target.value) : '')}>
                <option value="">-</option>{variants.map((v) => <option key={v.variant_no} value={v.variant_no}>{v.variant_no}</option>)}
              </select></label>
            </div>
            {va && vb && <DiffView a={va} b={vb} />}
          </div>
        ) : <div>Select or create a content def.</div>}
      </div>
    </div>
  );
}
