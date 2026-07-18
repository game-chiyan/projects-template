# 03_Checks — 運用ルール自動チェック

機械検証可能な運用ルールをスクリプトで検査する。AIの自己点検（確率的）を仕組み（決定的）で補強するための共有リソース。

## 使い方

```bat
cd /d <Projectsのパス>
node 03_Checks\run-checks.js .                    # Projects 全体
node 03_Checks\run-checks.js <プロジェクト>       # プロジェクト単位
node 03_Checks\run-checks.js . --check=doc-chars  # チェック指定
node 03_Checks\run-checks.js . --no-recursive --check=doc-chars,glossary-terms
```

- `--no-recursive`: 対象ディレクトリ直下だけを走査し、直下プロジェクトの設定も読み込まない
- 不明なチェック名、空の `--check=`、不明なオプションは走査前に引数エラーとする
- 終了コード: 0 = 機械検証対象の違反なし（警告のみ含む）/ 1 = 違反あり、対象不正、または引数エラー
- 違反 = ルール違反として修正対象。警告 = 意図的使用があり得るため人間が目視判定
- 終了コード0は機械検証可能な一部の通過だけを示し、全ルールへの適合を保証しない

### 横断ルール文書だけを検査する

workspace root（`Projects`）から次の4コマンドを実行する。ルート直下は再帰を止め、個別プロジェクトを走査しない。

```powershell
node .\03_Checks\run-checks.js . --no-recursive --check=doc-chars,glossary-terms
node .\03_Checks\run-checks.js .\02_Roles --check=doc-chars,glossary-terms
node .\03_Checks\run-checks.js .\03_Checks --check=doc-chars,glossary-terms
node .\03_Checks\run-checks.js .\04_Rules_Reference --check=doc-chars,glossary-terms
```

4コマンドすべてが終了コード0であることを横断文書変更の完了条件とする。

## 実行タイミング

1. AI: セッション終了時に対象範囲へ実行し、違反を修正または依頼者へ報告する
2. 依頼者: コミット前にローカルで実行する（こちらの結果を正ᴳとする）

## チェック一覧とルールID対応

| チェック | 内容 | 関連ルール |
| --- | --- | --- |
| doc-chars | Markdown の全角スペース・全角英数字・全角チルダ・U+FFFD（違反）、全角不等号・異体字黒リスト（警告） | CR-024 / CR-071 / MF-009 |
| unicode-escape | ソースコード中の `\uXXXX` エスケープ残存（設定があるプロジェクトのみ） | プロジェクト側規約（バイブコーディング時の混入防止） |
| resume-freshness | `resume.md` 記載の更新時刻が `worklog.md` より古い場合に警告 | CR-054 |
| glossary-terms | 定義済み用語の目印 U+1D33（ᴳ）が付いた通常表記と `` `reviewer`ᴳ `` が用語集（`04_Rules_Reference/glossary.md`）に実在するかを検査（実在のみの逆向き検査。付与漏れは対象外。字としての言及は除外） | CR-067 |

## 設定（check-config.json）

対象ディレクトリ直下に置く（任意）。例外はプロジェクト固有の事実のため、プロジェクト側に置く（CR-004 の配置判定に整合）。

```json
{
  "docChars": {
    "excludePaths": ["<外部由来資料などの除外パス接頭辞>/"],
    "fileAllowedChars": { "<相対パス>.md": ["<許可する文字>"] }
  },
  "unicodeEscape": {
    "targets": [{ "dir": "<リポジトリ>/src", "extensions": [".js"], "recursive": true }],
    "allowedEscapes": ["\\u2003"]
  }
}
```

- 親ディレクトリから実行した場合、直下プロジェクトの `check-config.json` も自動統合する（docChars 例外はパスにプロジェクト名を前置、unicodeEscape はプロジェクト単位で実行）。例外の正ᴳはプロジェクト側に1箇所だけ置く（CR-064）
- `~\Projects\<プロジェクト>\check-config.json`: 外部由来資料の引用文字や、意図的な Unicode エスケープ等をプロジェクト単位で許可する

## 既定の除外

- ディレクトリ: `node_modules` / `.git` / `.docusaurus` / `.codex` / `.agents` / `build` / `dist` / `coverage`
- ファイル: `handover-YYYY-MM-DD[-N].md` / `worklog.md` / `worklog-YYYY-MM[-N].md`（追記専用の歴史記録。違反文字の引用を含むため。CR-054 / CR-059）

## 既知の制約

- Cowork サンドボックスからの実行は、ホスト編集直後のファイルで読取途切れ（CS-002）による U+FFFD 誤検出があり得る。依頼者マシンでの実行結果を正ᴳとする
- resume-freshness は時刻をローカルタイムゾーンで解釈する。サンドボックス（UTC）実行では検知が甘くなるため、これも依頼者マシンでの実行を正ᴳとする

## 更新規律

- チェックの追加・変更は提案 → 依頼者承認後に反映する（CR-005）
- 新チェックは必ず関連ルールIDを持たせ、本 README の対応表を更新する
- 誤検出が出た場合: 意図的使用なら設定で許可、判定が割れるものは違反でなく警告に置く

---
最終確認日: 2026-07-18
