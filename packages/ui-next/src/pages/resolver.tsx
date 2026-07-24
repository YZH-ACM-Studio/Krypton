import { useBootstrap } from '@/lib/bootstrap';
import { AdminAccountDetailPage, AdminAccountsPage } from '@/pages/admin-accounts';
import { DomainDashboardPage, ManageDashboardPage, StatusPage } from '@/pages/admin';
import {
  AdminTasksAssignPage,
  AdminTasksCandidatesPage,
  AdminTasksEditPage,
  AdminTasksListPage,
  AdminTasksScoresPage,
  AdminTasksSettingsPage,
  AdminTasksStatsPage,
} from '@/pages/admin-tasks';
import {
  AdminAnnounceCategoriesPage,
  AdminAnnounceEditorPage,
  AdminAnnounceListPage,
  AnnounceDetailPage,
  AnnounceListPage,
} from '@/pages/announcement';
import {
  ChangeMailSentPage,
  LoginPage,
  LogoutPage,
  LostPasswordMailSentPage,
  LostPasswordPage,
  LostPasswordWithCodePage,
  RegisterMailSentPage,
  RegisterPage,
  UserDeletePendingPage,
} from '@/pages/auth';
import { AdminAuthTokenPage } from '@/pages/authtoken';
import { BlankProblemEditorPage, MultiProblemEditorPage, SingleProblemEditorPage, TrueFalseProblemEditorPage } from '@/pages/basic-objective-editors';
import { BlogDetailPage, BlogEditPage, BlogMainPage } from '@/pages/blog';
import { ClientRequiredNoticePage } from '@/pages/client-required-notice';
import {
  ContestBalloonPage,
  ContestClarificationPage,
  ContestEditPage,
  ContestManagePage,
  ContestPrintPage,
  ContestProblemListPage,
  ContestUserPage,
} from '@/pages/contest-manage';
import { ContestTeamsPage } from '@/pages/contest-teams';
import { TeamBatchesPage } from '@/pages/team-batches';
import { ContestDetailPage, ContestScoreboardPage, ContestsPage } from '@/pages/contests';
import { CourseDetailPage, CourseEditPage, CoursePage } from '@/pages/course';
import { DiscussionCreatePage, DiscussionEditPage } from '@/pages/discussion-manage';
import { DiscussionDetailPage, DiscussionsPage } from '@/pages/discussions';
import { DomainEditPage, DomainGroupPage, DomainUserPage } from '@/pages/domain-manage';
import { DomainPermissionPage, DomainRolePage } from '@/pages/domain-permission-workspace';
import { ContestModePage, DomainCreatePage, DomainJoinApplicationsPage, DomainJoinPage } from '@/pages/domain-misc';
import { BsodPage, ErrorPage } from '@/pages/error';
import { ExamContestPage } from '@/pages/exam-mode/contest';
import { ExamModeHomePage } from '@/pages/exam-mode/index';
import { ExamPaperPage } from '@/pages/exam-mode/paper';
import { ContestWorkspacePage } from '@/pages/exam-mode/workspace';
import { GenericPage } from '@/pages/generic';
import { KryptonHomePage } from '@/pages/home';
import { HomeworkDetailPage, HomeworkPage } from '@/pages/homework';
import { HomeworkEditPage, HomeworkFilesPage } from '@/pages/homework-manage';
import { ManualGradingPage } from '@/pages/manual-grading';
import { MindmapPage } from '@/pages/mindmap';
import { AdminMindmapPage } from '@/pages/mindmap/admin';
import { DomainsPage } from '@/pages/misc';
import { MyVerifyInboxPage } from '@/pages/permits/inbox';
import { FpsImportPage, TelegramLoginPage, XcpcioBoardPage } from '@/pages/plugin-pages';
import { ProblemDetailPage } from '@/pages/problem-detail';
import { ProblemCreateHubPage } from '@/pages/problem-create-hub';
import { ProblemEditPage } from '@/pages/problem-edit';
import { ProblemHackPage } from '@/pages/problem-hack';
import { ProblemConfigPage, ProblemFilesPage, ProblemImportPage, ProblemSolutionPage, ProblemStatisticsPage } from '@/pages/problem-manage';
import { AdminStatsPage } from '@/pages/admin-stats';
import { ProblemMinePage } from '@/pages/problem-mine';
import { ProblemReviewPage } from '@/pages/problem-review';
import { ProblemSubmitPage } from '@/pages/problem-submit';
import { ProblemsPage } from '@/pages/problems';
import { RankBoardDetailPage, RankBoardMainPage } from '@/pages/rankboard';
import { AdminAwardTypesPage, AdminRankBoardListPage, AdminRankBoardPersonPage } from '@/pages/rankboard/admin';
import { RankBoardGalleryPage } from '@/pages/rankboard/gallery';
import { RankingPage } from '@/pages/ranking';
import { RealPassManagePage } from '@/pages/realpass-manage';
import { RecordDetailPage, RecordsPage } from '@/pages/records';
import { SpikeWebViewProbePage } from '@/pages/spike-webview';
import { FunctionProblemEditorPage, ProgramFillProblemEditorPage } from '@/pages/structured-code-editors';
import { SubjectiveProblemEditorPage } from '@/pages/subjective-editor';
import { SudoPage, SudoRedirectPage } from '@/pages/sudo';
import { ManageConfigPage, ManageScriptPage, ManageSettingPage } from '@/pages/system-manage';
import { TaskCenterPage, TaskDetailPage, TaskMyPage } from '@/pages/tasks';
import { TrainingDetailPage, TrainingPage } from '@/pages/training';
import { TrainingEditPage, TrainingFilesPage } from '@/pages/training-manage';
import { UserDetailPage } from '@/pages/user';
import { UserAccountPage } from '@/pages/user-account';
import {
  AdminUserbindGroupDetailPage,
  AdminUserbindGroupsPage,
  AdminUserbindOverviewPage,
  AdminUserbindRequestsPage,
  AdminUserbindSchoolDetailPage,
  AdminUserbindSchoolsPage,
  AdminUserbindStudentsImportPage,
  AdminUserbindStudentsPage,
  AdminUserbindTokensPage,
  UserBindApplicationsPage,
  UserBindClaimPage,
  UserBindLandingPage,
  UserBindPage,
  UserBindSuccessPage,
} from '@/pages/userbind';
import { AdminVigilExamDetailPage, AdminVigilOverviewPage } from '@/pages/vigil';
import { AboutPage, WikiHelpPage } from '@/pages/wiki';

type PageComponent = React.ComponentType;

const PAGE_MAP: Record<string, PageComponent> = {
  // Home
  'main.html': KryptonHomePage,
  'about.html': AboutPage,
  'wiki_help.html': WikiHelpPage,

  // Problems
  'problem_main.html': ProblemsPage,
  'problem_review.html': ProblemReviewPage,
  'problem_create_hub.html': ProblemCreateHubPage,
  'problem_mine.html': ProblemMinePage,
  'problem_detail.html': ProblemDetailPage,
  'problem_submit.html': ProblemSubmitPage,
  'problem_hack.html': ProblemHackPage,
  'problem_edit.html': ProblemEditPage,
  'problem_edit_single.html': SingleProblemEditorPage,
  'problem_edit_multi.html': MultiProblemEditorPage,
  'problem_edit_true_false.html': TrueFalseProblemEditorPage,
  'problem_edit_blank.html': BlankProblemEditorPage,
  'problem_edit_subjective.html': SubjectiveProblemEditorPage,
  'problem_edit_program_fill.html': ProgramFillProblemEditorPage,
  'problem_edit_function.html': FunctionProblemEditorPage,
  'problem_config.html': ProblemConfigPage,
  'problem_files.html': ProblemFilesPage,
  'problem_solution.html': ProblemSolutionPage,
  'problem_statistics.html': ProblemStatisticsPage,
  'problem_import.html': ProblemImportPage,
  'problem_import_fps.html': FpsImportPage,

  // Contests
  'contest_main.html': ContestsPage,
  'contest_detail.html': ContestDetailPage,
  'contest_teams.html': ContestTeamsPage,
  'team_batches.html': TeamBatchesPage,
  'team_batch_detail.html': ContestTeamsPage,
  'contest_edit.html': ContestEditPage,
  'contest_scoreboard.html': ContestScoreboardPage,
  'xcpcio_board.html': XcpcioBoardPage,
  'contest_manage.html': ContestManagePage,
  'contest_problemlist.html': ContestProblemListPage,
  'contest_user.html': ContestUserPage,
  'contest_balloon.html': ContestBalloonPage,
  'contest_clarification.html': ContestClarificationPage,
  'contest_print.html': ContestPrintPage,

  // Homework
  'homework_main.html': HomeworkPage,
  'homework_detail.html': HomeworkDetailPage,
  'manual_grading.html': ManualGradingPage,
  'homework_edit.html': HomeworkEditPage,
  'homework_files.html': HomeworkFilesPage,

  // Training
  'course_main.html': CoursePage,
  'course_detail.html': CourseDetailPage,
  'course_edit.html': CourseEditPage,
  'training_main.html': TrainingPage,
  'training_detail.html': TrainingDetailPage,
  'training_edit.html': TrainingEditPage,
  'training_files.html': TrainingFilesPage,

  // Discussions
  'discussion_main_or_node.html': DiscussionsPage,
  'discussion_detail.html': DiscussionDetailPage,
  'discussion_create.html': DiscussionCreatePage,
  'discussion_edit.html': DiscussionEditPage,

  // Records
  'record_main.html': RecordsPage,
  'record_detail.html': RecordDetailPage,

  // Ranking
  'ranking.html': RankingPage,

  // Blog plugin
  'blog_main.html': BlogMainPage,
  'blog_detail.html': BlogDetailPage,
  'blog_edit.html': BlogEditPage,

  // Auth
  'user_login.html': LoginPage,
  'telegram_login.html': TelegramLoginPage,
  'user_register.html': RegisterPage,
  'user_register_with_code.html': RegisterPage,
  'user_register_mail_sent.html': RegisterMailSentPage,
  'user_logout.html': LogoutPage,
  'user_lostpass.html': LostPasswordPage,
  'user_lostpass_mail_sent.html': LostPasswordMailSentPage,
  'user_lostpass_with_code.html': LostPasswordWithCodePage,
  'user_sudo.html': SudoPage,
  'user_sudo_redirect.html': SudoRedirectPage,
  'user_delete_pending.html': UserDeletePendingPage,
  'user_changemail_mail_sent.html': ChangeMailSentPage,
  'contest_mode.html': ContestModePage,

  // User pages
  'user_detail.html': UserDetailPage,
  'home_security.html': UserAccountPage,
  'home_settings.html': UserAccountPage,
  'home_domain.html': DomainsPage,
  'home_messages.html': UserAccountPage,
  'home_files.html': UserAccountPage,

  // Domain admin
  'domain_create.html': DomainCreatePage,
  'domain_dashboard.html': DomainDashboardPage,
  'domain_edit.html': DomainEditPage,
  'domain_user.html': DomainUserPage,
  'domain_user_raw.html': DomainUserPage,
  'domain_permission.html': DomainPermissionPage,
  'domain_role.html': DomainRolePage,
  'domain_group.html': DomainGroupPage,
  'domain_join.html': DomainJoinPage,
  'domain_join_applications.html': DomainJoinApplicationsPage,

  // System admin
  'manage_dashboard.html': ManageDashboardPage,
  'manage_script.html': ManageScriptPage,
  'manage_setting.html': ManageSettingPage,
  'manage_config.html': ManageConfigPage,
  'manage_realpass.html': RealPassManagePage,
  'admin_stats.html': AdminStatsPage,
  'admin_accounts.html': AdminAccountsPage,
  'admin_account_detail.html': AdminAccountDetailPage,

  // Misc
  'status.html': StatusPage,

  // Error pages
  'error.html': ErrorPage,
  'bsod.html': BsodPage,

  // krypton-userbind admin
  'admin_userbind_overview.html': AdminUserbindOverviewPage,
  'admin_userbind_schools.html': AdminUserbindSchoolsPage,
  'admin_userbind_school_detail.html': AdminUserbindSchoolDetailPage,
  'admin_userbind_groups.html': AdminUserbindGroupsPage,
  'admin_userbind_group_detail.html': AdminUserbindGroupDetailPage,
  'admin_userbind_students.html': AdminUserbindStudentsPage,
  'admin_userbind_students_import.html': AdminUserbindStudentsImportPage,
  'admin_userbind_tokens.html': AdminUserbindTokensPage,
  'admin_userbind_requests.html': AdminUserbindRequestsPage,

  // krypton-userbind student
  'user_bind.html': UserBindPage,
  'user_bind_applications.html': UserBindApplicationsPage,
  'user_bind_landing.html': UserBindLandingPage,
  'user_bind_success.html': UserBindSuccessPage,
  'user_bind_claim.html': UserBindClaimPage,

  // Phase 0 spike
  '_spike-webview.html': SpikeWebViewProbePage,

  // Phase 2: exam-mode (paper workflow)
  'exam_mode_home.html': ExamModeHomePage,
  'exam_contest.html': ExamContestPage,
  'exam_paper.html': ExamPaperPage,
  // Phase 4: client-required workspace (all-rule contest entry)
  'contest_workspace.html': ContestWorkspacePage,
  'client_required_notice.html': ClientRequiredNoticePage,

  // Phase 3: vigil admin (S2 absorption)
  'admin_vigil_overview.html': AdminVigilOverviewPage,
  'admin_vigil_exam_detail.html': AdminVigilExamDetailPage,

  // krypton-tasks (user-facing)
  'tasks_center.html': TaskCenterPage,
  'tasks_my.html': TaskMyPage,
  'tasks_detail.html': TaskDetailPage,

  // krypton-permits (per-problem verifier ACL)
  'my_verify_inbox.html': MyVerifyInboxPage,

  // krypton-tasks (admin-facing)
  'admin_tasks.html': AdminTasksListPage,
  'admin_tasks_edit.html': AdminTasksEditPage,
  'admin_tasks_assign.html': AdminTasksAssignPage,
  'admin_tasks_stats.html': AdminTasksStatsPage,
  'admin_tasks_candidates.html': AdminTasksCandidatesPage,
  'admin_tasks_scores.html': AdminTasksScoresPage,
  'admin_tasks_settings.html': AdminTasksSettingsPage,

  // krypton-announcement
  'announce_list.html': AnnounceListPage,
  'announce_detail.html': AnnounceDetailPage,
  'admin_announce_list.html': AdminAnnounceListPage,
  'admin_announce_edit.html': AdminAnnounceEditorPage,
  'admin_announce_categories.html': AdminAnnounceCategoriesPage,

  // krypton-rankboard
  'rankboard_main.html': RankBoardMainPage,
  'rankboard_gallery.html': RankBoardGalleryPage,
  'rankboard_detail.html': RankBoardDetailPage,
  'admin_rankboard.html': AdminRankBoardListPage,
  'admin_rankboard_awards.html': AdminAwardTypesPage,
  'admin_rankboard_person.html': AdminRankBoardPersonPage,

  // krypton-mindmap
  'mindmap_main.html': MindmapPage,
  'admin_mindmap.html': AdminMindmapPage,

  // auth-token admin (Krypton access tokens)
  'admin_authtoken.html': AdminAuthTokenPage,
};

export function PageResolver() {
  const bs = useBootstrap();
  const Component = PAGE_MAP[bs.page.templateName] || GenericPage;
  return <Component />;
}
