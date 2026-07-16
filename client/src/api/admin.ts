// client/src/api/admin.ts -- REQ-0145b (ca): registry-admin surfaces --
// REQ-0151 artwork registry, REQ-0156 generation queue, REQ-0152
// inspection kits, REQ-0155 content-data registry (extracted VERBATIM
// from the old flat api.ts). artJson/contentJson stay module-private,
// exactly as they were file-private before.
import { authHeaders } from './http';

// ---- REQ-0151: artwork registry admin client ----
export interface ArtworkDto {
  id: number; system_name: string; kind: string; shape: unknown;
  gen_width: number; gen_height: number; main_object: string;
  prompt_template: string; style_override: string | null;
  edge_padding: number | null; adopted_render_id: number | null;
  // REQ-0186: po shape-conditioning controls. null = unset = the server's
  // auto/8 default (the client never invents a default of its own).
  shape_lock?: string | null; shape_dilation_px?: number | null;
  // REQ-0156: per-artwork aggregates, present on listArtworks() rows only
  // (additive server enrichment for the registry browser rail).
  adopted_seed?: number | null; latest_ok_seed?: number | null;
  render_count?: number; ok_count?: number; failed_count?: number;
  last_render_at?: string | null;
}
export interface RenderDto {
  id: number; seed: number; status: string; image_sha256: string | null;
  final_prompt: string | null; params: unknown; error: string | null;
}

async function artJson<T = Record<string, unknown>>(path: string, opts: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers as Record<string, string> || {}) },
  });
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok || (body as { ok?: boolean }).ok === false) {
    throw new Error(((body as { error?: string }).error) || ('HTTP ' + res.status));
  }
  return body as T;
}

export function listArtworks(): Promise<{ ok: true; artworks: ArtworkDto[] }> {
  return artJson('/api/art/artworks', { method: 'GET' });
}
export function createArtwork(b: Record<string, unknown>): Promise<{ ok: true; artwork: ArtworkDto }> {
  return artJson('/api/art/artworks', { method: 'POST', body: JSON.stringify(b) });
}
export function getArtwork(name: string): Promise<{ ok: true; artwork: ArtworkDto; renders: RenderDto[]; queueDepth: number; inspectDepth: number; inspections: Record<string, InspectionDto[]>; kits: KitDto[] }> {
  return artJson('/api/art/artworks/' + encodeURIComponent(name), { method: 'GET' });
}
export function patchArtwork(name: string, b: Record<string, unknown>): Promise<{ ok: true; artwork: ArtworkDto }> {
  return artJson('/api/art/artworks/' + encodeURIComponent(name), { method: 'PATCH', body: JSON.stringify(b) });
}
export function previewArtwork(name: string, b: Record<string, unknown>): Promise<{ ok: true; subject: string; final_prompt: string; width: number; height: number; route_params: Record<string, unknown> }> {
  return artJson('/api/art/artworks/' + encodeURIComponent(name) + '/preview', { method: 'POST', body: JSON.stringify(b) });
}
export function generateArtwork(name: string, b: Record<string, unknown>): Promise<{ ok: true; renders: RenderDto[]; queueDepth: number }> {
  return artJson('/api/art/artworks/' + encodeURIComponent(name) + '/generate', { method: 'POST', body: JSON.stringify(b) });
}
export function adoptRenderApi(name: string, seed: number): Promise<{ ok: true; artwork: ArtworkDto; export: unknown; export_error: string | null }> {
  return artJson('/api/art/artworks/' + encodeURIComponent(name) + '/adopt', { method: 'POST', body: JSON.stringify({ seed }) });
}
// REQ-0192: manual repack -- derive a best-placement variant of an OK render
// as a NEW render at source seed + 100000 (bumped by another 100000 while
// taken). The job runs at inspection priority; poll the artwork detail.
export function repackRenderApi(name: string, seed: number): Promise<{ ok: true; render: RenderDto; source_seed: number; inspectDepth: number }> {
  return artJson('/api/art/artworks/' + encodeURIComponent(name) + '/renders/' + seed + '/repack', { method: 'POST', body: JSON.stringify({}) });
}
export function deleteRenderApi(name: string, seed: number): Promise<{ ok: true; deleted: number }> {
  return artJson('/api/art/artworks/' + encodeURIComponent(name) + '/renders/' + seed, { method: 'DELETE' });
}
export function artRenderUrl(name: string, seed: number): string {
  return '/api/art/' + encodeURIComponent(name) + '/renders/' + seed;
}
export function artAdoptedUrl(name: string): string {
  return '/api/art/' + encodeURIComponent(name);
}

// ---- REQ-0156: generation queue introspection + cancel ----
export interface ArtQueueRunning { renderId: number; artwork: string; seed: number; started_at: number; elapsed_ms: number }
export interface ArtQueuePending { renderId: number; artwork: string; seed: number; enqueued_at: number }
// REQ-0197: held/heldPending -- the deferred-batch gate. Held jobs wait for
// an explicit Execute batch (or hold-off) and are listed apart from live
// pending so the panel can label them.
export interface ArtQueueDto { running: ArtQueueRunning | null; pending: ArtQueuePending[]; heldPending: ArtQueuePending[]; held: boolean; inspectDepth: number }

/** GET /api/art/queue -- running job (with elapsed) + pending generation
 * jobs + inspection backlog depth. Polled by the admin queue panel. */
export function getArtQueue(): Promise<{ ok: true } & ArtQueueDto> {
  return artJson('/api/art/queue', { method: 'GET' });
}
/** Cancel one generation job (pending: dequeued; running: worker killed).
 * The canceled render becomes status failed / 'canceled by user'. */
export function cancelRenderApi(name: string, seed: number): Promise<{ ok: true; canceled: 'pending' | 'running'; renderId: number; seed: number; queue: ArtQueueDto }> {
  return artJson('/api/art/artworks/' + encodeURIComponent(name) + '/renders/' + seed + '/cancel', { method: 'POST' });
}

// ---- REQ-0197: deferred-batch queue controls ----
/** POST /api/art/queue/hold -- gate newly queued generation jobs behind an
 * explicit Execute batch (held=true), or resume auto-run (held=false,
 * releasing everything currently held). */
export function setArtQueueHold(held: boolean): Promise<{ ok: true } & ArtQueueDto> {
  return artJson('/api/art/queue/hold', { method: 'POST', body: JSON.stringify({ held }) });
}
/** POST /api/art/queue/execute -- release every held job, grouped so
 * same-prompt jobs run back to back (text-encoder conditioning reuse). */
export function executeArtQueueBatch(): Promise<{ ok: true; released: number } & ArtQueueDto> {
  return artJson('/api/art/queue/execute', { method: 'POST' });
}

// ---- REQ-0152: inspection kits ----
export interface InspectionCheck { name: string; ok: boolean; value: unknown; threshold: string }
export interface InspectionDto {
  render_id: number; kit_id: string; kit_version: string;
  verdict: 'PASS' | 'WARN' | 'FAIL';
  metrics: Record<string, number>; checks: InspectionCheck[]; notes: string[];
  kit_input_sha256: string | null; ran_at: string;
  stale: boolean; current_version: string | null;
}
export interface KitDto { kit_id: string; kit_version: string; applies_to: string[]; blocking: boolean }

/** Re-run inspection kit(s) for one render. Omit kit_id to run every kit for
 * the kind (also the on-demand path for lazily-inspected backfilled renders). */
export function reinspectRender(name: string, seed: number, kit_id?: string): Promise<{ ok: true; queued: string[]; inspectDepth: number }> {
  return artJson('/api/art/artworks/' + encodeURIComponent(name) + '/renders/' + seed + '/inspect', { method: 'POST', body: JSON.stringify(kit_id ? { kit_id } : {}) });
}

// ---- REQ-0155: content-data registry admin client ----
export interface ContentDefDto {
  id: number; system_name: string; kind: string; brief: string;
  schema_ref: string; gen_config: Record<string, unknown>;
  adopted_variant_id: number | null; artwork_facet?: boolean;
  // REQ-0174: def-level SELECTABLE artwork reference (bare artwork
  // system_name; null = unlinked) + the server's REF-FIRST resolved name
  // (ref artwork -> exact-name match -> null) exposed on def-shaped responses.
  artwork_ref?: string | null; artwork_facet_name?: string | null;
  // REQ-0157 list aggregates (present on GET /api/content/defs rows;
  // additive -- the detail GET keeps the plain REQ-0155 shape)
  adopted_variant_no?: number | null; variant_count?: number; ok_count?: number;
  failed_check_count?: number; last_variant_at?: string | null; has_artwork_facet?: boolean;
}
export interface MachineCheckItem { name: string; ok: boolean; applicable: boolean; detail: string; extra?: { content_live_unchanged?: boolean } }
export interface MachineCheck { overall: 'PASS' | 'FAIL'; checks: MachineCheckItem[]; schema_ref?: string; ran_at?: string }
export interface AgentReview { agent: string | null; model: string | null; verdict: 'recommend' | 'neutral' | 'concern'; rationale: string; reviewed_at?: string }
export interface VariantProvenance { source: 'llm' | 'human_edit'; model: string | null; model_version: string | null; prompt: string | null; params: unknown; seed_if_any: unknown; parent_variant_id: number | null }
export interface ContentVariantDto {
  id: number; content_id: number; variant_no: number; data: Record<string, unknown>;
  data_sha256: string; provenance: VariantProvenance; machine_check: MachineCheck;
  agent_review: AgentReview | null; status: string; created_at: string;
}
export interface ContentCommission { system_name: string; kind: string; brief: string; schema_ref: string; count: number; instructions: string; post_to: string; review_to: string }

function contentJson<T = Record<string, unknown>>(path: string, opts: RequestInit): Promise<T> {
  return artJson<T>(path, opts);
}

export function listContentDefs(): Promise<{ ok: true; defs: ContentDefDto[] }> {
  return contentJson('/api/content/defs', { method: 'GET' });
}
export function createContentDef(b: Record<string, unknown>): Promise<{ ok: true; def: ContentDefDto }> {
  return contentJson('/api/content/defs', { method: 'POST', body: JSON.stringify(b) });
}
export function getContentDef(name: string): Promise<{ ok: true; def: ContentDefDto; variants: ContentVariantDto[]; artwork_facet: boolean }> {
  return contentJson('/api/content/defs/' + encodeURIComponent(name), { method: 'GET' });
}
export function patchContentDef(name: string, b: Record<string, unknown>): Promise<{ ok: true; def: ContentDefDto }> {
  return contentJson('/api/content/defs/' + encodeURIComponent(name), { method: 'PATCH', body: JSON.stringify(b) });
}
export function commissionContent(name: string, count?: number): Promise<{ ok: true; commission: ContentCommission }> {
  return contentJson('/api/content/defs/' + encodeURIComponent(name) + '/commission', { method: 'POST', body: JSON.stringify(count ? { count } : {}) });
}
export function ingestVariants(name: string, variants: Array<{ data: Record<string, unknown>; provenance: Record<string, unknown> }>): Promise<{ ok: true; created: ContentVariantDto[] }> {
  return contentJson('/api/content/defs/' + encodeURIComponent(name) + '/variants', { method: 'POST', body: JSON.stringify({ variants }) });
}
export function reviewVariant(name: string, variantNo: number, b: { verdict: string; rationale: string; agent?: string; model?: string }): Promise<{ ok: true; variant: ContentVariantDto }> {
  return contentJson('/api/content/defs/' + encodeURIComponent(name) + '/variants/' + variantNo + '/review', { method: 'POST', body: JSON.stringify(b) });
}
export function editVariant(name: string, variantNo: number, data: Record<string, unknown>): Promise<{ ok: true; variant: ContentVariantDto; parent_variant_no: number }> {
  return contentJson('/api/content/defs/' + encodeURIComponent(name) + '/variants/' + variantNo + '/edit', { method: 'POST', body: JSON.stringify({ data }) });
}
export function adoptVariantApi(name: string, variantNo: number, override?: boolean): Promise<{ ok: true; def: ContentDefDto; adopted_variant_no: number; override: boolean; export: unknown; export_error: string | null }> {
  return contentJson('/api/content/defs/' + encodeURIComponent(name) + '/adopt', { method: 'POST', body: JSON.stringify({ variant_no: variantNo, override: override === true }) });
}
export function deleteVariantApi(name: string, variantNo: number): Promise<{ ok: true; deleted: number }> {
  return contentJson('/api/content/defs/' + encodeURIComponent(name) + '/variants/' + variantNo, { method: 'DELETE' });
}
/** REQ-0157: re-run the four machine checks on an existing (immutable)
 * variant; the server persists the fresh machine_check annotation and
 * returns the updated variant. */
export function recheckVariantApi(name: string, variantNo: number): Promise<{ ok: true; variant: ContentVariantDto }> {
  return contentJson('/api/content/defs/' + encodeURIComponent(name) + '/variants/' + variantNo + '/recheck', { method: 'POST', body: JSON.stringify({}) });
}
/** Public: adopted-variant metadata (provenance + checks + review) or null
 * (used by the Dex LINK-FIRST adoption-state badge; 404 => no adopted data). */
export async function contentMeta(name: string): Promise<{ ok: true; kind: string; variant_no: number; machine_check: MachineCheck; agent_review: AgentReview | null; provenance: VariantProvenance } | null> {
  const res = await fetch('/api/content/' + encodeURIComponent(name) + '/meta');
  if (!res.ok) return null;
  return res.json();
}
