# ui-next coverage status

Live audit of which ui-default templates are covered by ui-next React pages.

## Tier A — Required for OJ completeness ✅

| ui-default template | Status | ui-next implementation |
|---|---|---|
| `domain_dashboard` | ✅ implemented | `pages/admin.tsx::DomainDashboardPage` |
| `domain_edit` | ✅ implemented | `pages/domain-manage.tsx::DomainEditPage` |
| `domain_user` | ✅ implemented | `pages/domain-manage.tsx::DomainUserPage` |
| `domain_user_raw` | ✅ implemented | `pages/domain-manage.tsx::DomainUserPage` (shared) |
| `domain_role` | ✅ implemented | `pages/domain-manage.tsx::DomainRolePage` |
| `domain_permission` | ✅ implemented | `pages/domain-manage.tsx::DomainPermissionPage` |
| `domain_group` | ✅ implemented | `pages/domain-manage.tsx::DomainGroupPage` (legacy) — note: superseded by krypton-userbind groups |
| `domain_join` | ✅ implemented | `pages/domain-misc.tsx::DomainJoinPage` |
| `domain_join_applications` | ✅ implemented | `pages/domain-misc.tsx::DomainJoinApplicationsPage` |
| `manage_dashboard` | ✅ implemented | `pages/admin.tsx::ManageDashboardPage` |
| `manage_setting` | ✅ implemented | `pages/system-manage.tsx::ManageSettingPage` |
| `manage_config` | ✅ implemented | `pages/system-manage.tsx::ManageConfigPage` |
| `manage_script` | ✅ implemented | `pages/system-manage.tsx::ManageScriptPage` |
| `manage_user_import` | ✅ implemented | `pages/system-manage.tsx::ManageUserImportPage` |
| `manage_user_priv` | ✅ implemented | `pages/system-manage.tsx::ManageUserPrivPage` |
| `home_messages` | ✅ folded | `pages/user-account.tsx::UserAccountPage` (`messages` tab) |
| `home_files` | ✅ folded | `pages/user-account.tsx::UserAccountPage` (`files` tab) |
| `problem_files` | ✅ implemented | `pages/problem-manage.tsx::ProblemFilesPage` |
| `problem_import` | ✅ implemented | `pages/problem-manage.tsx::ProblemImportPage` |
| `problem_import_fps` | ✅ implemented | `pages/plugin-pages.tsx::FpsImportPage` |
| `status` | ✅ implemented | `pages/admin.tsx::StatusPage` |
| `record_detail` | ✅ implemented | `pages/records.tsx::RecordDetailPage` (folds status + summary) |

## Tier B — Important per scenario ✅

| Template | Status | ui-next implementation |
|---|---|---|
| `contest_balloon` | ✅ implemented | `pages/contest-manage.tsx::ContestBalloonPage` |
| `contest_clarification` | ✅ implemented | `pages/contest-manage.tsx::ContestClarificationPage` |
| `contest_print` | ✅ implemented | `pages/contest-manage.tsx::ContestPrintPage` |
| `contest_user` | ✅ implemented | `pages/contest-manage.tsx::ContestUserPage` |
| `contest_scoreboard` | ✅ implemented | `pages/contests.tsx::ContestScoreboardPage` (download via existing export) |
| `xcpcio_board` | ✅ implemented | `pages/plugin-pages.tsx::XcpcioBoardPage` |
| `problem_solution` | ✅ implemented | `pages/problem-manage.tsx::ProblemSolutionPage` |
| `problem_statistics` | ✅ implemented | `pages/problem-manage.tsx::ProblemStatisticsPage` |

## Tier C — Edge ✅

| Template | Status | ui-next implementation |
|---|---|---|
| `home_security` | ✅ folded | `pages/user-account.tsx::UserAccountPage` (`security` tab) |
| `home_settings` | ✅ folded | `pages/user-account.tsx::UserAccountPage` (`settings` tab) |
| `homework_files` | ✅ implemented | `pages/homework-manage.tsx::HomeworkFilesPage` |
| `training_files` | ✅ implemented | `pages/training-manage.tsx::TrainingFilesPage` |
| `problem_config` | ✅ implemented | `pages/problem-manage.tsx::ProblemConfigPage` |
| `problem_submit` | ✅ folded | `pages/problem-detail.tsx::ProblemDetailPage` (submit in-page) |

## Krypton additions (Phase 1-3 new pages)

| Template | Implementation |
|---|---|
| `admin_userbind_*` (9 pages) | `pages/userbind/index.tsx` |
| `user_bind`, `user_bind_landing`, `user_bind_success`, `user_bind_claim` | `pages/userbind/index.tsx` |
| `admin_vigil_*` (4 pages) | `pages/vigil/index.tsx` |
| `exam_mode_home`, `exam_paper` | `pages/exam-mode/{index,paper}.tsx` |
| `_spike-webview` | `pages/spike-webview.tsx` |

## Admin nav coverage

All admin pages above are surfaced in the secondary admin sidebar via the
`admin-nav-registry`. Registration sources:

- Built-in Hydro pages → `lib/admin-nav-builtins.ts`
- krypton-userbind → `pages/userbind/index.tsx`
- krypton-vigil → `pages/vigil/index.tsx`

Add a new admin sub-feature by calling `registerAdminNavSection({...})` at
module load time from your page module.

## Open enhancements (post-Krypton 1.0)

- Inline scoreboard "download CSV/HTML" button (functional via existing `/export?as=html` URL, but no UI affordance yet)
- ui-default deletion (currently coexist; flag for removal one release after Krypton 1.0)
- Migrate `domain_group` page to redirect to `/admin/userbind/groups`
