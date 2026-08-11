// client/src/api/meta.ts -- REQ-0377 item 2: GET /api/health.
//
// A new DOMAIN MODULE rather than a line appended to the api.ts barrel, per
// that barrel's own standing instruction ("EXTEND THE DOMAIN MODULES, NOT THIS
// FILE", REQ-0145b (ca)).
//
// Unauthenticated on purpose: the landing footer renders BEFORE sign-in and
// for a signed-out visitor, and the whole point of the readout is that a
// player who cannot get in can still tell you which build refused them.
import { getJSON } from './http';
import type { ApiHealth } from '../../../shared/dto';

export async function fetchHealth(): Promise<ApiHealth> {
  return getJSON<ApiHealth>('/api/health');
}
