'use strict';
// server/lib/humanize.cjs -- REQ-0047 (c): replay-event -> human text line
// (REQ-0045 (g) ?format=text). Moved VERBATIM from server/api.cjs.
function humanizeEventText(ev) {
  const t = typeof ev.t === 'number' ? ev.t.toFixed(2) : '?';
  const cellStr = (c) => (Array.isArray(c) ? '[' + c[0] + ',' + c[1] + ']' : String(c));
  switch (ev.ev) {
    case 'encounter_start':
      return 't=' + t + 's  encounter #' + ev.enc + ' starts (' + ev.kind + ', formation ' + ev.formation + ')';
    case 'telegraph':
      return 't=' + t + 's  telegraph: ' + ev.src + ' winds up ' + ev.skill + ' from the ' + ev.edge + ' edge (fires at t=' + (typeof ev.fires_at === 'number' ? ev.fires_at.toFixed(2) : '?') + 's)';
    case 'ray_fire':
      return 't=' + t + 's  ray fired by ' + ev.src + ' into the ' + ev.field + ' field, entering at ' + cellStr(ev.entry);
    case 'ray_step':
      return 't=' + t + 's  ray travels through ' + (Array.isArray(ev.path) ? ev.path.length : '?') + ' cell(s)';
    case 'ray_bounce':
      return 't=' + t + 's  ray bounces at ' + cellStr(ev.at) + ' (new dir ' + ev.new_dir + ', bounce #' + ev.bounce + ')';
    case 'ray_hit':
      return 't=' + t + 's  HIT: ' + ev.dst + ' takes ' + ev.amount + ' dmg (hp after: ' + ev.hp_after + ')';
    case 'ray_aoe': {
      const hits = Array.isArray(ev.hits) ? ev.hits : [];
      const hitList = hits.map((h) => h.dst + ':' + h.amount).join(', ');
      return 't=' + t + 's  AOE at ' + cellStr(ev.center) + ' (radius ' + ev.radius + '): ' + (hitList || 'no targets');
    }
    case 'ray_hit_all': {
      const hits = Array.isArray(ev.hits) ? ev.hits : [];
      const hitList = hits.map((h) => h.dst + ':' + h.amount).join(', ');
      return 't=' + t + 's  HIT ALL (whole field): ' + (hitList || 'no targets');
    }
    case 'reflect_damage':
      return 't=' + t + 's  reflect: ' + ev.dst + ' takes ' + ev.amount + ' reflected dmg';
    case 'progress':
      return 't=' + t + 's  progress: encounter #' + ev.enc + ' -> ' + ev.pct + '%';
    case 'shortcut':
      return 't=' + t + 's  shortcut: encounter #' + ev.enc + ' grants +' + (typeof ev.jump_pct === 'number' ? ev.jump_pct.toFixed(1) : ev.jump_pct) + '% (now ' + ev.pct_after + '%)';
    case 'run_end':
      return 't=' + t + 's  RUN END: ' + String(ev.result).toUpperCase() + ' at ' + ev.final_pct + '% progress';
    default:
      return 't=' + t + 's  ' + ev.ev + '  ' + JSON.stringify(ev);
  }
}


module.exports = { humanizeEventText };
