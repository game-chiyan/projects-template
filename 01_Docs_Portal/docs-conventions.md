# docs-conventions.md（Docusaurus ドキュメント詳細規約）

各リポジトリの設計資料を Docusaurus + Mermaid で公開・横断閲覧するための詳細規約。要点と集約先はワークスペース横断ルール `CROSS_PROJECT_RULES.md`「Docusaurus ドキュメント運用」に定め、本書はその運用詳細を補う。

## GitHub Pages 公開（リポジトリ直下 website\）

- GitHub Pages で各リポジトリの資料を個別公開する場合は、リポジトリ直下の `website\` に最小の Docusaurus 設定・依存関係・ロックファイルを置き、`.github\workflows\` の専用 workflow でビルド・デプロイする（2026-07-10 指示）
- `website\node_modules\`、`website\.docusaurus\`、`website\build\` は `.gitignore` に記載し、`website\package-lock.json` は CI の再現性確保のためコミット対象に含める

## docs\ の構成

- `docs\index.md` にはプロジェクト概要と主要資料へのリンクを記載し、中央ポータルからプロジェクトトップとして参照できる状態にする
- `docs\` のディレクトリ構成は自動生成サイドバーの構成と一致させ、`architecture\`、`design\`、`adr\`、`operations\`、`assets\` など必要な分類だけを作成する
- カテゴリの表示名と順序は `_category_.json`、文書の表示名と順序は Front Matter の `title` と `sidebar_position` で指定する

## 記法・リンク・バージョニング

- 文書間リンクは `.md` を含む相対パスで記載し、画像や配布ファイルは `docs\assets\` に置く。`docs\` 外のファイルはリポジトリの Web URL で参照する
- 設計資料は Markdown で記述し、構造・処理・シーケンスなどの図は Mermaid を使用する
- Docusaurus のドキュメントバージョニングは必要性が明確になった場合だけ導入し、通常は Git 履歴で変更を管理する
