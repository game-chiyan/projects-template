#!/usr/bin/env node
/**
 * @fileoverview 運用ルール自動チェックランナー（03_Checks）
 *
 * 役割:
 *   ~\Projects 配下のドキュメント・コードに対し、機械検証可能な運用ルールの
 *   違反を検出する。各チェックと対応ルールIDの一覧は同階層の README.md を参照。
 *
 * 使い方:
 *   node 03_Checks/run-checks.js <対象ディレクトリ> [--no-recursive] [--check=doc-chars,unicode-escape,resume-freshness,glossary-terms]
 *   例: node 03_Checks/run-checks.js .                    （Projects 全体）
 *       node 03_Checks/run-checks.js <プロジェクト>       （プロジェクト単位）
 *
 * 設定:
 *   <対象ディレクトリ>\check-config.json があれば読み込む（任意・例外設定用）。
 *   親ディレクトリから実行した場合、直下プロジェクトの check-config.json も統合する
 *   （例外の正ᴳはプロジェクト側に1箇所 = CR-064。二重管理しない）。スキーマは README.md を参照。
 *
 * 終了コード:
 *   0: 違反なし（警告のみの場合を含む）
 *   1: 違反あり、対象不正、または引数エラー
 *
 * 注意:
 *   Cowork サンドボックスからの実行はマウント読取の途切れ（CS-002・CS-004）で
 *   誤検出があり得る。正ᴳとするのは依頼者マシン（ローカル）での実行結果。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

/** 走査から常に除外するディレクトリ名 */
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".worktrees",
  ".docusaurus",
  ".codex",
  ".agents",
  "build",
  "dist",
  "coverage",
]);

/** --check で指定できるチェック名 */
const CHECK_NAMES = [
  "doc-chars",
  "unicode-escape",
  "resume-freshness",
  "glossary-terms",
  "escalation-gap",
];

/** 追記専用の履歴ファイル */
const WORKLOG_FILE_RE = /^worklog(?:-\d{4}-\d{2}(?:-\d+)?)?\.md$/;

/**
 * 違反として検出する文字（ハード違反）。名称は報告メッセージ用
 * 根拠: CR-024（全角スペース禁止）、CR-071 / MF-009（全角半角取り違え・破損点検）
 */
const HARD_CHARS = [
  { re: /　/g, name: "全角スペース(U+3000)", ruleId: "CR-024" },
  {
    re: /[  -​]/g,
    name: "不可視スペース(U+00A0/U+2000-200B)",
    ruleId: "CR-024",
  },
  { re: /[０-９]/g, name: "全角数字", ruleId: "CR-071" },
  { re: /[Ａ-Ｚａ-ｚ]/g, name: "全角英字", ruleId: "CR-071" },
  { re: /～/g, name: "全角チルダ(U+FF5E)", ruleId: "CR-071" },
  { re: /�/g, name: "置換文字(U+FFFD)=破損疑い", ruleId: "CR-071" },
];

/**
 * 警告として検出する文字（意図的使用があり得るため人間が判定する）
 * - 全角不等号: 優先順位表記（例: A ＞ B）の意図的使用の実績あり
 * - 異体字・簡体字の混入疑い: 隨(U+96A8)/圈(U+5708)/暂(U+6682)。観測実績ベースの黒リスト
 */
const WARN_CHARS = [
  { re: /[＜＞]/g, name: "全角不等号（意図的使用か要目視）", ruleId: "CR-071" },
  { re: /[隨圈暂]/g, name: "異体字・簡体字の疑い（要目視）", ruleId: "CR-071" },
];

/** Unicodeエスケープ検出用（unicode-escape チェック） */
const UNICODE_ESCAPE_RE = /\\u[0-9a-fA-F]{4}/g;

/** 失敗記録台帳の列数（日付/事象/原因/暫定対処/状態/関連ルール。CR-016） */
const INCIDENT_CELL_COUNT = 6;

/** 台帳の表の区切り行（|---|---|） */
const TABLE_SEPARATOR_RE = /^\|[\s:|-]+\|?\s*$/;

/** 表の行とみなす最小の区切り数。これ以上あるのに `|` で始まらない行は崩れた表行を疑う */
const TABLE_ROW_HINT_DELIMITERS = 5;

/** ルールID（ファイル別接頭辞2文字 + 3桁。CR-013） */
const RULE_ID_RE = /[A-Z]{2}-\d{3}/g;

/**
 * 状態欄の機械可読規約（CR-016）。上から順に評価し最初の一致を採る
 * - open: 付記のない素の `再発` も未対処として扱う。移行漏れを沈黙させないため（fail-safe）
 * - 括弧は全角のみ。コロンは人手記入の揺れを吸収して半角・全角どちらも許容する
 */
const INCIDENT_STATUS_PATTERNS = [
  { re: /^様子見$/, kind: "watch" },
  { re: /^昇格済(?:（\s*\S.*）)?$/, kind: "promoted" },
  { re: /^再発(?:（未対処）)?$/, kind: "open" },
  // 対処先は空白だけでは足りない。`再発（対処: ）` の1文字挿入で警告を消す抜け道を塞ぐ（CR-017）
  { re: /^再発（対処[:：]\s*\S.*）$/, kind: "resolved" },
];

/**
 * 同一ルールで未対処の再発が何件に達したら警告するか（CR-001 の「2回目でルール昇格」に合わせる）
 * 横断方針のためディレクトリ単位の check-config.json では変更させない
 */
const ESCALATION_GAP_THRESHOLD = 2;

/**
 * 対象ディレクトリ配下のファイルを再帰列挙する
 * @param {string} dirPath - 起点ディレクトリの絶対パス
 * @param {(name: string) => boolean} fileFilter - 対象ファイル名の判定
 * @param {boolean} recursive - サブディレクトリを辿るか
 * @param {string} scanRoot - scanExcludePaths の基準ディレクトリ
 * @param {string[]} scanExcludePaths - 再帰前に除外する正規化済み相対path
 * @return {string[]} 絶対パスの一覧
 */
function collectFiles(
  dirPath,
  fileFilter,
  recursive,
  selectedFiles = null,
  scanRoot = dirPath,
  scanExcludePaths = [],
) {
  if (!fs.existsSync(dirPath)) return [];
  if (isScanPathExcluded(scanRoot, dirPath, scanExcludePaths)) return [];
  if (selectedFiles) {
    const base = path.resolve(dirPath);
    return [...selectedFiles]
      .filter((filePath) => {
        const absolute = path.resolve(filePath);
        const relative = path.relative(base, absolute);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
          return false;
        if (!recursive && path.dirname(absolute) !== base) return false;
        if (isScanPathExcluded(scanRoot, absolute, scanExcludePaths))
          return false;
        return (
          fs.existsSync(absolute) &&
          fs.statSync(absolute).isFile() &&
          fileFilter(path.basename(absolute))
        );
      })
      .sort((a, b) => a.localeCompare(b));
  }
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (recursive && !EXCLUDE_DIRS.has(entry.name)) {
        results.push(
          ...collectFiles(
            path.join(dirPath, entry.name),
            fileFilter,
            recursive,
            null,
            scanRoot,
            scanExcludePaths,
          ),
        );
      }
    } else if (entry.isFile() && fileFilter(entry.name)) {
      results.push(path.join(dirPath, entry.name));
    }
  }
  return results;
}

function normalizeConfigPath(value, fieldName) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.isAbsolute(value)
  ) {
    throw new Error(`${fieldName} must be a non-empty relative path`);
  }
  const normalized = value
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  if (
    !normalized ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${fieldName} contains an invalid path segment`);
  }
  return normalized;
}

function normalizeScanExcludePaths(config) {
  const values = config.scanExcludePaths || [];
  if (!Array.isArray(values)) {
    throw new Error("scanExcludePaths must be an array");
  }
  return values.map((value, index) =>
    normalizeConfigPath(value, `scanExcludePaths[${index}]`),
  );
}

function mergeScanExcludePaths(config, subConfigs) {
  const merged = [...normalizeScanExcludePaths(config)];
  for (const { name, config: subConfig } of subConfigs) {
    for (const relativePath of normalizeScanExcludePaths(subConfig)) {
      merged.push(`${name}/${relativePath}`);
    }
  }
  return [...new Set(merged)];
}

function isScanPathExcluded(scanRoot, targetPath, scanExcludePaths) {
  const relative = path.relative(
    path.resolve(scanRoot),
    path.resolve(targetPath),
  );
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    return false;
  const normalized = relative.split(path.sep).join("/");
  return scanExcludePaths.some(
    (excluded) =>
      normalized === excluded || normalized.startsWith(`${excluded}/`),
  );
}

function resolveInside(rootPath, relativePath, fieldName) {
  const root = path.resolve(rootPath);
  const resolved = path.resolve(
    root,
    ...normalizeConfigPath(relativePath, fieldName).split("/"),
  );
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${fieldName} escapes its project root`);
  }
  return resolved;
}

function assertNoReparsePoint(rootPath, targetPath, label) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside its configured root`);
  }
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} contains a symlink or junction: ${current}`);
    }
  }
}

function runGit(worktreePath, args) {
  const safePath = path.resolve(worktreePath).replaceAll("\\", "/");
  try {
    return execFileSync(
      "git",
      ["-c", `safe.directory=${safePath}`, "-C", worktreePath, ...args],
      {
        encoding: null,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const detail = error.stderr
      ? error.stderr.toString("utf8").trim()
      : error.message;
    throw new Error(`Git command failed (${args.join(" ")}): ${detail}`);
  }
}

function parseNulList(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function normalizeGitRelativePath(value) {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || path.posix.isAbsolute(normalized)) {
    throw new Error(`Git returned an invalid path: ${JSON.stringify(value)}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Git returned an unsafe path: ${JSON.stringify(value)}`);
  }
  return normalized;
}

function hashFile(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function collectGitChangedSnapshot(worktreePath, baseRef) {
  if (
    typeof baseRef !== "string" ||
    baseRef.length === 0 ||
    baseRef.startsWith("-")
  ) {
    throw new Error("gitWorktrees.baseRef must be a non-empty string");
  }
  const root = path.resolve(worktreePath);
  const topLevel = runGit(root, ["rev-parse", "--show-toplevel"])
    .toString("utf8")
    .trim();
  if (path.resolve(topLevel).toLowerCase() !== root.toLowerCase()) {
    throw new Error(
      `worktree root mismatch: expected ${root}, got ${topLevel}`,
    );
  }
  const unmerged = parseNulList(
    runGit(root, ["diff", "--name-only", "--diff-filter=U", "-z"]),
  );
  if (unmerged.length > 0) {
    throw new Error(`worktree has unmerged paths: ${unmerged.join(", ")}`);
  }
  const mergeBase = runGit(root, ["merge-base", baseRef, "HEAD"])
    .toString("utf8")
    .trim();
  if (!mergeBase) throw new Error(`merge-base was empty for ${baseRef}`);

  const groups = [
    parseNulList(
      runGit(root, [
        "diff",
        "--no-renames",
        "--name-only",
        "--diff-filter=ACMRTUXBD",
        "-z",
        mergeBase,
        "HEAD",
      ]),
    ),
    parseNulList(
      runGit(root, [
        "diff",
        "--no-renames",
        "--cached",
        "--name-only",
        "--diff-filter=ACMRTUXBD",
        "-z",
      ]),
    ),
    parseNulList(
      runGit(root, [
        "diff",
        "--no-renames",
        "--name-only",
        "--diff-filter=ACMRTUXBD",
        "-z",
      ]),
    ),
    parseNulList(
      runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ),
  ];
  const byCaseFoldedPath = new Map();
  for (const rawPath of groups.flat()) {
    const relativePath = normalizeGitRelativePath(rawPath);
    const folded = relativePath.toLowerCase();
    const previous = byCaseFoldedPath.get(folded);
    if (previous && previous !== relativePath) {
      throw new Error(
        `case-insensitive path collision: ${previous} / ${relativePath}`,
      );
    }
    byCaseFoldedPath.set(folded, relativePath);
  }

  const paths = [...byCaseFoldedPath.values()].sort((a, b) =>
    a.localeCompare(b),
  );
  const existingFiles = [];
  const deletedPaths = [];
  const hashes = {};
  for (const relativePath of paths) {
    const filePath = path.resolve(root, ...relativePath.split("/"));
    const relation = path.relative(root, filePath);
    if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) {
      throw new Error(`changed path escapes worktree: ${relativePath}`);
    }
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      deletedPaths.push(relativePath);
      continue;
    }
    if (stat.isSymbolicLink())
      throw new Error(`changed path is a symlink or junction: ${relativePath}`);
    if (!stat.isFile())
      throw new Error(`changed path is not a regular file: ${relativePath}`);
    existingFiles.push(filePath);
    hashes[relativePath] = hashFile(filePath);
  }
  const head = runGit(root, ["rev-parse", "HEAD"]).toString("utf8").trim();
  const snapshot = {
    head,
    mergeBase,
    paths,
    hashes,
    existingFiles,
    deletedPaths,
    existingCount: existingFiles.length,
    deletedCount: deletedPaths.length,
    enumeratedCount: paths.length,
  };
  if (
    snapshot.enumeratedCount !==
    snapshot.existingCount + snapshot.deletedCount
  ) {
    throw new Error("worktree changed-path self-check failed");
  }
  return snapshot;
}

function sameGitSnapshot(left, right) {
  return (
    left.head === right.head &&
    left.mergeBase === right.mergeBase &&
    JSON.stringify(left.paths) === JSON.stringify(right.paths) &&
    JSON.stringify(left.hashes) === JSON.stringify(right.hashes) &&
    JSON.stringify(left.deletedPaths) === JSON.stringify(right.deletedPaths)
  );
}

function parseWorktreeList(buffer) {
  const records = buffer.toString("utf8").split("\0\0").filter(Boolean);
  return records.map((record) => {
    const values = {};
    for (const field of record.split("\0").filter(Boolean)) {
      const separator = field.indexOf(" ");
      const key = separator === -1 ? field : field.slice(0, separator);
      values[key] = separator === -1 ? true : field.slice(separator + 1);
    }
    return values;
  });
}

function discoverConfiguredWorktrees(projectRoot, settings) {
  if (!settings || typeof settings !== "object")
    throw new Error("gitWorktrees entry must be an object");
  const repositoryLogicalPath = normalizeConfigPath(
    settings.repositoryPath,
    "gitWorktrees.repositoryPath",
  );
  const rootLogicalPath = normalizeConfigPath(
    settings.root,
    "gitWorktrees.root",
  );
  if (
    typeof settings.baseRef !== "string" ||
    settings.baseRef.length === 0 ||
    settings.baseRef.startsWith("-")
  ) {
    throw new Error("gitWorktrees.baseRef must be a non-empty string");
  }
  const repositoryPath = resolveInside(
    projectRoot,
    repositoryLogicalPath,
    "gitWorktrees.repositoryPath",
  );
  const worktreeRoot = resolveInside(
    projectRoot,
    rootLogicalPath,
    "gitWorktrees.root",
  );
  if (
    !fs.existsSync(repositoryPath) ||
    !fs.statSync(repositoryPath).isDirectory()
  ) {
    throw new Error(
      `configured repository does not exist: ${repositoryLogicalPath}`,
    );
  }
  assertNoReparsePoint(projectRoot, repositoryPath, "repositoryPath");
  if (fs.existsSync(worktreeRoot))
    assertNoReparsePoint(projectRoot, worktreeRoot, "worktree root");

  const records = parseWorktreeList(
    runGit(repositoryPath, ["worktree", "list", "--porcelain", "-z"]),
  );
  const scopes = [];
  for (const record of records) {
    if (!record.worktree) continue;
    const registeredPath = path.resolve(record.worktree);
    if (registeredPath.toLowerCase() === repositoryPath.toLowerCase()) continue;
    const relative = path.relative(worktreeRoot, registeredPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `registered worktree is outside configured root: ${registeredPath}`,
      );
    }
    if (relative.split(path.sep).length !== 1) {
      throw new Error(
        `registered worktree must be a direct child of configured root: ${registeredPath}`,
      );
    }
    assertNoReparsePoint(worktreeRoot, registeredPath, "registered worktree");
    scopes.push({
      name: relative,
      repositoryPath,
      repositoryLogicalPath,
      worktreePath: registeredPath,
      baseRef: settings.baseRef,
    });
  }
  return scopes.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * check-config.json を読み込む（無ければ空設定）
 * @param {string} dirPath - 設定ファイルを探すディレクトリの絶対パス
 * @return {Object} 設定オブジェクト
 */
function loadConfig(dirPath) {
  const configPath = path.join(dirPath, "check-config.json");
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

/**
 * 直下プロジェクトの check-config.json を列挙する
 * @param {string} targetDir - 対象ディレクトリの絶対パス
 * @return {{name: string, config: Object}[]} プロジェクト名と設定の一覧
 */
function collectSubConfigs(targetDir) {
  const results = [];
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || EXCLUDE_DIRS.has(entry.name)) continue;
    const configPath = path.join(targetDir, entry.name, "check-config.json");
    if (!fs.existsSync(configPath)) continue;
    results.push({
      name: entry.name,
      config: JSON.parse(fs.readFileSync(configPath, "utf8")),
    });
  }
  return results;
}

/**
 * 自設定と直下プロジェクト設定の docChars 例外を統合する
 * @param {Object} config - 対象ディレクトリ自身の設定
 * @param {{name: string, config: Object}[]} subConfigs - 直下プロジェクトの設定一覧
 * @return {{excludePaths: string[], fileAllowedChars: Object}} 統合済み例外
 */
function mergeDocCharsConfig(config, subConfigs) {
  const merged = {
    excludePaths: [
      ...((config.docChars && config.docChars.excludePaths) || []),
    ],
    fileAllowedChars: {
      ...((config.docChars && config.docChars.fileAllowedChars) || {}),
    },
  };
  for (const { name, config: subConfig } of subConfigs) {
    const docChars = subConfig.docChars || {};
    for (const prefix of docChars.excludePaths || []) {
      merged.excludePaths.push(`${name}/${prefix}`);
    }
    for (const [relPath, chars] of Object.entries(
      docChars.fileAllowedChars || {},
    )) {
      merged.fileAllowedChars[`${name}/${relPath}`] = chars;
    }
  }
  return merged;
}

/**
 * doc-chars: Markdown ドキュメントの禁止文字・破損疑い文字を検出する
 * @param {string} targetDir - 対象ディレクトリの絶対パス
 * @param {{excludePaths: string[], fileAllowedChars: Object}} docCharsConfig - 統合済み例外
 * @param {boolean} recursive - サブディレクトリを走査するか
 * @return {{violations: string[], warnings: string[]}} 検出結果
 */
function checkDocChars(
  targetDir,
  docCharsConfig,
  recursive,
  selectedFiles = null,
  reportPrefix = "",
  scanExcludePaths = [],
) {
  const violations = [];
  const warnings = [];
  const files = collectFiles(
    targetDir,
    // handover-*.md と worklog.md / worklog-YYYY-MM[-N].md は追記専用の歴史記録（違反文字の引用を含む）のため既定で対象外
    (name) =>
      name.endsWith(".md") &&
      !/^handover-.*\.md$/.test(name) &&
      !WORKLOG_FILE_RE.test(name),
    recursive,
    selectedFiles,
    targetDir,
    scanExcludePaths,
  );

  for (const filePath of files) {
    const configPath = path
      .relative(targetDir, filePath)
      .split(path.sep)
      .join("/");
    const relPath = reportPrefix + configPath;
    if (
      docCharsConfig.excludePaths.some((prefix) =>
        configPath.startsWith(prefix),
      )
    )
      continue;
    const allowed = new Set(docCharsConfig.fileAllowedChars[configPath] || []);
    const lines = fs.readFileSync(filePath, "utf8").split("\n");

    lines.forEach((lineText, lineIndex) => {
      for (const { re, name, ruleId } of HARD_CHARS) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(lineText)) !== null) {
          if (allowed.has(match[0])) continue;
          violations.push(
            `${relPath}:${lineIndex + 1}:${match.index + 1}: [doc-chars] ${name}「${match[0]}」（${ruleId}）`,
          );
        }
      }
      for (const { re, name, ruleId } of WARN_CHARS) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(lineText)) !== null) {
          if (allowed.has(match[0])) continue;
          warnings.push(
            `${relPath}:${lineIndex + 1}:${match.index + 1}: [doc-chars] ${name}「${match[0]}」（${ruleId}）`,
          );
        }
      }
    });
  }
  return { violations, warnings };
}

/**
 * unicode-escape: ソースコード中の \uXXXX エスケープ残存を検出する（汎用版）
 * 設定が無い場合はスキップする（コードを持つプロジェクトだけが対象）
 * @param {string} baseDir - 設定の基準ディレクトリの絶対パス
 * @param {Object} config - 設定（unicodeEscape.targets / allowedEscapes）
 * @param {string} reportPrefix - 報告パスに付ける接頭辞（親実行時のプロジェクト名）
 * @param {boolean} allowRecursive - 設定対象内の再帰走査を許可するか
 * @return {{violations: string[], warnings: string[]}} 検出結果
 */
function checkUnicodeEscape(
  baseDir,
  config,
  reportPrefix,
  allowRecursive,
  selectedFiles = null,
) {
  const violations = [];
  const settings = config.unicodeEscape;
  if (!settings || !Array.isArray(settings.targets)) {
    return { violations, warnings: [] };
  }
  const allowedEscapes = settings.allowedEscapes || [];

  for (const target of settings.targets) {
    const extensions = target.extensions || [".js"];
    const dirPath = path.join(baseDir, ...target.dir.split("/"));
    const recursive = allowRecursive && target.recursive !== false;
    const files = collectFiles(
      dirPath,
      (name) => extensions.some((ext) => name.endsWith(ext)),
      recursive,
      selectedFiles,
      baseDir,
      normalizeScanExcludePaths(config),
    );

    for (const filePath of files) {
      const relPath =
        reportPrefix +
        path.relative(baseDir, filePath).split(path.sep).join("/");
      const lines = fs.readFileSync(filePath, "utf8").split("\n");
      lines.forEach((lineText, lineIndex) => {
        let sanitized = lineText;
        for (const escape of allowedEscapes) {
          sanitized = sanitized.split(escape).join("");
        }
        let match;
        UNICODE_ESCAPE_RE.lastIndex = 0;
        while ((match = UNICODE_ESCAPE_RE.exec(sanitized)) !== null) {
          violations.push(
            `${relPath}:${lineIndex + 1}: [unicode-escape] Unicodeエスケープ検出 ${match[0]}（直接文字に置き換える）`,
          );
        }
      });
    }
  }
  return { violations, warnings: [] };
}

/**
 * 用語集（glossary.md）から定義済み用語の集合を読み込む
 * スクリプト位置基準で参照するため対象ディレクトリに依存しない
 * @return {string[]} 定義済み用語の一覧
 */
function loadGlossaryTerms() {
  const glossaryPath = path.join(
    __dirname,
    "..",
    "04_Rules_Reference",
    "glossary.md",
  );
  if (!fs.existsSync(glossaryPath)) return [];
  const TERM_SECTIONS = new Set([
    "セッション進行",
    "成果物・記録",
    "設計・品質",
  ]);
  const terms = new Set();
  let inTermSection = false;
  for (const line of fs.readFileSync(glossaryPath, "utf8").split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      inTermSection = TERM_SECTIONS.has(heading[1].trim());
      continue;
    }
    if (!inTermSection) continue;
    const entry = line.match(/^-\s+([^:：]+)[:：]/);
    if (!entry) continue;
    for (let part of entry[1].split("/")) {
      part = part.replace(/（[^）]*）/g, "").trim();
      if (part) terms.add(part);
    }
  }
  return [...terms];
}

/**
 * glossary-terms: 定義済み用語の目印 (U+1D33) が用語集にある語に付いているかを検査する
 * 定義の意味かは機械判定できないため付与漏れは検査しない（実在のみの逆向き検査。CR-067）
 * @param {string} targetDir - 対象ディレクトリの絶対パス
 * @param {boolean} recursive - サブディレクトリを走査するか
 * @return {{violations: string[], warnings: string[]}} 検出結果
 */
function checkGlossaryTerms(
  targetDir,
  recursive,
  selectedFiles = null,
  reportPrefix = "",
  scanExcludePaths = [],
) {
  const violations = [];
  const terms = loadGlossaryTerms();
  if (terms.length === 0) return { violations, warnings: [] };
  const MARK = "ᴳ";
  const files = collectFiles(
    targetDir,
    (name) =>
      name.endsWith(".md") &&
      !/^handover-.*\.md$/.test(name) &&
      !WORKLOG_FILE_RE.test(name),
    recursive,
    selectedFiles,
    targetDir,
    scanExcludePaths,
  );
  for (const filePath of files) {
    const relPath =
      reportPrefix +
      path.relative(targetDir, filePath).split(path.sep).join("/");
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    lines.forEach((lineText, lineIndex) => {
      for (
        let idx = lineText.indexOf(MARK);
        idx !== -1;
        idx = lineText.indexOf(MARK, idx + 1)
      ) {
        const before = lineText.slice(0, idx);
        const inlineCode = before.match(/(`+)([^`\r\n]+)\1$/);
        if (inlineCode) {
          if (!terms.includes(inlineCode[2])) {
            violations.push(
              `${relPath}:${lineIndex + 1}:${idx + 1}: [glossary-terms] 用語集にない語に目印 (U+1D33) が付与されている（CR-067）`,
            );
          }
          continue;
        }
        const prevChar = before.slice(-1);
        // 直前が語構成文字でなければ目印ではなく字としての言及（記法定義・引用）とみなし対象外
        if (!prevChar || !/[\p{L}\p{N}-]/u.test(prevChar)) continue;
        if (!terms.some((term) => before.endsWith(term))) {
          violations.push(
            `${relPath}:${lineIndex + 1}:${idx + 1}: [glossary-terms] 用語集にない語に目印 (U+1D33) が付与されている（CR-067）`,
          );
        }
      }
    });
  }
  return { violations, warnings: [] };
}

/**
 * resume-freshness: resume.md の更新時刻の記載が worklog.md より古くないかを検知する
 * 時刻はローカルタイムゾーン前提のため、依頼者マシンでの実行を正ᴳとし警告のみとする（CR-054）
 * @param {string} targetDir - 対象ディレクトリの絶対パス
 * @param {boolean} recursive - 直下プロジェクトの handover も探索するか
 * @return {{violations: string[], warnings: string[]}} 検出結果
 */
function checkResumeFreshness(
  targetDir,
  recursive,
  selectedFiles = null,
  reportPrefix = "",
) {
  const warnings = [];
  const handoverDirs = [];

  const directHandover = path.join(targetDir, "handover");
  if (fs.existsSync(directHandover)) {
    handoverDirs.push(directHandover);
  } else if (recursive) {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || EXCLUDE_DIRS.has(entry.name)) continue;
      if (entry.name === "00_Template") continue;
      const handoverPath = path.join(targetDir, entry.name, "handover");
      if (fs.existsSync(handoverPath)) handoverDirs.push(handoverPath);
    }
  }

  const TOLERANCE_MS = 60 * 60 * 1000;
  for (const handoverDir of handoverDirs) {
    const resumePath = path.join(handoverDir, "resume.md");
    const worklogPath = path.join(handoverDir, "worklog.md");
    if (!fs.existsSync(resumePath)) continue;
    if (
      selectedFiles &&
      !selectedFiles.has(resumePath) &&
      !selectedFiles.has(worklogPath)
    )
      continue;
    const relPath =
      reportPrefix +
      path.relative(targetDir, resumePath).split(path.sep).join("/");

    const text = fs.readFileSync(resumePath, "utf8");
    const timeMatch = text.match(/更新時刻:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
    if (!timeMatch) continue; // 雛形（プレースホルダ）はスキップ
    const recordedTime = new Date(timeMatch[1].replace(" ", "T"));

    if (fs.existsSync(worklogPath)) {
      const worklogMtime = fs.statSync(worklogPath).mtime;
      if (worklogMtime.getTime() - recordedTime.getTime() > TOLERANCE_MS) {
        warnings.push(
          `${relPath}: [resume-freshness] worklog.md の方が新しい（resume 記載 ${timeMatch[1]}）。resume.md の最新化漏れの疑い（CR-054）`,
        );
      }
    }
    const resumeMtime = fs.statSync(resumePath).mtime;
    if (resumeMtime.getTime() - recordedTime.getTime() > TOLERANCE_MS) {
      warnings.push(
        `${relPath}: [resume-freshness] ファイル更新が記載時刻より新しい（記載 ${timeMatch[1]}）。更新時刻の書き換え漏れの疑い（CR-054）`,
      );
    }
  }
  return { violations: [], warnings };
}

/**
 * 状態欄の値を5値へ分類する（CR-016）
 * @param {string} status - 状態セルの値（trim 済み）
 * @return {string} watch / promoted / open / resolved / unknown
 */
function classifyStatus(status) {
  for (const { re, kind } of INCIDENT_STATUS_PATTERNS) {
    if (re.test(status)) return kind;
  }
  return "unknown";
}

/**
 * Markdown表の1行をセルへ分割する
 * `\|`（エスケープされた縦棒）は区切りにせず、`\\`（エスケープされたバックスラッシュ）の
 * 直後の縦棒は区切りとして扱う。直前1文字だけを見る正規表現では後者を誤判定するため
 * @param {string} line - 表の1行
 * @return {string[]} セルの配列（前後の空要素を含む）
 */
function splitTableRow(line) {
  const cells = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      current += ch + line[i + 1];
      i += 1;
    } else if (ch === "|") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * 失敗記録台帳のMarkdown表をパースする
 * @param {string} text - 台帳の全文
 * @return {{rows: Object[], anomalies: Object[]}} データ行と書式異常
 */
function parseIncidentLog(text) {
  const rows = [];
  const anomalies = [];

  text.split("\n").forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = rawLine.trimEnd();

    if (!line.startsWith("|")) {
      // 表の行に見えるのに `|` で始まらない行を黙って捨てない。
      // 行頭の `|` 欠落やインデントで1行まるごと集計から消えるのを防ぐ（fail-safe）
      const looksLikeRow =
        line.trimStart().startsWith("|") ||
        splitTableRow(line).length > TABLE_ROW_HINT_DELIMITERS;
      if (looksLikeRow) {
        anomalies.push({
          lineNo,
          type: "row-shape",
          detail:
            "表の行に見えるが行頭が縦棒でない。行頭の空白を除き `|` で始める（CR-016）",
        });
      }
      return; // 見出し・箇条書き・空行
    }
    if (TABLE_SEPARATOR_RE.test(line)) return;

    const cells = splitTableRow(line);
    if (cells[0].trim() === "") cells.shift();
    if (cells.length > 0 && cells[cells.length - 1].trim() === "") cells.pop();
    if (cells[0].trim() === "日付") return; // ヘッダ行

    if (cells.length !== INCIDENT_CELL_COUNT) {
      // 列がずれた行はセルの意味を確定できないため、これ以上解析せず多重報告を避ける
      anomalies.push({
        lineNo,
        type: "columns",
        detail:
          `表の列数が ${INCIDENT_CELL_COUNT} でない（${cells.length} 列）。` +
          "セル内の縦棒はエスケープする（CR-016）",
      });
      return;
    }

    const date = cells[0].trim();
    const status = cells[4].trim();
    const kind = classifyStatus(status);
    const ruleIds = [...new Set(cells[5].match(RULE_ID_RE) || [])].sort();

    if (kind === "unknown") {
      anomalies.push({
        lineNo,
        type: "status",
        detail:
          `状態欄が規約外「${status}」。様子見 / 昇格済[（付記）] / 再発（未対処） / ` +
          "再発（対処: X）のいずれかにする（CR-016）",
      });
    } else if (
      (kind === "open" || kind === "resolved") &&
      ruleIds.length === 0
    ) {
      anomalies.push({
        lineNo,
        type: "no-rule-id",
        detail:
          `状態が「${status}」だが関連ルール欄にルールIDがない。` +
          "集計から漏れるためIDを記載する（CR-016）",
      });
    }

    rows.push({ lineNo, date, status, kind, ruleIds });
  });

  return { rows, anomalies };
}

/**
 * 失敗記録台帳のパスを集める
 * checkResumeFreshness と違い直下が見つかっても再帰を止めない。
 * 横断台帳（Projects 直下）とプロジェクト台帳は同時に存在して両方が対象のため（CR-014 / CR-015）
 * @param {string} targetDir - 対象ディレクトリの絶対パス
 * @param {boolean} recursive - 直下プロジェクトも探索するか
 * @return {string[]} 台帳の絶対パス一覧
 */
function collectIncidentLogs(targetDir, recursive, selectedFiles = null) {
  const paths = [];
  const direct = path.join(targetDir, "incident-log.md");
  if (fs.existsSync(direct) && (!selectedFiles || selectedFiles.has(direct)))
    paths.push(direct);
  if (!recursive) return paths;

  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || EXCLUDE_DIRS.has(entry.name)) continue;
    if (entry.name === "00_Template") continue;
    const sub = path.join(targetDir, entry.name, "incident-log.md");
    if (fs.existsSync(sub) && (!selectedFiles || selectedFiles.has(sub)))
      paths.push(sub);
  }
  return paths;
}

/**
 * escalation-gap: 同一ルールで未対処の再発が閾値に達したのに昇格されていない状態を検知する
 * ルールを増やしても同型再発が止まらなかった実績（CR-084 が同型4回目まで進行）を受けた機械化。
 * 台帳へ記録する行為自体は正しいため違反にはせず警告に留める（CR-001 / CR-016 / CR-017）
 * @param {string} targetDir - 対象ディレクトリの絶対パス
 * @param {boolean} recursive - 直下プロジェクトの台帳も対象にするか
 * @return {{violations: string[], warnings: string[]}} 検出結果
 */
function checkEscalationGap(
  targetDir,
  recursive,
  selectedFiles = null,
  reportPrefix = "",
) {
  const warnings = [];

  for (const logPath of collectIncidentLogs(
    targetDir,
    recursive,
    selectedFiles,
  )) {
    const relPath =
      reportPrefix +
      path.relative(targetDir, logPath).split(path.sep).join("/");
    const { rows, anomalies } = parseIncidentLog(
      fs.readFileSync(logPath, "utf8"),
    );

    for (const anomaly of anomalies) {
      warnings.push(
        `${relPath}:${anomaly.lineNo}: [escalation-gap] ${anomaly.detail}`,
      );
    }

    // 台帳ごとに独立して集計する。別プロジェクトの再発は同型として扱わない
    const datesByRule = new Map();
    for (const row of rows) {
      if (row.kind !== "open") continue;
      for (const ruleId of row.ruleIds) {
        if (!datesByRule.has(ruleId)) datesByRule.set(ruleId, []);
        datesByRule.get(ruleId).push(row.date);
      }
    }

    const sorted = [...datesByRule.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    for (const [ruleId, dates] of sorted) {
      if (dates.length < ESCALATION_GAP_THRESHOLD) continue;
      warnings.push(
        `${relPath}: [escalation-gap] ${ruleId} の未対処の再発が ${dates.length} 件` +
          `（${dates.join(", ")}）。ルール改訂・新設・機械化による対処を検討し、` +
          "CR-017 の条件を満たす事象行だけ状態を更新する（CR-001 / CR-017）",
      );
    }
  }

  return { violations: [], warnings };
}

/**
 * メイン処理
 */
function sliceDocCharsConfig(docCharsConfig, repositoryLogicalPath) {
  const prefix = `${repositoryLogicalPath}/`;
  const sliced = { excludePaths: [], fileAllowedChars: {} };
  for (const excluded of docCharsConfig.excludePaths || []) {
    if (excluded.startsWith(prefix))
      sliced.excludePaths.push(excluded.slice(prefix.length));
  }
  for (const [relativePath, chars] of Object.entries(
    docCharsConfig.fileAllowedChars || {},
  )) {
    if (relativePath.startsWith(prefix)) {
      sliced.fileAllowedChars[relativePath.slice(prefix.length)] = chars;
    }
  }
  return sliced;
}

function mergeRepositoryDocChars(projectDocChars, repositoryConfig) {
  const repositoryDocChars = mergeDocCharsConfig(repositoryConfig, []);
  return {
    excludePaths: [
      ...projectDocChars.excludePaths,
      ...repositoryDocChars.excludePaths,
    ],
    fileAllowedChars: {
      ...projectDocChars.fileAllowedChars,
      ...repositoryDocChars.fileAllowedChars,
    },
  };
}

function runConfiguredWorktreeChecks(
  targetDir,
  config,
  subConfigs,
  enabled,
  allViolations,
  allWarnings,
) {
  const sources = [{ root: targetDir, reportPrefix: "", config }];
  for (const { name, config: subConfig } of subConfigs) {
    sources.push({
      root: path.join(targetDir, name),
      reportPrefix: `${name}/`,
      config: subConfig,
    });
  }
  const seenWorktrees = new Set();

  for (const source of sources) {
    const settingsList = source.config.gitWorktrees || [];
    if (!Array.isArray(settingsList)) {
      allViolations.push(
        `${source.reportPrefix}check-config.json: [git-worktree] gitWorktrees must be an array`,
      );
      continue;
    }
    for (const settings of settingsList) {
      try {
        const scopes = discoverConfiguredWorktrees(source.root, settings);
        const repositoryLogicalPath = scopes[0]
          ? scopes[0].repositoryLogicalPath
          : normalizeConfigPath(
              settings.repositoryPath,
              "gitWorktrees.repositoryPath",
            );
        const projectDocChars = sliceDocCharsConfig(
          mergeDocCharsConfig(source.config, []),
          repositoryLogicalPath,
        );
        for (const scope of scopes) {
          const worktreeKey = scope.worktreePath.toLowerCase();
          if (seenWorktrees.has(worktreeKey)) {
            throw new Error(
              `worktree is configured more than once: ${scope.worktreePath}`,
            );
          }
          seenWorktrees.add(worktreeKey);

          const snapshot = collectGitChangedSnapshot(
            scope.worktreePath,
            scope.baseRef,
          );
          const selectedFiles = new Set(snapshot.existingFiles);
          const logicalRepository = `${source.reportPrefix}${scope.repositoryLogicalPath}`;
          const reportPrefix = `[worktree:${scope.name}] ${logicalRepository}/`;
          const repositoryConfig = loadConfig(scope.repositoryPath);
          const docCharsConfig = mergeRepositoryDocChars(
            projectDocChars,
            repositoryConfig,
          );
          const scanExcludePaths = normalizeScanExcludePaths(repositoryConfig);

          console.log(
            `[git-worktree] worktree:${scope.name} enumerated=${snapshot.enumeratedCount} ` +
              `existing=${snapshot.existingCount} deleted=${snapshot.deletedCount} ` +
              `accounted=${snapshot.existingCount + snapshot.deletedCount}`,
          );

          if (enabled.has("doc-chars")) {
            const result = checkDocChars(
              scope.worktreePath,
              docCharsConfig,
              true,
              selectedFiles,
              reportPrefix,
              scanExcludePaths,
            );
            allViolations.push(...result.violations);
            allWarnings.push(...result.warnings);
          }
          if (enabled.has("unicode-escape")) {
            const result = checkUnicodeEscape(
              scope.worktreePath,
              repositoryConfig,
              reportPrefix,
              true,
              selectedFiles,
            );
            allViolations.push(...result.violations);
            allWarnings.push(...result.warnings);
          }
          if (enabled.has("resume-freshness")) {
            const result = checkResumeFreshness(
              scope.worktreePath,
              true,
              selectedFiles,
              reportPrefix,
            );
            allViolations.push(...result.violations);
            allWarnings.push(...result.warnings);
          }
          if (enabled.has("glossary-terms")) {
            const result = checkGlossaryTerms(
              scope.worktreePath,
              true,
              selectedFiles,
              reportPrefix,
              scanExcludePaths,
            );
            allViolations.push(...result.violations);
            allWarnings.push(...result.warnings);
          }
          if (enabled.has("escalation-gap")) {
            const result = checkEscalationGap(
              scope.worktreePath,
              true,
              selectedFiles,
              reportPrefix,
            );
            allViolations.push(...result.violations);
            allWarnings.push(...result.warnings);
          }

          const after = collectGitChangedSnapshot(
            scope.worktreePath,
            scope.baseRef,
          );
          if (!sameGitSnapshot(snapshot, after)) {
            allViolations.push(
              `${reportPrefix}[git-worktree] HEAD, changed-path set, or file content changed during checks`,
            );
          }
        }
      } catch (error) {
        allViolations.push(
          `${source.reportPrefix}check-config.json: [git-worktree] ${error.message}`,
        );
      }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const unknownOptions = args.filter(
    (arg) =>
      arg.startsWith("--") &&
      arg !== "--no-recursive" &&
      !arg.startsWith("--check="),
  );
  if (unknownOptions.length > 0) {
    console.error(
      `引数エラー: 不明なオプション「${unknownOptions.join(", ")}」`,
    );
    process.exit(1);
  }

  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (positional.length !== 1) {
    console.error(
      `使い方: node 03_Checks/run-checks.js <対象ディレクトリ> [--no-recursive] [--check=${CHECK_NAMES.join(",")}]`,
    );
    process.exit(1);
  }

  const targetDir = path.resolve(positional[0]);
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    console.error(`対象エラー: ディレクトリが存在しない「${positional[0]}」`);
    process.exit(1);
  }

  const checkArgs = args.filter((arg) => arg.startsWith("--check="));
  if (checkArgs.length > 1) {
    console.error("引数エラー: --check は1回だけ指定する");
    process.exit(1);
  }
  const checkArg = checkArgs[0];
  const requested = checkArg
    ? checkArg
        .slice("--check=".length)
        .split(",")
        .map((name) => name.trim())
    : CHECK_NAMES;
  const unknownChecks = requested.filter(
    (name) => !name || !CHECK_NAMES.includes(name),
  );
  if (unknownChecks.length > 0) {
    const display = unknownChecks.map((name) => name || "(空)").join(", ");
    console.error(
      `引数エラー: 不明なチェック「${display}」。指定可能: ${CHECK_NAMES.join(", ")}`,
    );
    process.exit(1);
  }

  const enabled = new Set(requested);
  const recursive = !args.includes("--no-recursive");

  const config = loadConfig(targetDir);
  const subConfigs = recursive ? collectSubConfigs(targetDir) : [];
  const scanExcludePaths = mergeScanExcludePaths(config, subConfigs);
  const allViolations = [];
  const allWarnings = [];

  if (enabled.has("doc-chars")) {
    const result = checkDocChars(
      targetDir,
      mergeDocCharsConfig(config, subConfigs),
      recursive,
      null,
      "",
      scanExcludePaths,
    );
    allViolations.push(...result.violations);
    allWarnings.push(...result.warnings);
  }
  if (enabled.has("unicode-escape")) {
    const result = checkUnicodeEscape(targetDir, config, "", recursive);
    allViolations.push(...result.violations);
    allWarnings.push(...result.warnings);
    // 親実行時は直下プロジェクトの unicode-escape 設定も実行する
    for (const { name, config: subConfig } of subConfigs) {
      const subResult = checkUnicodeEscape(
        path.join(targetDir, name),
        subConfig,
        `${name}/`,
        recursive,
      );
      allViolations.push(...subResult.violations);
      allWarnings.push(...subResult.warnings);
    }
  }
  if (enabled.has("resume-freshness")) {
    const result = checkResumeFreshness(targetDir, recursive);
    allViolations.push(...result.violations);
    allWarnings.push(...result.warnings);
  }
  if (enabled.has("glossary-terms")) {
    const result = checkGlossaryTerms(
      targetDir,
      recursive,
      null,
      "",
      scanExcludePaths,
    );
    allViolations.push(...result.violations);
    allWarnings.push(...result.warnings);
  }
  if (enabled.has("escalation-gap")) {
    const result = checkEscalationGap(targetDir, recursive);
    allViolations.push(...result.violations);
    allWarnings.push(...result.warnings);
  }
  if (recursive) {
    runConfiguredWorktreeChecks(
      targetDir,
      config,
      subConfigs,
      enabled,
      allViolations,
      allWarnings,
    );
  }

  for (const warning of allWarnings) console.warn(`警告: ${warning}`);
  for (const violation of allViolations) console.error(`違反: ${violation}`);
  console.log(
    `\nチェック完了: 違反 ${allViolations.length} 件 / 警告 ${allWarnings.length} 件`,
  );
  if (allViolations.length > 0) process.exit(1);
}

// CLI として起動したときだけ実行する。テストから require しても main() が走らないようにするため
if (require.main === module) main();

module.exports = {
  collectFiles,
  collectGitChangedSnapshot,
  discoverConfiguredWorktrees,
  sameGitSnapshot,
  classifyStatus,
  parseIncidentLog,
  collectIncidentLogs,
  checkEscalationGap,
};
