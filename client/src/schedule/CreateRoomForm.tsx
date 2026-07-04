// Create-room form -- REQ-0036 P1-C. Dungeon select (fetched via GET
// /api/schedule/dungeons), level input, formation select, cancel-policy
// toggle, visibility fixed to "self" (P1 scope -- rendered as a
// disabled/label-only field, never a real selector: golden c's other
// visibility levels are P2+ and the server always forces
// visibility:"self" regardless of what a client sends).
import { useEffect, useState } from 'react';
import type { ApiCreateRoomBody, ApiDungeonsPayload } from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';

interface CreateRoomFormProps {
  locale: Locale;
  dungeons: ApiDungeonsPayload | null;
  creating: boolean;
  onCreate: (body: ApiCreateRoomBody) => void | Promise<void>;
}

function localizedName(locale: Locale, entry: { id: string; name: string; i18n?: Record<string, { name?: string }> }): string {
  if (locale === 'ja' && entry.i18n?.ja?.name) return entry.i18n.ja.name;
  return entry.name;
}

export function CreateRoomForm({ locale, dungeons, creating, onCreate }: CreateRoomFormProps) {
  const [dungeonId, setDungeonId] = useState('');
  const [level, setLevel] = useState(1);
  const [formationId, setFormationId] = useState('');
  const [cancelImmediate, setCancelImmediate] = useState(true);

  // Default the selects to the first available entry once dungeons load
  // (avoids submitting an empty string on a fast "click create right
  // away" flow).
  useEffect(() => {
    if (dungeons && dungeons.dungeons.length > 0 && !dungeonId) setDungeonId(dungeons.dungeons[0].id);
    if (dungeons && dungeons.formations.length > 0 && !formationId) setFormationId(dungeons.formations[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dungeons]);

  if (!dungeons) {
    return <div className="schedule-loading">{t(locale, 'schedule.loading')}</div>;
  }

  const handleSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    if (!dungeonId) return;
    void onCreate({
      dungeonId,
      level,
      formationId: formationId || undefined,
      cancelPolicy: { immediate: cancelImmediate },
    });
  };

  return (
    <form className="schedule-create-form" onSubmit={handleSubmit}>
      <label className="schedule-field">
        <span className="schedule-field-label">{t(locale, 'schedule.dungeonLabel')}</span>
        <select
          className="schedule-select"
          value={dungeonId}
          onChange={(e) => setDungeonId(e.target.value)}
          data-testid="schedule-dungeon-select"
        >
          {dungeons.dungeons.map((d) => (
            <option key={d.id} value={d.id}>
              {localizedName(locale, d)}
            </option>
          ))}
        </select>
      </label>

      <label className="schedule-field">
        <span className="schedule-field-label">{t(locale, 'schedule.levelLabel')}</span>
        <input
          className="schedule-input"
          type="number"
          min={1}
          value={level}
          onChange={(e) => setLevel(Math.max(1, parseInt(e.target.value, 10) || 1))}
          data-testid="schedule-level-input"
        />
      </label>

      <label className="schedule-field">
        <span className="schedule-field-label">{t(locale, 'schedule.formationLabel')}</span>
        <select
          className="schedule-select"
          value={formationId}
          onChange={(e) => setFormationId(e.target.value)}
          data-testid="schedule-formation-select"
        >
          {dungeons.formations.map((f) => (
            <option key={f.id} value={f.id}>
              {localizedName(locale, f)}
            </option>
          ))}
        </select>
      </label>

      <div className="schedule-field">
        <span className="schedule-field-label">{t(locale, 'schedule.visibilityLabel')}</span>
        <span className="schedule-visibility-fixed" data-testid="schedule-visibility-fixed">
          {t(locale, 'schedule.visibilitySelfOnly')}
        </span>
      </div>

      <label className="schedule-field">
        <span className="schedule-field-label">{t(locale, 'schedule.cancelPolicyLabel')}</span>
        <select
          className="schedule-select"
          value={cancelImmediate ? 'immediate' : 'after'}
          onChange={(e) => setCancelImmediate(e.target.value === 'immediate')}
          data-testid="schedule-cancel-policy-select"
        >
          <option value="immediate">{t(locale, 'schedule.cancelPolicyImmediate')}</option>
          <option value="after">{t(locale, 'schedule.cancelPolicyAfterRun')}</option>
        </select>
      </label>

      <button type="submit" className="schedule-create-btn" disabled={creating || !dungeonId} data-testid="schedule-create-submit">
        {creating ? t(locale, 'schedule.creating') : t(locale, 'schedule.createButton')}
      </button>
    </form>
  );
}
