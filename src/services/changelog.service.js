import mongoose, { Schema } from 'mongoose';
import { GITHUB_CHANGELOG_REPOS, GITHUB_TOKEN } from '../config/env.js';
import { buildChangelog } from './changelog-lib.js';

/*
 * The release notes, compiled from the conventional commit messages of the
 * repos in GITHUB_CHANGELOG_REPOS (read through the GitHub API, so the server
 * needs no git checkout). Stored once compiled; recompiled automatically once
 * a week, or on demand by a founder.
 */

export const RECOMPILE_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAGES_PER_REPO = 10; // 1,000 commits each
const GITHUB_API = 'https://api.github.com';

const changelogSchema = new Schema(
  {
    _id: { type: String, default: 'current' },
    releases: { type: Schema.Types.Mixed, default: [] },
    compiledAt: { type: Date, default: null },
    commits: { type: Number, default: 0 },
  },
  { versionKey: false }
);
export const Changelog = mongoose.models.Changelog || mongoose.model('Changelog', changelogSchema);

/** Every non-merge commit of one repo, as { hash, date, subject, repo }. */
export const fetchRepoCommits = async (fullName, fetchImpl = fetch) => {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'typeit-changelog' };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const repo = fullName.split('/')[1];
  const commits = [];
  for (let page = 1; page <= MAX_PAGES_PER_REPO; page++) {
    const res = await fetchImpl(`${GITHUB_API}/repos/${fullName}/commits?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${fullName}`);
    const rows = await res.json();
    for (const c of rows) {
      if ((c.parents?.length ?? 0) > 1) continue;
      commits.push({ hash: c.sha, date: c.commit?.author?.date, subject: String(c.commit?.message ?? '').split('\n')[0], repo });
    }
    if (rows.length < 100) break;
  }
  return commits;
};

/** Reads every configured repo, builds the notes and stores them. */
export const compileChangelog = async (now = new Date(), fetchImpl = fetch) => {
  if (!GITHUB_CHANGELOG_REPOS.length) throw new Error('No repos configured (GITHUB_CHANGELOG_REPOS)');
  const commits = (await Promise.all(GITHUB_CHANGELOG_REPOS.map((r) => fetchRepoCommits(r, fetchImpl)))).flat();
  const releases = buildChangelog(commits);
  await Changelog.updateOne({ _id: 'current' }, { $set: { releases, compiledAt: now, commits: commits.length } }, { upsert: true });
  return { releases: releases.length, commits: commits.length, compiledAt: now };
};

export const getChangelog = async () => {
  const doc = await Changelog.findById('current').lean();
  return { releases: doc?.releases ?? [], compiledAt: doc?.compiledAt ?? null };
};

/** Recompiles when the stored notes are older than a week (or missing). */
export const recompileIfStale = async (now = new Date()) => {
  if (!GITHUB_CHANGELOG_REPOS.length || mongoose.connection.readyState !== 1) return false;
  const doc = await Changelog.findById('current').select('compiledAt').lean();
  if (doc?.compiledAt && now - new Date(doc.compiledAt) < RECOMPILE_EVERY_MS) return false;
  await compileChangelog(now);
  return true;
};

/** Checks every few hours, so the weekly compile happens even if the server restarts often. */
export const startChangelogSchedule = () => {
  const run = () => recompileIfStale().catch((err) => console.error('[changelog] weekly compile failed:', err?.message || err));
  setTimeout(run, 60_000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
};
