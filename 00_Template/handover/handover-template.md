# handover-YYYY-MM-DD[-N].md（節目の区間要約）

CR-058 の節目で新しいファイルとして作成する。過去handoverは原則として書き換えない。タスク途中の引継ぎでは、本書末尾の再開用プロンプトを依頼者への最終回答にも同文で提示する。

- 作成時刻: YYYY-MM-DD HH:MM
- 実行ツール・セッション:
- 対象プロジェクト:
- workspace root:
- nested repository / branch / HEAD:
- upstream / local remote-tracking ref / ahead / behind:
- Git実行モード（human / ai-pr）/ 実行主体:
- worktree path / base branch / working branch / remote / PR base:
- latest commit / remote branch / PR URL:
- 現在タスクとゴール:
- 現在フェーズと状態:

## 引継ぎ区間の要約

- 開始地点:
- 完了事項:
- 途中状態:
- 主要な決定と理由:

## 現在の作業ツリー

- tracked:
- staged:
- unstaged:
- untracked:
- 保護すべき既存変更:

## 検証

- 最後に成功した検証:
- 最後に失敗した検証:
- 検証待ちキュー（CR-066）:
- 未確認事項:

## 未解決・ブロッカー・残作業

- 未解決・ブロッカー:
- AI側の残作業:
- 依頼者側の残作業:

## 次の一手

- 次に扱うexact files:
- 方針:
- 次のフェーズゲート:

## 権限境界

- 禁止操作:
- 追加承認が必要な操作:
- 再開初回のread-only停止と続行合意の要否:

## 参照先

- `resume.md`:
- `worklog.md`直近エントリ:
- task-records / 仕様 / 設計:

## 再開用プロンプト

```text
<対象プロジェクト>の<現在タスク>を<現在フェーズ>から再開します。

最初に、使用中AIツールに対応する入口ファイル、CROSS_PROJECT_RULES.md、PROJECT_RULES.md、resume.md、このhandover、指定task-records・仕様・設計をexact pathsの順に読んでください。worklog.mdは差異・ブロッカー・詳細経緯の確認が必要な場合だけ末尾を確認してください。

次に、workspace rootとnested repository、実行ユーザー、Git実行モード／実行主体／worktree path、base／作業branch、HEAD、upstream、local remote-tracking ref、ahead／behind、tracked、staged、unstaged、untracked、commit／remote branch／PR URL、保護すべき既存変更をread-onlyで照合してください。

現在タスク、現在フェーズ、直近完了ステップ、次のフェーズゲート、完了事項、途中状態、最後に成功・失敗した検証、検証待ちキュー、未確認事項、ブロッカー、AI側／依頼者側の残作業、次に扱うexact filesと方針、禁止操作、追加承認が必要な操作を確認してください。

<再開初回の停止条件と続行条件を具体的に記載>
```
