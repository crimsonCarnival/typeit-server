import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  comebackProgress,
  configKey,
  countBreakthroughs,
  countClockFinishes,
  countDistinctOpponents,
  countImprovedKeys,
  countLanguagesPlayed,
  countModesPlayed,
  countModifierRuns,
  countOldRecordsBroken,
  countPerfectStorms,
  countPhotoFinishes,
  countUnderdogWins,
  longestMetronome,
  longestMomentumChain,
  longestPerfectStreak,
  longestWinStreak,
  personalBestEvents,
  wellTraveledProgress,
} from '../src/services/achievement-history.js';
import { historyMetrics, maskHidden } from '../src/services/achievement.service.js';
import { ACHIEVEMENTS } from '../src/config/achievements.js';
import { evaluateAchievements } from '../src/services/achievement.service.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1, 12);

let seq = 0;
/** A verified 60s words run on day `day`, with overrides. Each call is a later run. */
const run = (over = {}) => ({
  createdAt: new Date(T0 + (over.day ?? 0) * DAY + seq++ * 1000),
  wpm: 60,
  accuracy: 97,
  successes: 200,
  elapsedTime: 60,
  timeMax: 60,
  gameMode: 'words',
  wordCount: 50,
  modifiers: 'none',
  language: 'english',
  textCategory: null,
  ranked: true,
  practiceKind: null,
  practiceId: null,
  dailyDate: null,
  completionPercentage: 100,
  penalty: { seconds: 0 },
  keyPresses: [],
  keyErrors: [],
  ...over,
});

const events = (runs) => personalBestEvents(runs);

describe('personal bests', () => {
  it('compares like with like: every setting that changes difficulty is in the key', () => {
    const base = run();
    for (const over of [{ timeMax: 30 }, { wordCount: 25 }, { modifiers: 'numbers' }, { language: 'spanish' }, { gameMode: 'phrases' }]) {
      assert.notEqual(configKey(run(over)), configKey(base), JSON.stringify(over));
    }
    assert.equal(configKey(run({ wpm: 99, accuracy: 80 })), configKey(base), 'speed and accuracy are not settings');
  });

  it('only a faster run than the standing best is a new best; equalling is not', () => {
    const e = events([run({ wpm: 60 }), run({ wpm: 60 }), run({ wpm: 61 })]);
    assert.deepEqual(e.map((x) => x.isPb), [false, false, true]);
  });

  it('ignores unverified, practice and daily runs', () => {
    const e = events([run(), run({ ranked: false, wpm: 90 }), run({ practiceKind: 'drill' }), run({ dailyDate: '2026-01-01' })]);
    assert.equal(e.length, 1);
  });
});

describe('Breakthrough', () => {
  it('needs a 10% jump over the previous best with 95%+ accuracy', () => {
    assert.equal(countBreakthroughs(events([run({ wpm: 60 }), run({ wpm: 66 })])), 1, 'exactly 10%');
    assert.equal(countBreakthroughs(events([run({ wpm: 60 }), run({ wpm: 65 })])), 0, 'just under');
    assert.equal(countBreakthroughs(events([run({ wpm: 60 }), run({ wpm: 80, accuracy: 94 })])), 0, 'accuracy too low');
  });

  it('does not count the first run, or a jump over a best from another configuration', () => {
    assert.equal(countBreakthroughs(events([run({ wpm: 100 })])), 0);
    assert.equal(countBreakthroughs(events([run({ wpm: 60 }), run({ wpm: 90, timeMax: 30 })])), 0);
  });

  it('is measured against the best, not the previous run', () => {
    assert.equal(countBreakthroughs(events([run({ wpm: 80 }), run({ wpm: 50 }), run({ wpm: 70 })])), 0);
  });
});

describe('The Comeback (old record)', () => {
  const at = (days, wpm) => run({ day: days, wpm });
  it('needs the beaten record to have stood 30 days', () => {
    assert.equal(countOldRecordsBroken(events([at(0, 60), at(30, 61)])), 1);
    assert.equal(countOldRecordsBroken(events([at(0, 60), at(29, 61)])), 0);
  });

  it('a run that does not beat the best does not qualify', () => {
    assert.equal(countOldRecordsBroken(events([at(0, 60), at(40, 60)])), 0);
  });

  it('measures how long the record stood, not when the player last played', () => {
    // Best set on day 0; a slower run on day 20 does not refresh it.
    assert.equal(countOldRecordsBroken(events([at(0, 60), at(20, 50), at(31, 61)])), 1);
  });
});

describe('Against the Clock', () => {
  const pb = (over) => events([run({ wpm: 60 }), run({ wpm: 61, ...over })]);
  it('a personal best finishing the text in the last second', () => {
    assert.equal(countClockFinishes(pb({ elapsedTime: 59 })), 1);
    assert.equal(countClockFinishes(pb({ elapsedTime: 58 })), 0);
  });

  it('counts penalty seconds against the limit, and needs the whole text', () => {
    assert.equal(countClockFinishes(pb({ elapsedTime: 55, penalty: { seconds: 4 } })), 1);
    assert.equal(countClockFinishes(pb({ elapsedTime: 59, completionPercentage: 90 })), 0);
  });

  it('is not enough without a personal best', () => {
    assert.equal(countClockFinishes(events([run({ wpm: 70 }), run({ wpm: 60, elapsedTime: 59 })])), 0);
  });
});

describe('Unstoppable Momentum', () => {
  const pbRun = (timeMax, wpm) => run({ timeMax, wpm });
  const setup = [pbRun(15, 50), pbRun(30, 50), pbRun(60, 50)];

  it('three personal bests in a row, each in a different configuration', () => {
    assert.equal(longestMomentumChain(events([...setup, pbRun(15, 51), pbRun(30, 51), pbRun(60, 51)])), 3);
  });

  it('a run that is not a personal best ends the chain', () => {
    assert.equal(longestMomentumChain(events([...setup, pbRun(15, 51), pbRun(30, 40), pbRun(60, 51)])), 1);
  });

  it('a second best in a configuration already in the chain starts it over', () => {
    assert.equal(longestMomentumChain(events([...setup, pbRun(15, 51), pbRun(15, 52), pbRun(30, 51)])), 2);
  });
});

describe('Metronome', () => {
  const seqOf = (wpms, over = {}) => wpms.map((wpm) => run({ wpm, ...over }));

  it('five 60s tests within 5% of each other', () => {
    assert.equal(longestMetronome(seqOf([60, 61, 62, 60, 61])), 5);
  });

  it('just outside the band is not enough', () => {
    // (63 - 60) / 61.2 = 4.9% is inside; (64 - 60) / 61.6 = 6.5% is outside.
    assert.equal(longestMetronome(seqOf([60, 61, 62, 60, 63])), 5);
    assert.equal(longestMetronome(seqOf([60, 61, 62, 60, 64])), 4);
  });

  it('measures the band as fastest minus slowest over the mean', () => {
    assert.equal(longestMetronome(seqOf([100, 105])), 2);
    assert.equal(longestMetronome(seqOf([100, 106])), 1);
  });

  it('a test under 95% accuracy breaks the sequence', () => {
    assert.equal(longestMetronome([...seqOf([60, 60]), run({ wpm: 60, accuracy: 94 }), ...seqOf([60, 60])]), 2);
  });

  it('only counts verified 60s tests; others neither help nor hurt', () => {
    const mixed = [run({ wpm: 60 }), run({ wpm: 120, timeMax: 30 }), run({ wpm: 99, ranked: false }), run({ wpm: 61 })];
    assert.equal(longestMetronome(mixed), 2);
  });
});

describe('Triple Threat', () => {
  const perfect = (over) => run({ accuracy: 100, ...over });

  it('three verified perfect runs in a row', () => {
    assert.equal(longestPerfectStreak([perfect(), perfect(), perfect()]), 3);
    assert.equal(longestPerfectStreak([perfect(), perfect()]), 2);
  });

  it('a run under 100% resets the streak', () => {
    assert.equal(longestPerfectStreak([perfect(), perfect(), run({ accuracy: 99 }), perfect()]), 2);
  });

  it('too-short runs are ignored: they neither count nor break it', () => {
    assert.equal(longestPerfectStreak([perfect(), perfect({ successes: 99 }), perfect(), run({ accuracy: 50, successes: 20 }), perfect()]), 3);
  });

  it('unverified perfect runs do not count', () => {
    assert.equal(longestPerfectStreak([perfect(), perfect({ ranked: false }), perfect()]), 2);
  });
});

describe('Perfect Storm', () => {
  it('needs 100 WPM and 100% in the same verified 60s run', () => {
    assert.equal(countPerfectStorms([run({ wpm: 100, accuracy: 100 })]), 1);
    assert.equal(countPerfectStorms([run({ wpm: 99, accuracy: 100 })]), 0);
    assert.equal(countPerfectStorms([run({ wpm: 100, accuracy: 99.9 })]), 0);
    assert.equal(countPerfectStorms([run({ wpm: 140, accuracy: 96 }), run({ wpm: 80, accuracy: 100 })]), 0, 'separate runs do not combine');
    assert.equal(countPerfectStorms([run({ wpm: 100, accuracy: 100, timeMax: 30 })]), 0);
    assert.equal(countPerfectStorms([run({ wpm: 100, accuracy: 100, ranked: false })]), 0);
  });
});

describe('modifier badges', () => {
  it('count verified runs with the modifier on at 95%+', () => {
    const runs = [run({ modifiers: 'numbers' }), run({ modifiers: 'punctuation' }), run({ modifiers: 'both' })];
    assert.equal(countModifierRuns(runs, ['numbers', 'both']), 2);
    assert.equal(countModifierRuns(runs, ['punctuation', 'both']), 2);
    assert.equal(countModifierRuns(runs, ['both']), 1);
  });

  it('need accuracy and verification', () => {
    assert.equal(countModifierRuns([run({ modifiers: 'numbers', accuracy: 94.9 })], ['numbers']), 0);
    assert.equal(countModifierRuns([run({ modifiers: 'numbers', accuracy: 95 })], ['numbers']), 1);
    assert.equal(countModifierRuns([run({ modifiers: 'numbers', ranked: false })], ['numbers']), 0);
  });
});

describe('Well-Traveled', () => {
  it('ten tests across three configurations', () => {
    const runs = [...Array.from({ length: 4 }, () => run()), ...Array.from({ length: 3 }, () => run({ timeMax: 30 })), ...Array.from({ length: 3 }, () => run({ modifiers: 'numbers' }))];
    assert.equal(wellTraveledProgress(runs, 10, 3), 10);
  });

  it('is held one short while the tests span too few configurations', () => {
    const runs = [...Array.from({ length: 8 }, () => run()), ...Array.from({ length: 4 }, () => run({ timeMax: 30 }))];
    assert.equal(wellTraveledProgress(runs, 10, 3), 9);
  });

  it('counts verified tests only', () => {
    assert.equal(wellTraveledProgress(Array.from({ length: 12 }, () => run({ ranked: false })), 10, 3), 0);
  });
});

describe('Full Spectrum and Polymath', () => {
  it('counts the modes with a finished test, from the game\'s own list of modes', () => {
    const runs = [run(), run({ gameMode: 'phrases', ranked: false }), run({ gameMode: 'code', ranked: false })];
    assert.equal(countModesPlayed(runs), 3);
  });

  it('an unfinished or sloppy unranked test does not count', () => {
    assert.equal(countModesPlayed([run({ gameMode: 'code', ranked: false, completionPercentage: 60 })]), 0);
    assert.equal(countModesPlayed([run({ gameMode: 'code', ranked: false, accuracy: 80 })]), 0);
  });

  it('practice and daily runs do not count', () => {
    assert.equal(countModesPlayed([run({ gameMode: 'phrases', practiceKind: 'drill' }), run({ gameMode: 'code', dailyDate: '2026-01-01' })]), 0);
  });

  it('counts distinct words languages, ignoring runs from before languages were stored', () => {
    const runs = [run({ language: 'english' }), run({ language: 'english' }), run({ language: 'spanish', ranked: false }), run({ language: null }), run({ language: 'german', ranked: false })];
    assert.equal(countLanguagesPlayed(runs), 3);
    assert.equal(countLanguagesPlayed(runs.slice(0, 4)), 2);
  });
});

describe('Comeback Kid', () => {
  const on = (day) => run({ day });

  it('14 days with no test, then three tests', () => {
    assert.equal(comebackProgress([on(0), on(15), on(15), on(16)]), 3);
  });

  it('13 days away is not enough', () => {
    assert.equal(comebackProgress([on(0), on(14), on(14), on(14)]), 0);
  });

  it('shows progress while coming back', () => {
    assert.equal(comebackProgress([on(0), on(15)]), 1);
    assert.equal(comebackProgress([on(0), on(15), on(15)]), 2);
  });

  it('a first ever test is not a return', () => {
    assert.equal(comebackProgress([on(100), on(100), on(100)]), 0);
  });

  it('uses UTC calendar days, so late night and early morning count as the neighbouring days they are', () => {
    const late = run({ day: 0 });
    late.createdAt = new Date(Date.UTC(2026, 0, 1, 23, 59));
    const back = run({ day: 0 });
    back.createdAt = new Date(Date.UTC(2026, 0, 16, 0, 1)); // 14 whole days (Jan 2-15) in between
    assert.equal(comebackProgress([late, back]), 1);
    back.createdAt = new Date(Date.UTC(2026, 0, 15, 23, 59)); // only 13
    assert.equal(comebackProgress([late, back]), 0);
  });
});

describe('Weakest Link and Problem Solver', () => {
  const stats = (key, presses, errors) => ({ keyPresses: [{ key, count: presses }], keyErrors: errors ? [{ expected: key, typed: 'x', count: errors }] : [] });
  const withKeys = (list) => ({ keyPresses: list.map(([key, count]) => ({ key, count })), keyErrors: list.filter(([, , e]) => e).map(([key, , e]) => ({ expected: key, typed: 'x', count: e })) });
  const drill = (key) => run({ ranked: false, practiceKind: 'drill', practiceId: key });
  // 'e' is the weakest key (30%); 'a', 't', 'o' are fine.
  const baseline = () => run({ ...withKeys([['e', 100, 30], ['a', 100, 5], ['t', 100, 4], ['o', 100, 3]]) });

  it('a drill on a weakest key followed by 20% fewer mistakes', () => {
    const runs = [baseline(), drill('e'), run(stats('e', 100, 20))];
    assert.equal(countImprovedKeys(runs), 1);
  });

  it('a drop of less than 20% is not enough', () => {
    assert.equal(countImprovedKeys([baseline(), drill('e'), run(stats('e', 100, 25))]), 0);
  });

  it('needs enough samples before and after', () => {
    assert.equal(countImprovedKeys([run(stats('e', 20, 10)), drill('e'), run(stats('e', 100, 1))]), 0, 'too few before');
    assert.equal(countImprovedKeys([baseline(), drill('e'), run(stats('e', 20, 0))]), 0, 'too few after');
  });

  it('only counts keys that were among the weakest', () => {
    assert.equal(countImprovedKeys([baseline(), drill('o'), run(stats('o', 100, 0))]), 0);
  });

  it('counts each key once, however many drills', () => {
    const runs = [baseline(), drill('e'), drill('e'), run(stats('e', 100, 20))];
    assert.equal(countImprovedKeys(runs), 1);
  });

  it('counts three distinct keys', () => {
    const weak = run({ ...withKeys([['e', 100, 30], ['a', 100, 28], ['t', 100, 26], ['o', 100, 1]]) });
    const after = run({ ...withKeys([['e', 100, 10], ['a', 100, 10], ['t', 100, 10]]) });
    assert.equal(countImprovedKeys([weak, drill('e'), drill('a'), drill('t'), after]), 3);
  });

  it('ignores digraph drills', () => {
    assert.equal(countImprovedKeys([baseline(), drill('th'), run(stats('e', 100, 1))]), 0);
  });
});

describe('races', () => {
  const ME = 'me';
  const racer = (userId, over = {}) => ({ userId, place: null, finishedAt: null, ranked: true, reached75At: null, ...over });
  let n = 0;
  const race = (over = {}) => ({
    mode: 'words',
    startAt: new Date(T0 + n * DAY),
    finishedAt: new Date(T0 + n++ * DAY + 60000),
    winnerId: ME,
    players: [racer(ME), racer('rival')],
    ...over,
  });
  const at = (race, ms) => new Date(+race.startAt + ms);

  it('counts consecutive wins and resets on a loss', () => {
    const lose = () => race({ winnerId: 'rival' });
    assert.equal(longestWinStreak([race(), race(), race(), lose(), race(), race()], ME), 3);
    assert.equal(longestWinStreak([race(), race(), lose(), race()], ME), 2);
  });

  it('ignores races with no verified winner and races against nobody', () => {
    assert.equal(longestWinStreak([race(), race({ winnerId: null }), race()], ME), 2);
    assert.equal(longestWinStreak([race(), race({ players: [racer(ME)] }), race()], ME), 2);
  });

  it('a win by the other player in a race you were not in does nothing', () => {
    assert.equal(longestWinStreak([race({ players: [racer('a'), racer('b')], winnerId: 'a' }), race()], ME), 1);
  });

  describe('Photo Finish', () => {
    const finish = (winnerMs, runnerUpMs, over = {}) => {
      const r = race(over);
      r.players = [racer(ME, { finishedAt: at(r, winnerMs) }), racer('rival', { finishedAt: at(r, runnerUpMs) })];
      return r;
    };
    it('wins by under 2% of the winner\'s time', () => {
      assert.equal(countPhotoFinishes([finish(50000, 50999)], ME), 1, '999ms of 50000ms is 1.998%');
      assert.equal(countPhotoFinishes([finish(50000, 51000)], ME), 0, 'exactly 2% is not under');
      assert.equal(countPhotoFinishes([finish(50000, 50000)], ME), 1, 'a dead heat decided by the server');
    });
    it('needs a win, a runner-up that finished, and a fixed-text race', () => {
      assert.equal(countPhotoFinishes([finish(50000, 50100, { winnerId: 'rival' })], ME), 0);
      assert.equal(countPhotoFinishes([finish(50000, 50100, { mode: 'time' })], ME), 0);
      const lone = finish(50000, 50100);
      lone.players[1].finishedAt = null;
      assert.equal(countPhotoFinishes([lone], ME), 0);
    });
  });

  describe('Underdog', () => {
    const stamped = (mine, theirs, over = {}) => {
      const r = race(over);
      r.players = [racer(ME, { reached75At: mine === null ? null : at(r, mine) }), racer('rival', { reached75At: theirs === null ? null : at(r, theirs) })];
      return r;
    };
    it('wins after another racer passed 75% first', () => {
      assert.equal(countUnderdogWins([stamped(40000, 30000)], ME), 1);
    });
    it('not when you were ahead, level, or the checkpoint is unknown', () => {
      assert.equal(countUnderdogWins([stamped(30000, 40000)], ME), 0);
      assert.equal(countUnderdogWins([stamped(30000, 30000)], ME), 0);
      assert.equal(countUnderdogWins([stamped(40000, null)], ME), 0);
      assert.equal(countUnderdogWins([stamped(null, 30000)], ME), 0, 'a race from before checkpoints were recorded');
    });
    it('not for a loss or a timed race', () => {
      assert.equal(countUnderdogWins([stamped(40000, 30000, { winnerId: 'rival' })], ME), 0);
      assert.equal(countUnderdogWins([stamped(40000, 30000, { mode: 'time' })], ME), 0);
    });
  });

  describe('Social Butterfly', () => {
    const vs = (...ids) => race({ players: [racer(ME, { finishedAt: new Date() }), ...ids.map((id) => racer(id))] });
    it('counts distinct opponents, not entries', () => {
      assert.equal(countDistinctOpponents([vs('a', 'b'), vs('a'), vs('c')], ME), 3);
    });
    it('only counts races you finished, and never yourself', () => {
      const dnf = race({ players: [racer(ME), racer('z')] });
      assert.equal(countDistinctOpponents([dnf, vs('a')], ME), 1);
      assert.equal(countDistinctOpponents([race({ players: [racer(ME, { finishedAt: new Date() })] })], ME), 0);
    });
  });
});

describe('historyMetrics', () => {
  it('is deterministic: the same history gives the same numbers every time', () => {
    const runs = [run({ wpm: 60 }), run({ wpm: 70 }), run({ wpm: 72, accuracy: 100 })];
    assert.deepEqual(historyMetrics(runs, [], 'me'), historyMetrics(runs, [], 'me'));
  });

  it('is all zero for a new player', () => {
    assert.ok(Object.values(historyMetrics([], [], 'me')).every((v) => v === 0));
  });
});

describe('the new catalog', () => {
  const byId = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
  const unlocked = (metrics) => new Set(evaluateAchievements(metrics).filter((p) => p.unlocked).map((p) => p.id));

  it('adds Supersonic as a tier of the speed family, between Century and Lightning', () => {
    assert.equal(byId.supersonic.family, 'speed');
    assert.ok(byId.century.target < byId.supersonic.target && byId.supersonic.target < byId.lightning.target);
    assert.equal(unlocked({ bestWpm: 119 }).has('supersonic'), false);
    assert.equal(unlocked({ bestWpm: 120 }).has('supersonic'), true);
    assert.equal(unlocked({ bestWpm: 120 }).has('lightning'), false);
  });

  it('keeps Long Haul as one tiered family: 1, 5, 10, 25 and 100 hours', () => {
    const tiers = ACHIEVEMENTS.filter((a) => a.family === 'long-haul');
    assert.deepEqual(tiers.map((t) => t.target), [1, 5, 10, 25, 100]);
    assert.deepEqual([...unlocked({ activeHours: 5 })].filter((id) => tiers.some((t) => t.id === id)).sort(), ['long-haul', 'veteran-typist']);
    assert.equal(unlocked({ activeHours: 0.9 }).has('long-haul'), false);
  });

  it('puts Win Streak and Unstoppable on one family', () => {
    assert.deepEqual([...unlocked({ winStreak: 3 })].filter((id) => id.includes('win-streak') || id === 'race-unstoppable'), ['win-streak']);
    assert.ok(unlocked({ winStreak: 10 }).has('race-unstoppable'));
  });

  it('does not add duplicates of badges that already cover the idea', () => {
    for (const id of ['century-club', 'first-victory', 'self-taught']) assert.equal(byId[id], undefined, id);
    assert.ok(byId.century && byId['race-winner'] && byId.curator);
  });

  it('keeps every original id, and every metric one the service computes', () => {
    const metrics = new Set(Object.keys(historyMetrics([], [], 'me')));
    const fromService = new Set(['runs', 'bestWpm', 'flawlessRuns', 'bestHardcoreWpm', 'drillRuns', 'listRuns', 'lessonsPassed', 'commonWordsPassed', 'best60sAccuracy', 'bestConsistency', 'longestRunMinutes', 'speedrunWords', 'longestStreak', 'dailiesFinished', 'raceWins', 'activeHours']);
    for (const a of ACHIEVEMENTS) assert.ok(metrics.has(a.metric) || fromService.has(a.metric), `${a.id} -> ${a.metric}`);
  });
});

describe('hidden badges', () => {
  const hidden = ACHIEVEMENTS.filter((a) => a.hidden);

  it('are the four secret ones, each with a vague hint', () => {
    assert.deepEqual(hidden.map((a) => a.id).sort(), ['against-the-clock', 'perfect-storm', 'the-comeback', 'unstoppable-momentum']);
    assert.ok(hidden.every((a) => a.hint && !a.hint.includes(String(a.target))));
  });

  it('reveal nothing before unlock: not the name, id, criteria, icon, target or progress', () => {
    hidden.forEach((a, i) => {
      const masked = maskHidden({ ...a, value: 3 }, a.hint, i);
      const text = JSON.stringify(masked);
      assert.ok(!text.includes(a.name) && !text.includes(a.id) && !text.includes(a.description), a.id);
      assert.deepEqual([masked.hidden, masked.unlocked, masked.value, masked.target, masked.icon], [true, false, 0, 1, 'lock']);
      assert.equal(masked.category, a.category);
      assert.equal(masked.rarity, a.rarity);
    });
  });

  it('are still evaluated normally, so unlocking works', () => {
    assert.ok(unlockedIds({ perfectStorms: 1 }).has('perfect-storm'));
  });
});

function unlockedIds(metrics) {
  return new Set(evaluateAchievements(metrics).filter((p) => p.unlocked).map((p) => p.id));
}
