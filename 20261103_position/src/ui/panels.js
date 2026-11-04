// DOM updates: the HUD over the 3D view (objective, bullets, status, the action prompt), the
// position + movement panel and the log.

import { statusOf } from '../sim/escape.js';

const $ = (id) => document.getElementById(id);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const DIFF = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

export function makePanels() {
  const log = $('log');
  const lastMove = {};
  const MOVE_HOLD = { toward: 0, away: 0, up: 6, down: 6, around: 12, past: 12 };
  let toastTimer = null;
  let shownEvents = 0;

  function hud(game) {
    const g = game.ctx.config.game;
    const me = game.player;
    const st = statusOf(game);
    const obj = $('objective');
    obj.textContent = me.carrying ? 'Run east to the hospital!' : 'Find the vaccine case';
    obj.classList.toggle('urgent', me.carrying);
    $('timer').textContent = `${clock((game.step * g.tickMs) / 1000)} · ${DIFF[game.difficulty]}${me.carrying ? '' : ' · follow the cyan light'}`;
    const total = g.difficulty[game.difficulty].ammo;
    $('ammo').innerHTML = `<span>Bullets</span>${Array.from({ length: total }, (_, i) => `<i class="${i < me.ammo ? '' : 'used'}"></i>`).join('')}`;
    $('chip-seen').classList.toggle('on', st.sees);
    $('chip-heard').classList.toggle('on', st.hears && !st.sees);
    $('chip-tree').classList.toggle('on', st.inTree);
    $('chip-alarm').classList.toggle('on', game.alarmLeft > 0);
    $('chip-frozen').classList.toggle('on', game.creature.frozenLeft > 0 && me.seesCreature);
    // the two keys: what each would do now
    const acts = st.actions;
    const ps = $('prompt-shoot');
    const pc = $('prompt-climb');
    ps.hidden = !acts.shoot || game.over;
    pc.hidden = !acts.climb || game.over;
    if (acts.climb) $('prompt-climb-text').textContent = acts.climb === 'down' ? 'Climb down (or just move)' : 'Climb the tree and hide';
    $('prompts').hidden = ps.hidden && pc.hidden;
    const bar = $('treebar');
    bar.hidden = !st.inTree;
    if (st.inTree) bar.firstElementChild.style.width = `${(100 * me.treeLeft) / g.treeTicks}%`;
  }

  function relations(game) {
    const seen = game.player.seesCreature || game.over;
    const visible = (r) => seen || !(r.kind === 'between'
      || (r.kind === 'behind' && r.who === 'creature') || (r.kind === 'adjacent' && r.b === 'creature'));
    const pos = game.relations.position.filter(visible);
    const moves = game.relations.movement.filter((m) => seen || m.who === 'player');
    const on = new Set(pos.map((r) => r.kind));
    for (const m of moves) lastMove[m.kind] = { step: game.step, text: m.text };
    document.querySelectorAll('#rel-chips [data-rel]').forEach((el) => {
      const k = el.dataset.rel;
      if (k in MOVE_HOLD) {
        const m = lastMove[k];
        el.classList.toggle('on', !!m && game.step - m.step <= MOVE_HOLD[k]);
      } else el.classList.toggle('on', on.has(k));
    });
    const lines = pos.map((r) => `<li class="${r.who ?? r.upper ?? r.a}">${r.text}</li>`);
    for (const m of moves) if (m.kind !== 'toward' && m.kind !== 'away') lines.push(`<li class="${m.who} move">${m.text}</li>`);
    $('rel-list').innerHTML = lines.length ? lines.join('') : '<li class="none">No position relation holds right now.</li>';
  }

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hide');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hide'), 2800);
  }

  function events(game) {
    const fresh = game.events.slice(shownEvents);
    shownEvents = game.events.length;
    for (const e of fresh) {
      const li = document.createElement('li');
      li.className = `${e.who} ${e.kind}`;
      li.innerHTML = `<span class="when">${clock((e.step * game.ctx.config.game.tickMs) / 1000)}</span>`;
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = e.text;
      li.append(what);
      log.prepend(li);
      if (['case', 'shot', 'caw', 'spot', 'ambush', 'noshot', 'notree', 'alarm', 'thaw', 'start', 'climb', 'slip'].includes(e.kind)) toast(e.text);
    }
    while (log.children.length > 60) log.lastChild.remove();
  }

  function update(game) { hud(game); relations(game); events(game); }

  function reset() {
    shownEvents = 0;
    for (const k in lastMove) delete lastMove[k];
    log.innerHTML = '';
  }

  return { update, reset, toast };
}
