# AGENTS.md（Codex / OpenAI 系入口）

- 対象: `~\Projects` 配下で Codex / OpenAI 系エージェントが作業する全セッション
- 位置づけ: 本書 = Codex / OpenAI 系ツール向け入口。プロジェクト横断ルールの実体は `CROSS_PROJECT_RULES.md` に置く
- 読み順: 本書 → `CROSS_PROJECT_RULES.md`。特定プロジェクトが対象の場合だけ `PROJECT_RULES.md` → `resume.md`（あれば）を読み、handoverᴳ / `worklog.md` は詳細確認が必要なときだけ参照する
- 状況別の参照先は `~\Projects\04_Rules_Reference\README.md` の参照トリガーに従う
- 優先順位は `CROSS_PROJECT_RULES.md` 冒頭に従う

## Codex / OpenAI 系ツール固有ルール

- AG-002: ツール実行結果は依頼者には直接見えないため、重要な出力は要点を最終回答に記載する

## AGENTS.md を育てるルール（メタルール）

1. AG-004: 追記トリガー: Codex / OpenAI 系ツール固有の失敗・制約・有効な回避策を発見した場合に追記候補とする
2. AG-005: 分析様式は CR-002、本文の簡潔さは CR-010 に従う
3. AG-006: 配置判定: ツール固有なら本書、全AIツール共通なら `CROSS_PROJECT_RULES.md`、特定プロジェクトだけなら `PROJECT_RULES.md` に置く
4. AG-007: 更新フローは CR-005、採番は CR-013 に従う
5. AG-008: 肥大化抑制: 本書は入口とツール固有差分だけに限定し、共通ルールを重複記載しない
