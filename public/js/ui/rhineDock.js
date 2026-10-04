import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { boardTargets } from './gameLogic.js';
import { GEO } from '../../../shared/constants.js';
import { RHINE_DEVICES, RHINE_BALANCE, rhineAttack } from '../../../shared/rhineResearch.js';
import { researchRange, researchRangeText } from '../../../shared/rhineRange.js';
import { showRange } from './facingWheel.js';

export function containsPoint(poly, x, y) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function researchTileAt(view, x, y) {
  for (let row = GEO.FIELD.r0; row <= GEO.FIELD.r1; row++) {
    for (let col = GEO.FIELD.c0; col <= GEO.FIELD.c1; col++) {
      const tile = view?.tileScreen?.(row, col);
      if (tile && containsPoint(tile.poly, x, y)) return { area: 'board', row, col };
    }
  }
  return null;
}

export function researchProgress(points = 0, stage = 0) {
  const goal = RHINE_BALANCE.breakthroughPoints[stage];
  return goal == null ? '阶段突破已完成' : `研究 ${points}/${goal} · 成功+${RHINE_BALANCE.successPoints} / 失败+${RHINE_BALANCE.failurePoints}`;
}

/** Three reserved bench slots. Pointer dragging and click-then-place work in either renderer. */
export function RhineDock({ research, editable, view, placeCtx, onDeploy, onRecall, onDetail }) {
  const [armed, setArmed] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { if (!editable || !placeCtx?.pieces?.has(armed)) setArmed(null); }, [editable, placeCtx, armed]);
  useEffect(() => {
    if (armed == null || !editable || !view) return undefined;
    const { legal } = boardTargets(placeCtx, armed);
    const style = { group: 'research', color: 0x6fe8c1, fill: 0.18, line: 0.8 };
    view.highlightTiles(legal, style);
    const piece = placeCtx.pieces.get(armed)?.piece;
    const status = research?.devices?.find(d => d.uid === armed);
    const range = researchRange({ ...piece, stage: status?.stage ?? piece?.stage });
    const previewStyle = { group: 'researchPreview', color: 0xff9c33, fill: .36, line: 1 };
    const move = (e) => {
      const tile = researchTileAt(view, e.clientX, e.clientY);
      if (range && tile && legal.some(([r,c])=>r===tile.row && c===tile.col)) {
        showRange(view, range.grid, tile.row, tile.col, 'RIGHT', previewStyle, range.radius);
      } else view.highlightTiles([], previewStyle);
    };
    const up = (e) => {
      if (e.target?.closest?.('.rhine-dock')) return;
      const tile = researchTileAt(view, e.clientX, e.clientY);
      if (tile) { onDeploy?.(armed, tile); setArmed(null); }
    };
    const key = (e) => { if (e.key === 'Escape') setArmed(null); };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointermove', move);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerup', up); window.removeEventListener('keydown', key);
      window.removeEventListener('pointermove', move);
      view.highlightTiles([], style);
      view.highlightTiles([], previewStyle);
    };
  }, [armed, editable, view, placeCtx, onDeploy, research]);
  if (!research?.unlocked) return null;
  const deployed = (research.devices || []).filter(d => d.onBoard).length;
  return html`<section class=${`rhine-dock${collapsed ? ' is-collapsed' : ''}${armed != null ? ' is-placing' : ''}`} aria-label="莱茵生命科研备牌区" data-testid="rhine-dock">
    <header><b>莱茵生命 · 联合科研</b><span>盟约 ${research.layers || 0} 层 · 部署 ${deployed}/${research.capacity || 0}</span>
      <button type="button" aria-label=${collapsed ? '展开科研装置' : '收起科研装置'} onClick=${() => setCollapsed(!collapsed)}>${collapsed ? '+' : '−'}</button></header>
    ${collapsed ? null : html`<div class="rhine-dock__cards">${RHINE_DEVICES.map((def, index) => {
      const status = research.devices?.find(d => d.key === def.key) || {};
      const piece = research.hand?.[index];
      const uid = status.uid ?? piece?.uid;
      const canDeploy = editable && research.capacity > deployed && !status.onBoard && uid != null;
      const stage = status.stage || 0;
      const range = researchRange({ id: def.tokenId, stage });
      return html`<article key=${def.key} class=${`rhine-card${armed === uid ? ' is-armed' : ''}${status.onBoard ? ' is-deployed' : ''}`} style=${`--research-color:${def.color}`} data-research=${def.key}>
        <button type="button" class="rhine-card__select" disabled=${!canDeploy} aria-label=${`部署${def.name}`} title=${def.description}
          onPointerDown=${() => { if (canDeploy) setArmed(uid); }} onClick=${() => { if (canDeploy) setArmed(uid); }}>
          <img src=${def.sprite || def.icon} alt="" draggable="false" /><strong>${def.name}</strong><small>${['原型', '改良型', '成熟型'][stage]}</small>
        </button>
        <div class="rhine-card__stats">攻击 ${Math.round(status.attack ?? rhineAttack(research.layers))}${status.onBoard ? ' · 已部署' : ''}</div>
        <div class="rhine-card__range" title=${researchRangeText({id:def.tokenId,stage})}>范围 ${range.grid.length} 格 · 半径 ${range.radius}${def.key==='energy' && stage>=1 ? ` · 溅射 ${RHINE_BALANCE.energySpreadRadius}` : ''}</div>
        <div class="rhine-card__progress" title="每阶段需要5点；突破后研究点清零，溢出不保留。">${researchProgress(status.points || 0, stage)}</div>
        <div class="rhine-card__next">${stage < 2 ? `下次：${def.breakthroughs[stage]}` : def.breakthroughs.join(' · ')}</div>
        <div class="rhine-card__actions"><button type="button" onClick=${() => uid != null && onDetail?.(uid)}>详情</button>
          ${status.onBoard ? html`<button type="button" disabled=${!editable} onClick=${() => onRecall?.(uid)}>收回</button>` : null}</div>
      </article>`;
    })}</div><p class="rhine-dock__hint">${armed != null ? '点击高亮格或拖动到棋盘部署 · Esc取消' : research.capacity ? '3人可部署1台，6人可部署2台，9人可部署3台 · 科研位不占普通备牌格' : '莱茵生命未激活，装置停机；研究成果已保留'}</p>`}
  </section>`;
}
