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

/* ====== Placeholder slot label (e.g. "1A" -> "グループA1位") ====== */
function slotLabelJa(slot) {
  if (!slot) return 'TBD';
  // 1A / 2B / 3(A/B/C/D/F) / W73 / L101
  let m;
  m = slot.match(/^(\d)([A-L])$/);
  if (m) return `グループ${m[2]}${m[1]}位`;
  m = slot.match(/^3\(([A-L/]+)\)$/);
  if (m) return `グループ${m[1]}3位`;
  m = slot.match(/^W(\d+)$/);
  if (m) return `第${m[1]}試合勝者`;
  m = slot.match(/^L(\d+)$/);
  if (m) return `第${m[1]}試合敗者`;
  return slot;
}

/* ====== Bracket rendering ====== */
const BRACKET_LAYOUT = {
  // Left side, top -> bottom (matches that feed each SF half)
  leftR32: [74, 77, 73, 75, 83, 84, 81, 82],
  leftR16: [89, 90, 93, 94],
  leftQf:  [97, 98],
  leftSf:  [101],

  // Right side
  rightR32: [76, 78, 79, 80, 86, 88, 85, 87],
  rightR16: [91, 92, 95, 96],
  rightQf:  [99, 100],
  rightSf:  [102],
};

function renderBracket(data) {
  const container = document.getElementById('bracket');
  const byId = Object.fromEntries(
    data.knockout_matches.map((m) => [String(m.id), m]),
  );

  const cols = [
    { label: 'ラウンド32', cls: 'col-r32', ids: BRACKET_LAYOUT.leftR32 },
    { label: 'ラウンド16', cls: 'col-r16', ids: BRACKET_LAYOUT.leftR16 },
    { label: '準々決勝', cls: 'col-qf',  ids: BRACKET_LAYOUT.leftQf },
    { label: '準決勝',   cls: 'col-sf',  ids: BRACKET_LAYOUT.leftSf },
    { label: '決勝',     cls: 'col-final', ids: ['__final__'] },
    { label: '準決勝',   cls: 'col-sf',  ids: BRACKET_LAYOUT.rightSf },
    { label: '準々決勝', cls: 'col-qf',  ids: BRACKET_LAYOUT.rightQf },
    { label: 'ラウンド16', cls: 'col-r16', ids: BRACKET_LAYOUT.rightR16 },
    { label: 'ラウンド32', cls: 'col-r32', ids: BRACKET_LAYOUT.rightR32 },
  ];

  for (const col of cols) {
    const colEl = document.createElement('div');
    colEl.className = 'bracket-col ' + col.cls;
    const lbl = document.createElement('div');
    lbl.className = 'col-label';
    lbl.textContent = col.label;
    colEl.appendChild(lbl);
    for (const id of col.ids) {
      if (id === '__final__') {
        // final + 3rd
        const finalMatch = byId['104'];
        const thirdMatch = byId['103'];
        if (finalMatch) colEl.appendChild(buildMatchCell(finalMatch, data, 'match-final'));
        const trophy = document.createElement('div');
        trophy.className = 'trophy';
        trophy.textContent = '🏆';
        colEl.appendChild(trophy);
        const thirdLbl = document.createElement('div');
        thirdLbl.className = 'third-label';
        thirdLbl.textContent = '3位決定戦';
        colEl.appendChild(thirdLbl);
        if (thirdMatch) colEl.appendChild(buildMatchCell(thirdMatch, data, 'match-3rd'));
      } else {
        const m = byId[String(id)];
        if (m) colEl.appendChild(buildMatchCell(m, data));
      }
    }
    container.appendChild(colEl);
  }
}

function buildMatchCell(m, data, extraCls) {
  const cell = document.createElement('div');
  cell.className = 'match-cell' + (extraCls ? ' ' + extraCls : '');

  const dt = getJstParts(m.kickoff_utc);
  const date = document.createElement('div');
  date.className = 'match-date';
  date.innerHTML = `${dt.date}<br>${dt.time}`;
  cell.appendChild(date);

  // home team
  cell.appendChild(bracketTeamRow(m.home, m.home_code, m.home_score, m, data, 'home'));
  // away team
  cell.appendChild(bracketTeamRow(m.away, m.away_code, m.away_score, m, data, 'away'));
  return cell;
}

function bracketTeamRow(teamCode, slotCode, score, match, data, side) {
  const row = document.createElement('div');
  row.className = 'match-team';
  const team = teamCode ? data.teams[teamCode] : null;

  if (team) {
    let cls = '';
    if (match.home_score != null && match.away_score != null) {
      const hs = match.home_score, as = match.away_score;
      if (side === 'home') cls = hs > as ? 'winner' : (hs < as ? 'loser' : '');
      else cls = as > hs ? 'winner' : (as < hs ? 'loser' : '');
    }
    if (cls) row.classList.add(cls);
    row.innerHTML = `${flagImg(team, 'flag-sm')}<span class="team-name">${team.name_ja}</span>${score != null ? `<span class="team-score">${score}</span>` : ''}`;
  } else {
    row.classList.add('placeholder');
    row.innerHTML = `<span class="team-name">${slotLabelJa(slotCode)}</span>`;
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
    nameTd.innerHTML = `${flagImg(teamsRef[rowCode], 'flag-sm')}${teamsRef[rowCode].name_ja}`;
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
