# Projects Template

複数プロジェクトを共通ルールで管理し、各リポジトリの設計資料をDocusaurus + Mermaidで横断閲覧するためのワークスペーステンプレートです。

[game-chiyan/projects-template](https://github.com/game-chiyan/projects-template)を`Projects`ディレクトリとしてcloneして使用します。

## セットアップ

```bat
git clone https://github.com/game-chiyan/projects-template.git Projects
cd /d Projects
```

`repository-template`自体を保守する場合は、独立したリポジトリとして配置します。

```bat
git clone https://github.com/game-chiyan/repository-template.git 00_Template\repository-template
```

## 構成

```text
~\Projects
├─ .gitignore
├─ README.md
├─ AGENTS.md
├─ CLAUDE.md
├─ CROSS_PROJECT_RULES.md
├─ 00_Template
│  ├─ PROJECT_RULES.md
│  └─ repository-template        # 独立したGitリポジトリ
├─ 01_Docs_Portal                # ローカル横断閲覧用Docusaurus
├─ 02_Roles                      # 判断のための観点レンズ集
└─ <プロジェクト>
   ├─ PROJECT_RULES.md
   ├─ handover
   └─ <リポジトリ>
      ├─ docs
      │  └─ index.md             # 必須。ポータルのプロジェクトトップ
      ├─ website                 # GitHub Pages公開用Docusaurus
      └─ .github\workflows
```

`00_Template`はテンプレート保守用のため、引継ぎファイルを置きません。

## ルールファイル

- `AGENTS.md`: Codex / OpenAI系ツール向けの入口
- `CLAUDE.md`: Claude向けの入口
- `CROSS_PROJECT_RULES.md`: 全プロジェクト共通の横断ルール
- `PROJECT_RULES.md`: 各プロジェクト固有のルール

AIツールは対応する入口ファイル、`CROSS_PROJECT_RULES.md`、対象プロジェクトの`PROJECT_RULES.md`、存在する場合は最新の引継ぎファイルの順に読みます。

## 判断レンズ（02_Roles）

`02_Roles`は、判断を複数の専門家の観点（レンズ）から見るための共通資産です。重要な判断では、関連するレンズと批判者レンズ（`reviewer`）を併用してトレードオフを洗い出し、意見が割れたら判断軸（`_judgment-axis.md`）に照らして決めます。レンズは助言であり、最終判断は依頼者が下します。レンズ一覧や使い方は`~\Projects\02_Roles\README.md`、運用ルールは`CROSS_PROJECT_RULES.md`の「判断レンズ運用」を参照します。

## プロジェクト追加手順

1. `~\Projects\<プロジェクト>\`を作成する
2. `00_Template\PROJECT_RULES.md`を参考に、プロジェクト直下へ`PROJECT_RULES.md`を作成する
3. 通常のプロジェクトでは`handover\`を作成する
4. [game-chiyan/repository-template](https://github.com/game-chiyan/repository-template)の`Use this template`から新しいリポジトリを作成する
5. 作成したリポジトリを`~\Projects\<プロジェクト>\<リポジトリ>\`へcloneする
6. リポジトリの`README.md`と`docs\index.md`をプロジェクト用に更新する

リポジトリ作成後のGitHub Pages設定とブランチ運用は、`repository-template`のREADMEに従います。

## ローカルドキュメントポータル

`01_Docs_Portal`は次の構成だけを検出します。

```text
~\Projects\<プロジェクト>\<リポジトリ>\docs\index.md
```

`~\Projects\<プロジェクト>\docs\`は検出対象外です。`00_Template`・`01_Docs_Portal`・`02_Roles`もプロジェクト一覧から除外されます。

コマンドプロンプトで次を実行します。

```bat
cd /d <Projectsのパス>\01_Docs_Portal
npm install --no-package-lock
npm start
```

起動後、`http://localhost:3000/`を開きます。終了する場合は`Ctrl+C`を押します。

## GitHub Pages

各リポジトリの`docs\`は、そのリポジトリ内のDocusaurusから個別にGitHub Pagesへ公開します。横断ポータル自体はGitHub Pagesへ公開しません。

`repository-template`から作成したリポジトリでは、`main`へドキュメント関連の変更がpushされた場合だけPagesデプロイを実行します。

## Git管理

ルート`.gitignore`は`Projects`直下のディレクトリを原則除外し、`NN_`（数字2桁＋`_`）で始まる進行用ディレクトリだけをパターン（`/[0-9][0-9]_*/`）で追跡許可します。新規プロジェクトの追加でも、`NN_`進行用ディレクトリの追加でも、`.gitignore`の更新は不要です。

`00_Template\repository-template`は独立したGitリポジトリであり、親の`projects-template`では追跡しません。

## パス表記

ドキュメントでは、`Projects`より上位のディレクトリを`~\`として表記します。

```text
~\Projects\<プロジェクト>\PROJECT_RULES.md
```

## セッション引継ぎ

通常のプロジェクトでは、セッション終了時に次の引継ぎファイルを作成します。

```text
~\Projects\<プロジェクト>\handover\handover-YYYY-MM-DD[-N].md
```

引継ぎファイルには、完了事項・次タスクの作業順・未解決事項・運用ノートを記載します。`00_Template`の保守作業では作成しません。
