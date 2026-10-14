import { useEffect, useState } from '../../vendor/hooks.module.js';
import { t } from '../../../shared/i18n.js';
import { html } from './components.js';
import { researchTileAt } from './rhineDock.js';

/** Board-space coordinates throughout: PrepField maps both picking and highlighting on boss halves. */
export function RemRally({ point, enabled, editable, view, placeCtx, onSet }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!editable || !enabled) setArmed(false); }, [editable, enabled]);
  useEffect(() => {
    if (!view || !enabled || !editable) return undefined;
    const style = { group: 'remRally', color: 0xffcd68, fill: .28, line: 1 };
    const legal = [...(placeCtx?.deploy?.melee || [])].map(k => k.split(',').map(Number));
    view.highlightTiles(armed ? legal : point ? [[point.row, point.col]] : [], style);
    const up = (e) => {
      if (!armed || e.target?.closest?.('.rem-rally')) return;
      const tile = researchTileAt(view, e.clientX, e.clientY);
      if (tile && legal.some(([r, c]) => r === tile.row && c === tile.col)) {
        onSet?.(tile.row, tile.col); setArmed(false);
      }
    };
    const key = e => { if (e.key === 'Escape') setArmed(false); };
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      view.highlightTiles([], style);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, [point, armed, enabled, editable, view, placeCtx, onSet]);
  if (!enabled) return null;
  return html`<section class="rem-rally" data-testid="rem-rally" style="position:absolute;left:16px;top:160px;z-index:20;background:#182329ee;color:#ffe0a0;padding:8px;border:1px solid #8e784e;border-radius:6px;max-width:250px">
    <button type="button" disabled=${!editable} aria-pressed=${armed} onClick=${() => setArmed(!armed)}>
      <img src="/assets/bond/rem.png" alt="" style="width:26px;height:26px;object-fit:contain;vertical-align:middle" /> ${t('雷姆必拓集合点')}
    </button>
    <div>${armed ? t('点击高亮地面设置集合点 · Esc取消') : point ? t('集合点：{row}行 {col}列', point) : t('未设置：援军在蓝门附近集结')}</div>
    <small>${t('准备阶段可改 · 战斗锁定 · 集合点周围2格作战')}</small>
  </section>`;
}
