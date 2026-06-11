(async function () {
  const data = await fetch('tournament.json?ts=' + Date.now())
    .then((r) => r.json())
    .catch((e) => { console.error(e); return null; });
  if (!data) {
    document.getElementById('groups').textContent = 'データを読み込めませんでした。';
    return;
  }

  // header updated_at
  if (data.updated_at) {
    const d = new Date(data.updated_at);
    document.getElementById('updated').textContent =
      '最終更新: ' + formatJstDateTime(d);
  }

  renderGroups(data);
  renderKnockout(data);
})();

function formatJstDateTime(date) {
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(date);
}

function formatJstShort(isoUtc) {
  const d = new Date(isoUtc);
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // "6/14 23:00"
  const parts = fmt.formatToParts(d);
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  const hh = parts.find((p) => p.type === 'hour').value;
  const mm = parts.find((p) => p.type === 'minute').value;
  return `${m}/${day} ${hh}:${mm}`;
}

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

    // compute standings
    const standings = computeStandings(teamCodes, matches);

    // sort teams by standings ranking
    const sortedCodes = standings.slice().sort(rankCompare).map((s) => s.code);

    // build cross table
    const table = buildCrossTable(sortedCodes, data.teams, matches, standings);
    card.appendChild(table);
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
  for (const c of teamCodes) {
    stats[c].GD = stats[c].GF - stats[c].GA;
  }
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
  for (const m of matches) {
    matchByPair[m.home + '|' + m.away] = m;
  }

  const table = document.createElement('table');
  table.className = 'cross-table';

  // header
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.appendChild(th(''));
  for (const c of teamCodes) {
    hr.appendChild(th(teamsRef[c].flag));
  }
  hr.appendChild(th('勝点'));
  hr.appendChild(th('得失'));
  thead.appendChild(hr);
  table.appendChild(thead);

  // body
  const tbody = document.createElement('tbody');
  for (const rowCode of teamCodes) {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.className = 'team-name';
    nameTd.innerHTML = `<span class="flag">${teamsRef[rowCode].flag}</span>${teamsRef[rowCode].name_ja}`;
    tr.appendChild(nameTd);

    for (const colCode of teamCodes) {
      const td = document.createElement('td');
      if (rowCode === colCode) {
        td.className = 'self-cell';
        td.textContent = '—';
      } else {
        // Find the match between rowCode and colCode (regardless of home/away)
        let m = matchByPair[rowCode + '|' + colCode];
        let rowIsHome = true;
        if (!m) {
          m = matchByPair[colCode + '|' + rowCode];
          rowIsHome = false;
        }
        if (m) {
          if (m.home_score != null && m.away_score != null) {
            td.innerHTML = formatResult(m, rowIsHome);
          } else {
            const span = document.createElement('span');
            span.className = 'scheduled';
            span.textContent = formatJstShort(m.kickoff_utc);
            td.appendChild(span);
          }
        }
      }
      tr.appendChild(td);
    }

    // stats
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

function th(text) {
  const e = document.createElement('th');
  e.textContent = text;
  return e;
}

function formatResult(m, rowIsHome) {
  // From the row team's perspective, show "○3-1×" / "△1-1△" / "×0-1○"
  const rowScore = rowIsHome ? m.home_score : m.away_score;
  const colScore = rowIsHome ? m.away_score : m.home_score;
  let rowMark, colMark;
  if (rowScore > colScore) { rowMark = '<span class="mark-win">○</span>'; colMark = '<span class="mark-loss">×</span>'; }
  else if (rowScore < colScore) { rowMark = '<span class="mark-loss">×</span>'; colMark = '<span class="mark-win">○</span>'; }
  else { rowMark = '<span class="mark-draw">△</span>'; colMark = '<span class="mark-draw">△</span>'; }
  return `<span class="result">${rowMark}${rowScore}-${colScore}${colMark}</span>`;
}

function renderKnockout(data) {
  const container = document.getElementById('knockout');
  const rounds = [
    { key: 'R32', label: 'ラウンド32' },
    { key: 'R16', label: 'ラウンド16' },
    { key: 'QF',  label: '準々決勝' },
    { key: 'SF',  label: '準決勝' },
    { key: '3RD', label: '3位決定戦' },
    { key: 'F',   label: '決勝' },
  ];
  for (const r of rounds) {
    const ms = data.knockout_matches.filter((m) => m.round === r.key);
    if (!ms.length) continue;
    const card = document.createElement('div');
    card.className = 'round-card';
    const h = document.createElement('h3');
    h.textContent = r.label;
    card.appendChild(h);
    for (const m of ms) {
      card.appendChild(renderKnockoutMatch(m, data));
    }
    container.appendChild(card);
  }
}

function renderKnockoutMatch(m, data) {
  const row = document.createElement('div');
  row.className = 'match-row';

  const meta = document.createElement('div');
  meta.className = 'match-meta';
  meta.textContent = `${formatJstShort(m.kickoff_utc)} ・ ${m.venue || ''}`;
  row.appendChild(meta);

  const line = document.createElement('div');
  line.className = 'match-line';

  const homeName = labelForKnockoutSide(m.home, m.home_code, data);
  const awayName = labelForKnockoutSide(m.away, m.away_code, data);

  const home = document.createElement('div');
  home.className = 'match-team home';
  home.innerHTML = homeName;

  const away = document.createElement('div');
  away.className = 'match-team away';
  away.innerHTML = awayName;

  const score = document.createElement('div');
  if (m.home_score != null && m.away_score != null) {
    score.className = 'match-score';
    score.textContent = `${m.home_score} - ${m.away_score}`;
  } else {
    score.className = 'match-score tbd';
    score.textContent = 'vs';
  }

  line.appendChild(home);
  line.appendChild(score);
  line.appendChild(away);
  row.appendChild(line);
  return row;
}

function labelForKnockoutSide(teamCode, slot, data) {
  if (teamCode && data.teams[teamCode]) {
    const t = data.teams[teamCode];
    return `<span class="flag">${t.flag}</span>${t.name_ja}`;
  }
  // slot is something like "1A" or "W73"
  return `<span style="color: var(--text-dim)">${slot || 'TBD'}</span>`;
}
