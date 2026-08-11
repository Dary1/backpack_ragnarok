// client/src/dex/Glossary.tsx -- REQ-0376. The Dex's "Terms" tab: the closed
// vocabulary in one sentence each, then the dry-rules block.
//
// WHY THE DEX. The Dex is already the reference surface -- the place a player
// goes to look something up rather than to act -- so the glossary belongs
// beside the catalogs rather than in Settings or a help modal. It is a peer tab
// of Items/Units/Monsters/Gimics and coexists with the draft REQ-0227/0228 dex
// plans: it adds a tab and touches no existing one.
//
// WHY IT IS STATIC. Every string here is CHROME i18n (src/i18n/guide.ts, via
// the barrel), NOT content i18n: these are the names of engine concepts, not of
// authored entities, so no content-pipeline locale field is involved and
// /api/content is never consulted. That also makes the tab render complete with
// no payload, which is why it sits outside the Items tab's data plumbing.
//
// SOURCES (PROJECT.md: cite engine code for any convention -- these sentences
// are transcriptions, not paraphrases from memory):
//   Canvas/BP/PO/SI/Unit/Link  docs/user_managed/canvas_spec.md
//   Squad/Troop/Unit naming    docs/user_managed/terminology_unit_squad.md
//   TM dual-use, no coin       docs/user_managed/economy.md
//   LRDST                      docs/REQ/done/REQ-0042-workshop-gacha-lrdst.md
//   auto-repeat                server/services/runs.cjs maybeAutoStartNextRun
//   random draw                server/services/rooms.cjs drawDungeonId (REQ-0304)
//   7-day decay / 200 cap      server/services/core.cjs WAREHOUSE_TTL_MS,
//                              shared/constants.json WAREHOUSE_CAP,
//                              server/services/warehouse.cjs (expiry dismantles)
//   8% burn                    server/services/market/lib.cjs MARKET_BURN_RATE
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import type { Locale } from '../store';

// Ordered as the game teaches them: the placement stack outward-in (Canvas ->
// BP -> PO -> SI), then the Unit and what it does, then the deployment units,
// then money. Same order the canvas tour reveals its layers in.
const TERM_IDS = [
  'canvas', 'bp', 'po', 'si', 'unit', 'connshape', 'link', 'squad', 'troop', 'tm', 'lrdst',
] as const;

const RULE_IDS = [
  'autorepeat', 'draw', 'decay', 'burn', 'finality', 'currency',
] as const;

function Row({ locale, nameKey, descKey, testId }: {
  locale: Locale; nameKey: TranslationKey; descKey: TranslationKey; testId: string;
}) {
  return (
    <div className="dex-glossary-row" data-testid={testId}>
      <dt className="dex-glossary-term">{t(locale, nameKey)}</dt>
      <dd className="dex-glossary-desc">{t(locale, descKey)}</dd>
    </div>
  );
}

export function Glossary({ locale }: { locale: Locale }) {
  return (
    <div className="dex-glossary" data-testid="dex-glossary">
      <section className="dex-glossary-section" data-testid="dex-glossary-terms">
        <h2 className="dex-glossary-heading dj">{t(locale, 'guide.glossary.termsHeading')}</h2>
        <p className="dex-glossary-lede">{t(locale, 'guide.glossary.termsLede')}</p>
        <dl className="dex-glossary-list">
          {TERM_IDS.map((id) => (
            <Row
              key={id}
              locale={locale}
              nameKey={`guide.glossary.term.${id}.name` as TranslationKey}
              descKey={`guide.glossary.term.${id}.desc` as TranslationKey}
              testId={`dex-glossary-term-${id}`}
            />
          ))}
        </dl>
      </section>
      <section className="dex-glossary-section" data-testid="dex-glossary-rules">
        <h2 className="dex-glossary-heading dj">{t(locale, 'guide.glossary.rulesHeading')}</h2>
        <p className="dex-glossary-lede">{t(locale, 'guide.glossary.rulesLede')}</p>
        <dl className="dex-glossary-list">
          {RULE_IDS.map((id) => (
            <Row
              key={id}
              locale={locale}
              nameKey={`guide.glossary.rule.${id}.name` as TranslationKey}
              descKey={`guide.glossary.rule.${id}.desc` as TranslationKey}
              testId={`dex-glossary-rule-${id}`}
            />
          ))}
        </dl>
      </section>
    </div>
  );
}
