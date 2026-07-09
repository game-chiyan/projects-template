# Projects Template

複数プロジェクトを同じ作業ルールで管理するためのワークスペーステンプレートです。

AIツールごとの入口ファイルと、プロジェクト横断ルール、プロジェクト固有ルールを分離して運用します。

## 構成

```text
~\Projects
├─ README.md
├─ AGENTS.md
├─ CLAUDE.md
├─ CROSS_PROJECT_RULES.md
├─ 00_Template
│  ├─ PROJECT_RULES.md
│  └─ handover
└─ <プロジェクトフォルダ>
   ├─ PROJECT_RULES.md
   ├─ handover
   └─ <リポジトリ本体>
```

## ルールファイル

- `AGENTS.md`: Codex / OpenAI 系ツール向けの入口ファイル
- `CLAUDE.md`: Claude 向けの入口ファイル
- `CROSS_PROJECT_RULES.md`: 全プロジェクト共通の横断ルール
- `PROJECT_RULES.md`: 各プロジェクト固有のルール

AIツールは、まず対応する入口ファイルを読み、続けて `CROSS_PROJECT_RULES.md` と対象プロジェクトの `PROJECT_RULES.md` を読みます。

## プロジェクト追加手順

1. `00_Template` を参考に、`<プロジェクトフォルダ>` を作成する
2. `<プロジェクトフォルダ>\PROJECT_RULES.md` を作成し、プロジェクト概要・ディレクトリ構成・技術スタック・固有運用を記載する
3. `<プロジェクトフォルダ>\handover` を作成し、セッション引継ぎファイルを置く
4. 必要に応じて `<プロジェクトフォルダ>\<リポジトリ本体>` を配置する

## 運用方針

- 横断ルールは `CROSS_PROJECT_RULES.md` に集約する
- プロジェクト固有の判断・制約・運用は `PROJECT_RULES.md` に記載する
- AIツール固有の注意は `AGENTS.md` または `CLAUDE.md` に記載する
- ルール追加時は、各ファイルのメタルールに従って提案し、承認後に反映する
- テンプレートとして公開する内容には、個別プロジェクト名や固有情報を含めない

## パス表記

ドキュメント内では、`Projects` より上位のディレクトリを `~\` として表記します。

```text
~\Projects\<プロジェクトフォルダ>\PROJECT_RULES.md
```

## セッション引継ぎ

各プロジェクトの `handover` ディレクトリに、セッション終了時の引継ぎファイルを作成します。

```text
~\Projects\<プロジェクトフォルダ>\handover\handover-YYYY-MM-DD[-N].md
```

引継ぎファイルには、完了事項・次タスクの作業順・未解決事項・運用ノートを記載します。
