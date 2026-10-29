/**
 * Turns commit subjects into release notes. Pure: no git, no files, so it can
 * be tested. The commit format it relies on is described in the project
 * memory (commit-message-format): `type(scope)!: summary`.
 */

/** Which section of the notes each commit type lands in (see sectionOf for scopes that override it). */
export const SECTION_OF = Object.freeze({
  feat: 'features',
  improve: 'improvements',
  ui: 'design',
  perf: 'performance',
  security: 'security',
  fix: 'fixes',
  revert: 'reverts',
  docs: 'documentation',
  refactor: 'nerd',
  chore: 'nerd',
  test: 'nerd',
  build: 'nerd',
  ci: 'nerd',
  style: 'nerd',
});

/** In the order they are shown. Empty sections are left out of a release. */
export const SECTIONS = Object.freeze([
  { id: 'breaking', title: 'Breaking changes' },
  { id: 'features', title: 'Features' },
  { id: 'improvements', title: 'Improvements' },
  { id: 'design', title: 'Design' },
  { id: 'performance', title: 'Performance' },
  { id: 'security', title: 'Security' },
  { id: 'fixes', title: 'Fixes' },
  { id: 'reverts', title: 'Reverts' },
  { id: 'documentation', title: 'Documentation' },
  { id: 'dependencies', title: 'Dependencies' },
  { id: 'nerd', title: 'Behind the scenes' },
]);

/**
 * The section a parsed commit belongs to. A breaking change (`!`) always goes
 * first; a security fix (`fix(security)`) to Security; dependency bumps
 * (`chore(deps)`, `build(deps)`) to Dependencies.
 */
export const sectionOf = (parsed) => {
  if (parsed.breaking) return 'breaking';
  if (parsed.type === 'fix' && parsed.scope === 'security') return 'security';
  if ((parsed.type === 'chore' || parsed.type === 'build') && /^deps(-dev)?$/.test(parsed.scope ?? '')) return 'dependencies';
  return SECTION_OF[parsed.type];
};

const SUBJECT = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s+(?<text>.+)$/;

/** Commits about the notes themselves would only add noise to them. */
const IGNORED = (parsed) => parsed.type === 'chore' && parsed.scope === 'changelog';

/**
 * Parses one commit subject. Returns null for anything that is not a
 * conventional commit with a known type (merge commits, free-form messages).
 */
export const parseSubject = (subject) => {
  const m = SUBJECT.exec(String(subject ?? '').trim());
  if (!m || !SECTION_OF[m.groups.type]) return null;
  let text = m.groups.text.trim();
  // A trailing pull request reference, "(#123)", is kept apart from the text.
  const pr = /\s*\(#(\d+)\)$/.exec(text);
  if (pr) text = text.slice(0, pr.index);
  const parsed = {
    type: m.groups.type,
    scope: m.groups.scope?.trim() || null,
    breaking: !!m.groups.breaking,
    text: text.replace(/\.$/, ''),
    pr: pr ? Number(pr[1]) : null,
  };
  return IGNORED(parsed) ? null : parsed;
};

/** ISO 8601 week-year and week number of a date, in UTC. */
export const isoWeek = (date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday of this week decides the week-year.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7) };
};

/** Calendar version of a date: vYY.WW.0 (year and ISO week), e.g. v26.43.0. */
export const versionOf = (date) => {
  const { year, week } = isoWeek(date);
  return `v${String(year % 100).padStart(2, '0')}.${String(week).padStart(2, '0')}.0`;
};

/**
 * Groups commits into one release per week, newest first.
 *
 * @param {{ subject: string, hash: string, date: string, repo?: string }[]} commits
 * @returns {{ version: string, date: string, sections: Record<string, object[]> }[]}
 */
export const buildChangelog = (commits) => {
  const releases = new Map();
  for (const commit of commits) {
    const parsed = parseSubject(commit.subject);
    if (!parsed) continue;
    const when = new Date(commit.date);
    if (Number.isNaN(when.getTime())) continue;
    const version = versionOf(when);
    if (!releases.has(version)) releases.set(version, { version, date: when.toISOString().slice(0, 10), sections: Object.fromEntries(SECTIONS.map((s) => [s.id, []])) });
    const release = releases.get(version);
    // A release is dated by its latest commit.
    if (when.toISOString().slice(0, 10) > release.date) release.date = when.toISOString().slice(0, 10);
    release.sections[sectionOf(parsed)].push({
      scope: parsed.scope,
      text: parsed.text,
      breaking: parsed.breaking,
      pr: parsed.pr,
      hash: String(commit.hash).slice(0, 8),
      repo: commit.repo ?? null,
    });
  }
  return [...releases.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
};
