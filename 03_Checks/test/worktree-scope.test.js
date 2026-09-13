/**
 * @fileoverview Worktree duplicate-scan and changed-file overlay tests (T0-27).
 *
 * Run from the workspace root:
 *   node --test 03_Checks\test\worktree-scope.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const runnerPath = path.resolve(__dirname, '..', 'run-checks.js');
const {
  collectGitChangedSnapshot,
  discoverConfiguredWorktrees,
  sameGitSnapshot,
} = require('../run-checks.js');

function runGit(cwd, args) {
  return execFileSync('git', ['-c', `safe.directory=${cwd.replaceAll('\\', '/')}`, '-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createFixture(nestedProject = false) {
  const fixtureRoot = path.resolve(__dirname, '..', '..', 'Auto_Trader', '.tmp-check-fixtures');
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const container = fs.mkdtempSync(path.join(fixtureRoot, 't0-27-'));
  const root = nestedProject ? path.join(container, 'Project') : container;
  const repositoryPath = path.join(root, 'repo');
  const worktreeRoot = path.join(root, '.worktrees');
  const worktreePath = path.join(worktreeRoot, 'feature');
  fs.mkdirSync(repositoryPath, { recursive: true });
  fs.mkdirSync(worktreeRoot, { recursive: true });

  runGit(repositoryPath, ['init']);
  runGit(repositoryPath, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(repositoryPath, ['config', 'user.name', 'Fixture']);
  runGit(repositoryPath, ['checkout', '-b', 'main']);
  writeFile(repositoryPath, 'README.md', '# baseline\n');
  runGit(repositoryPath, ['add', 'README.md']);
  runGit(repositoryPath, ['commit', '-m', 'baseline']);
  runGit(repositoryPath, ['worktree', 'add', '-b', 'feature', worktreePath, 'main']);

  const config = {
    gitWorktrees: [
      {
        repositoryPath: 'repo',
        root: '.worktrees',
        baseRef: 'main',
      },
    ],
  };
  fs.writeFileSync(path.join(root, 'check-config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  return { container, root, repositoryPath, worktreeRoot, worktreePath };
}

function removeFixture(fixture) {
  try {
    runGit(fixture.repositoryPath, ['worktree', 'remove', '--force', fixture.worktreePath]);
  } catch (_) {
    // The temporary fixture is removed below even if Git metadata cleanup fails.
  }
  fs.rmSync(fixture.container, { recursive: true, force: true });
}

function runChecker(target, checks = 'doc-chars') {
  return spawnSync(process.execPath, [runnerPath, target, `--check=${checks}`], {
    encoding: 'utf8',
  });
}

test('collectGitChangedSnapshot covers committed, staged, unstaged, and untracked paths', () => {
  const fixture = createFixture();
  try {
    writeFile(fixture.worktreePath, 'committed.md', '# committed\n');
    runGit(fixture.worktreePath, ['add', 'committed.md']);
    runGit(fixture.worktreePath, ['commit', '-m', 'committed']);
    writeFile(fixture.worktreePath, 'staged.md', '# staged\n');
    runGit(fixture.worktreePath, ['add', 'staged.md']);
    writeFile(fixture.worktreePath, 'README.md', '# unstaged\n');
    writeFile(fixture.worktreePath, 'untracked.md', '# untracked\n');

    const snapshot = collectGitChangedSnapshot(fixture.worktreePath, 'main');
    const expectedPaths = [
      'README.md',
      'committed.md',
      'staged.md',
      'untracked.md',
    ].sort((a, b) => a.localeCompare(b));
    assert.deepStrictEqual(snapshot.paths, expectedPaths);
    assert.strictEqual(snapshot.existingCount, 4);
    assert.strictEqual(snapshot.deletedCount, 0);
    assert.strictEqual(snapshot.enumeratedCount, 4);
    assert.strictEqual(sameGitSnapshot(snapshot, collectGitChangedSnapshot(fixture.worktreePath, 'main')), true);
  } finally {
    removeFixture(fixture);
  }
});

test('collectGitChangedSnapshot fails closed when the base ref is missing', () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => collectGitChangedSnapshot(fixture.worktreePath, 'missing-ref'),
      /missing-ref|merge-base|Git/i
    );
  } finally {
    removeFixture(fixture);
  }
});

test('collectGitChangedSnapshot accounts for zero changes and deleted paths', () => {
  const fixture = createFixture();
  try {
    const clean = collectGitChangedSnapshot(fixture.worktreePath, 'main');
    assert.strictEqual(clean.enumeratedCount, 0);
    assert.strictEqual(clean.existingCount, 0);
    assert.strictEqual(clean.deletedCount, 0);

    fs.unlinkSync(path.join(fixture.worktreePath, 'README.md'));
    const deleted = collectGitChangedSnapshot(fixture.worktreePath, 'main');
    assert.deepStrictEqual(deleted.paths, ['README.md']);
    assert.strictEqual(deleted.existingCount, 0);
    assert.strictEqual(deleted.deletedCount, 1);
    assert.strictEqual(deleted.enumeratedCount, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('collectGitChangedSnapshot accounts for both sides of a rename', () => {
  const fixture = createFixture();
  try {
    runGit(fixture.worktreePath, ['mv', 'README.md', 'RENAMED.md']);
    const renamed = collectGitChangedSnapshot(fixture.worktreePath, 'main');
    assert.deepStrictEqual(renamed.paths, ['README.md', 'RENAMED.md']);
    assert.strictEqual(renamed.existingCount, 1);
    assert.strictEqual(renamed.deletedCount, 1);
    assert.strictEqual(renamed.enumeratedCount, 2);
  } finally {
    removeFixture(fixture);
  }
});

test('sameGitSnapshot detects content changes even when the path set is unchanged', () => {
  const fixture = createFixture();
  try {
    writeFile(fixture.worktreePath, 'README.md', '# first\n');
    const before = collectGitChangedSnapshot(fixture.worktreePath, 'main');
    writeFile(fixture.worktreePath, 'README.md', '# second\n');
    const after = collectGitChangedSnapshot(fixture.worktreePath, 'main');
    assert.deepStrictEqual(before.paths, after.paths);
    assert.strictEqual(sameGitSnapshot(before, after), false);
  } finally {
    removeFixture(fixture);
  }
});

test('discoverConfiguredWorktrees returns only registered worktrees under the configured root', () => {
  const fixture = createFixture();
  try {
    fs.mkdirSync(path.join(fixture.worktreeRoot, 'noise'), { recursive: true });
    const scopes = discoverConfiguredWorktrees(fixture.root, {
      repositoryPath: 'repo',
      root: '.worktrees',
      baseRef: 'main',
    });
    assert.strictEqual(scopes.length, 1);
    assert.strictEqual(scopes[0].name, 'feature');
    assert.strictEqual(scopes[0].worktreePath, fixture.worktreePath);
  } finally {
    removeFixture(fixture);
  }
});

test('discoverConfiguredWorktrees rejects a registered worktree outside the configured root', () => {
  const fixture = createFixture();
  try {
    const outsidePath = path.join(fixture.root, 'outside');
    runGit(fixture.repositoryPath, ['worktree', 'add', '-b', 'outside', outsidePath, 'main']);
    assert.throws(
      () => discoverConfiguredWorktrees(fixture.root, {
        repositoryPath: 'repo',
        root: '.worktrees',
        baseRef: 'main',
      }),
      /outside configured root/i
    );
  } finally {
    removeFixture(fixture);
  }
});

test('CLI ignores duplicate noise but detects a registered worktree violation through the overlay', () => {
  const fixture = createFixture();
  try {
    const invalid = String.fromCodePoint(0xff11);
    writeFile(fixture.worktreePath, 'README.md', `# invalid ${invalid}\n`);
    runGit(fixture.worktreePath, ['add', 'README.md']);
    runGit(fixture.worktreePath, ['commit', '-m', 'invalid']);
    writeFile(fixture.worktreeRoot, 'noise/invalid.md', `# duplicate noise ${invalid}\n`);

    const negative = runChecker(fixture.root);
    assert.strictEqual(negative.status, 1);
    assert.match(`${negative.stdout}\n${negative.stderr}`, /worktree:feature/);
    assert.match(`${negative.stdout}\n${negative.stderr}`, /repo\/README\.md/);
    assert.match(`${negative.stdout}\n${negative.stderr}`, /enumerated=1.*accounted=1/i);

    writeFile(fixture.worktreePath, 'README.md', '# valid\n');
    runGit(fixture.worktreePath, ['add', 'README.md']);
    runGit(fixture.worktreePath, ['commit', '-m', 'valid']);
    const positive = runChecker(fixture.root);
    assert.strictEqual(positive.status, 0, `${positive.stdout}\n${positive.stderr}`);
    assert.match(`${positive.stdout}\n${positive.stderr}`, /worktree:feature/);
    assert.match(`${positive.stdout}\n${positive.stderr}`, /enumerated=1.*accounted=1/i);
    assert.doesNotMatch(`${positive.stdout}\n${positive.stderr}`, /noise\/invalid\.md/);
  } finally {
    removeFixture(fixture);
  }
});

test('CLI applies a direct child project gitWorktrees config from the workspace parent', () => {
  const fixture = createFixture(true);
  try {
    const invalid = String.fromCodePoint(0xff11);
    writeFile(fixture.worktreePath, 'README.md', `# invalid ${invalid}\n`);
    runGit(fixture.worktreePath, ['add', 'README.md']);
    runGit(fixture.worktreePath, ['commit', '-m', 'invalid']);

    const result = runChecker(fixture.container);
    assert.strictEqual(result.status, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /worktree:feature/);
    assert.match(`${result.stdout}\n${result.stderr}`, /Project\/repo\/README\.md/);
    assert.match(`${result.stdout}\n${result.stderr}`, /enumerated=1.*accounted=1/i);
  } finally {
    removeFixture(fixture);
  }
});
