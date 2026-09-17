import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getContestProblemStatus,
  prioritizeCurrentScoreboardRows,
  scoreboardParticipantColumn,
} from '../src/lib/contest-exam-display.ts';

const workspace = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspace, path), 'utf8');
}

describe('small interface fixes', () => {
  it('shows accepted and latest non-accepted contest status labels', () => {
    expect(getContestProblemStatus(1)).to.include({ label: 'AC', code: 'pass' });
    expect(getContestProblemStatus(2)).to.include({ label: 'WA', code: 'fail' });
    expect(getContestProblemStatus(3)).to.include({ label: 'TLE', code: 'fail' });
    expect(getContestProblemStatus(20)).to.include({ label: '评测中', code: 'progress' });
    expect(getContestProblemStatus(undefined)).to.equal(null);
  });

  it('moves the current individual or team to the top without changing other rows', () => {
    const rows = [
      [{ type: 'rank', value: 1 }, { type: 'user', raw: 10 }],
      [{ type: 'rank', value: 2 }, { type: 'user', raw: 20 }],
      [{ type: 'rank', value: 3 }, { type: 'user', raw: 30 }],
    ];
    expect(scoreboardParticipantColumn([{ type: 'rank' }, { type: 'user' }], false)).to.equal(1);
    expect(prioritizeCurrentScoreboardRows(rows, 1, 20).map((row) => row[1].raw)).to.deep.equal([20, 10, 30]);

    const teamRows = [
      [{ type: 'rank', value: 1 }, { type: 'string', raw: 'team-a' }],
      [{ type: 'rank', value: 2 }, { type: 'string', raw: 'team-b' }],
    ];
    expect(scoreboardParticipantColumn([{ type: 'rank' }, { type: 'string' }], true)).to.equal(1);
    expect(prioritizeCurrentScoreboardRows(teamRows, 1, 'team-b').map((row) => row[1].raw)).to.deep.equal(['team-b', 'team-a']);
  });

  it('filters the problem bank by the selected visible contest problem ids', () => {
    const handler = source('packages/hydrooj/src/handler/problem.ts');
    const page = source('packages/ui-next/src/pages/problems.tsx');
    expect(handler).to.include("@param('contest', Types.ObjectId, true)");
    expect(handler).to.include('const canFilterContest =');
    expect(handler).to.include('this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST) || this.user.hasPerm(PERM.PERM_VIEW_CONTEST)');
    expect(handler).to.include('if (contestId && !canFilterContest) throw new PermissionError(PERM.PERM_VIEW_CONTEST);');
    expect(handler).to.include('function requireProblemSolutionView');
    expect(handler).to.include('PERM.PERM_VIEW_PROBLEM_SOLUTION_ACCEPT');
    const access = source('packages/hydrooj/src/model/problem-access.ts');
    expect(access).to.include('!user.hasPerm(PERM.PERM_VIEW_PROBLEM) && !isProblemBankAdmin(user)');
    const contestops = source('packages/hydrooj/src/handler/contestops.ts');
    expect(contestops).to.include('this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)');
    expect(contestops).to.include('this.user.hasPerm(PERM.PERM_EDIT_CONTEST)');
    const tagger = source('packages/hydrooj/src/handler/tagger.ts');
    expect(tagger).not.to.include('this.checkPerm(PERM.PERM_VIEW_PROBLEM)');
    expect(handler).to.include("rule: { $ne: 'homework' }");
    expect(handler).to.include('filterParts.push({ docId: { $in: selectedContest.pids || [] } });');
    expect(page).to.include('name="contest"');
    expect(page).to.include('contestOptions={contestOptions}');
  });

  it('renders a sanitized exam problem status journal and keeps selftests out of that path', () => {
    const page = source('packages/ui-next/src/pages/contest-manage.tsx');
    const handler = source('packages/hydrooj/src/handler/contest.ts');
    const paper = source('packages/hydrooj/src/handler/paper.ts');
    const record = source('packages/hydrooj/src/model/record.ts');
    expect(page).to.include('const problemStatusByPid: Record<string, R> = data.problemStatusByPid || {};');
    expect(page).to.include(': problemStatusByPid[String(pid)] || null');
    expect(page).to.include('getContestProblemStatus(statusDoc?.status)');
    expect(paper).to.include('protected latestProblemStatusesEnabled = true;');
    expect(handler).to.include('buildLatestContestProblemStatusByPid(statusJournal, this.tdoc.pids)');
    expect(record).to.include("if (args.type === 'pretest')");
    expect(record).to.include('data.contest = RecordModel.RECORD_PRETEST;');
  });

  it('keeps the record list language filter on its live WebSocket subscription', () => {
    const page = source('packages/ui-next/src/pages/records.tsx');
    expect(page).to.include('lang: filterParams.lang || undefined');
  });

  it('sends print isAdmin and shows balloon without an ACM-only nav gate', () => {
    const page = source('packages/ui-next/src/pages/contest-manage.tsx');
    const handler = source('packages/hydrooj/src/handler/contest.ts');
    expect(handler).to.include('isAdmin: this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST)');
    expect(handler).to.include('canSubmitPrint: !!this.tsdoc?.attend && contest.isOngoing(this.tdoc, this.tsdoc)');
    expect(handler).to.include('canSubmitClarification: !!this.tsdoc?.attend && contest.isOngoing(this.tdoc)');
    expect(page).to.include('const canSubmitPrint = data.canSubmitPrint === true');
    expect(page).to.include('data.canSubmitClarification === true && data.previewMode !== true');
    const examAnnouncements = source('packages/ui-next/src/pages/exam-mode/contest.tsx');
    expect(examAnnouncements).to.include('data.canSubmitClarification === true && data.previewMode !== true');
    expect(page).to.include('const isPrintAdmin = data.isAdmin === true');
    expect(page).not.to.include('data.isAdmin || data.canEdit');
    expect(page).to.include('canSubmitPrint && printTab === \'submit\'');
    expect(page).to.include("key: 'balloon'");
    expect(page).not.to.include('show: isACM');
    expect(page).to.include("const canStar = !isTeamMode && ['acm', 'oi', 'ioi', 'strictioi'].includes(String(tdoc.rule || '').toLowerCase())");
    expect(page).to.include('{canStar ? (');
    const detail = source('packages/ui-next/src/pages/contests.tsx');
    expect(detail).to.include('{!isExam || canManageContest ? (');
    expect(detail).to.include('{canManageContest ? (');
    expect(detail).to.include('{tdoc.allowPrint ? (');
    const userNav = detail.slice(detail.indexOf('{tdoc.allowPrint ? ('), detail.indexOf('附件'));
    expect(userNav).to.include('{canManageContest ? (');
    expect(userNav).to.include('${detailUrl}/user');
    expect(userNav).to.include('参赛选手');
    expect(detail).to.include('${detailUrl}/file/private/${encodeURIComponent(f.name || \'\')}');
    expect(detail).not.to.include('/file/contest/');
  });

  it('keeps problem-set and homework edit buttons on the same capability as the edit prepare', () => {
    const trainingPage = source('packages/ui-next/src/pages/training.tsx');
    const trainingHandler = source('packages/hydrooj/src/handler/training.ts');
    const homework = source('packages/hydrooj/src/handler/homework.ts');
    const homeworkPage = source('packages/ui-next/src/pages/homework.tsx');
    const homeworkManage = source('packages/ui-next/src/pages/homework-manage.tsx');
    expect(trainingHandler).to.include("import { studentDirectory } from '../service/student-directory'");
    expect(trainingHandler).to.include('canManage: canManageProblemSet(this.user, tdoc)');
    expect(trainingHandler).to.include('if (!canManageProblemSet(this.user, this.tdoc)) {');
    expect(trainingHandler).to.include('await problemSetAccessService.assertAccessible');
    expect(trainingHandler).to.include('throw new PermissionError(PERM.PERM_EDIT_TRAINING)');
    expect(trainingPage).to.include('const canManage = data.canManage === true');
    expect(trainingPage).to.include('name="operation" value="delete"');
    expect(trainingPage).not.to.include('isOwner || data.canManage');
    expect(homework).to.include('actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)');
    expect(homework).to.include('actor.hasPerm(PERM.PERM_EDIT_HOMEWORK_SELF)');
    expect(homework).to.include('canEditHomework: canEditHomework(this.user, this.tdoc)');
    expect(homework).to.include('canDeleteHomework: canDeleteHomework(this.user, this.tdoc)');
    expect(homework).to.include('assertCanEditHomework(this.user, tdoc)');
    expect(homework).to.include('assertCanDeleteHomework(this.user, tdoc)');
    expect(homework).to.include('canCreateHomework(this.user)');
    expect(homework).to.include('else if (!canCreateHomework(this.user)) this.checkPerm(PERM.PERM_CREATE_HOMEWORK)');
    expect(homeworkPage).to.include('data.canEditHomework');
    expect(homeworkPage).to.include('data.canDeleteHomework');
    expect(homeworkPage).to.include('name="operation" value="delete"');
    expect(homeworkPage).to.include(`/homework/\${String(tdoc.docId)}/file`);
    const homeworkFiles = homeworkPage.slice(homeworkPage.indexOf('data.canDeleteHomework'), homeworkPage.indexOf('data.canGradeSubjective'));
    expect(homeworkFiles).to.include(`/homework/\${String(tdoc.docId)}/file`);
    expect(homeworkPage.slice(homeworkPage.indexOf('data.canEditHomework'), homeworkPage.indexOf('data.canDeleteHomework'))).to.include('/edit');
    expect(homeworkPage.slice(homeworkPage.indexOf('data.canEditHomework'), homeworkPage.indexOf('data.canDeleteHomework'))).not.to.include('/file');
    expect(homeworkManage).to.include('`/homework/${String(tdoc.docId || tdoc._id)}/file`');
    const homeworkEdit = homeworkManage.slice(homeworkManage.indexOf('export function HomeworkEditPage'));
    const homeworkSaveClose = homeworkEdit.indexOf('</form>');
    expect(homeworkEdit.slice(0, homeworkSaveClose)).not.to.include('name="operation" value="delete"');
    expect(homeworkEdit.slice(homeworkSaveClose)).to.include('name="operation" value="delete"');
    expect(trainingPage).to.include('${trainingUrl}/file');
    expect(trainingHandler).to.include('} else if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM))');
    expect(trainingHandler).to.include('this.checkPerm(PERM.PERM_CREATE_TRAINING)');
    expect(trainingHandler).to.include("ctx.Route('training_detail', '/problem-sets/:tid', TrainingDetailHandler);");
    expect(trainingHandler).to.include("ctx.Route('training_files', '/problem-sets/:tid/file', TrainingFilesHandler);");
    expect(trainingHandler).to.include("ctx.Route('training_file_download', '/problem-sets/:tid/file/:filename', TrainingFileDownloadHandler);");
    expect(trainingHandler).not.to.include("ctx.Route('training_detail', '/problem-sets/:tid', TrainingDetailHandler, PERM.PERM_VIEW_TRAINING)");
    expect(trainingHandler).to.include("ctx.Route('training_main', '/problem-sets', TrainingMainHandler);");
    expect(trainingHandler).not.to.include("ctx.Route('training_main', '/problem-sets', TrainingMainHandler, PERM.PERM_VIEW_TRAINING)");
    const courseHandler = source('packages/hydrooj/src/handler/course.ts');
    expect(courseHandler).to.include("ctx.Route('course_detail', '/course/:tid', CourseDetailHandler);");
    expect(courseHandler).not.to.include("ctx.Route('course_detail', '/course/:tid', CourseDetailHandler, PERM.PERM_VIEW_TRAINING)");
    expect(courseHandler).to.include("ctx.Route('course_main', '/course', CourseMainHandler);");
    expect(courseHandler).not.to.include("ctx.Route('course_main', '/course', CourseMainHandler, PERM.PERM_VIEW_TRAINING)");
    const courseVideo = source('packages/hydrooj/src/handler/course-video.ts');
    expect(courseVideo).to.include("ctx.Route('course_video_play', '/course/:tid/video/:videoId/play', CourseVideoPlayHandler);");
    expect(courseVideo).not.to.include('CourseVideoPlayHandler, PERM.PERM_VIEW_TRAINING');
    expect(courseVideo).not.to.include('CourseVideoProgressHandler, PERM.PERM_VIEW_TRAINING');
  });

  it('lets moderators toggle hidden discussions on node pages without leaving the node', () => {
    const handler = source('packages/hydrooj/src/handler/discussion.ts');
    const page = source('packages/ui-next/src/pages/discussions.tsx');
    expect(handler).to.include('function canBypassDiscussionView');
    expect(handler).not.to.include("DiscussionMainHandler, PERM.PERM_VIEW_DISCUSSION");
    const nodeGet = handler.slice(handler.indexOf('class DiscussionNodeHandler'), handler.indexOf('class DiscussionCreateHandler'));
    expect(nodeGet).to.include("@param('all', Types.Boolean)");
    expect(nodeGet).to.include('all &&= this.user.hasPerm(PERM.PERM_MOD_BADGE)');
    expect(nodeGet).to.include('this.user.hasPerm(PERM.PERM_MOD_BADGE)');
    expect(nodeGet).to.include('? all');
    expect(nodeGet).to.include('canViewHidden: this.user.hasPerm(PERM.PERM_MOD_BADGE)');
    expect(page).to.include("data.page_name === 'discussion_node' ? window.location.pathname");
    expect(page).to.include("data.page_name === 'discussion_node' ? `${discussionsBase}/create` : ''");
    const discussionModel = source('packages/hydrooj/src/model/discussion.ts');
    const listVnodes = discussionModel.slice(discussionModel.indexOf('export async function getListVnodes'), discussionModel.indexOf('export function discussionParentVisible'));
    expect(listVnodes).to.include('PERM.PERM_MOD_BADGE');
    expect(listVnodes).to.include('vnode.hidden');
    expect(listVnodes).to.include('if (!checkVNodeVisibility(ddoc.parentType, vnode, user)) return');
    expect(listVnodes).not.to.include('if (vnode.assign?.length && new Set(vnode.assign).intersection(new Set(user.group || [])).size) return');
    expect(discussionModel).to.include('user.hasPerm(PERM.PERM_MOD_BADGE)');
    expect(discussionModel).to.include('user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)');
    expect(discussionModel).to.include('if (error instanceof ContestNotFoundError) throw new DiscussionNodeNotFoundError');
    expect(discussionModel).to.include("error.name === 'ContestNotFoundError'");
    expect(discussionModel).to.include('new Set(user.group || [])');
    expect(discussionModel).to.include('assertHomeworkAccess(domainId, tdoc, userOrUid)');
    const visibility = discussionModel.slice(
      discussionModel.indexOf('export function checkVNodeVisibility'),
      discussionModel.indexOf('export function apply(ctx: Context)'),
    );
    expect(visibility).to.include('vnode.hidden');
  });

  it('loads the seat workspace on publication drift and scopes redemption lookup to actor batches', () => {
    const seat = source('packages/hydrooj/src/handler/exam-seat-assignment.ts');
    const seatPage = source('packages/ui-next/src/pages/exam-seat-plan.tsx');
    const redemption = source('packages/hydrooj/src/handler/redemption.ts');
    expect(seat).to.include("publicationWarning = 'assignment_publication_reference_drift'");
    expect(seat).not.to.match(/if \(\s*!published[\s\S]{0,240}throw new ExamSeatAssignmentError\('assignment_publication_reference_drift'\)/);
    expect(seat).to.include('isClassroomIntegrityError(error)');
    expect(seat).to.include("classroomWarning = classroomWarning || 'assignment_classroom_reference_unavailable'");
    expect(seatPage).to.include('已发布座位分配的引用已变化。页面仍可打开，请重新检查并发布新版本。');
    expect(seatPage).to.include('教室数据暂不可用，页面仍可打开。请检查教室布局后再写入。');
    const classroomPage = source('packages/ui-next/src/pages/exam-classroom.tsx');
    const binding = source('packages/hydrooj/src/handler/endpoint-seat-binding.ts');
    expect(classroomPage).to.include('教室数据暂不可用，页面仍可打开。请检查教室布局后再写入。');
    expect(binding).to.include("classroomWarning: 'classroom_sources_unavailable'");
    const paper = source('packages/hydrooj/src/handler/paper.ts');
    const print = paper.slice(paper.indexOf('class ExamModePrintHandler'), paper.indexOf('class ExamModeRecordDetailHandler'));
    expect(print).to.include('const { tsdoc } = await ensureExamModeAccess');
    expect(print).to.include('!this.user.hasPerm(PERM.PERM_EDIT_CONTEST) && !tsdoc?.attend');
    expect(print).not.to.include('isAdminBypass');
    const problems = paper.slice(paper.indexOf('class ExamModeProblemListHandler'), paper.indexOf('class ExamModeAnnouncementsHandler'));
    expect(problems).to.include('!canManageContest && (contest.isNotStarted(this.tdoc) || (!tsdoc?.attend && !contest.isDone(this.tdoc)))');
    const announcements = paper.slice(paper.indexOf('class ExamModeAnnouncementsHandler'), paper.indexOf('class ExamModeProblemDetailHandler'));
    expect(announcements).to.include('!canManageContest && (contest.isNotStarted(this.tdoc) || (!tsdoc?.attend && !contest.isDone(this.tdoc)))');
    const ranking = paper.slice(paper.indexOf('class ExamModeScoreboardHandler'), paper.indexOf('class ExamModePrintHandler'));
    expect(ranking).to.include('contest.canShowScoreboard.call(this, this.tdoc, true)');
    const examProblem = paper.slice(paper.indexOf('class ExamModeProblemDetailHandler'), paper.indexOf('class ExamModeScoreboardHandler'));
    expect(examProblem).to.include('if (!isAdminBypass && this.tdoc && contest.isNotStarted(this.tdoc))');
    const examDiscuss = paper.slice(paper.indexOf('class ExamModeDiscussionListHandler'), paper.indexOf('class ExamModeDiscussionCreateHandler'));
    expect(examDiscuss).to.include("@param('all', Types.Boolean)");
    expect(examDiscuss).to.include('all &&= this.user.hasPerm(PERM.PERM_MOD_BADGE)');
    expect(examDiscuss).to.include('canViewHidden: this.user.hasPerm(PERM.PERM_MOD_BADGE)');
    expect(examDiscuss).to.include('PERM.PERM_EDIT_CONTEST');
    expect(examDiscuss).to.include('this.checkPerm(PERM.PERM_VIEW_DISCUSSION)');
    const problemHandler = source('packages/hydrooj/src/handler/problem.ts');
    expect(problemHandler).to.include('if (contest.isNotStarted(this.tdoc) && !canManageContest) throw new ContestNotLiveError(tid)');
    expect(redemption).to.include('redemptionLookupSourceIds(batches)');
    expect(redemption).to.include("row.source === 'redemption' && allowedSourceIds.has(String(row.sourceId))");
  });

  it('exposes scoreboard unlock and problem archive on the same trusted write the list already has', () => {
    const contestHandler = source('packages/hydrooj/src/handler/contest.ts');
    const contestManage = source('packages/ui-next/src/pages/contest-manage.tsx');
    const contestEdit = contestManage.slice(contestManage.indexOf('name="operation" value="update"'), contestManage.indexOf('ContestExamSeatEntry'));
    const contestSaveClose = contestEdit.indexOf('</form>');
    expect(contestEdit.slice(0, contestSaveClose)).not.to.include('name="operation" value="delete"');
    expect(contestEdit.slice(contestSaveClose)).to.include('name="operation" value="delete"');
    const discussionHandler = source('packages/hydrooj/src/handler/discussion.ts');
    const discussionEditGet = discussionHandler.slice(
      discussionHandler.indexOf('class DiscussionEditHandler'),
      discussionHandler.indexOf('async postUpdate'),
    );
    expect(discussionEditGet).to.include('canDeleteDiscussion:');
    expect(discussionEditGet).to.include('PERM.PERM_DELETE_DISCUSSION_SELF');
    const discussionManage = source('packages/ui-next/src/pages/discussion-manage.tsx');
    expect(discussionManage).to.include('data.permissions?.canDeleteDiscussion === true');
    expect(discussionManage).to.include('data.permissions?.canHighlightDiscussion === true');
    expect(discussionManage).to.include('data.permissions?.canPinDiscussion === true');
    expect(discussionEditGet).to.include('canHighlightDiscussion:');
    expect(discussionHandler).to.include('canHighlightDiscussion: this.user.hasPerm(PERM.PERM_HIGHLIGHT_DISCUSSION)');
    const discussionEdit = discussionManage.slice(discussionManage.indexOf('export function DiscussionEditPage'));
    const discussionSaveClose = discussionEdit.indexOf('</form>');
    expect(discussionEdit.slice(0, discussionSaveClose)).not.to.include('name="operation" value="delete"');
    expect(discussionEdit.slice(discussionSaveClose)).to.include('name="operation" value="delete"');
    const contests = source('packages/ui-next/src/pages/contests.tsx');
    const problemHandler = source('packages/hydrooj/src/handler/problem.ts');
    const detail = source('packages/ui-next/src/pages/problem-detail.tsx');
    const edit = source('packages/ui-next/src/pages/problem-edit.tsx');
    expect(contestHandler).to.include('this.response.body.canUnlockScoreboard');
    expect(contestHandler).to.include('contest.isDone(this.tdoc) && this.tdoc.lockAt && !this.tdoc.unlocked');
    expect(contests).to.include('name="operation" value="unlock"');
    expect(contests).to.include('解除封榜');
    expect(problemHandler).to.include('canArchiveProblem: !tid && !this.virtualAttempt && problem.canArchiveProblem(this.user, this.pdoc)');
    expect(detail).to.include('name="operation" value="archive"');
    expect(detail).to.include('Archived from problem detail');
    expect(edit).to.include('const canArchive = !isCreate && capabilities.canArchive === true && !pdoc.archivedAt');
    expect(edit).to.include('Archived from problem editor');
    expect(edit).to.include('action={String(bs.urls.problems || \'/p\')}');
    const afterSaveForm = edit.slice(edit.indexOf('id="programming-problem-form"'));
    const saveFormClose = afterSaveForm.indexOf('</form>');
    expect(afterSaveForm.slice(0, saveFormClose)).not.to.include('name="operation" value="delete"');
    expect(afterSaveForm.slice(saveFormClose)).to.include('name="operation" value="delete"');
    expect(afterSaveForm.slice(saveFormClose)).to.include('name="operation" value="archive"');
    const blog = source('packages/ui-next/src/pages/blog.tsx');
    expect(blog).to.include('hasPriv(bs.user.priv, PRIV.PRIV_EDIT_SYSTEM)');
    expect(blog).not.to.include('Boolean(bs.user.priv)');
    const blogEdit = blog.slice(blog.indexOf('export function BlogEditPage'), blog.indexOf('function BlogShell'));
    const blogSaveClose = blogEdit.indexOf('</form>');
    expect(blogEdit.slice(0, blogSaveClose)).not.to.include('name="operation" value="delete"');
    expect(blogEdit.slice(blogSaveClose)).to.include('name="operation" value="delete"');
    const balloonGet = contestHandler.slice(
      contestHandler.indexOf('export class ContestBalloonHandler'),
      contestHandler.indexOf('async postSetColor'),
    );
    expect(balloonGet).to.match(/async get\(/);
    expect(balloonGet).not.to.match(/async GET\(/);
    expect(balloonGet).not.to.include('PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD');
    expect(balloonGet).not.to.include('lockAt');
    expect(contestHandler).to.include('this.tdoc.lockAt && !this.tdoc.unlocked ? { lockAt: this.tdoc.lockAt }');
  });

  it('opens workspace and admin leftover writes on the same trusted path the page already promised', () => {
    const problem = source('packages/hydrooj/src/handler/problem.ts');
    expect(problem).to.include('problem.canOpenProblemWorkspace(this.user, workspace)');
    const home = source('packages/ui-next/src/pages/home.tsx');
    expect(home).to.include('bs.user.canBrowseProblemBank === true');
    const domain = source('packages/hydrooj/src/handler/domain.ts');
    expect(domain).to.include("canDeleteDomain: this.domain.owner === this.user._id && this.domain._id !== 'system'");
    const admin = source('packages/ui-next/src/pages/admin.tsx');
    expect(admin).to.include('data.canDeleteDomain === true');
    expect(admin).not.to.include('String(bs.user.id) === String(ownerId');
    const records = source('packages/ui-next/src/pages/records.tsx');
    expect(records).to.include('notification?: Array<{ name?: string }>');
    expect(records).to.include('(data.notification || []).map');
    const record = source('packages/hydrooj/src/handler/record.ts');
    expect(record).to.include('async function hideLoadedContest');
    expect(record).to.include('if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return;');
    expect(source('packages/hydrooj/src/handler/contest.ts')).to.include('export function canBrowseAssignRestrictedContests');
    expect(source('packages/hydrooj/src/handler/home.ts')).to.include(
        'this.user.hasPerm(PERM.PERM_EDIT_CONTEST) || this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST)',
    );
    expect(source('packages/hydrooj/src/handler/problem.ts')).to.include('canBrowseAssignRestrictedContests(this.user)');
    expect(source('packages/hydrooj/src/handler/record.ts')).to.include('function canRejudgeVirtualOnList');
    const team = source('packages/hydrooj/src/handler/contest-team.ts');
    expect(team.indexOf('await hideAssignRestrictedContest')).to.be.lessThan(team.indexOf('this.checkPerm(PERM.PERM_VIEW_CONTEST)'));
    const teamCode = source('packages/hydrooj/src/handler/contest-team-code.ts');
    expect(teamCode).to.include("access.reason === 'scope_miss') throw new ContestNotFoundError");
    const permits = source('packages/krypton-permits/src/handler.ts');
    expect(permits).to.include('async function loadPermitProblem');
    expect(permits).to.include('await hideAssignRestrictedContest(domainId, tdoc, this.user)');
    const inbox = source('packages/ui-next/src/pages/permits/inbox.tsx');
    expect(inbox).to.include('`/contest/${tid}/verifiers/remove`');
    const homeHandler = source('packages/hydrooj/src/handler/home.ts');
    expect(homeHandler).to.include('discussion.getMulti(domainId, { hidden: false })');
    expect(record).to.include('problem.getListViewableAuthorized(');
    expect(record).not.to.include('this.user.hasPerm(PERM.PERM_VIEW_PROBLEM)');
    expect(source('packages/hydrooj/src/handler/tagger.ts')).not.to.include('this.checkPerm(PERM.PERM_EDIT_PROBLEM)');
    expect(source('packages/hydrooj/src/handler/contest.ts')).to.include("hidden && !contest.RULES[tdoc.rule].features?.includes('download')");
    const examContest = source('packages/ui-next/src/pages/exam-mode/contest.tsx');
    expect(examContest).not.to.include('START_GATED_TEMPLATES');
    const examWorkspace = source('packages/ui-next/src/pages/exam-mode/workspace.tsx');
    expect(examWorkspace).not.to.include('shouldHideProblems');
    expect(source('packages/ui-next/src/pages/contests.tsx')).to.include('canManageContest ? (\n                <SidebarLink href={`${detailUrl}/code`}');
    expect(source('packages/hydrooj/src/handler/user.ts')).not.to.match(
      /hasPerm\(PERM\.PERM_VIEW_PROBLEM\)[\s\S]{0,120}getListViewableAuthorized/,
    );
    const examShell = source('packages/ui-next/src/components/layout/exam-shell.tsx');
    expect(examShell).to.include('new Set<ExamSection>()');
    expect(examShell).not.to.include("['problems', 'print']");
    const paper = source('packages/hydrooj/src/handler/paper.ts');
    expect(paper).to.include('function assertPaperProblemsReadable');
    expect(paper).to.include('async function hideAssignUnlessPostContest');
  });
});
