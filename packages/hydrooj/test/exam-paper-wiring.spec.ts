import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const hydroojRoot = resolve(__dirname, '..');
const repoRoot = resolve(hydroojRoot, '../..');

function readHydrooj(relative: string) {
    return readFileSync(resolve(hydroojRoot, relative), 'utf8');
}

function readRepo(relative: string) {
    return readFileSync(resolve(repoRoot, relative), 'utf8');
}

function extractExportedFunction(source: string, name: string) {
    return extractFunction(source, name, `export (?:async )?function ${name}\\b`);
}

function extractFunction(source: string, name: string, pattern = `(?:export )?(?:async )?function ${name}\\b`) {
    const start = source.search(new RegExp(pattern));
    if (start < 0) throw new Error(`missing ${name}`);
    const brace = source.indexOf('{', start);
    if (brace < 0) throw new Error(`missing body for ${name}`);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`unclosed ${name}`);
}

const DURATION_TRUNCATE = 'tsdoc.startAt <= new Date(Date.now() - Math.floor(tdoc.duration * Time.hour))';

describe('exam paper wiring', () => {
    it('paper.ts imports canStartExamPaper, resolveExamPaperPids, and isExamPaperInWindow', () => {
        const paper = readHydrooj('src/handler/paper.ts');
        expect(paper).to.include('canStartExamPaper');
        expect(paper).to.include('resolveExamPaperPids');
        expect(paper).to.include('isExamPaperInWindow');
        const fromLib = /from\s+['"][^'"]*lib\/exam-paper['"]/.test(paper);
        const fromCommon = /canStartExamPaper[\s\S]{0,500}from\s+['"]@hydrooj\/common['"]|from\s+['"]@hydrooj\/common['"][\s\S]{0,500}canStartExamPaper/.test(paper);
        expect(fromLib || fromCommon, 'import exam-paper helpers from lib/exam-paper or @hydrooj/common').to.equal(true);
    });

    it('does not gate exam-rule startAt on isOngoing', () => {
        const paper = readHydrooj('src/handler/paper.ts');
        const start = paper.indexOf('class PaperBaseHandler');
        const end = paper.indexOf('async getProblemDict');
        expect(start).to.be.at.least(0);
        expect(end).to.be.greaterThan(start);
        const prepare = paper.slice(start, end);
        const watchAt = prepare.indexOf('assertCourseExamWatchGate');
        expect(watchAt, 'exam start stays after the watch gate').to.be.at.least(0);
        const afterWatch = prepare.slice(watchAt);
        expect(afterWatch, 'GET must not write exam startAt').to.not.include('writeExamPaperStart');
        expect(afterWatch, 'GET must not start the personal clock').to.not.match(/assertExamPaperCanStart|canStartExamPaper/);
        const startAt = paper.indexOf('class PaperStartHandler');
        const startEnd = paper.indexOf('export async function finalizePaperForUser');
        expect(startAt).to.be.at.least(0);
        expect(startEnd).to.be.greaterThan(startAt);
        const startHandler = paper.slice(startAt, startEnd);
        expect(startHandler, 'explicit start POST uses canStartExamPaper').to.match(/assertExamPaperCanStart|canStartExamPaper/);
    });

    it('keeps contest isOngoing and isDone duration truncate bodies', () => {
        const contest = readHydrooj('src/model/contest.ts');
        const isOngoing = extractExportedFunction(contest, 'isOngoing');
        const isDone = extractExportedFunction(contest, 'isDone');
        expect(isOngoing).to.include(DURATION_TRUNCATE);
        expect(isDone).to.include(DURATION_TRUNCATE);
    });

    it('rejects non-exam quotas, a short save pool, and quota edits after someone started', () => {
        const contest = readHydrooj('src/handler/contest.ts');
        expect(contest).to.include("rule !== 'exam' && examPaperQuotas");
        expect(contest).to.include('只有选择题考试能设置抽题');
        expect(contest).to.include('题型数量不足，不能保存抽题');
        expect(contest).to.include('考试已有人开考，不能改抽题');
        expect(contest).to.include('startAt: { $exists: true }');
        expect(contest).to.include('examPaperPids: { $exists: true }');
    });

    it('contest edit GET projects pdict.problemKind and save blocks quota or pool changes after start', () => {
        const src = readHydrooj('src/handler/contest.ts');
        const getStart = src.indexOf('async get(_domainId: string, tid: ObjectId)');
        const getEnd = src.indexOf('async postUpdate(');
        expect(getStart).to.be.at.least(0);
        expect(getEnd).to.be.greaterThan(getStart);
        const get = src.slice(getStart, getEnd);
        expect(get).to.include("problem.getList(authoritativeDomainId, this.tdoc.pids, true, true, ['docId', 'pid', 'title', 'problemKind'], true)");
        const saveStart = src.indexOf('let previousExamPaperQuotas');
        const saveEnd = src.indexOf('if (autoHideTargets.length)');
        expect(saveStart).to.be.at.least(0);
        expect(saveEnd).to.be.greaterThan(saveStart);
        const save = src.slice(saveStart, saveEnd);
        expect(save).to.include('examPaperPoolChanged = examPaperDrawTouched && pidsChanged');
        expect(save).to.include('examPaperQuotasChanged || examPaperPoolChanged');
        expect(save).to.include('startAt: { $exists: true }');
        expect(save).to.include('examPaperPids: { $exists: true }');
    });

    it('course-exam-complete uses examPaperPidsForCompletion', () => {
        const complete = readHydrooj('src/lib/course-exam-complete.ts');
        expect(complete).to.match(/examPaperPidsForCompletion|resolveExamPaperPids/);
    });

    it('quotes Chinese-comma exam-paper catalog keys', () => {
        const catalog = readRepo('framework/framework/error-catalog.ts');
        expect(catalog).to.include('只有选择题考试能设置抽题');
        expect(catalog).to.include("'题型数量不足，不能保存抽题'");
        expect(catalog).to.include("'题型数量不足，不能开始考试'");
        expect(catalog).to.include("'考试已有人开考，不能改抽题'");
        expect(catalog).to.include("'个人试卷缺失或损坏，不能进入'");
        expect(catalog).to.include("'剩余时间不足，不能开始考试'");
        expect(catalog).to.include('还没有开始答题');
        expect(catalog).to.include('已经交卷');
        expect(catalog).to.include('预览考试不能开始答题');
        expect(catalog).to.include('只有选择题考试能设置题目分数');
        expect(catalog).to.include('只有选择题考试能设置及格分');
        expect(catalog).to.include('考试及格分无效');
        expect(catalog).to.include('补考次数已用完');
        expect(catalog).to.include("'评测尚未结束，不能再考'");
        expect(catalog).to.include("'已经及格，不能再考'");
        expect(catalog).to.include('考试分数无效');
        expect(catalog).to.include('只能给这场考试里的题目改分数');
    });

    it('contest student surfaces project draw-on pids and do not write exam startAt', () => {
        const src = readHydrooj('src/handler/contest.ts');
        expect(src).to.include('studentContestProblemPids');
        expect(src).to.include('projectStudentContestTdoc');
        expect(src).to.include("this.tdoc.rule !== 'exam' && this.tsdoc.attend && !this.tsdoc.startAt");
        expect(src).to.include("if (this.tdoc.rule !== 'exam' && !this.tsdoc.startAt)");
        expect(src).to.include('unset: { examPaperQuotas: 1');
        expect(src).not.to.include('document.set(authoritativeDomainId, document.TYPE_CONTEST, tid, undefined');
    });

    it('draw-on exam scoreboard keeps totals and refuses ghost pool columns', () => {
        const contestModel = readHydrooj('src/model/contest.ts');
        const examStart = contestModel.indexOf('const exam = buildContestRule');
        const examEnd = contestModel.indexOf('export const RULES');
        expect(examStart).to.be.at.least(0);
        expect(examEnd).to.be.greaterThan(examStart);
        const examRule = contestModel.slice(examStart, examEnd);
        expect(examRule).to.include('readExamPaperQuotas(tdoc.examPaperQuotas) === null');
        expect(examRule, 'exam rule must not emit tdoc.pids columns').to.not.include('tdoc.pids');
        const getScoreboard = extractExportedFunction(contestModel, 'getScoreboard');
        expect(getScoreboard).to.include('annotateScoreboardPercentages');
        expect(getScoreboard).to.include('readExamPaperQuotas(tdoc.examPaperQuotas) === null');

        const handler = readHydrooj('src/handler/contest.ts');
        const ghostStart = handler.indexOf("'ghost'");
        const ghostEnd = handler.indexOf("'html'", ghostStart);
        expect(ghostStart).to.be.at.least(0);
        expect(ghostEnd).to.be.greaterThan(ghostStart);
        const ghost = handler.slice(ghostStart, ghostEnd);
        expect(ghost).to.include("tdoc.rule === 'exam'");
        expect(ghost).to.include('readExamPaperQuotas(tdoc.examPaperQuotas) !== null');
        expect(ghost, 'teachers must not get a pool ghost export').to.not.include('canManageLoadedContest');
    });

    it('paper.ts allows unfrozen pool only for admin preview', () => {
        const paper = readHydrooj('src/handler/paper.ts');
        expect(paper).to.include('examPaperAllowPool');
        expect(paper).to.include('allowUnfrozenPool');
        expect(paper).to.include('isExamPaperWindowClosed');
        expect(paper).to.include('canFinalize: !this.examPaperAdminPreview && paperStarted && !paperFinalized && !isExamPaperWindowClosed(this.tdoc, this.tsdoc, new Date())');
        expect(paper).to.include('examShowVerdict: this.examPaperAdminPreview || examShowsVerdict(this.tdoc)');
        expect(paper).to.include('canRetakeExamPaper');
        expect(paper).to.include('writeExamPaperRetakeStart');
        expect(paper).to.include('examJournalAfter');
        expect(paper).to.include('display: 1');
        expect(paper).to.include('examAttemptsUsed');
        expect(paper).to.include('assertExamPaperDraftReadable');
        expect(paper).to.include("localizedErrorText`补考次数已用完`");
        expect(paper).to.include('readExamPassScore(tdoc) === null');
        expect(paper).to.include('examAttemptsUsed: used');
        const retake = extractFunction(paper, 'writeExamPaperRetakeStart');
        expect(retake.indexOf('contest.get(')).to.be.lessThan(retake.indexOf('drawExamPaperPids'));
        expect(retake).to.include('if (updated && isExamPaperStarted(updated)');
        expect(paper).to.include('scaleByContestProblemScore(this.tdoc, pid');
        expect(readHydrooj('src/handler/paper.ts')).to.not.include('updateStatus(domainId, tid, uid, rid, 0)');
        expect(readHydrooj('src/model/contest.ts')).to.include('rebuildExamJournalFromRecords');
        expect(readHydrooj('src/model/contest.ts')).to.include('mergeExamJournalEntry');
        expect(readHydrooj('bin/commands.ts')).to.include('contest-recalc-status');
        expect(readHydrooj('src/handler/contest.ts')).to.include('async postSetScores');
        expect(readHydrooj('src/handler/contest.ts')).to.include('assignContestProblemScores');
        expect(readHydrooj('src/handler/contest.ts')).to.include("'tag', 'problemKind'");
        expect(paper).to.include('recordStatus: showVerdict ? recordStatus : {}');
        expect(paper).to.include('judgeResults: showVerdict ? aggregateResults : {}');
        expect(paper).to.include("localizedErrorText`已经交卷`");
        expect(paper).to.include("localizedErrorText`预览考试不能交卷`");
        expect(paper).to.include('if (this.examPaperAdminPreview)');
    });

    it('first exam-paper start CASes one frozen paper and re-reads on conflict', () => {
        const paper = readHydrooj('src/handler/paper.ts');
        const write = extractFunction(paper, 'writeExamPaperStart');
        expect(write).to.include('setStatusIfCondition');
        expect(write).to.match(/\$exists:\s*false/);
        expect(write).to.include('examPaperPids');
        expect(write).to.include('assertFrozenExamPaperPids');
        const drawOff = write.slice(write.indexOf('if (!isExamPaperDrawEnabled'), write.indexOf('const quotas'));
        expect(drawOff).to.include('{ startAt, examJournalAfter }');
        expect(drawOff).not.to.include('examPaperPids');
        expect(write).to.include('{ startAt: { $exists: false } }');
        expect(write).to.include('{ startAt, examPaperPids, examJournalAfter }');
        expect(write).to.include('examJournalAfter');
        expect(write).to.not.include('{ examPaperPids: { $exists: false } }');
        expect(write).to.not.include('existingStart');
        expect(paper).to.not.include('examPaperStartNeedsWrite');
        expect(paper).to.not.include('tsdoc?.attend && !isExamPaperStarted(tsdoc)');
        expect(paper).to.include('class PaperStartHandler');
        expect(paper).to.include("ctx.Route('paper_start'");
        expect(paper).to.include('assertExamPaperStartedForWrite');
    });

    it('home, problem, and record student JSON project draw-on tdoc.pids', () => {
        expect(readHydrooj('src/handler/home.ts')).to.include('projectStudentContestTdoc');
        expect(readHydrooj('src/handler/problem.ts')).to.include('projectStudentContestTdoc');
        expect(readHydrooj('src/handler/record.ts')).to.include('projectStudentContestTdoc');
        expect(readHydrooj('src/handler/record.ts')).to.include('studentContestProblemPids');
        const list = readHydrooj('src/handler/contest.ts');
        expect(list).to.include('tdocs: tdocs.map((tdoc) =>');
        expect(list).to.include('projectStudentContestTdoc');
        expect(list).to.include('pdictForStudentPids');
    });

    it('non-paper writers skip exam-rule startAt', () => {
        const contest = readHydrooj('src/handler/contest.ts');
        expect(contest).to.include("this.tdoc.rule !== 'exam' && !this.tsdoc.startAt");
        const vigil = readHydrooj('src/lib/vigil-integration-attendance.ts');
        expect(vigil).to.include("tdoc.rule !== 'exam'");
        expect(vigil).to.include('contestModel.isOngoing(tdoc, tsdoc)');
    });

    it('exam-shell countdown consumes projected tdoc.endAt and paper UI does not reread the pool', () => {
        const shell = readRepo('packages/ui-next/src/components/layout/exam-shell.tsx');
        expect(shell).to.include('examShellClockIso(data.tdoc?.endAt)');
        expect(readRepo('packages/ui-next/src/pages/exam-mode/paper.tsx')).to.include('/paper/${tid}/start');
        expect(readRepo('packages/ui-next/src/pages/exam-mode/paper.tsx')).not.to.include('examPaperQuotas');
        expect(readRepo('packages/ui-next/src/pages/exam-mode/workspace.tsx')).not.to.include('examPaper');
        expect(readRepo('packages/ui-next/src/components/paper/sections.tsx')).to.include('contestEndAt || tdoc.endAt');
        expect(readRepo('packages/ui-next/src/components/paper/sections.tsx')).not.to.include('examPaperQuotas');
    });

    it('drops stale exam journal rids after a retake floor', () => {
        const contestModel = readHydrooj('src/model/contest.ts');
        expect(contestModel).to.include("tdoc.rule === 'exam'");
        expect(contestModel).to.include('examStatusAcceptsJournalRid');
        expect(contestModel).to.include('examJournalFloorFilter');
        expect(contestModel).to.include("'journal.rid': rid");
        expect(contestModel).to.include('manual === true');
        expect(readHydrooj('src/handler/paper.ts')).to.include('$inc: { rev: 1 }');
        expect(readHydrooj('src/model/manual-grade.ts')).to.include('manual: true');
        expect(readHydrooj('src/handler/course.ts')).to.include('canRetake: true');
        expect(readRepo('packages/ui-next/src/pages/course/types.ts')).to.include('canRetake: true');
    });

    it('fails closed on a missing frozen pid and maps remaining-time / short-pool start errors', () => {
        const paper = readHydrooj('src/handler/paper.ts');
        expect(paper).to.include('failOnMissingPaper');
        expect(paper).to.include('个人试卷缺失或损坏，不能进入');
        expect(paper).to.include('题型数量不足，不能开始考试');
        expect(paper).to.include('剩余时间不足，不能开始考试');
        expect(paper).to.include('tdoc: projectStudentExamPaperTdoc');
        expect(paper).to.include('return isExamPaperInWindow(this.tdoc, this.tsdoc, new Date())');
        expect(readHydrooj('src/handler/problem.ts')).to.include('canAccessExamAwareContestProblem');
    });
});
