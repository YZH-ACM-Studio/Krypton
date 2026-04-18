import { useBootstrap } from '@/lib/bootstrap';
import { GenericPage } from '@/pages/generic';
import { KryptonHomePage } from '@/pages/home';
import { ProblemsPage, ProblemDetailPage } from '@/pages/problems';
import { ContestsPage, ContestDetailPage, ContestScoreboardPage } from '@/pages/contests';
import { TrainingPage, TrainingDetailPage } from '@/pages/training';
import { HomeworkPage, HomeworkDetailPage } from '@/pages/homework';
import { DiscussionsPage, DiscussionDetailPage } from '@/pages/discussions';
import { RecordsPage, RecordDetailPage } from '@/pages/records';
import { RankingPage } from '@/pages/ranking';
import { LoginPage, RegisterPage, LogoutPage, LostPasswordPage } from '@/pages/auth';
import { UserDetailPage, SettingsPage, SecurityPage, MessagesPage } from '@/pages/user';
import { DomainDashboardPage, ManageDashboardPage, StatusPage } from '@/pages/admin';
import { DomainsPage, FilesPage } from '@/pages/misc';
import { ErrorPage, BsodPage } from '@/pages/error';

type PageComponent = React.ComponentType;

const PAGE_MAP: Record<string, PageComponent> = {
  // Home
  'main.html': KryptonHomePage,

  // Problems
  'problem_main.html': ProblemsPage,
  'problem_detail.html': ProblemDetailPage,
  'problem_submit.html': ProblemDetailPage,
  'problem_edit.html': GenericPage,
  'problem_config.html': GenericPage,
  'problem_files.html': GenericPage,
  'problem_solution.html': GenericPage,
  'problem_statistics.html': GenericPage,
  'problem_import.html': GenericPage,

  // Contests
  'contest_main.html': ContestsPage,
  'contest_detail.html': ContestDetailPage,
  'contest_edit.html': GenericPage,
  'contest_scoreboard.html': ContestScoreboardPage,
  'contest_manage.html': GenericPage,
  'contest_problemlist.html': GenericPage,
  'contest_user.html': GenericPage,
  'contest_balloon.html': GenericPage,
  'contest_clarification.html': GenericPage,
  'contest_print.html': GenericPage,

  // Homework
  'homework_main.html': HomeworkPage,
  'homework_detail.html': HomeworkDetailPage,
  'homework_edit.html': GenericPage,
  'homework_files.html': GenericPage,

  // Training
  'training_main.html': TrainingPage,
  'training_detail.html': TrainingDetailPage,
  'training_edit.html': GenericPage,
  'training_files.html': GenericPage,

  // Discussions
  'discussion_main_or_node.html': DiscussionsPage,
  'discussion_detail.html': DiscussionDetailPage,
  'discussion_create.html': GenericPage,
  'discussion_edit.html': GenericPage,

  // Records
  'record_main.html': RecordsPage,
  'record_detail.html': RecordDetailPage,

  // Ranking
  'ranking.html': RankingPage,

  // Auth
  'user_login.html': LoginPage,
  'user_register.html': RegisterPage,
  'user_register_with_code.html': RegisterPage,
  'user_register_mail_sent.html': GenericPage,
  'user_logout.html': LogoutPage,
  'user_lostpass.html': LostPasswordPage,
  'user_lostpass_with_code.html': GenericPage,
  'user_sudo.html': GenericPage,
  'user_sudo_redirect.html': GenericPage,
  'user_delete_pending.html': GenericPage,
  'user_changemail_mail_sent.html': GenericPage,
  'contest_mode.html': GenericPage,

  // User pages
  'user_detail.html': UserDetailPage,
  'home_security.html': SecurityPage,
  'home_settings.html': SettingsPage,
  'home_domain.html': DomainsPage,
  'home_messages.html': MessagesPage,
  'home_files.html': FilesPage,

  // Domain admin
  'domain_create.html': GenericPage,
  'domain_dashboard.html': DomainDashboardPage,
  'domain_edit.html': GenericPage,
  'domain_user.html': GenericPage,
  'domain_user_raw.html': GenericPage,
  'domain_permission.html': GenericPage,
  'domain_role.html': GenericPage,
  'domain_group.html': GenericPage,
  'domain_join.html': GenericPage,
  'domain_join_applications.html': GenericPage,

  // System admin
  'manage_dashboard.html': ManageDashboardPage,
  'manage_script.html': GenericPage,
  'manage_setting.html': GenericPage,
  'manage_config.html': GenericPage,
  'manage_user_import.html': GenericPage,
  'manage_user_priv.html': GenericPage,

  // Misc
  'status.html': StatusPage,

  // Error pages
  'error.html': ErrorPage,
  'bsod.html': BsodPage,
};

export function PageResolver() {
  const bs = useBootstrap();
  const Component = PAGE_MAP[bs.page.templateName] || GenericPage;
  return <Component />;
}
