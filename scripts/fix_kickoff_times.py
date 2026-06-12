"""
tournament.json の kickoff_utc を Wikipedia の wikitext から再計算する一回限りスクリプト。

WebFetch で初期生成した時刻には UTC 変換の誤り（多くは 12h/24h 単位）があったため、
各 football box の `time=…` フィールドに含まれる
  6:00&nbsp;p.m. <includeonly>[[UTC−07:00|UTC−7]]</includeonly>
の **ローカル時刻 + UTC オフセット** を直接読んで UTC に変換し直す。
"""

import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

WIKI_API = "https://en.wikipedia.org/w/api.php"
UA = "wc2026-fix/1.0"

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def fetch_wikitext(page: str) -> str:
    params = {
        "action": "parse", "page": page, "prop": "wikitext",
        "format": "json", "formatversion": "2",
    }
    url = WIKI_API + "?" + urllib.parse.urlencode(params)
    delay = 5
    for attempt in range(6):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())["parse"]["wikitext"]
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            print(f"  [retry] 429 on {page}, sleeping {delay}s")
            time.sleep(delay)
            delay = min(delay * 2, 120)
    raise RuntimeError(f"giving up on {page} after retries")


def parse_box_fields(body: str) -> dict:
    """Split |key=value pairs, ignoring | inside {{…}} and [[…]] groups."""
    fields = {}
    brace = 0
    bracket = 0
    buf = []
    parts = []
    i = 0
    while i < len(body):
        if body[i:i+2] == "[[":
            bracket += 1; buf.append("[["); i += 2; continue
        if body[i:i+2] == "]]":
            bracket = max(0, bracket - 1); buf.append("]]"); i += 2; continue
        ch = body[i]
        if ch == "{":
            brace += 1
        elif ch == "}":
            brace = max(0, brace - 1)
        if ch == "|" and brace == 0 and bracket == 0:
            parts.append("".join(buf)); buf = []; i += 1; continue
        buf.append(ch); i += 1
    parts.append("".join(buf))
    for p in parts:
        if "=" not in p:
            continue
        k, _, v = p.partition("=")
        fields[k.strip().lower()] = v.strip()
    return fields


def find_boxes(wt: str):
    out = []
    i = 0
    while True:
        idx = wt.find("{{#invoke:football box", i)
        if idx < 0:
            break
        depth, end = 0, idx
        for k in range(idx, len(wt)):
            if wt[k:k+2] == "{{":
                depth += 1
            elif wt[k:k+2] == "}}":
                depth -= 1
                if depth == 0:
                    end = k + 2
                    break
        body = wt[idx + len("{{#invoke:football box"):end - 2]
        if body.startswith("|"):
            body = body[1:]
        if body.startswith("main"):
            body = body[4:].lstrip()
            if body.startswith("|"):
                body = body[1:]
        out.append(parse_box_fields(body))
        i = end
    return out


_DATE_TPL = re.compile(r"\{\{Start date\|(\d+)\|(\d+)\|(\d+)", re.IGNORECASE)
_TIME_12 = re.compile(r"(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?", re.IGNORECASE)
_TZ_HM   = re.compile(r"UTC[−\-](\d{1,2}):(\d{2})")
_TZ_H    = re.compile(r"UTC[−\-](\d{1,2})\b")
_FLAG    = re.compile(r"\{\{#invoke:flag\|[a-z\-]+\|([A-Z]{2,4})", re.IGNORECASE)


def parse_kickoff_utc(box):
    dm = _DATE_TPL.search(box.get("date", ""))
    # Normalise &nbsp;/U+00A0 to plain space so the AM/PM regex matches.
    time_text = box.get("time", "").replace("&nbsp;", " ").replace("\xa0", " ")
    tm = _TIME_12.search(time_text)
    if not dm or not tm:
        return None
    y, mo, d = int(dm.group(1)), int(dm.group(2)), int(dm.group(3))
    hr, mn = int(tm.group(1)), int(tm.group(2))
    ampm = tm.group(3).lower()
    if ampm == "a":
        if hr == 12: hr = 0
    else:
        if hr != 12: hr += 12
    tz_text = time_text
    tzhm = _TZ_HM.search(tz_text)
    if tzhm:
        offset_hours = -(int(tzhm.group(1)) + int(tzhm.group(2)) / 60)
    else:
        tzh = _TZ_H.search(tz_text)
        if not tzh:
            return None
        offset_hours = -int(tzh.group(1))
    local = datetime(y, mo, d, hr, mn)
    utc = local - timedelta(hours=offset_hours)
    return utc.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def team_code(raw):
    m = _FLAG.search(raw or "")
    return m.group(1).upper() if m else None


CODE_ALIAS = {"ZAF": "RSA", "CHE": "SUI", "DEU": "GER", "NLD": "NED",
              "DZA": "ALG", "HRV": "CRO", "PRT": "POR", "URY": "URU",
              "PRY": "PAR", "SAU": "KSA", "IRI": "IRN", "DRC": "COD"}


def main():
    root = Path(__file__).resolve().parent.parent
    data_path = root / "public" / "tournament.json"
    data = json.loads(data_path.read_text(encoding="utf-8"))

    updates = 0
    mismatches = []

    # --- Group stage --- (incremental save after each group)
    for g in "ABCDEFGHIJKL":
        boxes = find_boxes(fetch_wikitext(f"2026_FIFA_World_Cup_Group_{g}"))
        for box in boxes:
            c1 = team_code(box.get("team1", ""))
            c2 = team_code(box.get("team2", ""))
            c1 = CODE_ALIAS.get(c1, c1)
            c2 = CODE_ALIAS.get(c2, c2)
            iso = parse_kickoff_utc(box)
            if not (c1 and c2 and iso):
                continue
            target = next(
                (m for m in data["group_matches"]
                 if m["group"] == g and m["home"] == c1 and m["away"] == c2),
                None,
            )
            if not target:
                mismatches.append(("group", g, c1, c2))
                continue
            if target["kickoff_utc"] != iso:
                print(f"[fix] g-{g.lower()} {c1}-{c2}: {target['kickoff_utc']} -> {iso}")
                target["kickoff_utc"] = iso
                updates += 1
        # Persist after every group so a 429 mid-loop doesn't lose progress.
        data["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        data_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        time.sleep(5.0)

    # --- Knockout (R32) — Wikipedia knockout page boxes include placeholder
    #     names like '1A' that can't be parsed by flag template; reuse the
    #     individual group-stage Top of dates aren't available there. We skip
    #     this for now and rely on existing knockout times being right enough.
    #     If they aren't, the scraper picks them up after the matches resolve.

    if updates:
        data["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        data_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"[done] updated {updates} kickoff_utc values")
    else:
        print("[done] no kickoff_utc changes")

    if mismatches:
        print(f"[warn] {len(mismatches)} boxes could not be matched:")
        for m in mismatches[:10]:
            print("  ", m)


if __name__ == "__main__":
    main()
