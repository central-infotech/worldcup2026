(async function () {
  const data = await fetch('tournament.json?ts=' + Date.now())
    .then((r) => r.json())
    .catch((e) => { console.error(e); return null; });
  if (!data) {
    document.getElementById('groups').textContent = 'データを読み込めませんでした。';
    return;
  }

  if (data.updated_at) {
    const d = new Date(data.updated_at);
    document.getElementById('updated').textContent =
      '最終更新: ' + formatJstDateTime(d);
  }

  renderBracket(data);
  renderGroups(data);
})();

/* ====== Time formatting (JST) ====== */
function formatJstDateTime(date) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function getJstParts(isoUtc) {
  const d = new Date(isoUtc);
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  const hh = parts.find((p) => p.type === 'hour').value;
  const mm = parts.find((p) => p.type === 'minute').value;
  return { date: `${m}/${day}`, time: `${hh}:${mm}` };
}

/* ====== Flag image ====== */
function flagImg(team, sizeClass) {
  if (!team) return '';
  const cls = sizeClass ? ' ' + sizeClass : '';
  return `<img class="flag-img${cls}" src="flags/${team.iso2}.png" alt="" loading="lazy">`;
}

/* ====== Scaled team name (base = 6 chars, shrinks for longer names) ====== */
function nameSpan(text) {
  const len = [...text].length;
  const scale = len <= 6 ? 1 : Math.max(0.55, 6 / len);
  const style = scale < 1 ? ` style="--name-scale:${scale.toFixed(2)}"` : '';
  return `<span class="team-name-text"${style}>${text}</span>`;
}

/* Placeholder text (e.g. "グループA/B/C/D/F3位", "第74試合勝者") – no scaling */
function placeholderSpan(text) {
  return `<span class="team-name-text placeholder-text">${text}</span>`;
}

/* ====== Per-round renumbering ======
   FIFA match IDs (73–104) aren't intuitive — re-label every knockout
   cell as #32-NN / #16-NN / #8-NN / #4-NN based on visual position in
   the bracket (left-side top → bottom, then right-side top → bottom).
   Final / 3rd place keep their column heading and have no badge.       */
const MATCH_DISPLAY_ID = (function () {
  const m = {};
  const assign = (ids, fmt) => ids.forEach((id, i) => { m[String(id)] = fmt(i); });
  assign([74, 77, 73, 75, 83, 84, 81, 82], (i) => `#32-${String(i + 1).padStart(2, '0')}`);
  assign([76, 78, 79, 80, 86, 88, 85, 87], (i) => `#32-${String(i + 9).padStart(2, '0')}`);
  assign([89, 90, 93, 94], (i) => `#16-${String(i + 1).padStart(2, '0')}`);
  assign([91, 92, 95, 96], (i) => `#16-${String(i + 5).padStart(2, '0')}`);
  assign([97, 98],  (i) => `#8-${String(i + 1).padStart(2, '0')}`);
  assign([99, 100], (i) => `#8-${String(i + 3).padStart(2, '0')}`);
  assign([101, 102], (i) => `#4-${String(i + 1).padStart(2, '0')}`);
  return m;
})();

function matchDisplayId(id) {
  return MATCH_DISPLAY_ID[String(id)] || null;
}

/* ====== Placeholder slot label ====== */
function slotLabelJa(slot) {
  if (!slot) return 'TBD';
  let m;
  m = slot.match(/^(\d)([A-L])$/);
  if (m) return `グループ${m[2]}${m[1]}位`;
  m = slot.match(/^3\(([A-L/]+)\)$/);
  if (m) return `グループ${m[1]}3位`;
  m = slot.match(/^W(\d+)$/);
  if (m) return `${matchDisplayId(m[1]) || ('#' + m[1])}勝者`;
  m = slot.match(/^L(\d+)$/);
  if (m) return `${matchDisplayId(m[1]) || ('#' + m[1])}敗者`;
  return slot;
}

/* ====== Bracket rendering ======
   Layout reads left→right:
     R32L → R16L → QFL → SFL → FINAL → SFR → QFR → R16R → R32R
   Matches are wrapped in <div class="pair-group"> of two so that
   CSS pseudo-elements can draw the connector tree to the next round.
*/
const LEFT_ROUNDS = [
  { label: 'ベスト32', cls: 'col-r32', pairs: [[74, 77], [73, 75], [83, 84], [81, 82]] },
  { label: 'ベスト16', cls: 'col-r16', pairs: [[89, 90], [93, 94]] },
  { label: '準々決勝', cls: 'col-qf',  pairs: [[97, 98]] },
  { label: '準決勝',   cls: 'col-sf',  pairs: [[101]] },
];

const RIGHT_ROUNDS_INNER_OUT = [
  { label: '準決勝',   cls: 'col-sf',  pairs: [[102]] },
  { label: '準々決勝', cls: 'col-qf',  pairs: [[99, 100]] },
  { label: 'ベスト16', cls: 'col-r16', pairs: [[91, 92], [95, 96]] },
  { label: 'ベスト32', cls: 'col-r32', pairs: [[76, 78], [79, 80], [86, 88], [85, 87]] },
];

/* ====== Group standings → bracket seed resolution ======
   "1A"  → group A 1st-place team code (when group all finished)
   "2B"  → group B 2nd-place team code (when group all finished)
   "3(…)" → cross-group 3rd-place qualification: not resolved client-side
              (scraper fills it from Wikipedia when known)
   "W74" → winner of match 74, chained back to groups if needed
   "L101" → loser of match 101 (3rd-place match source)
*/
function buildGroupStandings(data) {
  const result = {};
  for (const gk of Object.keys(data.groups)) {
    const codes = data.groups[gk];
    const matches = data.group_matches.filter((m) => m.group === gk);
    const allFinished =
      matches.length === 6 &&
      matches.every((m) => m.home_score != null && m.away_score != null);
    const standings = computeStandings(codes, matches);
    standings.sort(rankCompare);

    const clinched = computeClinchedPositions(standings, matches);

    result[gk] = {
      allFinished,
      sortedCodes: standings.map((s) => s.code),
      clinched,
    };
  }
  return result;
}

/* For each team, decide whether its final position in the group is already
   mathematically guaranteed from current points alone (tiebreakers ignored —
   only strict point gaps are considered). Returns { '1': code|null, '2': … }.
   Allows the bracket to fill in '1A'/'2B' as soon as it is decided, e.g. when
   a team has 6 pts after 2 wins and no other team can reach 6 pts. */
function computeClinchedPositions(standings, matches) {
  const played = {};
  for (const s of standings) played[s.code] = 0;
  for (const m of matches) {
    if (m.home_score != null && m.away_score != null) {
      played[m.home]++;
      played[m.away]++;
    }
  }
  const maxPts = {};
  for (const s of standings) maxPts[s.code] = s.Pts + (3 - played[s.code]) * 3;

  const clinched = {};
  for (const s of standings) {
    let above = 0;
    let undetermined = false;
    for (const o of standings) {
      if (o.code === s.code) continue;
      if (o.Pts > maxPts[s.code]) {
        above++;
      } else if (maxPts[o.code] < s.Pts) {
        // below — fine
      } else {
        undetermined = true;
        break;
      }
    }
    if (!undetermined) {
      const pos = above + 1;
      if (!clinched[String(pos)]) clinched[String(pos)] = s.code;
    }
  }
  return clinched;
}

function resolveSlot(slot, groupStandings, byId, depth) {
  if (!slot || depth > 8) return null;
  let m;
  m = slot.match(/^(\d)([A-L])$/);
  if (m) {
    const seed = parseInt(m[1], 10);
    const group = m[2];
    if (seed === 3) return null;
    const gs = groupStandings[group];
    if (!gs) return null;
    // Position may be mathematically clinched before all games are played.
    const clinchedTeam = gs.clinched && gs.clinched[String(seed)];
    if (clinchedTeam) return clinchedTeam;
    if (!gs.allFinished) return null;
    return gs.sortedCodes[seed - 1] || null;
  }
  m = slot.match(/^W(\d+)$/);
  if (m) {
    const sm = byId[m[1]];
    if (!sm || sm.home_score == null || sm.away_score == null) return null;
    const home = sm.home || resolveSlot(sm.home_code, groupStandings, byId, depth + 1);
    const away = sm.away || resolveSlot(sm.away_code, groupStandings, byId, depth + 1);
    if (sm.home_score > sm.away_score) return home;
    if (sm.away_score > sm.home_score) return away;
    return null;
  }
  m = slot.match(/^L(\d+)$/);
  if (m) {
    const sm = byId[m[1]];
    if (!sm || sm.home_score == null || sm.away_score == null) return null;
    const home = sm.home || resolveSlot(sm.home_code, groupStandings, byId, depth + 1);
    const away = sm.away || resolveSlot(sm.away_code, groupStandings, byId, depth + 1);
    if (sm.home_score < sm.away_score) return home;
    if (sm.away_score < sm.home_score) return away;
    return null;
  }
  return null;
}

function renderBracket(data) {
  const container = document.getElementById('bracket');
  container.innerHTML = '';
  const byId = Object.fromEntries(data.knockout_matches.map((m) => [String(m.id), m]));
  const groupStandings = buildGroupStandings(data);
  const ctx = { data, byId, groupStandings };

  for (const round of LEFT_ROUNDS) {
    container.appendChild(buildRoundColumn(round, ctx, 'side-left'));
  }
  container.appendChild(buildFinalColumn(ctx));
  for (const round of RIGHT_ROUNDS_INNER_OUT) {
    container.appendChild(buildRoundColumn(round, ctx, 'side-right'));
  }
}

function buildRoundColumn(round, ctx, side) {
  const col = document.createElement('div');
  col.className = `round ${round.cls} ${side}`;

  const heading = document.createElement('h3');
  heading.textContent = round.label;
  col.appendChild(heading);

  const matchesEl = document.createElement('div');
  matchesEl.className = 'matches';

  for (const pair of round.pairs) {
    const pairEl = document.createElement('div');
    pairEl.className = 'pair-group' + (pair.length === 1 ? ' single' : '');

    let topAdv = false;
    let botAdv = false;
    pair.forEach((id, i) => {
      const m = ctx.byId[String(id)];
      if (!m) return;
      const cell = buildMatchCell(m, ctx);
      const isFinished = m.status === 'finished';
      if (isFinished) {
        cell.classList.add('advancing');
        if (i === 0) topAdv = true;
        else botAdv = true;
      }
      pairEl.appendChild(cell);
    });

    if (pair.length === 1) {
      if (topAdv) pairEl.classList.add('has-advancing');
    } else {
      if (topAdv && botAdv) pairEl.classList.add('both-advancing', 'has-advancing');
      else if (topAdv) pairEl.classList.add('top-advancing', 'has-advancing');
      else if (botAdv) pairEl.classList.add('bottom-advancing', 'has-advancing');
    }

    matchesEl.appendChild(pairEl);
  }

  col.appendChild(matchesEl);
  return col;
}

function buildFinalColumn(ctx) {
  const col = document.createElement('div');
  col.className = 'round col-final';

  const heading = document.createElement('h3');
  heading.textContent = '決勝';
  col.appendChild(heading);

  const matchesEl = document.createElement('div');
  matchesEl.className = 'matches final-matches';

  const finalMatch = ctx.byId['104'];
  const thirdMatch = ctx.byId['103'];

  // Light up each SF→Final L-line once its source SF has a winner.
  const leftSf = ctx.byId['101'];
  const rightSf = ctx.byId['102'];
  if (leftSf && leftSf.status === 'finished') matchesEl.classList.add('has-left-advancing');
  if (rightSf && rightSf.status === 'finished') matchesEl.classList.add('has-right-advancing');

  const trophy = document.createElement('div');
  trophy.className = 'trophy';
  trophy.textContent = '🏆';
  matchesEl.appendChild(trophy);

  if (finalMatch) {
    const cell = buildMatchCell(finalMatch, ctx, 'match-final');
    if (finalMatch.status === 'finished') cell.classList.add('advancing');
    matchesEl.appendChild(cell);
  }

  const thirdLabel = document.createElement('div');
  thirdLabel.className = 'third-label';
  thirdLabel.textContent = '3位決定戦';
  matchesEl.appendChild(thirdLabel);

  if (thirdMatch) {
    const cell = buildMatchCell(thirdMatch, ctx, 'match-3rd');
    matchesEl.appendChild(cell);
  }

  col.appendChild(matchesEl);
  return col;
}

function buildMatchCell(m, ctx, extraCls) {
  const cell = document.createElement('div');
  cell.className = 'match-cell' + (extraCls ? ' ' + extraCls : '');

  // Match number badge (top-left) so placeholders like "#32-01勝者" are findable.
  // Final / 3rd place have no badge — the column heading already labels them.
  const displayId = matchDisplayId(m.id);
  if (displayId) {
    const num = document.createElement('div');
    num.className = 'match-num';
    num.textContent = displayId;
    cell.appendChild(num);
  }

  const dt = getJstParts(m.kickoff_utc);
  const date = document.createElement('div');
  date.className = 'match-date';
  date.innerHTML = `${dt.date}<br>${dt.time}`;
  cell.appendChild(date);

  cell.appendChild(bracketTeamRow(m.home, m.home_code, m.home_score, m, ctx, 'home'));
  cell.appendChild(bracketTeamRow(m.away, m.away_code, m.away_score, m, ctx, 'away'));
  return cell;
}

function bracketTeamRow(teamCode, slotCode, score, match, ctx, side) {
  const row = document.createElement('div');
  row.className = 'match-team';

  // If the data file doesn't yet have a concrete team for this slot,
  // try to derive it from completed groups / earlier knockout results.
  let resolved = teamCode;
  if (!resolved) {
    resolved = resolveSlot(slotCode, ctx.groupStandings, ctx.byId, 0);
  }
  const team = resolved ? ctx.data.teams[resolved] : null;

  if (team) {
    let cls = '';
    if (match.home_score != null && match.away_score != null) {
      const hs = match.home_score, as = match.away_score;
      if (side === 'home') cls = hs > as ? 'winner' : (hs < as ? 'loser' : '');
      else cls = as > hs ? 'winner' : (as < hs ? 'loser' : '');
    }
    if (cls) row.classList.add(cls);
    row.innerHTML = `${flagImg(team, 'flag-sm')}<span class="team-name">${nameSpan(team.name_ja)}</span>${score != null ? `<span class="team-score">${score}</span>` : ''}`;
  } else {
    row.classList.add('placeholder');
    row.innerHTML = `<span class="team-name">${placeholderSpan(slotLabelJa(slotCode))}</span>`;
  }
  return row;
}

/* ====== Group cross-tables ====== */
function renderGroups(data) {
  const container = document.getElementById('groups');
  const groupKeys = Object.keys(data.groups);
  for (const gk of groupKeys) {
    const card = document.createElement('div');
    card.className = 'group-card';
    const title = document.createElement('h3');
    title.className = 'group-title';
    title.textContent = `Group ${gk}`;
    card.appendChild(title);

    const teamCodes = data.groups[gk];
    const matches = data.group_matches.filter((m) => m.group === gk);
    const standings = computeStandings(teamCodes, matches);
    const sortedCodes = standings.slice().sort(rankCompare).map((s) => s.code);
    card.appendChild(buildCrossTable(sortedCodes, data.teams, matches, standings));
    container.appendChild(card);
  }
}

function computeStandings(teamCodes, matches) {
  const stats = {};
  for (const c of teamCodes) {
    stats[c] = { code: c, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
  }
  for (const m of matches) {
    if (m.home_score == null || m.away_score == null) continue;
    const h = stats[m.home];
    const a = stats[m.away];
    if (!h || !a) continue;
    h.P++; a.P++;
    h.GF += m.home_score; h.GA += m.away_score;
    a.GF += m.away_score; a.GA += m.home_score;
    if (m.home_score > m.away_score) { h.W++; a.L++; h.Pts += 3; }
    else if (m.home_score < m.away_score) { a.W++; h.L++; a.Pts += 3; }
    else { h.D++; a.D++; h.Pts++; a.Pts++; }
  }
  for (const c of teamCodes) stats[c].GD = stats[c].GF - stats[c].GA;
  return teamCodes.map((c) => stats[c]);
}

function rankCompare(a, b) {
  if (b.Pts !== a.Pts) return b.Pts - a.Pts;
  if (b.GD !== a.GD) return b.GD - a.GD;
  if (b.GF !== a.GF) return b.GF - a.GF;
  return 0;
}

function buildCrossTable(teamCodes, teamsRef, matches, standings) {
  const standingsByCode = Object.fromEntries(standings.map((s) => [s.code, s]));
  const matchByPair = {};
  for (const m of matches) matchByPair[m.home + '|' + m.away] = m;

  const table = document.createElement('table');
  table.className = 'cross-table';

  const colgroup = document.createElement('colgroup');
  const cName = document.createElement('col'); cName.className = 'col-name'; colgroup.appendChild(cName);
  for (let i = 0; i < teamCodes.length; i++) colgroup.appendChild(document.createElement('col'));
  const cPts = document.createElement('col'); cPts.className = 'col-stat'; colgroup.appendChild(cPts);
  const cGd  = document.createElement('col'); cGd.className  = 'col-stat'; colgroup.appendChild(cGd);
  table.appendChild(colgroup);

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.appendChild(th(''));
  for (const c of teamCodes) hr.appendChild(th(flagImg(teamsRef[c], 'flag-sm')));
  hr.appendChild(th('勝点'));
  hr.appendChild(th('得失'));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const rowCode of teamCodes) {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.className = 'team-name-cell';
    nameTd.innerHTML = `${flagImg(teamsRef[rowCode], 'flag-sm')}${nameSpan(teamsRef[rowCode].name_ja)}`;
    tr.appendChild(nameTd);

    for (const colCode of teamCodes) {
      const td = document.createElement('td');
      if (rowCode === colCode) {
        td.className = 'self-cell';
        td.textContent = '—';
      } else {
        let m = matchByPair[rowCode + '|' + colCode];
        let rowIsHome = true;
        if (!m) { m = matchByPair[colCode + '|' + rowCode]; rowIsHome = false; }
        if (m) {
          if (m.home_score != null && m.away_score != null) {
            td.innerHTML = formatResult(m, rowIsHome);
          } else {
            const parts = getJstParts(m.kickoff_utc);
            td.innerHTML = `<span class="scheduled"><span class="date">${parts.date}</span><span class="time">${parts.time}</span></span>`;
          }
        }
      }
      tr.appendChild(td);
    }

    const s = standingsByCode[rowCode];
    const ptsTd = document.createElement('td');
    ptsTd.className = 'stat-cell';
    ptsTd.textContent = s.Pts;
    tr.appendChild(ptsTd);

    const gdTd = document.createElement('td');
    gdTd.className = 'stat-cell';
    gdTd.textContent = (s.GD > 0 ? '+' : '') + s.GD;
    tr.appendChild(gdTd);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function th(html) {
  const e = document.createElement('th');
  e.innerHTML = html;
  return e;
}

function formatResult(m, rowIsHome) {
  const rowScore = rowIsHome ? m.home_score : m.away_score;
  const colScore = rowIsHome ? m.away_score : m.home_score;
  let rowMark, colMark;
  if (rowScore > colScore) { rowMark = '<span class="mark-win">○</span>'; colMark = '<span class="mark-loss">×</span>'; }
  else if (rowScore < colScore) { rowMark = '<span class="mark-loss">×</span>'; colMark = '<span class="mark-win">○</span>'; }
  else { rowMark = '<span class="mark-draw">△</span>'; colMark = '<span class="mark-draw">△</span>'; }
  return `<span class="result">${rowMark}${rowScore}-${colScore}${colMark}</span>`;
}
