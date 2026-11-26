import { expect } from 'chai';
import { describe, it } from 'node:test';
import type { ProblemKind } from '../problem-kind';
import {
    SET_CONFIG_TEXT,
    assertCanCreateSetKind,
    assertSetCombination,
    assertSetPublishable,
    createDraftConfig,
    mapLegacyContest,
    feedbackSideForProblem,
    parseSetConfig,
    presetSettings,
    readStoredSetConfig,
    setConfigMessage,
    setCreateKindsAllowed,
    type SetConfig,
    type SetSettings,
} from '../set-config';

const begin = new Date('2026-11-10T00:00:00.000Z');
const end = new Date('2026-11-10T10:00:00.000Z');

function codeOf(run: () => void): string {
    try {
        run();
    } catch (error) {
        if (error instanceof TypeError) return error.message;
        throw error;
    }
    throw new Error('expected a TypeError');
}

function publishFacts(overrides: Record<string, unknown> = {}) {
    return {
        beginAt: begin,
        endAt: end,
        problemCount: 1,
        audienceConfirmed: true,
        problems: [{ kind: 'programming' as ProblemKind, judged: true }],
        paperMax: 100,
        ...overrides,
    };
}

function drawConfig(settings: SetSettings): SetConfig {
    return parseSetConfig({
        schemaVersion: 1,
        purpose: 'exam',
        publication: 'draft',
        revision: 1,
        settings: {
            ...settings,
            draw: {
                enabled: true,
                quotas: { single: 1 },
                redrawEachRound: true,
                allowRepeatAcrossRounds: true,
            },
        },
    });
}

describe('problem set configuration', () => {
    it('gives teachers two create kinds and administrators four', () => {
        expect(setCreateKindsAllowed(false)).to.deep.equal(['homework', 'exam']);
        expect(setCreateKindsAllowed(true)).to.deep.equal(['practice', 'homework', 'exam', 'contest']);
        expect(assertCanCreateSetKind('homework', false)).to.equal('homework');
        expect(codeOf(() => assertCanCreateSetKind('contest', false))).to.equal('set_create_kind_forbidden');
        expect(codeOf(() => assertCanCreateSetKind('acm', true))).to.equal('set_create_kind_invalid');
        expect(assertCanCreateSetKind('practice', true)).to.equal('practice');
    });

    it('creates a complete draft from the purpose preset', () => {
        const homework = createDraftConfig('homework');
        const exam = createDraftConfig('exam');
        const contest = createDraftConfig('contest');
        expect(homework.publication).to.equal('draft');
        expect(homework.revision).to.equal(1);
        expect(homework.settings.codePolicy).to.equal('highest');
        expect(exam.settings.codePolicy).to.equal('highest');
        expect(contest.settings.codePolicy).to.equal('highest');
        expect(homework.settings.earlyHandIn).to.equal(false);
        expect(exam.settings.earlyHandIn).to.equal(true);
        expect(contest.settings.earlyHandIn).to.equal(false);
        expect(homework.settings.feedback.objective).to.deep.equal({ when: 'immediate', reveal: 'full' });
        expect(exam.settings.feedback.objective).to.deep.equal({ when: 'after_deadline', reveal: 'full' });
        expect(contest.settings.feedback.objective.when).to.equal('immediate');
        expect(homework.settings.feedback.code).to.deep.equal({ when: 'immediate', reveal: 'full', afterDeadline: 'same' });
        expect(exam.settings.feedback.code.when).to.equal('immediate');
        expect(homework.settings.scoreboard).to.equal('off');
        expect(exam.settings.scoreboard).to.equal('off');
        expect(contest.settings.scoreboard).to.equal('live');
        expect(homework.settings.retake).to.deep.equal({
            extra: 0,
            onlyAfterFail: false,
            requireFullWindow: false,
            passScore: null,
            pick: 'highest_total',
        });
        expect(exam.settings.retake.pick).to.equal('highest_total');
        expect(homework.settings.late).to.deep.equal({ enabled: false });
        expect(homework.settings.personalLimit).to.deep.equal({ hours: null, requireFullWindow: false });
        expect(homework.settings.draw.enabled).to.equal(false);
        expect(parseSetConfig(homework)).to.deep.equal(homework);
        expect(codeOf(() => createDraftConfig('practice' as 'homework'))).to.equal('set_config_purpose_invalid');
    });

    it('rejects unknown fields, partial settings, and illegal combinations', () => {
        const draft = createDraftConfig('homework');
        expect(codeOf(() => parseSetConfig({ ...draft, extra: true }))).to.equal('set_config_invalid');
        expect(codeOf(() => parseSetConfig({ ...draft, schemaVersion: 2 }))).to.equal('set_config_schema_invalid');
        expect(codeOf(() => parseSetConfig({ ...draft, settings: { ...draft.settings, codePolicy: 'oi' } }))).to.equal(
            'set_config_code_policy_invalid',
        );
        const { late, ...withoutLate } = draft.settings;
        expect(codeOf(() => parseSetConfig({ ...draft, settings: withoutLate }))).to.equal('set_config_late_invalid');
        expect(late).to.deep.equal({ enabled: false });
        expect(
            codeOf(() =>
                parseSetConfig({
                    ...draft,
                    settings: { ...draft.settings, personalLimit: { hours: null, requireFullWindow: true } },
                }),
            ),
        ).to.equal('set_config_limit_flag_invalid');
        expect(
            codeOf(() =>
                parseSetConfig({
                    ...draft,
                    settings: { ...draft.settings, late: { enabled: false, rules: { 1: 0.8 } } },
                }),
            ),
        ).to.equal('set_config_late_invalid');
        const acm = parseSetConfig({
            ...draft,
            settings: { ...draft.settings, codePolicy: 'acm' },
        });
        expect(codeOf(() => assertSetCombination(acm.settings, [{ kind: 'single', judged: false }]))).to.equal('set_config_acm_kind');
        const drawn = drawConfig(acm.settings);
        expect(codeOf(() => assertSetCombination(drawn.settings))).to.equal('set_config_acm_draw');
        const decay = parseSetConfig({
            ...draft,
            settings: { ...draft.settings, codePolicy: 'retry_decay' },
        });
        expect(codeOf(() => assertSetCombination(decay.settings, [{ kind: 'blank', judged: false }]))).to.equal(
            'set_config_code_policy_kind',
        );
        expect(setConfigMessage('set_config_acm_draw')).to.equal(SET_CONFIG_TEXT.set_config_acm_draw?.zh);
    });

    it('keeps published sets editable without requiring a new audience confirmation', () => {
        const published = parseSetConfig({ ...createDraftConfig('contest'), publication: 'published' });
        const facts = publishFacts({ audienceConfirmed: false });
        expect(() => assertSetPublishable(published, facts)).not.to.throw();
        expect(codeOf(() => assertSetPublishable(published, { ...facts, problemCount: 0 }))).to.equal('set_config_problems_required');
        expect(codeOf(() => assertSetPublishable(published, { ...facts, endAt: begin }))).to.equal('set_config_schedule_invalid');
        published.settings.retake.passScore = 101;
        expect(codeOf(() => assertSetPublishable(published, facts))).to.equal('set_config_pass_above_max');
    });

    it('requires problems, audience, time, and a consistent draw before publish', () => {
        const draft = createDraftConfig('homework');
        expect(codeOf(() => assertSetPublishable(draft, publishFacts({ problemCount: 0 })))).to.equal('set_config_problems_required');
        expect(codeOf(() => assertSetPublishable(draft, publishFacts({ audienceConfirmed: false })))).to.equal(
            'set_config_audience_required',
        );
        expect(codeOf(() => assertSetPublishable(draft, publishFacts({ endAt: begin })))).to.equal('set_config_schedule_invalid');
        const passing = parseSetConfig({
            ...draft,
            settings: { ...draft.settings, retake: { ...draft.settings.retake, passScore: 101 } },
        });
        expect(codeOf(() => assertSetPublishable(passing, publishFacts()))).to.equal('set_config_pass_above_max');
        const scored = parseSetConfig({
            ...draft,
            settings: { ...draft.settings, retake: { ...draft.settings.retake, passScore: 60 } },
        });
        expect(codeOf(() => assertSetPublishable(scored, publishFacts({ paperMax: undefined })))).to.equal('set_config_pass_above_max');
        const acm = parseSetConfig({ ...draft, settings: { ...draft.settings, codePolicy: 'acm' } });
        expect(codeOf(() => assertSetPublishable(acm, publishFacts({ problems: undefined })))).to.equal('set_config_acm_kind');
        const late = parseSetConfig({
            ...draft,
            settings: {
                ...draft.settings,
                late: { enabled: true, onTimeAt: end.toISOString(), rules: { 12: 0.8 } },
            },
        });
        expect(codeOf(() => assertSetPublishable(late, publishFacts()))).to.equal('set_config_late_outside_window');
        const timed = parseSetConfig({
            ...draft,
            settings: { ...draft.settings, personalLimit: { hours: 11, requireFullWindow: false } },
        });
        expect(codeOf(() => assertSetPublishable(timed, publishFacts()))).to.equal('set_config_duration_outside_window');
        const drawn = drawConfig(draft.settings);
        const wrongKind = new Map<number, ProblemKind>([[1, 'programming']]);
        expect(codeOf(() => assertSetPublishable(drawn, publishFacts({ poolPids: [1], poolKinds: wrongKind })))).to.equal(
            'set_config_draw_pool',
        );
        const enough = new Map<number, ProblemKind>([
            [1, 'single'],
            [2, 'single'],
        ]);
        expect(
            codeOf(() =>
                assertSetPublishable(drawn, publishFacts({ poolPids: [1, 2], poolKinds: enough, score: { 1: 10, 2: 20 } })),
            ),
        ).to.equal('set_config_draw_score_mixed');
        expect(() =>
            assertSetPublishable(drawn, publishFacts({ poolPids: [1, 2], poolKinds: enough, score: { 1: 10, 2: 10 } })),
        ).not.to.throw();
    });

    it('keeps a stored configuration and does not invent one from the old rule', () => {
        const draft = createDraftConfig('contest');
        expect(readStoredSetConfig({ setConfig: draft, rule: 'acm' }).settings.codePolicy).to.equal('highest');
        expect(codeOf(() => readStoredSetConfig({ rule: 'acm' }))).to.equal('set_config_missing');
        expect(codeOf(() => readStoredSetConfig({ setConfig: { ...draft, settings: {} } }))).to.equal(
            'set_config_code_policy_invalid',
        );
    });

    it('maps each legacy rule to its old behavior', () => {
        const onTime = new Date('2026-11-10T08:00:00.000Z');
        const homework = mapLegacyContest({
            rule: 'homework',
            beginAt: begin,
            endAt: end,
            penaltySince: onTime,
            penaltyRules: { 12: 0.8 },
            duration: 2,
            homeworkShowObjectiveVerdict: false,
        });
        expect(homework.purpose).to.equal('homework');
        expect(homework.publication).to.equal('published');
        expect(homework.settings.codePolicy).to.equal('last');
        expect(homework.settings.earlyHandIn).to.equal(false);
        expect(homework.settings.feedback.objective).to.deep.equal({ when: 'immediate', reveal: 'none' });
        expect(homework.settings.feedback.programFillChannel).to.equal('objective');
        expect(feedbackSideForProblem(homework.settings, { kind: 'program_fill', judged: true })).to.equal('objective');
        expect(feedbackSideForProblem(homework.settings, { kind: 'programming', judged: true })).to.equal('code');
        expect(homework.settings.scoreboard).to.equal('live');
        expect(homework.settings.personalLimit).to.deep.equal({ hours: 2, requireFullWindow: false });
        expect(homework.settings.late).to.deep.equal({ enabled: true, onTimeAt: onTime, rules: { 12: 0.8 } });
        expect(homework.settings.retake.extra).to.equal(0);

        const hiddenExam = mapLegacyContest({
            rule: 'exam',
            duration: 1,
            examShowVerdict: false,
            examPassScore: 60,
            examAttemptLimit: 2,
            examPaperQuotas: { single: 2, programming: 1 },
        });
        expect(hiddenExam.purpose).to.equal('exam');
        expect(hiddenExam.settings.codePolicy).to.equal('last');
        expect(hiddenExam.settings.earlyHandIn).to.equal(true);
        expect(hiddenExam.settings.feedback.objective).to.deep.equal({ when: 'after_deadline', reveal: 'full' });
        expect(feedbackSideForProblem(hiddenExam.settings, { kind: 'program_fill', judged: true })).to.equal('objective');
        expect(feedbackSideForProblem(hiddenExam.settings, { kind: 'function', judged: true })).to.equal('code');
        expect(hiddenExam.settings.personalLimit).to.deep.equal({ hours: 1, requireFullWindow: true });
        expect(hiddenExam.settings.retake).to.deep.equal({
            extra: 1,
            onlyAfterFail: true,
            requireFullWindow: true,
            passScore: 60,
            pick: 'last_round',
        });
        expect(hiddenExam.settings.draw.enabled).to.equal(true);
        expect(hiddenExam.settings.draw.quotas).to.deep.equal({ single: 2, programming: 1 });
        expect(hiddenExam.settings.draw.redrawEachRound).to.equal(true);

        const openExam = mapLegacyContest({ rule: 'exam', examPassScore: 0, examAttemptLimit: 1 });
        expect(openExam.settings.feedback.objective.when).to.equal('immediate');
        expect(openExam.settings.retake.passScore).to.equal(null);
        expect(openExam.settings.retake.extra).to.equal(0);
        expect(openExam.settings.scoreboard).to.equal('after_end');

        expect(codeOf(() => mapLegacyContest({ rule: 'oi', keepScoreboardHidden: true }))).to.equal('set_legacy_feedback_unmapped');
        expect(codeOf(() => mapLegacyContest({ rule: 'strictioi', keepScoreboardHidden: true }))).to.equal(
            'set_legacy_feedback_unmapped',
        );
        expect(mapLegacyContest({ rule: 'oi' }).settings.feedback.code.when).to.equal('after_deadline');
        expect(mapLegacyContest({ rule: 'exam', keepScoreboardHidden: true }).settings.scoreboard).to.equal('off');
        expect(feedbackSideForProblem(createDraftConfig('exam').settings, { kind: 'program_fill', judged: true })).to.equal('code');
        expect(feedbackSideForProblem(createDraftConfig('exam').settings, { kind: 'program_fill', judged: false })).to.equal(
            'objective',
        );
        expect(mapLegacyContest({ rule: 'ioi' }).settings).to.include({ codePolicy: 'highest', scoreboard: 'live' });
        expect(mapLegacyContest({ rule: 'ioi', keepScoreboardHidden: true }).settings.scoreboard).to.equal('during_only');
        expect(mapLegacyContest({ rule: 'strictioi' }).settings.codePolicy).to.equal('subtask_best');
        expect(mapLegacyContest({ rule: 'ledo' }).settings).to.include({ codePolicy: 'retry_decay', scoreboard: 'live' });
        const acm = mapLegacyContest({ rule: 'acm', duration: 5 });
        expect(acm.purpose).to.equal('contest');
        expect(acm.settings.codePolicy).to.equal('acm');
        expect(acm.settings.feedback.code).to.deep.equal({ when: 'immediate', reveal: 'verdict', afterDeadline: 'full' });
        expect(acm.settings.personalLimit).to.deep.equal({ hours: 5, requireFullWindow: false });
        expect(acm.settings.scoreboard).to.equal('live');
        expect(presetSettings('contest').codePolicy).to.not.equal(acm.settings.codePolicy);
    });

    it('stops when a legacy document is unknown or carries another rule\'s fields', () => {
        expect(codeOf(() => mapLegacyContest({ rule: 'codeforces' }))).to.equal('set_legacy_rule_unknown');
        expect(codeOf(() => mapLegacyContest({ rule: 'homework' }))).to.equal('set_legacy_field_invalid');
        expect(
            codeOf(() => mapLegacyContest({ rule: 'homework', penaltySince: end, endAt: begin, penaltyRules: { 1: 1 } })),
        ).to.equal('set_legacy_field_invalid');
        expect(codeOf(() => mapLegacyContest({ rule: 'homework', penaltySince: end, endAt: end, examPassScore: 60 }))).to.equal(
            'set_legacy_unexpected_exam_field',
        );
        expect(codeOf(() => mapLegacyContest({ rule: 'acm', homeworkShowObjectiveVerdict: false }))).to.equal(
            'set_legacy_unexpected_homework_field',
        );
        expect(codeOf(() => mapLegacyContest({ rule: 'exam', examPaperQuotas: {} }))).to.equal('set_legacy_field_invalid');
        const closed = mapLegacyContest({ rule: 'homework', penaltySince: end, endAt: end, penaltyRules: { 24: 0.5 } });
        expect(closed.settings.late).to.deep.equal({ enabled: false });
    });
});
