// client/src/dex/adminForm.ts -- REQ-0145b (cd): DexAdmin's form
// model -- the effect-row <-> wire-AST mapping and the ADD button's
// template defaults -- extracted VERBATIM from DexAdmin.tsx, which
// keeps the UI. Server-side validation (server/admin.cjs) remains the
// actual source of truth for every rule these helpers encode.
import type { ApiContentPayload } from '../api';

// Effect form-row shape -- a superset of every verb's optional fields, so
// one form row component covers every verb without a separate component
// per verb type. Fields irrelevant to the selected verb/trigger are
// simply not sent (validateBody on the server only looks at what a given
// trigger/verb actually needs).
export interface EffectRow {
  triggerT: string;
  secsLo: string;
  secsHi: string;
  verbT: string;
  nLo: string;
  nHi: string;
  status: string;
  mult: string;
}

export function numToStr(v: unknown): string {
  return v === undefined || v === null || v === '' ? '' : String(v);
}

export function effectToRow(eff: Record<string, unknown> | undefined): EffectRow {
  const trigger = (eff?.trigger as Record<string, unknown>) || {};
  const verb = (eff?.verb as Record<string, unknown>) || {};
  const s = (trigger.s as unknown[]) || [];
  const n = (verb.n as unknown[]) || [];
  return {
    triggerT: (trigger.t as string) || '',
    secsLo: numToStr(s[0]),
    secsHi: numToStr(s[1]),
    verbT: (verb.t as string) || '',
    nLo: numToStr(n[0]),
    nHi: numToStr(n[1]),
    status: (verb.status as string) || '',
    mult: numToStr(verb.mult),
  };
}

export function rowToEffect(row: EffectRow): Record<string, unknown> {
  const trigger: Record<string, unknown> = { t: row.triggerT };
  if (row.triggerT === 'every_secs') {
    trigger.s = [Number(row.secsLo), Number(row.secsHi)];
  }
  const verb: Record<string, unknown> = { t: row.verbT };
  if (row.nLo !== '' && row.nHi !== '') {
    verb.n = [Number(row.nLo), Number(row.nHi)];
  }
  if (['apply_status', 'add_on_hit_status', 'amp_status'].includes(row.verbT) && row.status) {
    verb.status = row.status;
  }
  if (row.verbT === 'amp_status' && row.mult !== '') {
    verb.mult = Number(row.mult);
  }
  return { trigger, verb };
}

/** REQ-0038: builds a new effect row with sensible defaults for the ADD
 * button's template picker -- trigger defaults to the first vocab
 * trigger, verb to the first vocab verb (both from payload.vocab, the
 * SAME closed-vocabulary lists server/admin.cjs validates against, per
 * the task's "reuse, don't invent a new list" instruction), and a
 * reasonable default numeric range (1-1) so the row is immediately
 * savable without the user having to fill in every field before their
 * first save attempt -- server-side validation still enforces every
 * rule regardless of these defaults. */
export function defaultEffectRow(vocab: ApiContentPayload['vocab']): EffectRow {
  return {
    triggerT: vocab.triggers[0] || 'battle_start',
    secsLo: '1',
    secsHi: '1',
    verbT: vocab.verbs[0] || 'strike',
    nLo: '1',
    nHi: '1',
    status: '',
    mult: '',
  };
}
