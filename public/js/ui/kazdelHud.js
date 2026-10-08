// Kazdel cannon progress is authoritative battle state; the browser never invents charges or a firing timer.
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
import { cannonStates } from '../kazdelState.js';
export { cannonStates } from '../kazdelState.js';

export function cannonModeText(stage) {
  return stage >= 3 ? t('仅伤敌军') : t('敌我均伤 · 亡魂免疫');
}

export function KazdelCannonHud({ states, players = [], gameTime = 0 }) {
  const list = cannonStates(states);
  if (!list.length) return null;
  return html`<aside class="kazdel-cannon-hud" aria-label=${t('卡兹戴尔战争巨炮')}>
    ${list.map(s => {
      const player = players.find(p => p.playerId === s.ownerId || p.id === s.ownerId);
      const warning = s.warning && s.warning.until > gameTime;
      return html`<section class=${`kazdel-cannon${warning ? ' is-warning' : ''}`} key=${s.ownerId} data-cannon-owner=${s.ownerId}>
        <header><img src="/art/kazdel/bond.svg" alt="" /><b>${t('战争巨炮')}</b>${list.length > 1 ? html`<small>${player?.name || s.ownerId}</small>` : null}<span class="num">${s.charge.toFixed(1)}/${s.max}</span></header>
        <div class="kazdel-cannon__bar" role="progressbar" aria-label=${t('战争巨炮充能')} aria-valuemin="0" aria-valuemax=${s.max} aria-valuenow=${s.charge}><i style=${`width:${s.charge / s.max * 100}%`}></i></div>
        <p>${cannonModeText(s.stage)}</p>
        ${warning ? html`<p>${t('九宫格轰击预警 · {seconds}秒', { seconds: Math.max(0, s.warning.until - gameTime).toFixed(1) })}</p>` : null}
      </section>`;
    })}
  </aside>`;
}
