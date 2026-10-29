
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildChangelog, isoWeek, parseSubject, versionOf } from '../src/services/changelog-lib.js';

describe('parseSubject', () => {
  it('reads type, scope and text', () => {
    assert.deepEqual(parseSubject('feat(race): add join and leave sounds'), { type: 'feat', scope: 'race', breaking: false, text: 'add join and leave sounds', pr: null });
  });

  it('scope is optional, a trailing period is dropped', () => {
    const p = parseSubject('fix: stop the timer when leaving the page.');
    assert.deepEqual([p.scope, p.text], [null, 'stop the timer when leaving the page']);
  });

  it('a "!" marks a breaking change', () => {
    assert.equal(parseSubject('feat(api)!: rename the results endpoint').breaking, true);
  });

  it('keeps a pull request number apart from the text', () => {
    const p = parseSubject('fix(daily): reset at midnight UTC (#42)');
    assert.deepEqual([p.text, p.pr], ['reset at midnight UTC', 42]);
  });

  it('drops anything that is not a known conventional commit', () => {
    for (const s of ['Merge pull request #6 from x/y', 'stuff', 'WIP', 'Add feature', 'wibble(x): y', '', null]) assert.equal(parseSubject(s), null, String(s));
  });

  it('drops the changelog\'s own commits', () => {
    assert.equal(parseSubject('chore(changelog): update release notes'), null);
    assert.ok(parseSubject('chore(deps): bump chart.js'));
  });
});

describe('versions', () => {
  it('are the year and ISO week', () => {
    assert.equal(versionOf(new Date('2026-10-20T10:00:00Z')), 'v26.43.0');
    assert.equal(versionOf(new Date('2026-08-04T10:00:00Z')), 'v26.32.0');
  });

  it('use the ISO week-year around New Year', () => {
    assert.deepEqual(isoWeek(new Date('2027-01-01T12:00:00Z')), { year: 2026, week: 53 });
    assert.deepEqual(isoWeek(new Date('2024-12-30T12:00:00Z')), { year: 2025, week: 1 });
  });

  it('count a Sunday with the week that ends on it', () => {
    assert.equal(versionOf(new Date('2026-10-25T23:59:00Z')), 'v26.43.0');
    assert.equal(versionOf(new Date('2026-10-26T00:00:00Z')), 'v26.44.0');
  });
});

describe('sections', () => {
  const at = '2026-10-20T10:00:00Z';
  const where = (subject) => {
    const [r] = buildChangelog([{ subject, date: at, hash: 'h', repo: 'x' }]);
    return Object.entries(r.sections).find(([, v]) => v.length)[0];
  };

  it('sorts each kind of change into its own section', () => {
    assert.equal(where('feat(race): kick players'), 'features');
    assert.equal(where('improve(stats): clearer labels'), 'improvements');
    assert.equal(where('ui(admin): full-width table'), 'design');
    assert.equal(where('perf(db): index results'), 'performance');
    assert.equal(where('security: limit login attempts'), 'security');
    assert.equal(where('fix(security): stop settings prototype keys'), 'security');
    assert.equal(where('fix(race): double sounds'), 'fixes');
    assert.equal(where('revert: undo tape mode'), 'reverts');
    assert.equal(where('docs: explain env vars'), 'documentation');
    assert.equal(where('chore(deps): bump chart.js'), 'dependencies');
    assert.equal(where('build(deps-dev): bump vitest'), 'dependencies');
    assert.equal(where('refactor(ui): split menu'), 'nerd');
  });

  it('a breaking change goes first, whatever its type', () => {
    assert.equal(where('feat(api)!: rename the results endpoint'), 'breaking');
  });
});

describe('buildChangelog', () => {
  const commit = (subject, date, hash = 'abcdef1234567890', repo = 'client') => ({ subject, date, hash, repo });

  it('puts each type in its section', () => {
    const [release] = buildChangelog([
      commit('feat(stats): show activity graph', '2026-10-20T10:00:00Z'),
      commit('perf(db): index results', '2026-10-20T11:00:00Z'),
      commit('fix(race): stop double sounds', '2026-10-21T10:00:00Z'),
      commit('refactor(ui): split menu', '2026-10-21T11:00:00Z'),
      commit('docs: explain env vars', '2026-10-22T10:00:00Z'),
    ]);
    assert.equal(release.version, 'v26.43.0');
    const counts = Object.fromEntries(Object.entries(release.sections).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
    assert.deepEqual(counts, { features: 1, performance: 1, fixes: 1, nerd: 1, documentation: 1 });
  });

  it('makes one release per week, newest first, dated by its latest commit', () => {
    const releases = buildChangelog([
      commit('feat: a', '2026-10-19T10:00:00Z'),
      commit('feat: b', '2026-10-22T10:00:00Z'),
      commit('feat: c', '2026-10-27T10:00:00Z'),
    ]);
    assert.deepEqual(releases.map((r) => [r.version, r.date]), [['v26.44.0', '2026-10-27'], ['v26.43.0', '2026-10-22']]);
  });

  it('skips merges, free-form commits and its own commits', () => {
    const releases = buildChangelog([commit('Merge branch x', '2026-10-20T10:00:00Z'), commit('wip', '2026-10-20T10:00:00Z'), commit('chore(changelog): update release notes', '2026-10-20T10:00:00Z')]);
    assert.deepEqual(releases, []);
  });

  it('keeps a short hash and which repo the commit is from', () => {
    const [r] = buildChangelog([commit('fix(x): y', '2026-10-20T10:00:00Z', '0123456789abcdef', 'server')]);
    assert.deepEqual([r.sections.fixes[0].hash, r.sections.fixes[0].repo], ['01234567', 'server']);
  });

  it('keeps the UTC day and the exact time of each commit', () => {
    const [r] = buildChangelog([commit('fix(x): y', '2026-10-29T01:30:00-05:00')]);
    assert.deepEqual([r.sections.fixes[0].day, r.sections.fixes[0].at], ['2026-10-29', '2026-10-29T06:30:00.000Z']);
  });

  it('ignores a commit with an unreadable date', () => {
    assert.deepEqual(buildChangelog([commit('feat: a', 'not a date')]), []);
  });
});

describe('fetchRepoCommits', async () => {
  const { fetchRepoCommits } = await import('../src/services/changelog.service.js');
  const commit = (sha, msg, parents = 1) => ({ sha, parents: Array.from({ length: parents }, () => ({})), commit: { message: msg, author: { date: '2026-10-20T10:00:00Z' } } });

  it('pages through the history, skips merges and keeps only the subject line', async () => {
    const pages = [Array.from({ length: 100 }, (_, i) => commit(`a${i}`, `feat: one ${i}\n\nbody text`)), [commit('m', 'Merge branch x', 2), commit('b', 'fix(x): two')]];
    const calls = [];
    const fake = async (url) => {
      calls.push(url);
      return { ok: true, json: async () => pages[calls.length - 1] ?? [] };
    };
    const out = await fetchRepoCommits('me/typeit-client', fake);
    assert.equal(calls.length, 2, 'stops on a short page');
    assert.equal(out.length, 101);
    assert.deepEqual(out.at(-1), { hash: 'b', date: '2026-10-20T10:00:00Z', subject: 'fix(x): two', repo: 'typeit-client' });
    assert.equal(out[0].subject, 'feat: one 0');
  });

  it('fails loudly when GitHub refuses', async () => {
    await assert.rejects(fetchRepoCommits('me/x', async () => ({ ok: false, status: 404 })), /404/);
  });
});
