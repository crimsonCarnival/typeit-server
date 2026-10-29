import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// Read by config/env.js at import time; each test file runs in its own process.
process.env.GITHUB_CHANGELOG_REPOS = 'owner/typeit-server';

const { Changelog, compileChangelog } = await import('../src/services/changelog.service.js');
const { versionOf } = await import('../src/services/changelog-lib.js');
const { default: User } = await import('../src/models/user.model.js');
const { default: Notification } = await import('../src/models/notification.model.js');

const leanOf = (value) => ({ select() { return this; }, lean: async () => value });
const COMMIT_DATE = '2026-10-29T12:00:00Z';
const LATEST = versionOf(new Date(COMMIT_DATE));
const fetchOne = async () => ({
  ok: true,
  json: async () => [{ sha: 'abc', parents: [{}], commit: { author: { date: COMMIT_DATE }, message: 'feat(game): add a mode' } }],
});

/** Stubs the stored notes and the player list; returns the bulk writes made. */
const setup = ({ stored, players = [{ _id: 'u1' }, { _id: 'u2' }] }) => {
  mock.method(Changelog, 'findById', () => leanOf(stored));
  mock.method(Changelog, 'updateOne', async () => ({}));
  const find = mock.method(User, 'find', () => leanOf(players));
  const bulk = mock.method(Notification, 'bulkWrite', async (ops) => ({ upsertedIds: Object.fromEntries(ops.map((_, i) => [i, i])) }));
  return { find, bulk };
};

describe('compileChangelog release notice', () => {
  afterEach(() => mock.restoreAll());

  it('notifies players who have not muted releases when the latest version changes', async () => {
    const { find, bulk } = setup({ stored: { releases: [{ version: 'v26.40.0' }] } });
    const out = await compileChangelog(new Date(), fetchOne);
    assert.equal(out.newVersion, LATEST);
    assert.equal(out.notified, 2);
    assert.deepEqual(find.mock.calls[0].arguments[0], { status: 'active', 'notificationPrefs.releases': { $ne: false } });
    const doc = bulk.mock.calls[0].arguments[0][0].updateOne.update.$setOnInsert;
    assert.equal(doc.type, 'changelog');
    assert.equal(doc.dedupeKey, `changelog:${LATEST}`);
  });

  it('stays silent when the latest version is unchanged', async () => {
    const { bulk } = setup({ stored: { releases: [{ version: LATEST }] } });
    assert.equal((await compileChangelog(new Date(), fetchOne)).notified, 0);
    assert.equal(bulk.mock.callCount(), 0);
  });

  it('stays silent on the very first compile', async () => {
    const { bulk } = setup({ stored: null });
    assert.equal((await compileChangelog(new Date(), fetchOne)).notified, 0);
    assert.equal(bulk.mock.callCount(), 0);
  });

  it('still stores the notes when the notice fails', async () => {
    setup({ stored: { releases: [{ version: 'v26.40.0' }] } });
    mock.method(User, 'find', () => ({ select() { return this; }, lean: async () => { throw new Error('db down'); } }));
    const error = mock.method(console, 'error', () => {});
    const out = await compileChangelog(new Date(), fetchOne);
    assert.equal(out.notified, 0);
    assert.equal(Changelog.updateOne.mock.callCount(), 1);
    assert.equal(error.mock.callCount(), 1);
  });
});
