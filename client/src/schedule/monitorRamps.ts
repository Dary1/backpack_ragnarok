// REQ-0292 P2: the client-side RAMP STORE + evaluator for instance-HUD cooldowns
// and unit-charge fills. PURE (no Pixi import): it holds ramp PARAMETERS captured
// once per state-change event and evaluates a fraction as a function of the
// presentation-time playhead `pt` (ms). MonitorRenderer's persistent Pixi ticker
// evaluates it every frame against the CURRENT pt and paints the overlays; the
// e2e `ramps()` seam reads snapshot() at the same pt.
//
// Two ramp families (P1 wire contract, dto.ts):
//   * COOLDOWN  {pt0, durationMs}   -- a ray_fire that re-arms carries
//     cooldownTicks; durationMs = cooldownTicks * TICK_SECS * 1000. The item
//     overlay / skill-badge sweep shows frac_remaining(pt) =
//     clamp01(1 - (pt - pt0)/durationMs), vanishing at ready. pt0 = the fire's pt
//     (the fire IS the arm, REQ-0263 s6.4).
//   * CHARGE    {pt0, value0, capacity, rate}  -- a unit_charge_* snapshot. For an
//     every_secs charge (rate = counts/sec present) the wedge interpolates
//     value(pt) = value0 + rate*(pt - pt0)/1000; for an event-driven charge
//     (rate absent -> null) the value STEPS at each snapshot (no smooth fill).
//     frac = clamp01(value/capacity).
//
// STATE, not VFX: unlike the transient flashes in monitorFx, ramps MUST be rebuilt
// on a silent replay catch-up/seek (MonitorRenderer captures them regardless of
// the `silent` flag, and reset() clears the store) -- otherwise a scrub would show
// stale or missing cooldowns. The store is the single source of truth; the drawing
// is a pure projection of it at the current pt.

/** TICK_SECS mirrored from sim/lib/core.cjs:105 (`TUNABLES.TICK_SECS: 0.01`), the
 * one tick-duration constant the whole sim derives seconds<->ticks through. Kept
 * as a local mirror the same way monitor/pacingClient.ts mirrors pacing.json --
 * the client never re-derives pacing, it obeys the served ramp params. */
export const TICK_SECS = 0.01;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** cooldownTicks (sim ticks) -> the overlay's duration in presentation ms. */
export function cooldownDurationMs(cooldownTicks: number): number {
  return Math.max(0, cooldownTicks) * TICK_SECS * 1000;
}

export interface CooldownRamp {
  /** presentation time (ms) of the fire that armed this cooldown. */
  pt0: number;
  /** total cooldown span in ms (cooldownTicks * TICK_SECS * 1000). */
  durationMs: number;
}

export interface ChargeRamp {
  /** presentation time (ms) of the snapshot this ramp was captured from. */
  pt0: number;
  /** counter value at pt0. */
  value0: number;
  /** per-instance rolled full mark. */
  capacity: number;
  /** fill rate (counts/sec) for an every_secs charge; null = event-driven step. */
  rate: number | null;
}

export interface RampsSnapshot {
  pt: number;
  cooldowns: Array<{ key: string; frac: number }>;
  charges: Array<{ key: string; value: number; capacity: number; frac: number }>;
}

/** The ramp store. Keys are namespaced by the renderer (`item|<slot>|<src>` and
 * `skill|<srcInst>|<skill>` for cooldowns; `<slot>` for charges) -- the store
 * itself is key-agnostic and only evaluates fractions. */
export class RampStore {
  private cooldowns = new Map<string, CooldownRamp>();
  private charges = new Map<string, ChargeRamp>();

  /** Arm/re-arm a cooldown ramp. Re-firing the same key resets pt0 (the sweep
   * jumps back to full) -- exactly the desired live behaviour. */
  setCooldown(key: string, pt0: number, cooldownTicks: number): void {
    this.cooldowns.set(key, { pt0, durationMs: cooldownDurationMs(cooldownTicks) });
  }

  setCharge(key: string, pt0: number, value0: number, capacity: number, rate: number | null): void {
    this.charges.set(key, {
      pt0,
      value0,
      capacity,
      rate: typeof rate === 'number' && Number.isFinite(rate) ? rate : null,
    });
  }

  hasCooldown(key: string): boolean { return this.cooldowns.has(key); }
  hasCharge(key: string): boolean { return this.charges.has(key); }
  cooldownKeys(): string[] { return Array.from(this.cooldowns.keys()); }
  chargeKeys(): string[] { return Array.from(this.charges.keys()); }
  chargeCapacity(key: string): number { return this.charges.get(key)?.capacity ?? 0; }

  /** clamp01(1 - (pt - pt0)/durationMs). 0 (ready / unknown) is drawn as "no
   * overlay", so an expired or missing ramp naturally vanishes. */
  cooldownFrac(key: string, pt: number): number {
    const r = this.cooldowns.get(key);
    if (!r || r.durationMs <= 0) return 0;
    return clamp01(1 - (pt - r.pt0) / r.durationMs);
  }

  /** Interpolated counter value at pt, clamped to [0, capacity]. */
  chargeValue(key: string, pt: number): number {
    const r = this.charges.get(key);
    if (!r) return 0;
    let v = r.value0;
    if (r.rate != null) v = r.value0 + (r.rate * (pt - r.pt0)) / 1000;
    if (v < 0) return 0;
    if (v > r.capacity) return r.capacity;
    return v;
  }

  chargeFrac(key: string, pt: number): number {
    const r = this.charges.get(key);
    if (!r || !(r.capacity > 0)) return 0;
    return clamp01(this.chargeValue(key, pt) / r.capacity);
  }

  /** Read-only snapshot at `pt` for the __monitorDebug ramps() e2e seam. */
  snapshot(pt: number): RampsSnapshot {
    const cooldowns = this.cooldownKeys().map((key) => ({ key, frac: this.cooldownFrac(key, pt) }));
    const charges = this.chargeKeys().map((key) => ({
      key,
      value: this.chargeValue(key, pt),
      capacity: this.chargeCapacity(key),
      frac: this.chargeFrac(key, pt),
    }));
    return { pt, cooldowns, charges };
  }

  /** Silent-rebuild / reset: drop all ramp state (MonitorRenderer.reset()). */
  clear(): void {
    this.cooldowns.clear();
    this.charges.clear();
  }
}
