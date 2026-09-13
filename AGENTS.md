# AGENTS.md（Codex / OpenAI 系入口）

- 対象: `~\Projects` 配下で Codex / OpenAI 系エージェントが作業する全セッション
- 位置づけ: 本書 = Codex / OpenAI 系ツール向け入口。プロジェクト横断ルールの実体は `CROSS_PROJECT_RULES.md` に置く
- 読み順: 本書 → `CROSS_PROJECT_RULES.md`。特定プロジェクトが対象の場合だけ `PROJECT_RULES.md` → `resume.md`（あれば）を読む。継続中タスク、再開用プロンプト、または続行指示がある場合は `~\Projects\04_Rules_Reference\session-phases.md` の再開手続きᴳに従い、指定handoverᴳ・タスク文書・必要時の `worklog.md` 末尾を確認する
- 状況別の参照先は `~\Projects\04_Rules_Reference\README.md` の参照トリガーに従う
- 優先順位は `CROSS_PROJECT_RULES.md` 冒頭に従う

## Codex / OpenAI 系ツール固有ルール

- AG-002: ツール実行結果は依頼者には直接見えないため、重要な出力は要点を最終回答に記載する
- AG-009: サブエージェント機能を利用でき、独立工程の並列化・異なる専門性の分離・品質ゲートでの独立監査が有効な場合は、`~\Projects\04_Rules_Reference\orchestration.md` に従う
- AG-010: PowerShell で複数のネイティブ検証コマンドを実行するときは、個別実行するか各コマンド直後の `$LASTEXITCODE` を確認し、途中失敗を最終 exit code へ伝播する
- AG-011: PowerShell の調査スクリプトでは Windows PowerShell 5.1 で利用可能な API・構文を使う。互換性が不明なものは事前に存在確認し、`$ErrorActionPreference = 'Stop'` と対象件数の自己検査を付け、非終端エラーや空結果を成功扱いにしない。ConstrainedLanguage では新しい .NET instance の生成や許可外methodに依存せず、native cmdletまたはNode helperを使う。mutation前にエラーが出た場合は停止し、対象をreadbackして未実施を確認する
- AG-012: 作業開始ゲート: 依頼者の「進めたい」「着手して」は調査・設計案の作成までの許可として扱い、CR-019 / CR-073 / CR-078 の合意・承認境界を守る。合意済み `ai-pr` の標準Git lifecycleは CR-095 に従う。対象 `PROJECT_RULES.md` の設計・開始ゲートが適用される場合は、コード編集前に設計正本、変更範囲、契約、migration、テスト、DoD、未検証範囲を提示して合意を得、未完了のフェーズゲートを越えない
- AG-013: Codex の `apply_patch` で複数fileまたは長い差分を扱い、timeout・中断・応答不良が起きた場合はnon-atomicとして全targetをreadbackし、未反映fileだけを再適用する。長い差分は1 file単位かつ一意なanchorで適用する

## AGENTS.md を育てるルール（メタルール）

1. AG-004: 追記トリガー: Codex / OpenAI 系ツール固有の失敗・制約・有効な回避策を発見した場合に追記候補とする
2. AG-005: 分析様式は CR-002、本文の簡潔さは CR-010 に従う
3. AG-006: 配置判定: ツール固有なら本書、全AIツール共通なら `CROSS_PROJECT_RULES.md`、特定プロジェクトだけなら `PROJECT_RULES.md` に置く
4. AG-007: 更新フローは CR-005、採番は CR-013 に従う
5. AG-008: 肥大化抑制: 本書は入口とツール固有差分だけに限定し、共通ルールを重複記載しない
