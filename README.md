# FIFA ワールドカップ 2026 - 予定と結果

2026年 FIFA ワールドカップ（北中米大会）の予定と結果を一目で見れるサイト。
試合結果は GitHub Actions で Wikipedia から自動取得され、Vercel に静的サイトとしてデプロイされる。

## 構成

```
worldcup2026/
├── public/                      # Vercel に配信される静的ファイル
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── tournament.json          # 唯一のデータソース（スクレイパが更新）
├── scripts/
│   └── scrape_results.py        # Wikipedia から結果を取得
├── .github/workflows/
│   └── update-results.yml       # 全試合開始 +2:30 後にスクレイパを実行
├── vercel.json
└── README.md
```

## 仕様メモ

- **時刻表示**: 全て日本時間 (JST = UTC+9)
- **グループ表**: 4 か国を縦横に並べた十字表 + 勝点 / 得失点差 列
  - 結果が出ると順位順に行が並び替わる
  - セルは未消化 → 試合予定 (M/D HH:MM)、終了 → ○3-1× / △1-1△ / ×0-1○
- **トーナメント**: ラウンド毎にまとめた一覧
- **スクレイピング**: Wikipedia の `Football box collapsible` テンプレートからスコア抽出
- **スケジュール**: 全 104 試合の開始時刻 (UTC) + 2:30 から計算した 92 個の cron エントリ
  - 同時刻開始の試合は 1 エントリに集約

## ローカル動作

```powershell
# 静的サイトを開く
start public\index.html

# スクレイパを手動実行
python scripts\scrape_results.py
```

## デプロイ

`main` への push で Vercel が自動再デプロイ。スクレイパは `tournament.json` のみコミットするため、結果更新時も自動再デプロイ。
