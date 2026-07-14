# 03_Checks — 運用ルール自動チェック

機械検証可能な運用ルールをスクリプトで検査する。AIの自己点検（確率的）を仕組み（決定的）で補強するための共有リソース。

## 使い方

```bat
cd /d <Projectsのパス>
node 03_Checks\run-checks.js .                    # Projects 全体
node 03_Checks\run-checks.js FF14_Fishing_Alert   # プロジェクト単位
node 03_Checks\run-checks.js . --check=doc-chars  # チェック指定
```

- 終了コード: 0 = 違反なし（警告のみ含む）/ 1 = 違反あり
- 違反 = ルール違反として修正対象。警告 = 意図的使用があり得るため人間が目視判定

## 実行タイミング

1. AI: セッション終了時に対象範囲へ実行し、違反を修正または依頼者へ報告する
2. 依頼者: コミット前にローカルで実行する（こちらの結果を正とする）

## チェック一覧とルールID対応

| チェック | 内容 | 関連ルール |
| --- | --- | --- |
| doc-chars | Markdown の全角スペース・全角英数字・全角チルダ・U+FFFD（違反）、全角不等号・異体字黒リスト（警告） | CR-024, CL-003 / AG-003 / MF-009 |
| unicode-escape | ソースコード中の `\uXXXX` エスケープ残存（設定があるプロジェクトのみ） | プロジェクト側規約（バイブコーディング時の混入防止） |
| resume-freshness | `resume.md` 記載の更新時刻が `worklog.md` より古い場合に警告 | CR-054 |

## 設定（check-config.json）

対象ディレクトリ直下に置く（任意）。例外はプロジェクト固有の事実のため、プロジェクト側に置く（CR-004 の配置判定に整合）。

```json
{
  "docChars": {
    "excludePaths": ["<外部由来資料などの除外パス接頭辞>/"],
    "fileAllowedChars": { "<相対パス>.md": ["～", "＜"] }
  },
  "unicodeEscape": {
    "targets": [{ "dir": "<リポジトリ>/src", "extensions": [".js"], "recursive": true }],
    "allowedEscapes": ["\\u2003"]
  }
}
```

- 親ディレクトリから実行した場合、直下プロジェクトの `check-config.json` も自動統合する（docChars 例外はパスにプロジェクト名を前置、unicodeEscape はプロジェクト単位で実行）。例外の正はプロジェクト側に1箇所だけ置く（CR-064）
- `~\Projects\check-config.json`: 横断実行用（ルール文書内の意図的引用の許可など）
- `~\Projects\Auto_Trader\check-config.json`: 外部サイトのメニュー名引用（「５．マニュアル」等）の全角数字を許可
- `~\Projects\FF14_Fishing_Alert\check-config.json`: `\u2003`（emスペース） を意図的使用として許可（リポジトリ内 `src/scripts/check-unicode-escape.js` の汎用化。リポジトリ側スクリプトは CI 用にそのまま残す = リポジトリ自己完結 CR-037）

## 既定の除外

- ディレクトリ: `node_modules` / `.git` / `.docusaurus` / `.codex` / `.agents` / `build` / `dist` / `coverage`
- ファイル: `handover-YYYY-MM-DD[-N].md`（過去時点の歴史記録。違反文字の引用を含むため）

## 既知の制約

- Cowork サンドボックスからの実行は、ホスト編集直後のファイルで読取途切れ（CS-002）による U+FFFD 誤検出があり得る。依頼者マシンでの実行結果を正とする
- resume-freshness は時刻をローカルタイムゾーンで解釈する。サンドボックス（UTC）実行では検知が甘くなるため、これも依頼者マシンでの実行を正とする

## 更新規律

- チェックの追加・変更は提案 → 依頼者承認後に反映する（CR-005）
- 新チェックは必ず関連ルールIDを持たせ、本 README の対応表を更新する
- 誤検出が出た場合: 意図的使用なら設定で許可、判定が割れるものは違反でなく警告に置く

---
最終確認日: 2026-07-14
