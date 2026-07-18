# 04_Rules_Reference（規範索引）

- 対象: `~\Projects` 配下のAIツールが、必要な規範だけを選んで読むための索引
- 位置づけ: 文書の役割・正ᴳ・参照トリガーの正ᴳ。詳細文書は `CROSS_PROJECT_RULES.md` から参照された範囲で規範となり、上位ルールを弱めない
- 読み方: 全文書を常時読み込まず、入口ファイルと `CROSS_PROJECT_RULES.md` を読んだ後、下表のトリガーに該当する文書だけを読む

## 文書の役割

| 文書 | 種別 | 正ᴳとする責務 | 主な参照元 |
| --- | --- | --- | --- |
| `CROSS_PROJECT_RULES.md` | 規範コア | 適用条件、必須行動、優先順位、確認境界 | `AGENTS.md` / `CLAUDE.md` |
| 本書 | 規範索引 | 文書の役割、正ᴳ、参照トリガー | CR-072 |
| `glossary.md` | 規範用語集 | 定義済み用語の意味と ᴳ の記法 | CR-067 |
| `session-phases.md` | 規範手順 | タスクᴳ種別、適用経路、開発フェーズᴳ、成果物、DoDᴳ | CR-049 / CR-050 / CR-065 |
| `session-phase-templates\*.md` | 規範様式 | `session-phases.md` が要求する成果物の記入構造 | `session-phases.md` |
| `orchestration.md` | 状況別規範 | サブエージェントの分解、委譲、統合、独立監査 | CR-034 / 各入口 |
| `mcp-file-ops.md` | 状況別規範 | MCP filesystem を使う場合のファイル操作 | ツール入口 |
| `cowork-sandbox.md` | 状況別規範 | Cowork サンドボックスで作業する場合の制約 | Claude入口 |
| `incident-log-template.md` | 規範様式 | プロジェクト側の初回失敗記録台帳の構造 | CR-018 |
| `02_Roles\README.md` / 各レンズ | 助言規範 | 判断レンズᴳと reviewerᴳ の起動条件・出力・判断補助 | CR-030〜CR-035 |
| `03_Checks\README.md` / `run-checks.js` | 検査実装 | 機械検証可能なルールの一部と実行方法 | CR-062 |
| ルート `README.md` | 非規範概要 | 人向けのワークスペース概要と導入案内 | なし |

テンプレートと検査実装は、参照元にない義務を単独で追加しない。`03_Checks` の成功は機械検証対象の通過だけを示し、全文書・全ルールへの適合を保証しない。

## 参照トリガー

| 状況 | 追加で読む文書 |
| --- | --- |
| タスクᴳを開始する、タスクᴳ種別・工程・DoDᴳを判定する | `session-phases.md` |
| ᴳ 付き用語を使う、意味や付与要否を確認する | `glossary.md` |
| サブエージェントで並列化・専門分離・独立監査を行う | `orchestration.md` |
| MCP filesystem でファイルを操作する | `mcp-file-ops.md` |
| Cowork サンドボックスで作業する | `cowork-sandbox.md` |
| プロジェクト側へ初めて失敗・指摘を記録する | `incident-log-template.md` |
| 判断レンズᴳまたは reviewerᴳ を使う | `02_Roles\README.md` と該当レンズ |
| ファイルを変更し、機械検査を実行する | `03_Checks\README.md` |

## 矛盾時の扱い

1. `CROSS_PROJECT_RULES.md` 冒頭の優先順位を適用する
2. 同じ優先階層では、具体的な適用条件を持つ規則を優先する
3. テンプレートまたは検査実装が規範コア・規範手順と矛盾する場合は、テンプレートまたは検査実装を修正する
4. 正ᴳが複数に見える場合は CR-064 に従って一元化し、未解決の間は依頼者へ裁定を求める
