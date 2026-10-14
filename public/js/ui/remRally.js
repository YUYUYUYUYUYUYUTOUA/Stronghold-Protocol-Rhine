import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { t } from '../../../shared/i18n.js';
import { html } from './components.js';
import { researchTileAt } from './rhineDock.js';

/** Board-space picking stays independent of the movable screen-space control. */
export function RemRally({ point, enabled, editable, view, placeCtx, contextKey, onSet }) {
  const [armed, updateArmed] = useState(false);
  const armedRef = useRef(false);
  const setArmed = value => { armedRef.current=value; updateArmed(value); };
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState({ x:16, y:160 });
  const root = useRef(null), drag = useRef(null);
  const clamp = (p) => {
    const el = root.current, parent = el?.offsetParent;
    if (!el || !parent) return p;
    const bounds = parent.getBoundingClientRect();
    const vp=window.visualViewport, left=vp?.offsetLeft||0, top=vp?.offsetTop||0;
    const width = Math.min(parent.clientWidth, left+(vp?.width||window.innerWidth)-bounds.left);
    const height = Math.min(parent.clientHeight, top+(vp?.height||window.innerHeight)-bounds.top);
    return { x:Math.max(0,left-bounds.left,Math.min(p.x,width-el.offsetWidth)), y:Math.max(0,top-bounds.top,Math.min(p.y,height-el.offsetHeight)) };
  };
  const stopDrag = () => {
    const d = drag.current; drag.current = null;
    if (d?.handle.hasPointerCapture?.(d.id)) d.handle.releasePointerCapture(d.id);
  };
  useLayoutEffect(() => { setArmed(false); stopDrag(); }, [editable, enabled, view, contextKey, placeCtx?.field]);
  useLayoutEffect(() => {
    if (!enabled || !root.current) return undefined;
    const fit = () => setPosition(p => { const next=clamp(p); return p.x===next.x&&p.y===next.y?p:next; });
    const observer = new ResizeObserver(fit);
    observer.observe(root.current);
    if (root.current.offsetParent) observer.observe(root.current.offsetParent);
    window.addEventListener('resize',fit);
    window.visualViewport?.addEventListener('resize',fit);
    window.visualViewport?.addEventListener('scroll',fit); fit();
    return () => { observer.disconnect(); window.removeEventListener('resize',fit);
      window.visualViewport?.removeEventListener('resize',fit); window.visualViewport?.removeEventListener('scroll',fit); stopDrag(); };
  }, [enabled]);
  useEffect(() => {
    if (!view || !enabled) return undefined;
    const style = { group: 'remRally', color: 0xffcd68, fill: .28, line: 1 };
    const legal = [...(placeCtx?.deploy?.melee || [])].map(k => k.split(',').map(Number));
    view.highlightTiles(collapsed || !editable ? [] : armed ? legal : point ? [[point.row, point.col]] : [], style);
    const up = (e) => {
      if (!armedRef.current || collapsed || drag.current || e.target?.closest?.('.rem-rally')) return;
      const tile = researchTileAt(view, e.clientX, e.clientY);
      if (tile && legal.some(([r, c]) => r === tile.row && c === tile.col)) {
        onSet?.(tile.row, tile.col); setArmed(false);
      }
    };
    const key = e => { if (e.key === 'Escape') { setArmed(false); stopDrag(); } };
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      view.highlightTiles([], style);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, [point, armed, collapsed, enabled, editable, view, placeCtx, onSet]);
  if (!enabled) return null;
  const down = e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault(); e.stopPropagation(); setArmed(false);
    drag.current = { id:e.pointerId, x:e.clientX, y:e.clientY, origin:position, handle:e.currentTarget };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = e => {
    const d=drag.current; if (!d || d.id!==e.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    setPosition(clamp({x:d.origin.x+e.clientX-d.x,y:d.origin.y+e.clientY-d.y}));
  };
  const keyboardMove = e => {
    const delta = {ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[e.key];
    if (!delta || e.target !== e.currentTarget) return;
    e.preventDefault(); e.stopPropagation(); setPosition(p=>clamp({x:p.x+delta[0],y:p.y+delta[1]}));
  };
  return html`<section ref=${root} class="rem-rally" data-testid="rem-rally"
    onPointerDown=${e=>e.stopPropagation()} onPointerUp=${e=>e.stopPropagation()} onClick=${e=>e.stopPropagation()}
    style=${{position:'absolute',left:position.x,top:position.y,zIndex:20,background:'#182329ee',color:'#ffe0a0',padding:8,border:'1px solid #8e784e',borderRadius:6,width:'min(250px, calc(100% - 18px))',maxHeight:'100%',overflowY:'auto',boxSizing:'border-box'}}>
    <header data-testid="rem-rally-drag" tabIndex="0" aria-label=${t('移动集合点窗口')}
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${stopDrag} onPointerCancel=${stopDrag} onLostPointerCapture=${stopDrag} onKeyDown=${keyboardMove}
      style="display:flex;align-items:center;gap:8px;cursor:move;touch-action:none;user-select:none">
      <img src="/assets/bond/rem.png" alt="" draggable="false" style="width:26px;height:26px;object-fit:contain" />
      <strong>${t('雷姆必拓集合点')}</strong>
      <button type="button" data-testid="rem-rally-collapse" aria-expanded=${!collapsed} aria-label=${collapsed?t('展开集合点'):t('收起集合点')}
        onClick=${()=>{setArmed(false);stopDrag();setCollapsed(!collapsed);}} style="margin-left:auto">${collapsed?'+':'−'}</button>
    </header>
    ${collapsed ? null : html`<div data-testid="rem-rally-body">
      <button type="button" data-testid="rem-rally-set" disabled=${!editable} aria-pressed=${armed} onClick=${()=>setArmed(!armed)}>${t('雷姆必拓集合点')}</button>
      <div>${armed ? t('点击高亮地面设置集合点 · Esc取消') : point ? t('集合点：{row}行 {col}列', point) : t('未设置：援军在蓝门附近集结')}</div>
      <small>${t('准备阶段可改 · 战斗锁定 · 集合点周围2格作战')}</small>
    </div>`}
  </section>`;
}
