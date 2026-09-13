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
├─ incident-log.md              # 横断作業の失敗・指摘台帳
├─ 00_Template
│  ├─ PROJECT_RULES.md
│  ├─ handover                    # resume / worklog / 節目handoverの雛形
│  └─ repository-template        # 独立したGitリポジトリ
├─ 01_Docs_Portal                # ローカル横断閲覧用Docusaurus
├─ 02_Roles                      # 判断のための観点レンズ集
├─ 03_Checks                     # 運用ルール自動チェック（run-checks.js）
├─ 04_Rules_Reference            # 規範索引・フェーズᴳ・用語・台帳雛形・状況別ルール
└─ <プロジェクト>
   ├─ PROJECT_RULES.md
   ├─ handover
   │  ├─ resume.md               # 現在の再開地点（上書き・常時最新）
   │  ├─ worklog.md              # 作業履歴（追記専用）
   │  └─ handover-YYYY-MM-DD.md  # 節目の保全・要約
   └─ <リポジトリ>
      ├─ docs
      │  └─ index.md             # 必須。ポータルのプロジェクトトップ
      ├─ website                 # GitHub Pages公開用Docusaurus
      └─ .github\workflows
```

`00_Template`は新規プロジェクトの雛形（コピー元）です。横断ルールは`Projects`直下と`04_Rules_Reference\`で保守します。`handover\`には空の雛形（`resume.md`・`worklog.md`・`handover-template.md`）だけを置き、実際の引継ぎ記録は保守作業では作成しません。

## ルールファイル

- `AGENTS.md`: Codex / OpenAI系ツール向けの入口
- `CLAUDE.md`: Claude向けの入口
- `CROSS_PROJECT_RULES.md`: 全プロジェクト共通の横断ルール
- `PROJECT_RULES.md`: 各プロジェクト固有のルール
- `04_Rules_Reference\README.md`: 文書の役割・正ᴳ・参照トリガーを示す規範索引
- `04_Rules_Reference\`: セッションフェーズᴳ、用語集、失敗台帳雛形、MCPファイル操作、Coworkサンドボックス、オーケストレーション等の詳細
- `incident-log.md`: プロジェクトに属さない横断作業で発生した失敗・指摘の台帳

AIツールは対応する入口ファイルと`CROSS_PROJECT_RULES.md`を読みます。特定プロジェクトが対象の場合だけ`PROJECT_RULES.md`と`resume.md`を追加で読みます。継続中タスク、再開用プロンプト、または続行指示がある場合は`session-phases.md`の再開手続きᴳに従い、指定handoverᴳ・タスク文書・必要時の`worklog.md`末尾を確認します。状況別資料は`04_Rules_Reference\README.md`の参照トリガーに該当するときだけ読みます。ルールはファイル別接頭辞＋3桁通し番号のID（例: `CR-024`）で識別します。

## 判断レンズᴳ（02_Roles）

`02_Roles`は、判断を複数の専門家の観点（レンズ）から見るための共通資産です。要件・詳細設計・リファクタ後と、基本設計が最終設計成果物になる品質ゲートでは`reviewer`ᴳを使い、高リスク判断では関連レンズ2〜3個を追加してトレードオフを確認します。意見が割れたら判断軸（`_judgment-axis.md`）に照らし、最終判断は依頼者または依頼者が指定した承認者が下します。

## プロジェクト追加手順

1. `00_Template`を`~\Projects\<プロジェクト>\`へコピーする（`repository-template`は除く）。これで`PROJECT_RULES.md`と`handover\`（`resume.md`・`worklog.md`・節目handoverᴳの雛形）が揃う
2. コピーした`PROJECT_RULES.md`をプロジェクト用に記入する
3. [game-chiyan/repository-template](https://github.com/game-chiyan/repository-template)の`Use this template`から新しいリポジトリを作成する
4. 作成したリポジトリを`~\Projects\<プロジェクト>\<リポジトリ>\`へcloneする
5. リポジトリの`README.md`と`docs\index.md`をプロジェクト用に更新する

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

## セッション遷移と引継ぎ

通常のプロジェクトでは、`handover` ディレクトリに継続作業ログを持ちます（`00_Template` では作成しません）。`~\Projects` 直下・`NN_` 配下の横断／非プロジェクト作業では継続ログを作らず、実施結果と未検証事項は最終報告に記載します。`incident-log.md`へ記録するのは失敗・指摘だけです（CR-068）。

- `resume.md`: 現在の再開地点を1枚に上書き保存します（常に最新・短く保つ）
- `worklog.md`: 重要な作業差分・決定・検証結果を追記専用で残します
- `handover-YYYY-MM-DD[-N].md`: タスクᴳ完了・長期中断・担当交代などの節目を要約し、タスク途中の引継ぎでは末尾に再開用プロンプトを保存します

同じ説明を複数文書へ重複記載せず、現在地点・証跡・節目要約を役割分担することで、任意のAIツール・セッションへ引き継げます。

セッション開始時は開始手続きᴳを行い、継続中タスクがあれば再開手続きᴳへ進みます。再開用プロンプトがない、不完全、または実状態と一致しない場合は復旧再開として、`resume.md`、最新handoverᴳ、`worklog.md`末尾、task-recordsᴳ、Git状態、変更済み・新規ファイルから現状をread-onlyで復元します。復元結果は`確認済み`・`推定`・`不明`に分け、初回復元中は編集・test・Git／ref変更・削除・外部操作を行いません。

タスクᴳ途中の長期中断、担当・AIツール交代などの節目では引継手続きᴳを行い、その区間を要約した保全用の引継ぎファイルを作成します。短い同一文脈の中断では節目handoverᴳや再開用プロンプトを作らず、`resume.md`と`worklog.md`のチェックポイントだけを更新します。タスクᴳが完了した場合は終了手続きᴳを行います。

```text
~\Projects\<プロジェクト>\handover\handover-YYYY-MM-DD[-N].md
```

保全用ファイルには、現在タスクᴳ・フェーズᴳ、Git・ファイル状態、完了事項、途中状態、検証、未解決事項、権限境界、次のexact filesと作業順を記載します。タスク途中の引継ぎでは、AI向け入口からのexact paths付き読み順とread-only停止条件を含む再開用プロンプトを末尾へ保存し、依頼者にも同文を提示します。`00_Template` の保守作業では実記録を作成しません。
