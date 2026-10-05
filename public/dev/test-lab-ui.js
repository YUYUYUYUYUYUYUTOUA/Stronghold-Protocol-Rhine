import { RHINE_DEVICES } from '../../shared/rhineResearch.js';
import { resolveRecordLoadout, loadoutRecord } from '../../shared/loadoutRecord.js';
import { FX_KINDS } from '../js/render/fx.js';

const STORE_KEY = 'stronghold.test-lab.scenario.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => String(value ?? '').replace(/<[@$][^>]*>|<\/>/g, '').replace(/<([^<>]+)>/g, '$1');
const entries = table => Object.entries(table || {});
const label = (text, id, content) => `<label class="lab-control" for="${id}">${text}${content}</label>`;
const select = (text, id) => label(text, id, `<select id="${id}"></select>`);
const number = (text, id, min = 0, max = '', step = 1) => label(text, id, `<input id="${id}" type="number" min="${min}" ${max === '' ? '' : `max="${max}"`} step="${step}">`);
const search = (text, id) => label(text, id, `<input id="${id}" type="search" placeholder="输入名称或 ID" autocomplete="off">`);
const button = (id, text, cls = '') => `<button id="${id}" type="button" class="${cls}">${text}</button>`;
const section = (title, content, open = false) => `<details class="lab-section" ${open ? 'open' : ''}><summary>${title}</summary><div class="lab-section-body">${content}</div></details>`;

export function formatLabStats(stats) {
  if (!stats) return '';
  const n = key => Number.isFinite(Number(stats[key])) ? Number(stats[key]) : 0;
  const performance = Number.isFinite(stats.fps) ? `${Math.round(stats.fps)} FPS` : 'FPS —';
  return `伤害 ${Math.round(n('damage')).toLocaleString('zh-CN')} · 击杀 ${n('killed')}/${n('total')} · 错误 ${n('errors')}\n${performance}${Number.isFinite(stats.particles) ? ` · 粒子 ${stats.particles}` : ''}`;
}

/** Human-readable data descriptions; all returned text is inserted as text, never executable HTML. */
export function describeLabUnit(record, loadout, records, bonds = []) {
  if (!record) return '请选择场上的干员、装置或敌人。';
  const resolved = loadoutRecord(record, resolveRecordLoadout(record, loadout));
  const lines = [record.name || record.tokenId || record.key || record.chessId || '单位'];
  if (resolved.skill) {
    const s = resolved.skill;
    lines.push(`【技能】${s.name || s.skillId || '无'}${s.level ? ` · Lv.${s.level}` : ''}`, plain(s.desc || '暂无技能说明'));
    if (s.spCost != null) lines.push(`初始技力 ${s.initSp ?? 0} / 消耗 ${s.spCost}${s.duration > 0 ? ` · 持续 ${s.duration} 秒` : ''}`);
  }
  if (!resolved.skill) for (const s of record.skills || []) if (s.desc || s.name) lines.push(`【技能】${s.name || s.skillId || s.key || ''}`, plain(s.desc));
  if (resolved.trait) lines.push('【特性】', plain(resolved.trait.desc), plain(resolved.trait.moduleDesc));
  for (const t of Array.isArray(resolved.talents) ? resolved.talents : []) if (!t.hidden) lines.push(`【天赋】${t.name || ''}`, plain(t.desc));
  for (const id of record.garrisonIds || []) {
    const g = records.garrisons?.[id];
    if (g) lines.push('【协议特质】', plain(g.desc));
  }
  if (record.modules?.length) {
    const id = resolved.module?.active ? resolved.module.id : null;
    const m = record.modules.find(x => x.uniEquipId === id);
    lines.push('【模组】', m ? `${m.typeName || ''} ${m.name || id} · Lv.${m.level || 1}` : '未装备');
    if (m) {
      if (m.attr) lines.push(Object.entries(m.attr).map(([k,v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(' / '));
      if (m.desc) lines.push(plain(m.desc));
      if (m.traitOverride?.moduleDesc) lines.push(plain(m.traitOverride.moduleDesc));
    }
  }
  if (record.desc) lines.push('【说明】', plain(record.desc));
  const ids = [...new Set([...(record.bonds || []), ...bonds.map(b => b.id ?? b.bondId)])];
  for (const id of ids) {
    const b = records.bonds?.[id], live = bonds.find(x => (x.id ?? x.bondId) === id);
    if (b) lines.push(`【盟约】${b.name || id}${live ? ` · ${live.count} 人 / ${live.layers} 层${live.active ? ' / 生效' : ' / 未激活'}` : ''}`, plain(b.desc));
  }
  return lines.filter(Boolean).join('\n');
}

/** Mount only the tools: the controller owns the real render host and all simulation state. */
export function mountLabUI({ root, controller, records = {} }) {
  if (!root || !controller) throw new Error('测试台缺少工具面板或控制器');
  const doc = root.ownerDocument, win = doc.defaultView;
  const abort = new AbortController();
  let state = { scenario: controller.scenario, selectedUid: null, playing: false, time: 0, speed: 1 };
  let tables = controller.records || records, lastScenario = '', lastSelected = Symbol('initial'), lastTables;
  let notice = '', localError = '', busy = false, animationRequest = 0;
  let animationSignature = '', animationUid = Symbol('initial');
  const $ = id => root.querySelector(`#${id}`);
  const listen = (el, event, fn) => el?.addEventListener(event, fn, { signal: abort.signal });
  const put = (id, value) => { const el = $(id); if (el && el.textContent !== String(value ?? '')) el.textContent = value ?? ''; };
  const options = (el, rows, value) => {
    const wanted = value ?? el.value;
    el.replaceChildren(...rows.map(([id, text]) => { const o = doc.createElement('option'); o.value = String(id); o.textContent = text; return o; }));
    if (rows.some(([id]) => String(id) === String(wanted))) el.value = String(wanted);
  };
  const value = id => $(id).value;
  const numeric = (id, fallback = 0) => {
    const input = $(id), n = input.value.trim() === '' ? fallback : Number(input.value);
    if (!Number.isFinite(n) || !input.checkValidity()) throw new Error(`${input.labels?.[0]?.firstChild?.textContent || id}：请输入有效范围内的数字`);
    return n;
  };
  const scenario = () => state.scenario || controller.scenario;
  const unit = () => scenario()?.units?.find(u => String(u.uid) === String(state.selectedUid));
  const enemy = () => scenario()?.enemies?.find(u => String(u.uid) === String(state.selectedUid));
  const nextUid = () => Math.max(0, ...[...(scenario()?.units || []), ...(scenario()?.enemies || [])].map(u => Number(u.uid)).filter(Number.isFinite)) + 1;
  const recOf = id => tables.chess?.[id] || tables.tokens?.[id];
  const recordId = () => {
    const base = tables.chess?.[value('lab-unit-kind')];
    return base && value('lab-quality') === 'elite' && tables.chess?.[base.goldenId] ? base.goldenId : value('lab-unit-kind');
  };
  const matches = (rec, id, text) => `${rec.name || ''} ${rec.appellation || ''} ${id}`.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase());

  root.innerHTML = `<div class="lab-toolbar">
    <div class="lab-toolbar-row">${button('lab-start','开始','primary')}${button('lab-pause','暂停')}${button('lab-step','单步')}${button('lab-reset','重置')}
    <select id="lab-speed" aria-label="播放速度"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></div>
    <div class="lab-status"><span id="lab-run-status">等待场景</span><output id="lab-clock">0.00 秒</output></div>
    <p id="lab-battle-stats" class="lab-small"></p>
    <p id="lab-message" class="lab-message" role="status" aria-live="polite"></p>
    <p class="lab-reset-note">应用配置将重置并暂停战斗；播放与单步使用真实模拟。</p>
  </div>
  ${section('场景与地图', `<div class="lab-grid">${select('数据版本','lab-profile')}${select('预设场景','lab-preset')}</div>${button('lab-load-preset','载入预设')}
    ${select('地图（启用地图）','lab-stage')}<div class="lab-grid">${number('随机种子 seed','lab-seed',1,4294967295)}${number('回合 round','lab-round',1,16)}</div>${button('lab-apply-scene','应用场景配置','primary')}`, true)}
  ${section('场上单位 <span id="lab-roster-count" class="lab-count"></span>', `${select('选择 UID（也可点击地图）','lab-unit-select')}<p id="lab-selection-note" class="lab-small">尚未选择单位</p>${button('lab-delete','删除所选单位','danger')}`, true)}
  ${section('干员与召唤物', `${search('搜索干员 / 召唤物','lab-unit-search')}${select('单位','lab-unit-kind')}
    <div class="lab-grid">${select('普通 / 精锐','lab-quality')}${select('朝向','lab-dir')}</div>
    <div class="lab-grid">${number('行 row','lab-row',9,12)}${number('列 col','lab-col',0,10)}</div>
    ${select('技能','lab-skill')}${select('模组','lab-module')}<div><span class="lab-small">装备（可重复选择）</span><div id="lab-items"></div>${button('lab-item-slot','增加装备槽')}</div>
    <div class="lab-actions">${button('lab-add-unit','添加单位','primary')}${button('lab-apply-unit','应用所选单位')}</div>`, true)}
  ${section('莱茵科研装置', '<p class="lab-small">使用上方行、列放置；有效人数、层数在盟约区设置。</p><div id="lab-research"></div>', true)}
  ${section('敌人与数值', `${search('搜索敌人','lab-enemy-search')}${select('敌人模板','lab-enemy-kind')}
    <div class="lab-grid three">${number('行 row','lab-enemy-row',9,12)}${number('列 col','lab-enemy-col',0,10)}${number('数量','lab-enemy-count',1,30)}</div>
    <div class="lab-grid">${number('生命 HP','lab-enemy-hp',1)}${number('攻击 ATK','lab-enemy-atk',0)}${number('防御 DEF','lab-enemy-def',0)}${number('法抗 RES','lab-enemy-res',0,100)}${number('移速','lab-enemy-speed',0,'',0.01)}</div>
    <p class="lab-small">数值留空使用模板默认值。数量表示同一配置的敌人组。</p>
    <div class="lab-actions">${button('lab-add-enemy','添加敌人','primary')}${button('lab-apply-enemy','应用所选敌人')}</div>`)}
  ${section('盟约层数与人数', `${search('搜索盟约','lab-bond-search')}${select('盟约','lab-bond-kind')}
    <div class="lab-grid">${number('层数','lab-bond-layers',0,999)}${select('人数计算','lab-bond-mode')}</div>${number('覆盖人数','lab-bond-count',0,20)}
    <p class="lab-small">自动人数由实际阵容计算；覆盖人数用于隔离测试羁绊门槛。</p><div class="lab-actions">${button('lab-apply-bond','应用盟约','primary')}${button('lab-clear-bond','移除覆盖')}</div><pre id="lab-bond-summary" class="lab-inspect"></pre>`)}
  ${section('技能、动作与特效', `${button('lab-cast','强制释放所选单位的真实技能','primary')}<p class="lab-small">技能走真实引擎；动作与特效仅用于观看，不改变伤害。</p>
    ${select('模型动作（真实素材）','lab-animation')}<p id="lab-animation-note" class="lab-small"></p><label class="lab-check"><input id="lab-animation-loop" type="checkbox">循环动作</label>${button('lab-play-animation','播放动作')}
    ${select('特效预览','lab-fx')}${button('lab-preview-fx','播放所选特效')}`, true)}
  ${section('所选单位说明与实时数值', '<label class="lab-control" for="lab-description">技能 / 特性 / 天赋 / 模组 / 协议 / 盟约<textarea id="lab-description" readonly></textarea></label><pre id="lab-live" class="lab-inspect">等待单位数据</pre>', true)}
  ${section('JSON 与本地保存', '<label class="lab-control" for="lab-json">场景 JSON<textarea id="lab-json" spellcheck="false" placeholder="导出当前场景或粘贴场景 JSON"></textarea></label>' +
    `<div class="lab-actions">${button('lab-export','导出到文本区')}${button('lab-import','导入并重建')}</div><div class="lab-actions">${button('lab-download','下载 JSON')}${button('lab-save','保存到本机')}${button('lab-load','读取本机')}</div><p class="lab-small">本机保存仅使用此浏览器的 localStorage，不写入线上对局。</p>`)}
  `;
  root.querySelectorAll('[id]').forEach(el => { el.dataset.testid = el.id; });
  root.setAttribute('aria-busy', 'false');
  options($('lab-profile'), [['rhine','莱茵扩展'],['vanilla','原版']]);
  options($('lab-preset'), [['basic','基础战斗'],['rhine-energy','莱茵能量'],['rhine-ecology','莱茵生态']]);
  options($('lab-quality'), [['normal','普通'],['elite','精锐']]);
  options($('lab-dir'), [['RIGHT','向右 →'],['UP','向上 ↑'],['LEFT','向左 ←'],['DOWN','向下 ↓']]);
  options($('lab-bond-mode'), [['auto','自动阵容人数'],['override','手动覆盖人数']]);
  const fxLabels = { rhineHeal:'科研治疗', rhinePulse:'科研能量脉冲', rhineEcology:'科研生态区' };
  options($('lab-fx'), Object.keys(FX_KINDS).map(id => [id, `${fxLabels[id] ? `${fxLabels[id]} · ` : ''}${id}`]), 'rhinePulse');
  $('lab-row').value = '10'; $('lab-col').value = '5'; $('lab-enemy-row').value = '10'; $('lab-enemy-col').value = '9'; $('lab-enemy-count').value = '1';

  function status() {
    put('lab-run-status', busy ? '正在处理…' : state.playing ? '运行中' : '已暂停 / 可编辑');
    put('lab-clock', `${Number(state.time || 0).toFixed(2)} 秒`);
    put('lab-battle-stats', formatLabStats(state.stats));
    const error = localError || state.error;
    put('lab-message', error ? String(error.message || error) : notice);
    $('lab-message').classList.toggle('is-error', !!error);
    $('lab-start').disabled = busy || !!state.playing;
    $('lab-pause').disabled = busy || !state.playing;
    $('lab-step').disabled = busy || !!state.playing;
    $('lab-profile').disabled = busy;
  }
  async function run(action, success = '') {
    if (busy) return;
    busy = true; localError = ''; notice = ''; status();
    try { await action(); notice = success; }
    catch (e) { localError = e?.message || String(e); }
    finally { busy = false; refresh(); }
  }
  async function commit(change, uid) {
    const next = clone(scenario()); change(next);
    await controller.setScenario(next);
    if (uid != null) await controller.select(uid);
  }
  function catalog(id, source, term, test) {
    const rows = entries(source).filter(([key,r]) => (!test || test(r)) && matches(r,key,term));
    options($(id), rows.map(([key,r]) => [key, `${r.name || key}${r.isGolden ? ' · 精锐' : ''}${r.tier ? ` · ${r.tier}阶` : ''} · ${key}`]));
  }
  function catalogs() {
    options($('lab-stage'), entries(tables.stages).filter(([,r]) => r.active !== false).map(([id,r]) => [id,`${r.name || id} · ${id}`]), scenario()?.stageId);
    catalog('lab-unit-kind', { ...tables.chess, ...tables.tokens }, value('lab-unit-search'), r => !r.isGolden && (r.chessId ? r.visible !== false : r.placeable !== false));
    catalog('lab-enemy-kind', tables.enemies, value('lab-enemy-search'));
    catalog('lab-bond-kind', tables.bonds, value('lab-bond-search'));
    unitChoices(); enemyDefaults(); bondFields();
  }
  function itemRows(ids = []) {
    const target = $('lab-items'); target.replaceChildren();
    for (let i = 0; i < Math.max(3, ids.length); i++) addItemRow(ids[i] || '');
  }
  function addItemRow(id = '') {
    const row = doc.createElement('div'); row.className = 'lab-item-row';
    const picker = doc.createElement('select'); picker.setAttribute('aria-label', `装备槽 ${$('lab-items').children.length + 1}`); picker.dataset.itemSlot = '';
    options(picker, [['','不装备'], ...entries(tables.items).filter(([,r]) => r.itemType === 'EQUIP').map(([key,r]) => [key,`${r.name || key}${r.isGolden ? ' · 精锐' : ''}`])], id);
    const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label','移除此装备槽');
    listen(remove, 'click', () => row.remove()); row.append(picker, remove); $('lab-items').append(row);
  }
  function unitChoices(existing = null) {
    const base = tables.chess?.[value('lab-unit-kind')];
    $('lab-quality').disabled = !base || !tables.chess?.[base.goldenId];
    if ($('lab-quality').disabled) $('lab-quality').value = 'normal';
    const rec = recOf(recordId());
    const lo = resolveRecordLoadout(rec, existing);
    const skills = rec?.skills?.length ? rec.skills : rec?.skill ? [rec.skill] : [];
    options($('lab-skill'), skills.map(s => [s.index ?? '',`${s.index != null ? `技能 ${s.index + 1} · ` : ''}${s.name || s.skillId || '默认技能'}`]), lo?.skillIndex);
    $('lab-skill').disabled = !skills.length;
    options($('lab-module'), [['none','不装备模组'], ...(rec?.modules || []).map(m => [m.uniEquipId,`${m.typeName || ''} ${m.name || m.uniEquipId} · Lv.${m.level || 1}`])], lo?.moduleId || 'none');
    $('lab-module').disabled = !rec?.isGolden || !rec?.modules?.length;
  }
  function enemyDefaults(existing = null) {
    const rec = tables.enemies?.[value('lab-enemy-kind')];
    for (const [id,key] of [['hp','maxHp'],['atk','atk'],['def','def'],['res','res'],['speed','moveSpeed']]) {
      const input = $(`lab-enemy-${id}`); input.value = existing?.stats?.[key] ?? ''; input.placeholder = String(rec?.stats?.[key] ?? '默认');
    }
  }
  function bondFields() {
    const b = scenario()?.bonds?.[value('lab-bond-kind')];
    $('lab-bond-layers').value = b?.layers ?? 0;
    $('lab-bond-mode').value = b?.count == null ? 'auto' : 'override';
    $('lab-bond-count').value = b?.count ?? 0; $('lab-bond-count').disabled = value('lab-bond-mode') === 'auto';
  }
  function unitFields() {
    const u = unit(), e = enemy();
    $('lab-apply-unit').disabled = !u; $('lab-apply-enemy').disabled = !e; $('lab-delete').disabled = !u && !e;
    put('lab-selection-note', u ? `UID ${u.uid} · ${recOf(u.id)?.name || u.id} · 行 ${u.row} / 列 ${u.col}` : e ? `UID ${e.uid} · ${tables.enemies?.[e.enemyKey]?.name || e.enemyKey} · ${e.count || 1} 个` : '尚未选择单位');
    if (u) {
      const r = recOf(u.id), baseId = r?.isGolden ? r.baseId : u.id;
      if (![...$('lab-unit-kind').options].some(o => o.value === baseId)) {
        $('lab-unit-search').value = ''; catalog('lab-unit-kind', { ...tables.chess, ...tables.tokens }, '', r => !r.isGolden);
      }
      $('lab-unit-kind').value = baseId; $('lab-quality').value = r?.isGolden ? 'elite' : 'normal';
      $('lab-row').value = u.row; $('lab-col').value = u.col; $('lab-dir').value = u.dir || 'RIGHT';
      unitChoices(u); itemRows(u.items || []);
    } else if (e) {
      $('lab-enemy-search').value = ''; catalog('lab-enemy-kind', tables.enemies, ''); $('lab-enemy-kind').value = e.enemyKey;
      $('lab-enemy-row').value = e.row; $('lab-enemy-col').value = e.col; $('lab-enemy-count').value = e.count || 1; enemyDefaults(e);
    }
    let info; try { info = controller.inspect(state.selectedUid); } catch { info = null; }
    const r = info?.record || (u ? recOf(u.id) : tables.enemies?.[e?.enemyKey]);
    $('lab-description').value = describeLabUnit(r, info?.loadout || u, tables, info?.bonds || []);
    refreshAnimations();
  }
  async function refreshAnimations(provided) {
    const request = ++animationRequest;
    try {
      const list = Array.isArray(provided) ? provided : await controller.animations(state.selectedUid);
      if (request !== animationRequest) return;
      const signature = JSON.stringify(list || []);
      if (signature !== animationSignature || animationUid !== state.selectedUid) {
        options($('lab-animation'), (list || []).map(a => [a.name, `${a.name}${Number.isFinite(a.duration) ? ` · ${a.duration.toFixed(2)} 秒` : ''}`]));
        animationSignature = signature; animationUid = state.selectedUid;
      }
      $('lab-play-animation').disabled = !list?.length;
      put('lab-animation-note', list?.length ? `已读取 ${list.length} 个模型动作。` : '尚无可用动作：请选择单位并等待真实模型素材加载。');
    } catch (e) { if (request === animationRequest) put('lab-animation-note', `动作读取失败：${e.message || e}`); }
  }
  function researchFields() {
    const container = $('lab-research'); container.replaceChildren();
    for (const d of RHINE_DEVICES) {
      const u = scenario()?.units?.find(u => u.id === d.tokenId);
      const row = doc.createElement('div'); row.className = 'lab-device-row';
      const name = doc.createElement('span'); name.textContent = d.name;
      const picker = doc.createElement('select'); picker.id = `lab-device-${d.key}-stage`; picker.dataset.testid = picker.id; picker.setAttribute('aria-label',`${d.name}阶段`);
      options(picker, [[0,'一级'],[1,'二级'],[2,'三级']], u?.stage ?? 0);
      const add = doc.createElement('button'); add.type = 'button'; add.id = `lab-device-${d.key}`; add.dataset.testid = add.id; add.textContent = u ? '应用' : '添加';
      add.disabled = scenario()?.profile === 'vanilla';
      listen(add,'click',() => run(() => { const uid = u?.uid ?? nextUid(); return commit(next => {
        const found = next.units.find(x => x.uid === uid);
        if (found) found.stage = Number(picker.value);
        else next.units.push({ uid, id:d.tokenId, row:numeric('lab-row',10), col:numeric('lab-col',5), dir:'RIGHT', stage:Number(picker.value), items:[] });
      },uid); },'科研装置已应用；战斗已重置。'));
      row.append(name,picker,add); container.append(row);
    }
  }
  function refresh(next) {
    if (next) state = { ...state, ...next };
    state.scenario = next?.scenario || controller.scenario || state.scenario;
    tables = controller.records || next?.records || records;
    const s = scenario(); if (!s) { status(); return; }
    $('lab-profile').value=s.profile;
    const serial = JSON.stringify(s), changed = serial !== lastScenario || tables !== lastTables;
    if (changed) {
      if (tables !== lastTables) catalogs();
      $('lab-profile').value = s.profile; $('lab-stage').value = s.stageId; $('lab-seed').value = s.seed; $('lab-round').value = s.round;
      options($('lab-unit-select'), [['','未选择'], ...(s.units || []).map(u => [u.uid,`#${u.uid} ${recOf(u.id)?.name || u.id}`]), ...(s.enemies || []).map(e => [e.uid,`#${e.uid} 敌 · ${tables.enemies?.[e.enemyKey]?.name || e.enemyKey} ×${e.count || 1}`])],state.selectedUid ?? '');
      put('lab-roster-count', `${s.units?.length || 0} 友方 / ${s.enemies?.length || 0} 敌群`);
      researchFields(); bondFields();
      put('lab-bond-summary', entries(s.bonds).map(([id,b]) => `${tables.bonds?.[id]?.name || id}：${b.layers || 0} 层 / ${b.count == null ? '人数自动' : `${b.count} 人`}`).join('\n') || '尚无层数或人数覆盖');
    }
    if (changed || state.selectedUid !== lastSelected) { $('lab-unit-select').value = state.selectedUid ?? ''; unitFields(); }
    if (next?.animationNames) refreshAnimations(next.animationNames);
    lastScenario = serial; lastTables = tables; lastSelected = state.selectedUid;
    $('lab-speed').value = String(state.speed || 1);
    let info = state.inspect; if (!info || info.uid !== state.selectedUid) { try { info = controller.inspect(state.selectedUid); } catch { info = null; } }
    put('lab-live', info ? JSON.stringify({ 生命与技力:info.live, 实际数值:info.stats, 生效盟约:info.bonds, 问题:info.errors },null,2) : '请选择单位查看实时数值。');
    $('lab-cast').disabled = !unit() || !!info && (info.kind === 'enemy' || info.live?.alive === false);
    status();
  }

  for (const [id,method,text] of [['lab-start','start',''],['lab-pause','pause',''],['lab-step','step',''],['lab-reset','reset','已重置到当前配置的开战状态。']]) listen($(id),'click',() => run(() => controller[method](),text));
  listen($('lab-speed'),'change',() => run(() => controller.setSpeed(Number(value('lab-speed')))));
  listen($('lab-profile'),'change',() => run(() => controller.changeProfile(value('lab-profile')),'数据版本已切换；战斗已重置。'));
  listen($('lab-load-preset'),'click',() => run(() => controller.preset(value('lab-preset')),'预设已载入；战斗已暂停。'));
  listen($('lab-apply-scene'),'click',() => run(() => commit(s => Object.assign(s,{stageId:value('lab-stage'),seed:numeric('lab-seed',1),round:numeric('lab-round',1)})),'场景配置已应用；战斗已重置。'));
  listen($('lab-unit-select'),'change',() => run(() => { const u = [...scenario().units,...scenario().enemies].find(u => String(u.uid) === value('lab-unit-select')); return controller.select(u?.uid ?? null); }));
  listen($('lab-delete'),'click',() => run(() => commit(s => { s.units=s.units.filter(u => u.uid !== state.selectedUid); s.enemies=s.enemies.filter(u => u.uid !== state.selectedUid); }).then(() => controller.select(null)),'单位已删除；战斗已重置。'));
  listen($('lab-unit-search'),'input',() => { catalog('lab-unit-kind',{...tables.chess,...tables.tokens},value('lab-unit-search'),r => !r.isGolden && (r.chessId ? r.visible !== false : r.placeable !== false)); unitChoices(); });
  listen($('lab-unit-kind'),'change',() => unitChoices()); listen($('lab-quality'),'change',() => unitChoices());
  listen($('lab-item-slot'),'click',() => addItemRow());
  function unitDraft(uid) {
    if (!recordId()) throw new Error('请先选择干员或召唤物');
    const u = { uid,id:recordId(),row:numeric('lab-row',10),col:numeric('lab-col',5),dir:value('lab-dir'),items:[...root.querySelectorAll('[data-item-slot]')].map(el=>el.value).filter(Boolean) };
    if (value('lab-skill') !== '') u.skillIndex = Number(value('lab-skill'));
    if (!$('lab-module').disabled) u.moduleId = value('lab-module');
    const device = RHINE_DEVICES.find(d => d.tokenId === u.id); if (device) u.stage = unit()?.stage ?? 0;
    return u;
  }
  listen($('lab-add-unit'),'click',() => run(() => { const uid=nextUid(),draft=unitDraft(uid); return commit(s => s.units.push(draft),uid); },'单位已添加；战斗已重置。'));
  listen($('lab-apply-unit'),'click',() => run(() => { const old=unit(); if (!old) throw new Error('请先选择一个友方单位'); const draft=unitDraft(old.uid); return commit(s => { s.units[s.units.findIndex(u=>u.uid===old.uid)]=draft; },old.uid); },'所选单位已应用；战斗已重置。'));
  listen($('lab-enemy-search'),'input',() => { catalog('lab-enemy-kind',tables.enemies,value('lab-enemy-search')); enemyDefaults(); });
  listen($('lab-enemy-kind'),'change',() => enemyDefaults());
  function enemyDraft(uid) {
    if (!value('lab-enemy-kind')) throw new Error('请先选择敌人模板');
    const stats = {}; for (const [id,key] of [['hp','maxHp'],['atk','atk'],['def','def'],['res','res'],['speed','moveSpeed']]) if (value(`lab-enemy-${id}`).trim() !== '') stats[key]=numeric(`lab-enemy-${id}`);
    return {uid,enemyKey:value('lab-enemy-kind'),row:numeric('lab-enemy-row',10),col:numeric('lab-enemy-col',9),count:numeric('lab-enemy-count',1),stats};
  }
  listen($('lab-add-enemy'),'click',() => run(() => {const uid=nextUid(),draft=enemyDraft(uid); return commit(s=>s.enemies.push(draft),uid);},'敌人已添加；战斗已重置。'));
  listen($('lab-apply-enemy'),'click',() => run(() => {const old=enemy(); if(!old) throw new Error('请先选择一个敌人组');const draft=enemyDraft(old.uid);return commit(s=>{s.enemies[s.enemies.findIndex(e=>e.uid===old.uid)]=draft;},old.uid);},'敌人配置已应用；战斗已重置。'));
  listen($('lab-bond-search'),'input',() => {catalog('lab-bond-kind',tables.bonds,value('lab-bond-search'));bondFields();});
  listen($('lab-bond-kind'),'change',bondFields);
  listen($('lab-bond-mode'),'change',() => {$('lab-bond-count').disabled=value('lab-bond-mode')==='auto';});
  listen($('lab-apply-bond'),'click',() => run(() => {const id=value('lab-bond-kind');if(!id)throw new Error('请先选择盟约');return commit(s=>{s.bonds ||= {};s.bonds[id]={layers:numeric('lab-bond-layers'),count:value('lab-bond-mode')==='auto'?null:numeric('lab-bond-count')};});},'盟约覆盖已应用；战斗已重置。'));
  listen($('lab-clear-bond'),'click',() => run(() => commit(s=>{delete s.bonds?.[value('lab-bond-kind')];}),'盟约覆盖已移除。'));
  listen($('lab-cast'),'click',() => run(() => controller.castSkill(state.selectedUid),'已请求真实技能释放；结果以引擎状态为准。'));
  listen($('lab-play-animation'),'click',() => run(() => controller.playAnimation(state.selectedUid,value('lab-animation'),$('lab-animation-loop').checked)));
  listen($('lab-animation'),'focus',refreshAnimations);
  listen($('lab-preview-fx'),'click',() => run(() => controller.previewFx(value('lab-fx'))));
  const exported = () => {const out=controller.exportScenario();return typeof out==='string'?out:JSON.stringify(out,null,2);};
  listen($('lab-export'),'click',() => run(() => {$('lab-json').value=exported();},'当前场景已写入 JSON 文本区。'));
  listen($('lab-import'),'click',() => run(() => controller.importScenario(value('lab-json')),'JSON 已导入；战斗已重置。'));
  listen($('lab-save'),'click',() => run(() => {win.localStorage.setItem(STORE_KEY,exported());},'场景已保存到此浏览器。'));
  listen($('lab-load'),'click',() => run(() => {const json=win.localStorage.getItem(STORE_KEY);if(!json)throw new Error('此浏览器还没有保存的场景');return controller.importScenario(json);},'本机场景已读取。'));
  listen($('lab-download'),'click',() => run(() => {const url=win.URL.createObjectURL(new Blob([exported()],{type:'application/json'}));const a=doc.createElement('a');a.href=url;a.download='stronghold-test-scenario.json';a.click();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);},'场景 JSON 已下载。'));
  const toggle=doc.querySelector('#lab-toggle-tools'),workspace=doc.querySelector('#lab-workspace');
  listen(toggle,'click',()=>{const hidden=workspace.classList.toggle('tools-collapsed');toggle.setAttribute('aria-expanded',String(!hidden));toggle.textContent=hidden?'展开工具':'收起工具';win.dispatchEvent(new win.Event('resize'));});
  itemRows(); refresh();
  const unsubscribe = controller.subscribe(refresh);
  return { refresh, destroy(){animationRequest++;abort.abort();unsubscribe?.();root.replaceChildren();} };
}
