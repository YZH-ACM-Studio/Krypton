import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { ObjectId } from 'mongodb';
import { createDraftConfig, planHandIn, roundPersonalEnd, selectRound, SET_DEFAULT_PERMISSIONS, SET_EXPERIENCE_DEFAULTS } from '@hydrooj/common';
import type { RoundDoc } from '../src/model/set-round';
import { setParticipantProjection } from '../src/lib/set-score-projection';

const tid = new ObjectId();
const teamId = new ObjectId();
const beginAt = new Date('2026-11-10T00:00:00Z');
const endAt = new Date('2026-11-10T04:00:00Z');
const now = new Date('2026-11-10T01:00:00Z');
let config = { ...createDraftConfig('exam'), publication: 'published' as const };
let rounds: RoundDoc[] = [];
let teamMode = false;
let persists: Array<{ uid: number; team: ObjectId | null; projection: ReturnType<typeof setParticipantProjection> }> = [];
let projectionCalls = 0;
let problemKind = 'single';
const doc = () => ({ domainId: 'course-test', docId: tid, rule: config.purpose, setConfig: config, beginAt, endAt, pids: [1] });

function round(roundNo: number, total: number, state: 'open' | 'closed' = 'closed'): RoundDoc {
    return {
        _id: new ObjectId(), domainId: 'course-test', tid, participantKey: 'u:9', roundNo, state,
        startedAt: beginAt, closedAt: state === 'closed' ? new Date(beginAt.getTime() + 1000) : null,
        paperPids: [1], total, passed: total >= 60, scoreRevision: 1, judgePending: false,
        detail: { 1: { pid: 1, score: total, status: 1, acceptedAt: beginAt } },
    };
}

function loadModule(): typeof import('../src/lib/course-exam-set') {
    const Module = require('module');
    const original = Module._load;
    const path = resolve(__dirname, '../src/lib/course-exam-set.ts');
    Module._load = function patched(request: string, parent: NodeModule, isMain: boolean) {
        if (parent?.filename === path || parent?.filename.endsWith('/lib/set-round-score-visible.ts')) {
            if (request === '../model/contest') {
                return {
                    get: async () => doc(),
                    persistSetParticipantStatus: async (_domain: string, _tid: ObjectId, uid: number, team: ObjectId | null, projection: ReturnType<typeof setParticipantProjection>) => {
                        persists.push({ uid, team, projection });
                    },
                };
            }
            if (request === '../model/contest-participation') {
                return {
                    getParticipationMode: () => teamMode ? 'team' : 'individual',
                    isTeamBatchFinalizationPending: () => false,
                };
            }
            if (request === '../model/contest-team') return { getTeamByMember: async () => ({ teamId }) };
            if (request === '../model/problem') {
                return { __esModule: true, default: { getMulti: () => ({ toArray: async () => [{
                    docId: 1, problemKind, config: { type: problemKind === 'programming' ? 'default' : 'objective', answers: { main: ['A', 100] } },
                }] }) } };
            }
            if (request === '../model/set-round') {
                return {
                    participantKey: (uid: number, team?: ObjectId | null) => team ? `t:${team.toHexString()}` : `u:${uid}`,
                    acknowledgeParticipantStatus: async () => undefined,
                    settleParticipantRounds: async (_domain: string, _tid: ObjectId, _uid: number, _team: ObjectId | null, at: Date) => {
                        for (const item of rounds) {
                            const deadline = roundPersonalEnd(config.settings, endAt, item.startedAt);
                            if (item.state === 'open' && at >= deadline) {
                                item.state = 'closed';
                                item.closedAt = deadline;
                            }
                        }
                        return rounds;
                    },
                    handInRound: async (item: RoundDoc, settings: typeof config.settings, at: Date, finalEnd: Date) => {
                        if (item.state === 'closed') return;
                        const decision = planHandIn(settings, item.state, at, roundPersonalEnd(settings, finalEnd, item.startedAt));
                        if (decision !== 'close') throw new Error(decision);
                        item.state = 'closed';
                        item.closedAt = at;
                    },
                    projectParticipantStatus: async () => {
                        projectionCalls++;
                        const selected = selectRound(config.settings, rounds);
                        return setParticipantProjection(selected ? rounds.find((item) => item.roundNo === selected.roundNo)! : null, config.revision);
                    },
                    readSettledParticipantStatus: async (_domain: string, _tid: ObjectId, _uid: number, _team: ObjectId | null, at: Date) => {
                        for (const item of rounds) {
                            const deadline = roundPersonalEnd(config.settings, endAt, item.startedAt);
                            if (item.state === 'open' && at >= deadline) {
                                item.state = 'closed';
                                item.closedAt = deadline;
                            }
                        }
                        const selected = selectRound(config.settings, rounds);
                        return setParticipantProjection(selected ? rounds.find((item) => item.roundNo === selected.roundNo)! : null, config.revision);
                    },
                };
            }
            if (/draft|record/.test(request)) throw new Error(`unexpected legacy answer access: ${request}`);
        }
        return original.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[path];
        return require(path);
    } finally {
        Module._load = original;
    }
}

const { loadFormalCourseExamState, finalizeFormalSetForUser, canShowFormalCourseScore } = loadModule();

beforeEach(() => {
    config = { ...createDraftConfig('exam'), publication: 'published' };
    config.settings.retake = { ...config.settings.retake, extra: 2, passScore: 60 };
    rounds = [];
    persists = [];
    projectionCalls = 0;
    teamMode = false;
    problemKind = 'single';
});

describe('configured course rounds', () => {
    it('uses the chosen whole round for completion while tracking the current retake separately', async () => {
        rounds = [round(1, 80), round(2, 40)];
        const highest = await loadFormalCourseExamState('course-test', tid, 9, now);
        assert.equal(highest.complete, true);
        assert.equal(highest.projection.score, 80);
        assert.equal(highest.attemptsUsed, 2);
        assert.equal(highest.canRetake, true);
        config.settings.retake.pick = 'last_round';
        const latest = await loadFormalCourseExamState('course-test', tid, 9, now);
        assert.equal(latest.complete, false);
        assert.equal(latest.projection.score, 40);
        assert.equal(latest.projection.setRoundNo, 2);
        assert.equal(projectionCalls, 0);
    });

    it('does not create attendance or a status for an unstarted course viewer', async () => {
        const state = await loadFormalCourseExamState('course-test', tid, 9, now);
        assert.equal(state.complete, false);
        assert.equal(state.canRetake, false);
        assert.equal(state.current, null);
        assert.equal(projectionCalls, 0);
        assert.equal(persists.length, 0);
    });

    it('settles an expired personal round and allows the next configured attempt', async () => {
        config.settings.personalLimit.hours = 0.5;
        rounds = [round(1, 70, 'open')];
        const state = await loadFormalCourseExamState('course-test', tid, 9, now);
        assert.equal(state.current?.state, 'closed');
        assert.equal(state.current?.closedAt?.toISOString(), '2026-11-10T00:30:00.000Z');
        assert.equal(state.complete, true);
        assert.equal(state.canRetake, true);
    });

    it('does not complete while judging is pending or the selected round is still open', async () => {
        rounds = [{ ...round(1, 90), judgePending: true }];
        assert.equal((await loadFormalCourseExamState('course-test', tid, 9, now)).complete, false);
        rounds = [round(1, 90, 'open')];
        assert.equal((await loadFormalCourseExamState('course-test', tid, 9, now)).complete, false);
    });

    it('student finish respects earlyHandIn and privileged finish keeps the accepted score', async () => {
        config.settings.earlyHandIn = false;
        rounds = [round(1, 37, 'open')];
        await assert.rejects(finalizeFormalSetForUser('course-test', tid, 9, false, now), /set_round_hand_in_closed/);
        assert.equal(rounds[0].state, 'open');
        assert.equal(persists.length, 0);
        await finalizeFormalSetForUser('course-test', tid, 9, true, now);
        assert.equal(rounds[0].state, 'closed');
        assert.equal(persists[0].projection.score, 37);
    });

    it('privileged team finish persists to the team identity', async () => {
        teamMode = true;
        rounds = [round(1, 81, 'open')];
        await finalizeFormalSetForUser('course-test', tid, 9, true, now);
        assert.ok(persists[0].team?.equals(teamId));
        assert.equal(persists[0].projection.score, 81);
    });

    it('allows a proctor to close an unstarted client session without inventing a round', async () => {
        await finalizeFormalSetForUser('course-test', tid, 9, true, now);
        assert.equal(rounds.length, 0);
        assert.equal(persists.length, 0);
        assert.equal(projectionCalls, 0);
        await assert.rejects(finalizeFormalSetForUser('course-test', tid, 9, false, now));
    });

    it('publishes the canonical truncated entry window and honours explicit full-window settings', async () => {
        config.settings.personalLimit.hours = 1;
        const nearDeadline = new Date(endAt.getTime() - 30 * 60_000);
        const allowed = await loadFormalCourseExamState('course-test', tid, 9, nearDeadline);
        assert.equal(allowed.entry.canEnter, true);
        assert.equal(allowed.entry.nextStartUntil, endAt.toISOString());
        config.settings.personalLimit.requireFullWindow = true;
        const denied = await loadFormalCourseExamState('course-test', tid, 9, nearDeadline);
        assert.equal(denied.entry.canEnter, false);
        assert.equal(denied.entry.windowClosed, true);
    });

    it('course cards use the configured feedback channel instead of exposing raw examScore', async () => {
        rounds = [round(1, 88)];
        const state = await loadFormalCourseExamState('course-test', tid, 9, now);
        assert.equal(await canShowFormalCourseScore(state.tdoc, config, state.chosen, 9, now), false);
        assert.equal(await canShowFormalCourseScore(state.tdoc, config, state.chosen, 9, endAt), true);
        problemKind = 'programming';
        assert.equal(await canShowFormalCourseScore(state.tdoc, config, state.chosen, 9, now), true);
    });

    it('withholds course card scores when totals are hidden or group access has ended', async () => {
        rounds = [round(1, 88)];
        problemKind = 'programming';
        const state = await loadFormalCourseExamState('course-test', tid, 9, now);
        config.settings.experience = { ...SET_EXPERIENCE_DEFAULTS, hideTotalScore: true };
        assert.equal(await canShowFormalCourseScore(state.tdoc, config, state.chosen, 9, now), false);
        config.settings.experience.hideTotalScore = false;
        config.settings.authorization = { defaults: { ...SET_DEFAULT_PERMISSIONS, afterEnd: false }, groups: [] };
        assert.equal(await canShowFormalCourseScore(state.tdoc, config, state.chosen, 9, now), true);
        assert.equal(await canShowFormalCourseScore(state.tdoc, config, state.chosen, 9, endAt), false);
        config.settings.authorization.defaults.problems = 'hidden';
        assert.equal(await canShowFormalCourseScore(state.tdoc, config, state.chosen, 9, now), false);
    });
});
