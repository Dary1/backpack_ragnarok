// client/src/sortie/AdvancedFold.tsx -- REQ-0239 (design 01 sec 4/5): the
// disclosure for plumbing (cancel policy / dev seed / visibility). Consequence
// (dungeon, squads) gets art; plumbing gets THIS fold (design 00 P-A). Cancel
// policy DEFAULTS to deferred; immediate is a destructive opt-in with warning
// copy (design 01 sec 8, bug #6).
import { useState } from 'react';
import { t } from '../i18n';
import type { Locale } from '../store';

export interface SortieAdvanced {
  cancelImmediate: boolean;
  genSeed: string;
}

interface AdvancedFoldProps {
  locale: Locale;
  isAdmin: boolean;
  value: SortieAdvanced;
  onChange: (next: SortieAdvanced) => void;
}

export function AdvancedFold({ locale, isAdmin, value, onChange }: AdvancedFoldProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`sortie-advanced${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="sortie-advanced-toggle den"
        aria-expanded={open}
        data-testid="sortie-advanced-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sortie-advanced-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        {t(locale, 'sortie.adv.toggle')}
      </button>
      {open ? (
        <div className="sortie-advanced-body">
          <fieldset className="sortie-advanced-field">
            <legend className="den">{t(locale, 'sortie.adv.cancelPolicy')}</legend>
            <label className="sortie-advanced-radio">
              <input
                type="radio"
                name="sortie-cancel"
                checked={!value.cancelImmediate}
                onChange={() => onChange({ ...value, cancelImmediate: false })}
              />
              {t(locale, 'sortie.adv.cancelAfterRun')}
            </label>
            <label className="sortie-advanced-radio is-destructive">
              <input
                type="radio"
                name="sortie-cancel"
                data-testid="sortie-cancel-immediate"
                checked={value.cancelImmediate}
                onChange={() => onChange({ ...value, cancelImmediate: true })}
              />
              {t(locale, 'sortie.adv.cancelImmediate')}
            </label>
          </fieldset>

          {isAdmin ? (
            <label className="sortie-advanced-field">
              <span className="den">{t(locale, 'sortie.adv.seed')}</span>
              <input
                className="sortie-advanced-seed"
                data-testid="sortie-seed-input"
                type="text"
                value={value.genSeed}
                placeholder={t(locale, 'sortie.adv.seedPlaceholder')}
                onChange={(e) => onChange({ ...value, genSeed: e.target.value })}
              />
            </label>
          ) : null}

          <div className="sortie-advanced-field">
            <span className="den">{t(locale, 'sortie.adv.visibility')}</span>
            <span className="chip sortie-advanced-visibility">{t(locale, 'sortie.adv.visibilitySelf')}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
