"""
2026 FIFA World Cup の試合結果を Wikipedia から取得し、
public/tournament.json を更新する。

- グループステージ: 各グループの Football box collapsible テンプレートからスコアを抽出
- 決勝トーナメント: knockout stage ページの Football box から抽出（チームが確定後）
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WIKI_API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "worldcup2026-scraper/1.0 (https://github.com/central-infotech/worldcup2026)"

GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]


def fetch_wikitext(page: str) -> str:
    params = {
        "action": "parse",
        "page": page,
        "prop": "wikitext",
        "format": "json",
        "formatversion": "2",
    }
    url = WIKI_API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    if "parse" not in data:
        raise RuntimeError(f"failed to parse {page}: {data}")
    return data["parse"]["wikitext"]


def strip_wiki(s: str) -> str:
    if s is None:
        return ""
    # [[Country|Display]] -> Display
    s = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", s)
    # [[Country]] -> Country
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    # {{tl|x}} or other templates - remove (nested removed below)
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    # HTML tags
    s = re.sub(r"<[^>]+>", "", s)
    # &nbsp;
    s = s.replace("&nbsp;", " ")
    # Multiple whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


# 3-letter code from {{#invoke:flag|fb-rt|MEX}} or {{flagicon|MEX}} or similar
_FLAG_CODE_RE = re.compile(r"\{\{#invoke:flag\|[a-z\-]+\|([A-Z]{2,4})", re.IGNORECASE)
_FLAGICON_RE = re.compile(r"\{\{(?:flagicon|fb|fbicon|flag)\|([A-Z]{2,4})", re.IGNORECASE)


def extract_team_code_from_raw(raw: str) -> str:
    """team1 / team2 フィールドから3文字コードを取り出す。失敗時は名前を返す"""
    if not raw:
        return ""
    m = _FLAG_CODE_RE.search(raw)
    if m:
        return m.group(1).upper()
    m = _FLAGICON_RE.search(raw)
    if m:
        return m.group(1).upper()
    return strip_wiki(raw)


_SCORE_LINK_RE = re.compile(r"\{\{score link\b[^}]*\|\s*(\d+)\s*[\-–—]\s*(\d+)\s*\}\}", re.IGNORECASE)


def extract_score_from_raw(raw: str):
    """score フィールドからホーム/アウェイのスコアを取り出す"""
    if not raw:
        return None, None
    m = _SCORE_LINK_RE.search(raw)
    if m:
        return int(m.group(1)), int(m.group(2))
    stripped = strip_wiki(raw)
    m = re.search(r"(\d+)\s*[\-–—]\s*(\d+)", stripped)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def parse_template_fields(body: str) -> dict:
    """テンプレート本文 (|key=value 形式) を辞書化"""
    # naive splitter: split by lines starting with '|', preserve nesting
    fields = {}
    # find segments: each '|key=value' may span multiple lines
    # split on top-level | only
    depth = 0
    buf = []
    parts = []
    for ch in body:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth = max(0, depth - 1)
        if ch == "|" and depth == 0:
            parts.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    parts.append("".join(buf))
    for p in parts:
        if "=" not in p:
            continue
        k, _, v = p.partition("=")
        fields[k.strip().lower()] = v.strip()
    return fields


def find_football_boxes(wikitext: str) -> list:
    """football box テンプレートを全て抽出。
    対応形式:
      {{#invoke:football box|main|...}}
      {{Football box collapsible|...}}
      {{Football box|...}}
    """
    results = []
    text = wikitext
    # NOTE: do NOT use text.lower() for offset-based searching — some chars
    # (e.g. Turkish İ U+0130 → "i̇") expand when lowercased, shifting
    # positions and corrupting brace matching. Use regex with re.IGNORECASE.
    needles = [
        "{{#invoke:football box",
        "{{football box collapsible",
        "{{football box",
    ]
    needle_res = [re.compile(re.escape(n), re.IGNORECASE) for n in needles]
    i = 0
    while i < len(text):
        # find earliest needle position
        idx = -1
        used_needle = None
        for n, rx in zip(needles, needle_res):
            m = rx.search(text, i)
            if m is not None and (idx == -1 or m.start() < idx):
                idx = m.start()
                used_needle = n
        if idx == -1:
            break
        # find matching closing brace
        depth = 0
        end = idx
        k = idx
        while k < len(text):
            if text[k:k+2] == "{{":
                depth += 1
                k += 2
                continue
            if text[k:k+2] == "}}":
                depth -= 1
                k += 2
                if depth == 0:
                    end = k
                    break
                continue
            k += 1
        body = text[idx + len(used_needle):end - 2]
        if body.startswith("|"):
            body = body[1:]
        # For #invoke:football box, the first param is the function name (e.g., "main")
        # which is followed by | and then named params.
        if used_needle == "{{#invoke:football box":
            # body looks like: main\n|date=...\n|team1=...
            # skip up to the first newline-pipe or first pipe
            if body.startswith("main"):
                body = body[len("main"):]
                body = body.lstrip()
                if body.startswith("|"):
                    body = body[1:]
        fields = parse_template_fields(body)
        fields["__template__"] = used_needle
        results.append(fields)
        i = end
    return results


def parse_score(s: str):
    """スコア文字列から (home, away) を抽出。未確定なら None"""
    if not s:
        return None, None
    s = strip_wiki(s)
    # extract pure number-dash-number, skip aet/pen markers
    m = re.search(r"(\d+)\s*[-–—]\s*(\d+)", s)
    if not m:
        return None, None
    return int(m.group(1)), int(m.group(2))


def parse_pen_score(s: str):
    """ペナルティスコア文字列を解析"""
    if not s:
        return None
    s = strip_wiki(s)
    m = re.search(r"\(?\s*(\d+)\s*[-–—]\s*(\d+)\s*\)?", s)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def build_name_to_code(teams: dict) -> dict:
    name_to_code = {}
    for code, t in teams.items():
        name_to_code[t["name_en"].lower()] = code
    # Aliases
    aliases = {
        "united states": "USA",
        "usa": "USA",
        "ivory coast": "CIV",
        "côte d'ivoire": "CIV",
        "south korea": "KOR",
        "republic of korea": "KOR",
        "korea republic": "KOR",
        "dr congo": "COD",
        "congo dr": "COD",
        "democratic republic of the congo": "COD",
        "iran": "IRN",
        "ir iran": "IRN",
        "czechia": "CZE",
        "cape verde": "CPV",
        "cabo verde": "CPV",
    }
    for k, v in aliases.items():
        name_to_code[k] = v
    return name_to_code


def resolve_code(raw_team: str, name_to_code: dict) -> str:
    """team フィールドからチームコードを解決する。3文字コードならそのまま、名前なら辞書引き"""
    code_or_name = extract_team_code_from_raw(raw_team)
    if not code_or_name:
        return ""
    # 3-letter code path
    if re.fullmatch(r"[A-Z]{2,4}", code_or_name):
        # Map common Wikipedia codes to our internal codes
        wiki_to_our = {
            "USA": "USA",
            "MEX": "MEX",
            "RSA": "RSA", "ZAF": "RSA",
            "KOR": "KOR",
            "CZE": "CZE",
            "CAN": "CAN",
            "QAT": "QAT",
            "SUI": "SUI", "CHE": "SUI",
            "BIH": "BIH",
            "BRA": "BRA",
            "MAR": "MAR",
            "HAI": "HAI", "HTI": "HAI",
            "SCO": "SCO",
            "PAR": "PAR", "PRY": "PAR",
            "AUS": "AUS",
            "TUR": "TUR", "TUE": "TUR",
            "GER": "GER", "DEU": "GER",
            "CUW": "CUW",
            "CIV": "CIV",
            "ECU": "ECU",
            "NED": "NED", "NLD": "NED",
            "JPN": "JPN",
            "TUN": "TUN",
            "SWE": "SWE",
            "BEL": "BEL",
            "EGY": "EGY",
            "IRN": "IRN", "IRI": "IRN",
            "NZL": "NZL",
            "ESP": "ESP",
            "CPV": "CPV",
            "KSA": "KSA", "SAU": "KSA",
            "URU": "URU", "URY": "URU",
            "FRA": "FRA",
            "SEN": "SEN",
            "IRQ": "IRQ",
            "NOR": "NOR",
            "ARG": "ARG",
            "ALG": "ALG", "DZA": "ALG",
            "AUT": "AUT",
            "JOR": "JOR",
            "POR": "POR", "PRT": "POR",
            "COD": "COD", "DRC": "COD",
            "UZB": "UZB",
            "COL": "COL",
            "ENG": "ENG",
            "CRO": "CRO", "HRV": "CRO",
            "GHA": "GHA",
            "PAN": "PAN",
        }
        return wiki_to_our.get(code_or_name, "")
    # Fall back to name lookup
    return name_to_code.get(code_or_name.lower(), "")


def update_group_stage(data: dict, name_to_code: dict) -> int:
    updated = 0
    for g in GROUPS:
        page = f"2026_FIFA_World_Cup_Group_{g}"
        try:
            wikitext = fetch_wikitext(page)
        except Exception as e:
            print(f"[warn] failed to fetch {page}: {e}", file=sys.stderr)
            continue
        boxes = find_football_boxes(wikitext)
        for box in boxes:
            c1 = resolve_code(box.get("team1", ""), name_to_code)
            c2 = resolve_code(box.get("team2", ""), name_to_code)
            hs, as_ = extract_score_from_raw(box.get("score", ""))
            if hs is None or as_ is None:
                continue
            if not c1 or not c2:
                print(f"[warn] unresolved teams in {page}: team1={box.get('team1', '')[:60]!r} team2={box.get('team2', '')[:60]!r}", file=sys.stderr)
                continue
            for m in data["group_matches"]:
                if m["group"] != g:
                    continue
                if m["home"] == c1 and m["away"] == c2:
                    if m.get("home_score") != hs or m.get("away_score") != as_:
                        m["home_score"] = hs
                        m["away_score"] = as_
                        m["status"] = "finished"
                        updated += 1
                        print(f"[update] {m['id']}: {c1} {hs}-{as_} {c2}")
                    break
        time.sleep(0.3)
    return updated


def update_knockout(data: dict, name_to_code: dict) -> int:
    """決勝トーナメントの試合結果（とチーム確定）を更新。

    Wikipedia は R32 (新設) を専用ページ `2026_FIFA_World_Cup_round_of_32` で
    管理し、R16 以降を `2026_FIFA_World_Cup_knockout_stage` に置く構成。
    両ページから football box を集めて処理する。
    """
    pages = [
        "2026_FIFA_World_Cup_round_of_32",
        "2026_FIFA_World_Cup_knockout_stage",
    ]
    boxes = []
    for page in pages:
        try:
            wikitext = fetch_wikitext(page)
        except Exception as e:
            print(f"[warn] failed to fetch {page}: {e}", file=sys.stderr)
            continue
        page_boxes = find_football_boxes(wikitext)
        print(f"[info] {page}: {len(page_boxes)} football boxes")
        boxes.extend(page_boxes)
        time.sleep(0.3)
    if not boxes:
        return 0

    updated = 0
    for box in boxes:
        c1 = resolve_code(box.get("team1", ""), name_to_code)
        c2 = resolve_code(box.get("team2", ""), name_to_code)
        hs, as_ = extract_score_from_raw(box.get("score", ""))
        venue_str = strip_wiki(box.get("stadium", ""))

        if not c1 or not c2:
            continue

        # Try to match by venue + approximate date
        target = None
        for m in data["knockout_matches"]:
            if m.get("home") == c1 and m.get("away") == c2:
                target = m
                break
        if target is None:
            # Match by venue stem
            for m in data["knockout_matches"]:
                if venue_str and venue_str.split(",")[0].lower() in m.get("venue", "").lower():
                    if m.get("home") in (None, c1) and m.get("away") in (None, c2):
                        target = m
                        break
        if target is None:
            continue

        changed = False
        if target.get("home") != c1:
            target["home"] = c1
            changed = True
        if target.get("away") != c2:
            target["away"] = c2
            changed = True
        if hs is not None and (target.get("home_score") != hs or target.get("away_score") != as_):
            target["home_score"] = hs
            target["away_score"] = as_
            target["status"] = "finished"
            changed = True
        if changed:
            updated += 1
            print(f"[update] knockout {target['id']}: {c1} vs {c2} ({hs}-{as_})")
    return updated


def compute_third_place_ranking(data: dict) -> list:
    """各グループの3位チームを集めて順位付け。

    48チーム制では3位の上位8チームが決勝トーナメント (R32) に進出する。
    並び替えは FIFA の主要タイブレーカー (勝点 → 得失点差 → 得点) を適用し、
    全て同値の場合はチームコード昇順で安定化する。フェアプレー/抽選など
    末端タイブレーカーは未対応 (実用上ほぼ発生しない)。
    """
    ranking = []
    for g in GROUPS:
        codes = data["groups"][g]
        matches = [m for m in data["group_matches"] if m["group"] == g]
        stats = {c: {"code": c, "P": 0, "GF": 0, "GA": 0, "Pts": 0} for c in codes}
        for m in matches:
            hs, as_ = m.get("home_score"), m.get("away_score")
            if hs is None or as_ is None:
                continue
            h, a = stats[m["home"]], stats[m["away"]]
            h["P"] += 1
            a["P"] += 1
            h["GF"] += hs
            h["GA"] += as_
            a["GF"] += as_
            a["GA"] += hs
            if hs > as_:
                h["Pts"] += 3
            elif hs < as_:
                a["Pts"] += 3
            else:
                h["Pts"] += 1
                a["Pts"] += 1
        for s in stats.values():
            s["GD"] = s["GF"] - s["GA"]
        sorted_codes = sorted(
            codes,
            key=lambda c: (-stats[c]["Pts"], -stats[c]["GD"], -stats[c]["GF"], c),
        )
        third = stats[sorted_codes[2]]
        ranking.append({
            "code": third["code"],
            "group": g,
            "remaining": 3 - third["P"],
            "pts": third["Pts"],
            "gf": third["GF"],
            "ga": third["GA"],
            "gd": third["GD"],
        })
    ranking.sort(key=lambda r: (-r["pts"], -r["gd"], -r["gf"], r["code"]))
    # 標準的な 1224 ランキング (同値は同順位、次の異なる値は本来の位置)
    prev_key = None
    for i, r in enumerate(ranking):
        key = (r["pts"], r["gd"], r["gf"])
        if key != prev_key:
            r["rank"] = i + 1
            prev_key = key
        else:
            r["rank"] = ranking[i - 1]["rank"]
    return ranking


def sanity_check(data: dict) -> list:
    """グループステージの『俯瞰チェック』。

    各グループについて kickoff_utc が既に過ぎている試合数(past)と
    finished の試合数を比較し、ズレているグループを警告として返す。
    1グループだけ取りこぼしている場合などのパーサ不具合の早期検知が目的。
    """
    now = datetime.now(timezone.utc)
    by_group = {}
    for m in data.get("group_matches", []):
        g = m["group"]
        s = by_group.setdefault(g, {"past": 0, "finished": 0, "missing_ids": []})
        try:
            ko = datetime.fromisoformat(m["kickoff_utc"].replace("Z", "+00:00"))
        except Exception:
            continue
        if ko < now:
            s["past"] += 1
            if m.get("status") != "finished":
                s["missing_ids"].append(m["id"])
        if m.get("status") == "finished":
            s["finished"] += 1

    warnings = []
    print(f"[sanity] now (UTC) = {now.strftime('%Y-%m-%dT%H:%M:%SZ')}")
    for g in sorted(by_group):
        s = by_group[g]
        marker = "" if not s["missing_ids"] else f"  <-- MISSING {s['missing_ids']}"
        print(f"[sanity]   Group {g}: finished={s['finished']:>2} / past={s['past']:>2}{marker}")
        if s["missing_ids"]:
            warnings.append((g, s["missing_ids"]))
    if warnings:
        print(f"[sanity] WARNING: {len(warnings)} group(s) have past-kickoff matches without results", file=sys.stderr)
    return warnings


def main():
    repo_root = Path(__file__).resolve().parent.parent
    data_path = repo_root / "public" / "tournament.json"
    data = json.loads(data_path.read_text(encoding="utf-8"))
    name_to_code = build_name_to_code(data["teams"])

    g_updated = update_group_stage(data, name_to_code)
    k_updated = update_knockout(data, name_to_code)
    total = g_updated + k_updated
    print(f"[done] updated {total} matches (group: {g_updated}, knockout: {k_updated})")

    new_ranking = compute_third_place_ranking(data)
    ranking_changed = data.get("third_place_ranking") != new_ranking
    if ranking_changed:
        data["third_place_ranking"] = new_ranking
        print(f"[done] third-place ranking updated")

    if total > 0 or ranking_changed:
        data["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        data_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"[done] wrote {data_path}")

    sanity_check(data)


if __name__ == "__main__":
    main()
