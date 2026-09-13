/**
 * @fileoverview run-checks.js の escalation-gap チェックの自動テスト（CR-025）
 *
 * 実行: workspace root（Projects）から
 *   node --test 03_Checks\test\run-checks.test.js
 *
 * フィクスチャは JS 文字列リテラルとしてインラインで持ち、本ディレクトリへ .md ファイルを置かない。
 * EXCLUDE_DIRS に test が無く collectFiles が再帰するため、.md を置くと doc-chars /
 * glossary-terms の走査対象に入り、意図的に崩した記法が新規違反として検出されるため。
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  collectFiles,
  classifyStatus,
  parseIncidentLog,
  collectIncidentLogs,
  checkEscalationGap,
} = require("../run-checks.js");

/** 台帳のヘッダ行と区切り行（CR-016 の6列） */
const LEDGER_HEADER = [
  "# incident-log.md（テスト用フィクスチャ）",
  "",
  "- 運用: 失敗・指摘の1回目をここに記録する",
  "",
  "| 日付 | 事象 | 原因 | 暫定対処 | 状態 | 関連ルール |",
  "| --- | --- | --- | --- | --- | --- |",
];

/**
 * 台帳の Markdown 文字列を組み立てる
 * @param {Array} rows - 行ごとのセル配列。文字列を渡した場合はその行をそのまま使う
 * @return {string} 台帳の全文
 */
function ledger(rows) {
  const lines = LEDGER_HEADER.slice();
  for (const row of rows) {
    lines.push(typeof row === "string" ? row : `| ${row.join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * 日付・状態・関連ルールだけを指定して1行を作る（事象・原因・暫定対処はダミー）
 * @param {string} date - 日付
 * @param {string} status - 状態欄の値
 * @param {string} rules - 関連ルール欄の値
 * @return {string[]} セル配列
 */
function row(date, status, rules) {
  return [date, "ダミー事象", "ダミー原因", "ダミー暫定対処", status, rules];
}

/**
 * 一時ディレクトリへ台帳を書き出してコールバックを実行する
 * @param {Object} files - ファイル相対パスと内容の対応
 * @param {(dir: string) => void} fn - 一時ディレクトリを受け取る処理
 */
function withTempDir(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b10-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * escalation-gap の警告のうち、昇格漏れ（行番号を持たないもの）だけを返す
 * @param {string[]} warnings - 警告一覧
 * @return {string[]} 昇格漏れ警告
 */
function gapWarnings(warnings) {
  return warnings.filter((w) => /の未対処の再発が/.test(w));
}

/**
 * escalation-gap の警告のうち、書式異常だけを返す
 * @param {string[]} warnings - 警告一覧
 * @return {string[]} 書式異常警告
 */
function formatWarnings(warnings) {
  return warnings.filter((w) => !/の未対処の再発が/.test(w));
}

test("scanExcludePaths は保護directoryをreaddirSyncより前に除外する", () => {
  const root = path.resolve("virtual-scan-root");
  const protectedPath = path.resolve(root, "protected");
  const originalExistsSync = fs.existsSync;
  const originalReaddirSync = fs.readdirSync;
  fs.existsSync = function guardedExistsSync(targetPath) {
    if (path.resolve(targetPath) === protectedPath) return true;
    return originalExistsSync.call(fs, targetPath);
  };
  fs.readdirSync = function guardedReaddirSync(targetPath, ...args) {
    if (path.resolve(targetPath) === protectedPath) {
      const error = new Error("simulated protected directory");
      error.code = "EPERM";
      throw error;
    }
    return originalReaddirSync.call(fs, targetPath, ...args);
  };
  try {
    assert.throws(
      () => collectFiles(protectedPath, () => true, true),
      (error) => error && error.code === "EPERM",
    );
    assert.deepStrictEqual(
      collectFiles(protectedPath, () => true, true, null, root, ["protected"]),
      [],
    );
  } finally {
    fs.existsSync = originalExistsSync;
    fs.readdirSync = originalReaddirSync;
  }
});

// ---------------------------------------------------------------------------
// classifyStatus: 状態欄の5値規約（要件 3.1）
// ---------------------------------------------------------------------------

test("classifyStatus: 様子見は watch", () => {
  assert.strictEqual(classifyStatus("様子見"), "watch");
});

test("classifyStatus: 昇格済は付記の有無によらず promoted", () => {
  assert.strictEqual(classifyStatus("昇格済"), "promoted");
  assert.strictEqual(
    classifyStatus("昇格済（CR-085・機械化は B-11）"),
    "promoted",
  );
  assert.strictEqual(classifyStatus("昇格済（CS-006 改訂）"), "promoted");
});

test("classifyStatus: 再発（未対処）と素の再発はどちらも open（fail-safe）", () => {
  assert.strictEqual(classifyStatus("再発（未対処）"), "open");
  assert.strictEqual(classifyStatus("再発"), "open");
});

test("classifyStatus: 再発（対処: X）は resolved。コロンは半角・全角どちらも許容する", () => {
  assert.strictEqual(classifyStatus("再発（対処: CR-054 改訂）"), "resolved");
  assert.strictEqual(classifyStatus("再発（対処：CR-054 改訂）"), "resolved");
  assert.strictEqual(classifyStatus("再発（対処:CR-078 新設）"), "resolved");
});

test("classifyStatus: 規約外の値は unknown", () => {
  assert.strictEqual(classifyStatus("対応済み"), "unknown");
  assert.strictEqual(classifyStatus("再発（対処）"), "unknown");
  assert.strictEqual(classifyStatus("昇格済（）"), "unknown");
  assert.strictEqual(classifyStatus(""), "unknown");
});

test("classifyStatus: 対処先が空白だけの再発は resolved にしない（警告を消す抜け道を塞ぐ）", () => {
  assert.strictEqual(classifyStatus("再発（対処: ）"), "unknown");
  assert.strictEqual(classifyStatus("再発（対処:　）"), "unknown");
  assert.strictEqual(classifyStatus("再発（対処:）"), "unknown");
  assert.strictEqual(classifyStatus("昇格済（ ）"), "unknown");
  assert.strictEqual(
    classifyStatus("再発（対処: C）"),
    "resolved",
    "1文字でも実体があれば通す",
  );
});

test("classifyStatus: 半角括弧は規約外として弾く", () => {
  assert.strictEqual(classifyStatus("再発(未対処)"), "unknown");
  assert.strictEqual(classifyStatus("再発（未対処)"), "unknown");
  assert.strictEqual(classifyStatus("昇格済(CR-085)"), "unknown");
});

// ---------------------------------------------------------------------------
// parseIncidentLog: 表のパース（要件 FR-2 / FR-4）
// ---------------------------------------------------------------------------

test("parseIncidentLog: ヘッダ・区切り・表以外の行を除いてデータ行だけを返す", () => {
  const { rows, anomalies } = parseIncidentLog(
    ledger([
      row("2026-07-01", "様子見", "CR-021"),
      row("2026-07-02", "昇格済", "CR-025"),
    ]),
  );
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(anomalies.length, 0);
  assert.strictEqual(rows[0].date, "2026-07-01");
  assert.strictEqual(rows[0].kind, "watch");
  assert.deepStrictEqual(rows[1].ruleIds, ["CR-025"]);
});

test("parseIncidentLog: 空の台帳（雛形状態）でも例外にならず0行を返す", () => {
  const { rows, anomalies } = parseIncidentLog(ledger([]));
  assert.strictEqual(rows.length, 0);
  assert.strictEqual(anomalies.length, 0);
});

test("AC-04 parseIncidentLog: 関連ルール欄の複数IDをすべて抽出し重複を除く", () => {
  const { rows } = parseIncidentLog(
    ledger([row("2026-07-01", "再発（未対処）", "CR-054・CR-063・CR-054")]),
  );
  assert.deepStrictEqual(rows[0].ruleIds, ["CR-054", "CR-063"]);
});

test("parseIncidentLog: ルールIDはCR/CL/AG/MF/CS/OR/PJ形式のみを拾う（CR-013）", () => {
  const { rows } = parseIncidentLog(
    ledger([row("2026-07-01", "様子見", "CR-021・PJ-030・CS-006・OR-009")]),
  );
  assert.deepStrictEqual(rows[0].ruleIds, [
    "CR-021",
    "CS-006",
    "OR-009",
    "PJ-030",
  ]);
});

test("AC-10 parseIncidentLog: 列数が6でない行を columns 異常として行番号つきで報告する", () => {
  const text = ledger([
    row("2026-07-01", "様子見", "CR-021"),
    "| 2026-07-02 | セル内に | が混ざった事象 | 原因 | 暫定対処 | 様子見 | CR-025 |",
  ]);
  const { rows, anomalies } = parseIncidentLog(text);
  assert.strictEqual(rows.length, 1, "異常行は rows に含めない");
  assert.strictEqual(anomalies.length, 1);
  assert.strictEqual(anomalies[0].type, "columns");
  assert.strictEqual(anomalies[0].lineNo, 8, "物理行番号を返す");
});

test("parseIncidentLog: エスケープされた縦棒はセル区切りにしない", () => {
  const text = ledger([
    "| 2026-07-13 | JSDoc の `{{env: string\\|null}}` で lint が落ちた | 原因 | 暫定対処 | 昇格済 | PJ-024 |",
  ]);
  const { rows, anomalies } = parseIncidentLog(text);
  assert.deepStrictEqual(anomalies, [], "エスケープ済みなら列数異常にしない");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].kind, "promoted");
  assert.deepStrictEqual(rows[0].ruleIds, ["PJ-024"]);
});

test("parseIncidentLog: エスケープされたバックスラッシュの直後の縦棒は区切りとして扱う", () => {
  const text = ledger([
    "| 2026-07-01 | パスに `~\\Projects\\\\` を含む事象 | 原因 | 暫定対処 | 再発（未対処） | CR-099 |",
  ]);
  const { rows, anomalies } = parseIncidentLog(text);
  assert.deepStrictEqual(anomalies, [], "列がずれない");
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(
    rows[0].ruleIds,
    ["CR-099"],
    "セルの誤結合でIDを取りこぼさない",
  );
  assert.strictEqual(rows[0].kind, "open");
});

test("parseIncidentLog: 行頭の縦棒が欠けた表行を row-shape 異常として報告する（黙って捨てない）", () => {
  const text = ledger([
    "2026-07-01 | 事象 | 原因 | 暫定対処 | 再発（未対処） | CR-099 |",
  ]);
  const { rows, anomalies } = parseIncidentLog(text);
  assert.strictEqual(rows.length, 0);
  assert.strictEqual(anomalies.length, 1);
  assert.strictEqual(anomalies[0].type, "row-shape");
});

test("parseIncidentLog: インデントされた表行も row-shape 異常として報告する", () => {
  const text = ledger([
    "  | 2026-07-01 | 事象 | 原因 | 暫定対処 | 再発（未対処） | CR-099 |",
  ]);
  const { rows, anomalies } = parseIncidentLog(text);
  assert.strictEqual(rows.length, 0);
  assert.strictEqual(anomalies.length, 1);
  assert.strictEqual(anomalies[0].type, "row-shape");
});

test("parseIncidentLog: 見出し・箇条書き・空行は row-shape 異常にしない", () => {
  const { rows, anomalies } = parseIncidentLog(
    ledger([row("2026-07-01", "様子見", "CR-021")]),
  );
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(anomalies, [], "ヘッダの説明文を誤検出しない");
});

test("AC-11 parseIncidentLog: 規約外の状態値を status 異常として報告する", () => {
  const { anomalies } = parseIncidentLog(
    ledger([row("2026-07-01", "対応済み", "CR-021")]),
  );
  assert.strictEqual(anomalies.length, 1);
  assert.strictEqual(anomalies[0].type, "status");
  assert.match(anomalies[0].detail, /対応済み/);
});

test("AC-12 parseIncidentLog: 再発系でルールIDが無い行を no-rule-id 異常として報告する", () => {
  const { anomalies } = parseIncidentLog(
    ledger([
      row("2026-07-01", "再発（未対処）", "CLAUDE.md「Claude固有ルール」"),
    ]),
  );
  assert.strictEqual(anomalies.length, 1);
  assert.strictEqual(anomalies[0].type, "no-rule-id");
});

test("parseIncidentLog: 様子見・昇格済でルールIDが無くても異常にしない", () => {
  const { anomalies } = parseIncidentLog(
    ledger([
      row("2026-07-01", "様子見", "-"),
      row("2026-07-02", "昇格済", "DEPLOY.md 注記"),
    ]),
  );
  assert.strictEqual(
    anomalies.length,
    0,
    "再発系だけが集計対象のため他は対象外",
  );
});

// ---------------------------------------------------------------------------
// collectIncidentLogs: 台帳の探索（要件 FR-5）
// ---------------------------------------------------------------------------

test("collectIncidentLogs: 直下と直下プロジェクトの台帳を両方返す", () => {
  withTempDir(
    {
      "incident-log.md": ledger([]),
      "ProjectA/incident-log.md": ledger([]),
      "ProjectB/incident-log.md": ledger([]),
    },
    (dir) => {
      const found = collectIncidentLogs(dir, true).map((p) =>
        path.relative(dir, p),
      );
      assert.strictEqual(found.length, 3, "直下があっても再帰を止めない");
    },
  );
});

test("collectIncidentLogs: --no-recursive では直下だけを返す", () => {
  withTempDir(
    { "incident-log.md": ledger([]), "ProjectA/incident-log.md": ledger([]) },
    (dir) => {
      assert.strictEqual(collectIncidentLogs(dir, false).length, 1);
    },
  );
});

test("collectIncidentLogs: 00_Template と除外ディレクトリを走査しない", () => {
  withTempDir(
    {
      "00_Template/incident-log.md": ledger([]),
      "node_modules/incident-log.md": ledger([]),
      ".git/incident-log.md": ledger([]),
    },
    (dir) => {
      assert.deepStrictEqual(collectIncidentLogs(dir, true), []);
    },
  );
});

test("collectIncidentLogs: 台帳が無いディレクトリでは空配列を返す", () => {
  withTempDir({ "README.md": "# なにもない\n" }, (dir) => {
    assert.deepStrictEqual(collectIncidentLogs(dir, true), []);
  });
});

// ---------------------------------------------------------------------------
// checkEscalationGap: 集計と警告（要件 FR-3 / FR-7）
// ---------------------------------------------------------------------------

test("AC-01 checkEscalationGap: 同一ルールで未対処の再発が2件（閾値ちょうど）で警告1件", () => {
  withTempDir(
    {
      "incident-log.md": ledger([
        row("2026-07-01", "再発（未対処）", "CR-021"),
        row("2026-07-02", "再発（未対処）", "CR-021"),
      ]),
    },
    (dir) => {
      const { violations, warnings } = checkEscalationGap(dir, false);
      assert.deepStrictEqual(
        violations,
        [],
        "違反ではなく警告に留める（NFR-3）",
      );
      assert.strictEqual(gapWarnings(warnings).length, 1);
    },
  );
});

test("AC-02 checkEscalationGap: 未対処の再発が1件だけなら警告0件", () => {
  withTempDir(
    {
      "incident-log.md": ledger([
        row("2026-07-01", "再発（未対処）", "CR-021"),
      ]),
    },
    (dir) => {
      assert.strictEqual(
        gapWarnings(checkEscalationGap(dir, false).warnings).length,
        0,
      );
    },
  );
});

test("AC-03 checkEscalationGap: 3件でも警告は1件にまとめ、件数3を表示する", () => {
  withTempDir(
    {
      "incident-log.md": ledger([
        row("2026-07-01", "再発（未対処）", "CR-021"),
        row("2026-07-02", "再発（未対処）", "CR-021"),
        row("2026-07-03", "再発（未対処）", "CR-021"),
      ]),
    },
    (dir) => {
      const gaps = gapWarnings(checkEscalationGap(dir, false).warnings);
      assert.strictEqual(gaps.length, 1);
      assert.match(gaps[0], /3 件/);
    },
  );
});

test("AC-04 checkEscalationGap: 複数IDが並ぶ行は各IDへ1件ずつ計上する", () => {
  withTempDir(
    {
      "incident-log.md": ledger([
        row("2026-07-01", "再発（未対処）", "CR-054・CR-063"),
        row("2026-07-02", "再発（未対処）", "CR-054・CR-063"),
      ]),
    },
    (dir) => {
      const gaps = gapWarnings(checkEscalationGap(dir, false).warnings);
      assert.strictEqual(gaps.length, 2, "CR-054 と CR-063 の2件");
      assert.match(gaps[0], /CR-054/);
      assert.match(gaps[1], /CR-063/, "ルールID昇順で出力する");
    },
  );
});

test("AC-05 checkEscalationGap: 付記のない素の再発も未対処として計上する（fail-safe）", () => {
  withTempDir(
    {
      "incident-log.md": ledger([
        row("2026-07-01", "再発", "CR-021"),
        row("2026-07-02", "再発", "CR-021"),
      ]),
    },
    (dir) => {
      assert.strictEqual(
        gapWarnings(checkEscalationGap(dir, false).warnings).length,
        1,
      );
    },
  );
});

test("AC-06 checkEscalationGap: 対処済みの再発は何件あっても警告しない", () => {
  withTempDir(
    {
      "incident-log.md": ledger([
        row("2026-07-01", "再発（対処: CR-085）", "CR-069"),
        row("2026-07-02", "再発（対処: CR-085）", "CR-069"),
        row("2026-07-03", "再発（対処: CR-085）", "CR-069"),
      ]),
    },
    (dir) => {
      assert.strictEqual(
        gapWarnings(checkEscalationGap(dir, false).warnings).length,
        0,
      );
    },
  );
});

test("AC-07 checkEscalationGap: 未対処と対処済みが混在しても未対処だけを数える", () => {
  const rows = [
    row("2026-07-01", "再発（未対処）", "CR-069"),
    row("2026-07-02", "再発（未対処）", "CR-069"),
  ];
  for (let i = 3; i <= 7; i += 1) {
    rows.push(row(`2026-07-0${i}`, "再発（対処: CR-085）", "CR-069"));
  }
  withTempDir({ "incident-log.md": ledger(rows) }, (dir) => {
    const gaps = gapWarnings(checkEscalationGap(dir, false).warnings);
    assert.strictEqual(gaps.length, 1);
    assert.match(gaps[0], /2 件/, "対処済み5件を含めない");
  });
});

test("AC-15 checkEscalationGap: 警告に台帳パス・ルールID・件数・日付が含まれる", () => {
  withTempDir(
    {
      "ProjectA/incident-log.md": ledger([
        row("2026-07-22", "再発（未対処）", "CR-021"),
        row("2026-07-24", "再発（未対処）", "CR-021"),
      ]),
    },
    (dir) => {
      const [warning] = gapWarnings(checkEscalationGap(dir, true).warnings);
      assert.match(
        warning,
        /ProjectA\/incident-log\.md/,
        "相対パスを / 区切りで含む",
      );
      assert.match(warning, /CR-021/);
      assert.match(warning, /2 件/);
      assert.match(warning, /2026-07-22/);
      assert.match(warning, /2026-07-24/);
      assert.match(warning, /escalation-gap/);
    },
  );
});

test("checkEscalationGap: 台帳ごとに独立して集計する（別台帳の件数を合算しない）", () => {
  withTempDir(
    {
      "ProjectA/incident-log.md": ledger([
        row("2026-07-01", "再発（未対処）", "CR-021"),
      ]),
      "ProjectB/incident-log.md": ledger([
        row("2026-07-02", "再発（未対処）", "CR-021"),
      ]),
    },
    (dir) => {
      assert.strictEqual(
        gapWarnings(checkEscalationGap(dir, true).warnings).length,
        0,
        "別プロジェクトの再発は同型として扱わない",
      );
    },
  );
});

test("checkEscalationGap: 書式異常は台帳パスと行番号つきで警告する", () => {
  withTempDir(
    {
      "incident-log.md": ledger([row("2026-07-01", "対応済み", "CR-021")]),
    },
    (dir) => {
      const [warning] = formatWarnings(checkEscalationGap(dir, false).warnings);
      assert.match(warning, /incident-log\.md:7:/);
      assert.match(warning, /escalation-gap/);
    },
  );
});

test("checkEscalationGap: 台帳が無ければ警告を出さない", () => {
  withTempDir({ "README.md": "# なにもない\n" }, (dir) => {
    const { violations, warnings } = checkEscalationGap(dir, true);
    assert.deepStrictEqual(violations, []);
    assert.deepStrictEqual(warnings, []);
  });
});
