// client/src/warehouse/TtlRing.tsx -- REQ-0145b (cd): extracted
// verbatim from WarehousePage.tsx (presentation-only component; the
// page keeps its call sites unchanged).
/** REQ-0072: the mock's Joermungandr TTL ring (mock .cring) -- an SVG
 * donut whose arc is the row's REMAINING share of its OWN lifetime
 * (expiresAt - harvestedAt), so the percentage stays honest even if the
 * server-side TTL constant ever changes: no 7-day literal is baked in
 * here. Geometry mirrors the mock exactly: pathLength=100 dasharray arc
 * from 12 o'clock, end-of-arc dot at (20 + 15·sin θ, 20 − 15·cos θ). */
export function TtlRing({ pct, danger, label }: { pct: number; danger: boolean; label: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const theta = (clamped / 100) * 2 * Math.PI;
  const dotX = 20 + 15 * Math.sin(theta);
  const dotY = 20 - 15 * Math.cos(theta);
  const stroke = danger ? '#D14B44' : 'var(--gold-lo)';
  const dot = danger ? '#E06B5F' : 'var(--gold-hi)';
  return (
    <svg className="schedule-warehouse-ring" viewBox="0 0 40 40" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="20" cy="20" r="15" fill="none" stroke="rgba(233,227,211,.1)" strokeWidth="3" />
      <circle
        cx="20"
        cy="20"
        r="15"
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        pathLength={100}
        strokeDasharray={`${clamped} ${100 - clamped}`}
        strokeLinecap="round"
        transform="rotate(-90 20 20)"
      />
      <circle cx={dotX} cy={dotY} r="2.6" fill={dot} />
      <text x="20" y="23.5" textAnchor="middle">
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}
