#!/usr/bin/env node
/**
 * @fileoverview 運用ルール自動チェックランナー（03_Checks）
 *
 * 役割:
 *   ~\Projects 配下のドキュメント・コードに対し、機械検証可能な運用ルールの
 *   違反を検出する。各チェックと対応ルールIDの一覧は同階層の README.md を参照。
 *
 * 使い方:
 *   node 03_Checks/run-checks.js <対象ディレクトリ> [--check=doc-chars,unicode-escape,resume-freshness,glossary-terms]
 *   例: node 03_Checks/run-checks.js .                    （Projects 全体）
 *       node 03_Checks/run-checks.js FF14_Fishing_Alert   （プロジェクト単位）
 *
 * 設定:
 *   <対象ディレクトリ>\check-config.json があれば読み込む（任意・例外設定用）。
 *   親ディレクトリから実行した場合、直下プロジェクトの check-config.json も統合する
 *   （例外の正はプロジェクト側に1箇所 = CR-064。二重管理しない）。スキーマは README.md を参照。
 *
 * 終了コード:
 *   0: 違反なし（警告のみの場合を含む）
 *   1: 違反あり
 *
 * 注意:
 *   Cowork サンドボックスからの実行はマウント読取の途切れ（CS-002・CS-004）で
 *   誤検出があり得る。正とするのは依頼者マシン（ローカル）での実行結果。
 */

const fs = require('fs');
const path = require('path');

/** 走査から常に除外するディレクトリ名 */
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.docusaurus',
  '.codex',
  '.agents',
  'build',
  'dist',
  'coverage',
]);

/**
 * 違反として検出する文字（ハード違反）。名称は報告メッセージ用
 * 根拠: CR-024（全角スペース禁止）、CL-003 / AG-003 / MF-009（全角半角取り違え・破損点検）
 */
const HARD_CHARS = [
  { re: /　/g, name: '全角スペース(U+3000)', ruleId: 'CR-024' },
  { re: /[  -​]/g, name: '不可視スペース(U+00A0/U+2000-200B)', ruleId: 'CR-024' },
  { re: /[０-９]/g, name: '全角数字', ruleId: 'CL-003' },
  { re: /[Ａ-Ｚａ-ｚ]/g, name: '全角英字', ruleId: 'CL-003' },
  { re: /～/g, name: '全角チルダ(U+FF5E)', ruleId: 'CL-003' },
  { re: /�/g, name: '置換文字(U+FFFD)=破損疑い', ruleId: 'CL-003' },
];

/**
 * 警告として検出する文字（意図的使用があり得るため人間が判定する）
 * - 全角不等号: 優先順位表記（例: A ＞ B）の意図的使用の実績あり
 * - 異体字・簡体字の混入疑い: 隨(U+96A8)/圈(U+5708)/暂(U+6682)。観測実績ベースの黒リスト
 */
const WARN_CHARS = [
  { re: /[＜＞]/g, name: '全角不等号（意図的使用か要目視）', ruleId: 'CL-003' },
  { re: /[隨圈暂]/g, name: '異体字・簡体字の疑い（要目視）', ruleId: 'CL-003' },
];

/** Unicodeエスケープ検出用（unicode-escape チェック） */
const UNICODE_ESCAPE_RE = /\\u[0-9a-fA-F]{4}/g;

/**
 * 対象ディレクトリ配下のファイルを再帰列挙する
 * @param {string} dirPath - 起点ディレクトリの絶対パス
 * @param {(name: string) => boolean} fileFilter - 対象ファイル名の判定
 * @param {boolean} recursive - サブディレクトリを辿るか
 * @return {string[]} 絶対パスの一覧
 */
function collectFiles(dirPath, fileFilter, recursive) {
  if (!fs.existsSync(dirPath)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (recursive && !EXCLUDE_DIRS.has(entry.name)) {
        results.push(...collectFiles(path.join(dirPath, entry.name), fileFilter, recursive));
      }
    } else if (entry.isFile() && fileFilter(entry.name)) {
      results.push(path.join(dirPath, entry.name));
    }
  }
  return results;
}

/**
 * check-config.json を読み込む（無ければ空設定）
 * @param {string} dirPath - 設定ファイルを探すディレクトリの絶対パス
 * @return {Object} 設定オブジェクト
 */
function loadConfig(dirPath) {
  const configPath = path.join(dirPath, 'check-config.json');
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
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
    const configPath = path.join(targetDir, entry.name, 'check-config.json');
    if (!fs.existsSync(configPath)) continue;
    results.push({ name: entry.name, config: JSON.parse(fs.readFileSync(configPath, 'utf8')) });
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
    excludePaths: [...((config.docChars && config.docChars.excludePaths) || [])],
    fileAllowedChars: { ...((config.docChars && config.docChars.fileAllowedChars) || {}) },
  };
  for (const { name, config: subConfig } of subConfigs) {
    const docChars = subConfig.docChars || {};
    for (const prefix of docChars.excludePaths || []) {
      merged.excludePaths.push(`${name}/${prefix}`);
    }
    for (const [relPath, chars] of Object.entries(docChars.fileAllowedChars || {})) {
      merged.fileAllowedChars[`${name}/${relPath}`] = chars;
    }
  }
  return merged;
}

/**
 * doc-chars: Markdown ドキュメントの禁止文字・破損疑い文字を検出する
 * @param {string} targetDir - 対象ディレクトリの絶対パス
 * @param {{excludePaths: string[], fileAllowedChars: Object}} docCharsConfig - 統合済み例外
 * @return {{violations: string[], warnings: string[]}} 検出結果
 */
function checkDocChars(targetDir, docCharsConfig) {
  const violations = [];
  const warnings = [];
  const files = collectFiles(
    targetDir,
    // handover-*.md と worklog.md / worklog-YYYY-MM.md は追記専用の歴史記録（違反文字の引用を含む）のため既定で対象外
    (name) =>
      name.endsWith('.md') &&
      !/^handover-.*\.md$/.test(name) &&
      !/^worklog(-\d{4}-\d{2})?\.md$/.test(name),
    true
  );

  for (const filePath of files) {
    const relPath = path.relative(targetDir, filePath).split(path.sep).join('/');
    if (docCharsConfig.excludePaths.some((prefix) => relPath.startsWith(prefix))) continue;
    const allowed = new Set(docCharsConfig.fileAllowedChars[relPath] || []);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');

    lines.forEach((lineText, lineIndex) => {
      for (const { re, name, ruleId } of HARD_CHARS) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(lineText)) !== null) {
          if (allowed.has(match[0])) continue;
          violations.push(
            `${relPath}:${lineIndex + 1}:${match.index + 1}: [doc-chars] ${name}「${match[0]}」（${ruleId}）`
          );
        }
      }
      for (const { re, name, ruleId } of WARN_CHARS) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(lineText)) !== null) {
          if (allowed.has(match[0])) continue;
          warnings.push(
            `${relPath}:${lineIndex + 1}:${match.index + 1}: [doc-chars] ${name}「${match[0]}」（${ruleId}）`
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
 * @return {{violations: string[], warnings: string[]}} 検出結果
 */
function checkUnicodeEscape(baseDir, config, reportPrefix) {
  const violations = [];
  const settings = config.unicodeEscape;
  if (!settings || !Array.isArray(settings.targets)) {
    return { violations, warnings: [] };
  }
  const allowedEscapes = settings.allowedEscapes || [];

  for (const target of settings.targets) {
    const extensions = target.extensions || ['.js'];
    const dirPath = path.join(baseDir, ...target.dir.split('/'));
    const recursive = target.recursive !== false;
    const files = collectFiles(
      dirPath,
      (name) => extensions.some((ext) => name.endsWith(ext)),
      recursive
    );

    for (const filePath of files) {
      const relPath = reportPrefix + path.relative(baseDir, filePath).split(path.sep).join('/');
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      lines.forEach((lineText, lineIndex) => {
        let sanitized = lineText;
        for (const escape of allowedEscapes) {
          sanitized = sanitized.split(escape).join('');
        }
        let match;
        UNICODE_ESCAPE_RE.lastIndex = 0;
        while ((match = UNICODE_ESCAPE_RE.exec(sanitized)) !== null) {
          violations.push(
            `${relPath}:${lineIndex + 1}: [unicode-escape] Unicodeエスケープ検出 ${match[0]}（直接文字に置き換える）`
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
  const glossaryPath = path.join(__dirname, '..', '04_Rules_Reference', 'glossary.md');
  if (!fs.existsSync(glossaryPath)) return [];
  const TERM_SECTIONS = new Set(['セッション進行', '成果物・記録', '設計・品質']);
  const terms = new Set();
  let inTermSection = false;
  for (const line of fs.readFileSync(glossaryPath, 'utf8').split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      inTermSection = TERM_SECTIONS.has(heading[1].trim());
      continue;
    }
    if (!inTermSection) continue;
    const entry = line.match(/^-\s+([^:：]+)[:：]/);
    if (!entry) continue;
    for (let part of entry[1].split('/')) {
      part = part.replace(/（[^）]*）/g, '').trim();
      if (part) terms.add(part);
    }
  }
  return [...terms];
}

/**
 * glossary-terms: 定義済み用語の目印 (U+1D33) が用語集にある語に付いているかを検査する
 * 定義の意味かは機械判定できないため付与漏れは検査しない（実在のみの逆向き検査。CR-067）
 * @param {string} targetDir - 対象ディレクトリの絶対パス
 * @return {{violations: string[], warnings: string[]}} 検出結果
 */
function checkGlossaryTerms(targetDir) {
  const violations = [];
  const terms = loadGlossaryTerms();
  if (terms.length === 0) return { violations, warnings: [] };
  const MARK = 'ᴳ';
  const files = collectFiles(
    targetDir,
    (name) =>
      name.endsWith('.md') &&
      !/^handover-.*\.md$/.test(name) &&
      !/^worklog(-\d{4}-\d{2})?\.md$/.test(name),
    true
  );
  for (const filePath of files) {
    const relPath = path.relative(targetDir, filePath).split(path.sep).join('/');
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    lines.forEach((lineText, lineIndex) => {
      for (let idx = lineText.indexOf(MARK); idx !== -1; idx = lineText.indexOf(MARK, idx + 1)) {
        const before = lineText.slice(0, idx);
        const prevChar = before.slice(-1);
        // 直前が語構成文字でなければ目印ではなく字としての言及（記法定義・引用）とみなし対象外
        if (!prevChar || !/[\p{L}\p{N}-]/u.test(prevChar)) continue;
        if (!terms.some((term) => before.endsWith(term))) {
          violations.push(
            `${relPath}:${lineIndex + 1}:${idx + 1}: [glossary-terms] 用語集にない語に目印 (U+1D33) が付与されている（CR-067）`
          );
        }
      }
    });
  }
  return { violations, warnings: [] };
}

/**
 * resume-freshness: resume.md の更新時刻の記載が worklog.md より古くないかを検知する
 * 時刻はローカルタイムゾーン前提のため、依頼者マシンでの実行を正とし警告のみとする（CR-054）
 * @param {string} targetDir - 対象ディレクトリの絶対パス
 * @return {{violations: string[], warnings: string[]}} 検出結果
 */
function checkResumeFreshness(targetDir) {
  const warnings = [];
  const handoverDirs = [];

  const directHandover = path.join(targetDir, 'handover');
  if (fs.existsSync(directHandover)) {
    handoverDirs.push(directHandover);
  } else {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || EXCLUDE_DIRS.has(entry.name)) continue;
      if (entry.name === '00_Template') continue;
      const handoverPath = path.join(targetDir, entry.name, 'handover');
      if (fs.existsSync(handoverPath)) handoverDirs.push(handoverPath);
    }
  }

  const TOLERANCE_MS = 60 * 60 * 1000;
  for (const handoverDir of handoverDirs) {
    const resumePath = path.join(handoverDir, 'resume.md');
    const worklogPath = path.join(handoverDir, 'worklog.md');
    if (!fs.existsSync(resumePath)) continue;
    const relPath = path.relative(targetDir, resumePath).split(path.sep).join('/');

    const text = fs.readFileSync(resumePath, 'utf8');
    const timeMatch = text.match(/更新時刻:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
    if (!timeMatch) continue; // 雛形（プレースホルダ）はスキップ
    const recordedTime = new Date(timeMatch[1].replace(' ', 'T'));

    if (fs.existsSync(worklogPath)) {
      const worklogMtime = fs.statSync(worklogPath).mtime;
      if (worklogMtime.getTime() - recordedTime.getTime() > TOLERANCE_MS) {
        warnings.push(
          `${relPath}: [resume-freshness] worklog.md の方が新しい（resume 記載 ${timeMatch[1]}）。resume.md の最新化漏れの疑い（CR-054）`
        );
      }
    }
    const resumeMtime = fs.statSync(resumePath).mtime;
    if (resumeMtime.getTime() - recordedTime.getTime() > TOLERANCE_MS) {
      warnings.push(
        `${relPath}: [resume-freshness] ファイル更新が記載時刻より新しい（記載 ${timeMatch[1]}）。更新時刻の書き換え漏れの疑い（CR-054）`
      );
    }
  }
  return { violations: [], warnings };
}

/**
 * メイン処理
 */
function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (positional.length !== 1) {
    console.error('使い方: node 03_Checks/run-checks.js <対象ディレクトリ> [--check=doc-chars,unicode-escape,resume-freshness,glossary-terms]');
    process.exit(1);
  }
  const targetDir = path.resolve(positional[0]);
  const checkArg = args.find((arg) => arg.startsWith('--check='));
  const enabled = checkArg
    ? new Set(checkArg.replace('--check=', '').split(','))
    : new Set(['doc-chars', 'unicode-escape', 'resume-freshness', 'glossary-terms']);

  const config = loadConfig(targetDir);
  const subConfigs = collectSubConfigs(targetDir);
  const allViolations = [];
  const allWarnings = [];

  if (enabled.has('doc-chars')) {
    const result = checkDocChars(targetDir, mergeDocCharsConfig(config, subConfigs));
    allViolations.push(...result.violations);
    allWarnings.push(...result.warnings);
  }
  if (enabled.has('unicode-escape')) {
    const result = checkUnicodeEscape(targetDir, config, '');
    allViolations.push(...result.violations);
    allWarnings.push(...result.warnings);
    // 親実行時は直下プロジェクトの unicode-escape 設定も実行する
    for (const { name, config: subConfig } of subConfigs) {
      const subResult = checkUnicodeEscape(path.join(targetDir, name), subConfig, `${name}/`);
      allViolations.push(...subResult.violations);
      allWarnings.push(...subResult.warnings);
    }
  }
  if (enabled.has('resume-freshness')) {
    const result = checkResumeFreshness(targetDir);
    allViolations.push(...result.violations);
    allWarnings.push(...result.warnings);
  }
  if (enabled.has('glossary-terms')) {
    const result = checkGlossaryTerms(targetDir);
    allViolations.push(...result.violations);
    allWarnings.push(...result.warnings);
  }

  for (const warning of allWarnings) console.warn(`警告: ${warning}`);
  for (const violation of allViolations) console.error(`違反: ${violation}`);
  console.log(`\nチェック完了: 違反 ${allViolations.length} 件 / 警告 ${allWarnings.length} 件`);
  if (allViolations.length > 0) process.exit(1);
}

main();
