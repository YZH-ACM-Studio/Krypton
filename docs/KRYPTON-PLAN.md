# Krypton Implementation Plan

> Companion to [`KRYPTON-PRD.md`](KRYPTON-PRD.md)
> Last updated: 2026-05-19

This plan breaks the four workstreams from the PRD into **Phases**, and within each Phase into **Issues** — units of work each small enough to land as a single PR (typically ≤500 LOC change, ≤2 days work).

Phases are sequential where required by dependencies, parallel where they aren't:

```
Phase 0  ──┐
            ├──► Phase 1 ──► Phase 2 ──► Phase 3
Phase 4  ──┘ (runs alongside Phases 1-3)
```

## Conventions

- **Branch naming**: `feat/p{phase}-{issue-slug}` (e.g. `feat/p1-userbind-schema`)
- **Each issue lists**: scope, key files, dependencies, verification, est. size
- **Size buckets**: S (≤1 day), M (1-3 days), L (3-7 days), XL (>1 week — should be split)
- **All PRs**: pass `bun run lint:ci`, relevant unit tests, and end-to-end smoke for the touched flow
- **Migrations**: every schema change ships its own upgrade step in `packages/hydrooj/src/upgrade.ts`; idempotent

---

## Phase 0 — Foundations & Spikes

Sets up infrastructure that the other phases depend on. **Must finish before Phase 1.**

### Issue 0.1 — Establish `/admin/*` shell in ui-next     [size: M]

**Why**: Tasks 2, 3, 4 all add admin pages. Without a shared shell each issue duplicates the layout, breadcrumbs, perms gate, and theme.

**Scope**:
- New route group `/admin` with a layout component (sidebar nav, content area, breadcrumbs)
- Permissions gate: redirects to `/auth` if not logged in; renders "Forbidden" panel if user lacks `PRIV_EDIT_SYSTEM` / configurable
- Sidebar registry pattern: each admin sub-feature registers its nav entry via a hook so Tasks 2/3/4 don't need to touch the layout component
- Initial children: a single `/admin` overview page listing available sub-modules

**Key files**:
- `packages/ui-next/src/routes/admin.tsx` (new — TanStack Router layout route)
- `packages/ui-next/src/components/layout/admin-sidebar.tsx` (new)
- `packages/ui-next/src/lib/admin-nav-registry.ts` (new)
- `packages/ui-next/src/pages/admin.tsx` (existing — re-purpose as `/admin` index)
- `packages/ui-next/src/router.tsx` (mount the layout)

**Verification**: Visiting `/admin` shows the shell; admin-protected page renders for an admin user, denies a regular user; sidebar registry accepts and displays entries from a smoke test consumer.

### Issue 0.2 — Upgrade step framework conventions    [size: S]

**Why**: Tasks 1 and 3 ship non-trivial migrations. Establish the pattern once.

**Scope**:
- Read `packages/hydrooj/src/upgrade.ts` and confirm the current step-array pattern
- Add a doc comment block at the top with conventions: idempotency, halt-on-error, progress logging, dry-run flag
- Add a helper `requireSettingFlag(name)` for "has this step run?" tracking using `system.settings`
- Add tests under `packages/hydrooj/test/upgrade.spec.ts`

**Key files**:
- `packages/hydrooj/src/upgrade.ts` (read + small additions)
- `packages/hydrooj/test/upgrade.spec.ts` (new)

**Verification**: New helper used in a trivial fake step; running upgrade twice does not double-execute.

### Issue 0.3 — Qt 6 + QWebEngineView + ui-next round-trip spike    [size: M]

**Why**: Phase 3 hinges on the Qt-WebView-ui-next bridge. Spike first to expose surprises (CSP, cookies, QWebChannel quirks) before the full integration begins.

**Scope**:
- Build a minimal Qt 6 app under `ecosystems/KryptonVigilSystem/Client/spike-webview/`
- Launches `QWebEngineView` loading `http://localhost:5173/spike` (ui-next dev server)
- Establishes `QWebChannel`: web can call `qt.ping()` and Qt receives; Qt can call `window.fromQt('hello')` and web receives
- Document any required Qt flags (e.g. `--remote-debugging-port`), CORS / cookie behavior, performance baseline

**Key files**:
- `ecosystems/KryptonVigilSystem/Client/spike-webview/` (new throwaway dir)
- `packages/ui-next/src/pages/_spike-webview.tsx` (new — gated to dev mode only)

**Verification**: Bidirectional ping documented; gotchas listed in `docs/spike-webview-notes.md`; team decides T1 still viable (no surprise blockers).

### Issue 0.4 — Service-token primitives    [size: S]

**Why**: Phase 3 needs both directions of inter-service auth. Keep token validation, multi-value support, and rotation hygiene in one place.

**Scope**:
- hydrooj side: a Koa middleware `requireServiceToken('vigil')` reading from system settings `vigil.acceptedTokens` (array) — used on Vigil-callable endpoints
- Vigil side: a FastAPI dependency `require_oj_token` reading from env `KVS_ACCEPTED_OJ_TOKENS` (comma-separated)
- Both: log token-id (first 8 chars) on accept; metrics counter on reject
- Doc: rotation procedure in `docs/service-tokens.md`

**Key files**:
- `packages/hydrooj/src/service/server.ts` (add middleware)
- `packages/hydrooj/src/lib/service-token.ts` (new)
- `ecosystems/KryptonVigilSystem/Server/app/security.py` (new)
- `docs/service-tokens.md` (new)

**Verification**: Unit tests for both: accept first token, accept second token, reject unknown, reject missing.

---

## Phase 1 — UserBind Refactor (Task 3)

**Depends on**: Phase 0 (admin shell, upgrade framework).

### Issue 1.1 — New package skeleton `packages/krypton-userbind`    [size: S]

**Scope**:
- New `packages/krypton-userbind/` with `package.json`, `tsconfig.json`, `src/index.ts` (empty plugin export), `README.md`
- Default-enable: add to default plugin set in install configuration
- Register as a Cordis plugin scaffold

**Key files**:
- `packages/krypton-userbind/package.json`
- `packages/krypton-userbind/src/index.ts`
- `install/setup.ts` (or wherever default-enabled list lives — discover during impl)

**Verification**: `bun run start` shows plugin loaded; no routes yet.

### Issue 1.2 — Data model definitions + collection declarations    [size: S]

**Scope**:
- `src/types.ts`: TypeScript interfaces from PRD §3.3 (`School`, `UserGroup`, `StudentRecord`, `BindToken`, `BindingRequest`)
- `src/model.ts`: collection declarations with indexes (`{domainId,name}` unique on schools, etc.)
- Module augmentation extending hydrooj's `Collections` and `UserDocument` interfaces

**Key files**:
- `packages/krypton-userbind/src/types.ts`
- `packages/krypton-userbind/src/model.ts`

**Verification**: TS compiles; running OJ creates indexes; nothing else.

### Issue 1.3 — School & UserGroup CRUD model methods    [size: M]

**Scope**:
- `createSchool`, `listSchools`, `updateSchool`, `deleteSchool` (refuses delete if students exist)
- `createUserGroup`, `listUserGroups`, `updateUserGroup`, `deleteUserGroup`
- All scope by `domainId`
- Unit tests under `packages/krypton-userbind/test/school.spec.ts`, `group.spec.ts`

**Key files**:
- `packages/krypton-userbind/src/model.ts` (extend)
- `packages/krypton-userbind/test/*`

**Verification**: All CRUD round-trips passing; cross-domain isolation tested (same name allowed in different domains).

### Issue 1.4 — StudentRecord CRUD + bulk import    [size: M]

**Scope**:
- `importStudents(domainId, schoolId, rows)` — accepts list of `{studentId, realName}`; returns insert/dupe report
- `listStudents(domainId, filter)` — paginated, filter by school / group / boundUserId presence
- `assignStudentsToGroup(domainId, groupId, studentRecordIds)`
- Validation: studentId unique within `(domainId, schoolId)`

**Key files**:
- `packages/krypton-userbind/src/model.ts` (extend)
- `packages/krypton-userbind/test/student.spec.ts`

**Verification**: Bulk insert of 1000 students <500ms; duplicate detection accurate; cross-school same-id allowed.

### Issue 1.5 — Binding paths ① and ②    [size: M]

**Scope**:
- `generateInviteToken`, `consumeInviteToken` (path ①)
- `submitBindingRequest`, `approveBindingRequest`, `rejectBindingRequest` (path ②)
- On bind: update `User.realName`, `User.studentId`, `User.parentSchoolId`, `User.parentUserGroupId`; set `StudentRecord.boundUserId`

**Key files**:
- `packages/krypton-userbind/src/model.ts` (extend)
- `packages/krypton-userbind/test/bind.spec.ts`

**Verification**: Both paths bind correctly; double-bind rejected; token reuse rejected; request lifecycle (pending → approved/rejected) enforced.

### Issue 1.6 — `lookupStudent` + temporary-account claim    [size: M]

**Scope**:
- `lookupStudent(domainId, studentId, realName)` — the contract Phase 3 depends on. Returns `{found, userId?, eligibleContestIds, reason}`
- `eligibleContestIds` computed by joining StudentRecord.groupIds to contests where `participantGroupIds ∋ groupId` and contest is exam-rule (Task 1) — for now stub `eligibleContestIds=[]` until Task 1 lands the field
- `claimTemporaryAccount(tempUid, realUid)` — atomic; uses a MongoDB session if the cluster supports transactions, else a recovery-log strategy

**Key files**:
- `packages/krypton-userbind/src/model.ts` (extend)
- `packages/krypton-userbind/test/lookup.spec.ts`
- `packages/krypton-userbind/test/claim.spec.ts`

**Verification**: `lookupStudent` returns correct reason codes; claim transfers all records, contest tsdocs, marks temp user disabled; under simulated failure mid-claim, recovery log is sound.

### Issue 1.7 — Admin handlers + routes    [size: M]

**Scope**: Hydrooj-side routes for all admin operations:
- `/api/admin/userbind/schools` (CRUD)
- `/api/admin/userbind/groups` (CRUD)
- `/api/admin/userbind/students` (list, import)
- `/api/admin/userbind/tokens` (generate, list, revoke)
- `/api/admin/userbind/requests` (list, approve, reject)

**Key files**:
- `packages/krypton-userbind/src/handler.ts` (new)
- `packages/krypton-userbind/src/index.ts` (wire routes)

**Verification**: HTTP integration tests for each route; perms enforced (`PRIV_EDIT_SYSTEM`).

### Issue 1.8 — Student-facing handlers + routes    [size: S]

**Scope**:
- `/user/bind` (path ② form), `/bind/:token` (path ① landing), `/user/bind/claim` (claim form)
- `before-prepare` hook enforcing bind for students in domains with `userbind.forceBind=true`

**Key files**:
- `packages/krypton-userbind/src/handler.ts` (extend)
- `packages/krypton-userbind/src/index.ts` (hook)

**Verification**: Forced-bind redirect tested; whitelist of bypass routes (login, bind itself) tested.

### Issue 1.9 — ui-next admin pages    [size: L]

**Scope**: All `/admin/userbind/*` pages listed in PRD §3.9.
- Schools list + create/edit modal
- Groups list, group detail
- Students table with filters + bulk import dialog
- Token list with bulk-generate dialog
- Request review queue with approve/reject + reason input

**Key files**:
- `packages/ui-next/src/pages/admin/userbind/*` (new)
- `packages/ui-next/src/lib/userbind-api.ts` (new — typed fetch client)

**Verification**: Each page exercises all admin operations from §1.7; visual review against shadcn/ui conventions.

### Issue 1.10 — ui-next student pages    [size: M]

**Scope**: `/user/bind`, `/bind/:token`, `/user/bind/claim`

**Key files**:
- `packages/ui-next/src/pages/user/bind.tsx`, `pages/bind/$token.tsx`, `pages/user/bind/claim.tsx`

**Verification**: Each binding path completes end-to-end from the ui-next pages.

### Issue 1.11 — Data migration upgrade step    [size: L]

**Scope**: Implement PRD §3.7. Dry-run flag, CSV report for `groupType=1` ambiguities, idempotent (writes `userbind.migration_v1_done`).

**Key files**:
- `packages/hydrooj/src/upgrade.ts` (add step)
- `packages/krypton-userbind/src/migration.ts` (new — the actual work)
- `packages/krypton-userbind/test/migration.spec.ts`

**Verification**:
- Spin up a MongoDB fixture loaded with a snapshot of real CAUCOJUserBind data
- Run migration; assert all collections created, all relationships preserved
- Run migration again; assert no double-insert
- Run with intentionally ambiguous `groupType=1` data; assert CSV report written and step halts with operator-actionable error

### Issue 1.12 — Legacy route redirects + retirement    [size: S]

**Scope**: Old `/user-bind/*`, `/school-group/*`, etc. routes return 410 Gone or 302 redirect (admin chooses via system setting). The plugin's own files **stay in** `dev/CAUCOJUserBind` during alpha — nothing imports them.

**Key files**:
- `packages/krypton-userbind/src/legacy-redirects.ts` (new)
- `packages/krypton-userbind/src/index.ts` (wire)

**Verification**: Each old route either 410s or 302s to its new equivalent; nunjucks templates **not** rendered.

### Issue 1.13 — Cross-domain export/import    [size: M]

**Scope**: PRD §3.8 — `exportDomain`, `importDomain` model methods; `hydrooj userbind:export` / `:import` CLI commands; `/admin/userbind/migrate` UI page.

**Key files**:
- `packages/krypton-userbind/src/model.ts` (extend)
- `packages/krypton-userbind/src/cli.ts` (new — commander integration)
- `packages/ui-next/src/pages/admin/userbind/migrate.tsx`

**Verification**: Export from one domain, import to another with each conflict policy (skip / overwrite / error); validate row counts and uniqueness.

### Phase 1 exit criteria

- All Tier-A acceptance scenarios in PRD §3.10 pass
- Old plugin in `dev/CAUCOJUserBind` no longer loaded (verified by grep on hydrooj startup logs)
- Migration step verified against the real production dataset snapshot in staging

---

## Phase 2 — Paper Workflow & Question Types (Task 1)

**Depends on**: Phase 1 — needs `UserGroup` model and `lookupStudent` (for `participantGroupIds` resolution in exam rule).

### Issue 2.1 — Extend `ProblemType` + `ProblemConfigFile`    [size: S]

**Scope**: PRD §1.3.1 and §1.3.2 type additions.

**Key files**:
- `packages/common/types.ts` (extend enum + config interfaces)
- Search for downstream type-narrowing on `ProblemType` and update exhaustive switches

**Verification**: TS compile clean; all `switch (type)` sites either handle `FillFunction` or have explicit `default` fallback.

### Issue 2.2 — `objective` question-kind inference + storage    [size: M]

**Scope**:
- New normalizer in `packages/hydrooj/src/lib/problem-config.ts` (new file or extension of existing): given a `Pdoc.config`, walk `answers` and return `{ key -> kind }` map (using PRD §1.3.2 inference rules + explicit override)
- Problem-edit handler accepts and persists explicit `kind` overrides
- judger remains unchanged (current `objective.ts` already correctly handles both array and string standard answers)

**Key files**:
- `packages/hydrooj/src/lib/problem-config.ts` (new)
- `packages/hydrooj/src/handler/problem.ts` (accept kind on edit)
- `packages/hydrooj/test/problem-config.spec.ts`

**Verification**: Inference matches §1.3.2 spec; explicit override persisted and round-trips.

### Issue 2.3 — `fill_function` problem type — backend judger    [size: L]

**Scope**:
- New file `packages/hydrojudge/src/judge/fill_function.ts`
- Splicing algorithm from PRD §1.7: takes the submitted `{regionId -> content}` map and the template + regions metadata, produces a single full source file, hands off to the existing `default` judge flow
- Pre-splice validation: regions present, none missing, none extra, content size limits per region

**Key files**:
- `packages/hydrojudge/src/judge/fill_function.ts` (new)
- `packages/hydrojudge/src/judge/index.ts` (register)
- `packages/hydrojudge/test/fill_function.spec.ts`

**Verification**: Sample fill_function problem with 2 regions; submission produces spliced source that compiles; judging against testcases yields expected verdicts.

### Issue 2.4 — `fill_function` problem-edit handler + storage    [size: M]

**Scope**:
- Problem-edit accepts `config.template` and `config.regions` JSON
- Computes `sourceHash` on save
- Validates regions: non-overlapping, in bounds, ids unique

**Key files**:
- `packages/hydrooj/src/handler/problem.ts` (extend POST handler)
- `packages/hydrooj/src/model/problem.ts` (validation)
- `packages/hydrooj/test/problem-edit-fill-function.spec.ts`

**Verification**: Round-trip create/update with regions; validation rejects overlapping/out-of-bounds; sourceHash present and stable.

### Issue 2.5 — `exam` contest rule registration    [size: M]

**Scope**:
- Build new rule via `buildContestRule(...)` and register in `RULES` table
- Define scoreboard, statusSort, applyProjection callbacks (mostly mirroring `oi` rule but with paper-style record presentation)
- Add `ExamRuleConfig` fields to `Tdoc`

**Key files**:
- `packages/hydrooj/src/model/contest.ts` (extend)
- `packages/hydrooj/test/contest-exam.spec.ts`

**Verification**: Creating an exam-rule contest works via existing contest-create handler with new rule param; standard scoreboard rendering works; perms enforced (`PERM_ATTEND_CONTEST`).

### Issue 2.6 — `vigil.paper_draft` collection + model methods    [size: M]

**Scope**:
- Collection declaration + indexes
- Methods: `upsertDraft(...)`, `getDraftsForUser(tid, uid)`, `lockKind(tid, uid, pid, kind)`, `clearDrafts(tid, uid)`
- Idempotent upsert via `findOneAndUpdate` with `$set`

**Key files**:
- `packages/hydrooj/src/model/paper-draft.ts` (new)
- `packages/hydrooj/test/paper-draft.spec.ts`

**Verification**: 100 concurrent upserts on same key → one final value; no duplicate docs; race-condition test under load.

### Issue 2.7 — Lock-on-begin invariant    [size: M]

**Scope**:
- Modify `problem.ts` model methods: `edit`, `setConfig`, etc. — accept a `bypassExamLock` superadmin flag; otherwise reject if any in-progress or upcoming exam-rule contest references this pid
- Force-unlock endpoint with double-confirm + rejudge orchestration

**Key files**:
- `packages/hydrooj/src/model/problem.ts` (extend)
- `packages/hydrooj/src/handler/problem.ts` (force-unlock route)
- `packages/hydrooj/src/handler/admin.ts` or new admin handler
- `packages/hydrooj/test/lock-on-begin.spec.ts`

**Verification**: Edit attempt during exam blocked; force-unlock + rejudge cascade works on test fixture.

### Issue 2.8 — Paper handler API    [size: L]

**Scope**: All PRD §1.8 routes.
- Auth: `PERM_ATTEND_CONTEST` + time-window check
- `submit-code/:pid`: dispatch immediately (default and fill_function); record contest.tid
- `finalize`: walk drafts → build records → for objective, assemble YAML format compatible with existing `objective.ts` judger
- Time-window scheduler: `endAt` callback uses `packages/hydrooj/src/service/worker.ts` or `schedule` service

**Key files**:
- `packages/hydrooj/src/handler/paper.ts` (new)
- `packages/hydrooj/src/service/paper-scheduler.ts` (new — for time-expiry auto-finalize)
- `packages/hydrooj/test/paper-handler.spec.ts`

**Verification**: Full lifecycle integration test: draft save → lock kind → submit code → finalize → records exist with correct verdicts.

### Issue 2.9 — `exam-mode` ui-next route shell    [size: M]

**Scope**:
- New layout route `/exam-mode` with minimal chrome (no nav, no breadcrumbs, no theme toggle — just exam context + timer + identity badge)
- Index page: card grid of eligible exam contests for current user
- Auth: refuses unauthenticated; redirects to /auth

**Key files**:
- `packages/ui-next/src/routes/exam-mode.tsx` (new)
- `packages/ui-next/src/pages/exam-mode/index.tsx` (new)
- `packages/ui-next/src/router.tsx` (mount)

**Verification**: Visiting `/exam-mode` while logged in shows card grid sourced from `GET /api/user/exams`.

### Issue 2.10 — Paper UI: tab bar + cell navigator    [size: L]

**Scope**:
- `pages/exam-mode/paper.tsx` — full answer sheet view
- Computes tabs from PRD §1.4 cell-aggregation logic
- Left navigator: numeric grid per tab; click jumps to cell
- Tab badge counts and status indicators (answered/unanswered/locked)

**Key files**:
- `packages/ui-next/src/pages/exam-mode/paper.tsx` (new)
- `packages/ui-next/src/components/paper/tab-bar.tsx`, `cell-navigator.tsx` (new)
- `packages/ui-next/src/lib/paper-aggregation.ts` (new — cell computation)

**Verification**: Fixture paper with mixed kinds → tab counts and ordering match spec; click navigates correctly.

### Issue 2.11 — Per-kind question renderers    [size: L]

**Scope**:
- `components/question/single-choice.tsx` — radio
- `components/question/multi-choice.tsx` — checkbox
- `components/question/blank.tsx` — input
- `components/question/fill-program.tsx` — code-snippet text area
- Each emits change events into a shared draft store hook
- Locked state: read-only render

**Key files**:
- `packages/ui-next/src/components/question/*` (new)
- `packages/ui-next/src/hooks/use-paper-draft.ts` (new — local state + remote sync)

**Verification**: Each renderer round-trips an answer; locked state shows read-only; visual regression against shadcn/ui look.

### Issue 2.12 — fill_function visual region editor    [size: XL — split below]

This issue must be split. Subdivision:

**2.12a — Region editor core**    [size: L]

**Scope**:
- `components/region-editor.tsx` — CodeMirror 6 host
- Loads `template.source` + `regions[]`
- Uses `EditorState.transactionFilter` to block edits outside any region
- Read-only ranges rendered with subtle dimming

**Key files**:
- `packages/ui-next/src/components/region-editor.tsx` (new)
- `packages/ui-next/test/region-editor.spec.tsx`

**Verification**: Edits inside region pass; edits outside dropped; multi-region case works; line-count changes inside region don't corrupt other regions' anchors (handled by submission-time splice on canonical pre-edit source — anchors are stored against template.source, not against the live view)

**2.12b — Teacher authoring mode**    [size: M]

**Scope**: Teacher can select a range and mark it as a region; assigns id; saves to `Pdoc.config.regions`.

**Key files**: Extend `pages/problem-edit.tsx` with a fill_function-specific config panel.

**Verification**: Author a fill_function problem end-to-end; save; reload; regions persist.

### Issue 2.13 — Programming-problem submit-from-paper flow    [size: M]

**Scope**: "Submit programming problem" button in paper UI. Sends draft `code` + `lang` to `/paper/submit-code/:pid`; shows verdict via existing record subscription. For fill_function: client sends `{regionId -> content}`; server splices.

**Key files**:
- `packages/ui-next/src/pages/exam-mode/paper.tsx` (extend)
- Hook into existing record-stream WebSocket from current `pages/records.tsx`

**Verification**: Submit code → record shows up in panel → verdict updates → no impact on objective drafts.

### Issue 2.14 — Lock-a-kind UI + final submit    [size: M]

**Scope**:
- "Submit this kind" button in each tab
- Modal confirm with "you can't edit these answers after lock"
- Final submit button at top of paper
- Idempotent: refreshing the page after final submit shows the submitted state, not the paper editor

**Key files**:
- `packages/ui-next/src/pages/exam-mode/paper.tsx` (extend)
- `packages/ui-next/src/components/paper/submit-bar.tsx` (new)

**Verification**: Lock a kind → questions in that tab become read-only; final submit → records created; reload → page shows submitted state with per-problem verdicts.

### Issue 2.15 — Countdown timer + auto-submit    [size: S]

**Scope**:
- React countdown component sourced from contest.endAt
- On reaching 0, fires `finalize` API call automatically
- Server-side scheduler tasks (Issue 2.8) provide tolerance for clock skew

**Key files**:
- `packages/ui-next/src/components/paper/countdown.tsx` (new)
- `packages/ui-next/src/hooks/use-clock-sync.ts` (new — periodic server-time check)

**Verification**: Short test contest → client triggers finalize; even when client closed, server scheduler triggers within seconds of endAt.

### Issue 2.16 — Predefined `exam/draft-update` event hook    [size: S]

**Scope**: Define event in `packages/hydrooj/src/service/bus.ts` (or wherever bus types live). Fire on every draft upsert. No listeners shipped in this phase.

**Key files**:
- `packages/hydrooj/src/service/bus.ts` (extend types)
- `packages/hydrooj/src/model/paper-draft.ts` (emit)

**Verification**: Add a test-only listener; verify it fires on each upsert.

### Phase 2 exit criteria

- Acceptance scenarios in PRD §1.9 pass
- Performance: 50 concurrent students saving every 1s sustains for 10 minutes with <50ms p95 save latency

---

## Phase 3 — Vigil Integration (Task 2)

**Depends on**: Phases 1 and 2.

### Issue 3.1 — Vigil schema migration: ExamSession + evidence FKs + OjContest + ApprovalRequest    [size: M]

**Scope**: PRD §2.4 schema changes. Alembic migration step under `Server/app/migrations/`. Drop `ClientEnrollment`. Rename `external_exam_id` → `oj_contest_id`.

**Key files**:
- `ecosystems/KryptonVigilSystem/Server/app/models.py` (rewrite affected models)
- `ecosystems/KryptonVigilSystem/Server/app/migrations/0002_three_layer_identity.py` (new)
- `ecosystems/KryptonVigilSystem/Server/tests/test_models.py` (extend)

**Verification**: Existing data migrated; new fields populated with sensible defaults; FKs nullable for legacy rows.

### Issue 3.2 — Service-token middleware (Vigil and OJ)    [size: S]

**Scope**: Apply Issue 0.4 primitives to both sides for the integration endpoints. Document accepted-tokens list mechanism.

**Key files**:
- `ecosystems/KryptonVigilSystem/Server/app/api/oj_integration.py` (new — uses `require_oj_token`)
- `packages/hydrooj/src/handler/vigil-integration.ts` (new — uses `requireServiceToken('vigil')`)

**Verification**: Calls without token rejected; with old token still accepted during rotation window.

### Issue 3.3 — OJ → Vigil push: contest create + delete    [size: M]

**Scope**:
- On `exam`-rule contest create/edit/delete in hydrooj, fire async webhook to Vigil's `POST /api/integrations/oj/exam` or `DELETE`
- Retry with exponential backoff if Vigil unreachable
- Lazy fallback: implemented in Issue 3.4 (`lookup-student` returns full contest data so Vigil can upsert on demand)

**Key files**:
- `packages/hydrooj/src/handler/contest.ts` (hook)
- `packages/hydrooj/src/service/vigil-bridge.ts` (new — outbound HTTP client)
- `ecosystems/KryptonVigilSystem/Server/app/api/oj_integration.py` (implement endpoint)

**Verification**: Create exam contest → OjContest appears in Vigil; delete → removed; if Vigil offline at create-time, retried until success.

### Issue 3.4 — `lookup-student` integration end-to-end    [size: M]

**Scope**:
- hydrooj endpoint `POST /api/vigil/lookup-student` invoking `userbind.lookupStudent`
- Vigil consumes from `/api/ws/clients/{client_id}`'s `login_request` message handler
- Push `eligibleExams` payload includes full OjContest fields so Vigil can lazy-cache

**Key files**:
- `packages/hydrooj/src/handler/vigil-integration.ts` (extend)
- `ecosystems/KryptonVigilSystem/Server/app/services/login_flow.py` (new)
- `ecosystems/KryptonVigilSystem/Server/app/api/routes.py` (extend ws handler)

**Verification**: Client login flow lands a real OjContest entry on the Vigil side when Vigil hadn't been pre-pushed (lazy fallback path).

### Issue 3.5 — Approval queue (Vigil-side data + WebSocket fanout)    [size: M]

**Scope**:
- `ApprovalRequest` create + update endpoints
- Dashboard WebSocket gets new `approval_request_added` / `approval_request_updated` messages
- Approve handler optionally invokes `temporary-user` creation on the OJ side

**Key files**:
- `ecosystems/KryptonVigilSystem/Server/app/services/approval.py` (new)
- `ecosystems/KryptonVigilSystem/Server/app/api/routes.py` (extend dashboard ws message types)

**Verification**: Unit + e2e: login_request → ApprovalRequest created → dashboard receives push → approve via API → ExamSession created.

### Issue 3.6 — Temporary-user creation endpoint    [size: S]

**Scope**: OJ endpoint `POST /api/vigil/temporary-user` creates `User` doc with `isTemporary=true`, no password, generates one-shot access token.

**Key files**:
- `packages/hydrooj/src/handler/vigil-integration.ts` (extend)
- `packages/hydrooj/src/model/user.ts` (extend with `createTemporary`)

**Verification**: Temp user created; cannot log in via password; one-shot token consumable exactly once.

### Issue 3.7 — Access-token exchange    [size: M]

**Scope**:
- `POST /api/vigil/exchange-access-token` accepts the opaque token, validates with Vigil (cross-server call), issues real OJ cookie session
- Token format: opaque random string; Vigil stores `{token: sessionId}` map in memory + redis; expires per PRD §2.10 phase 2 step 9

**Key files**:
- `packages/hydrooj/src/handler/vigil-integration.ts` (extend)
- `ecosystems/KryptonVigilSystem/Server/app/services/access_tokens.py` (new)

**Verification**: Token-exchange round-trip works; expired token rejected; replay rejected.

### Issue 3.8 — Qt Client: derive machine_id, login dialog, WS message types    [size: L]

**Scope**:
- `core/config_manager.cpp`: on first boot, compute hashed machineUniqueId and persist as `client_id` (rename JSON field to `machine_id` while accepting old key as fallback for compat)
- New `app/login_window.{h,cpp}` widget
- `network/server_connection.cpp`: handle `session_opened`, `session_closed`, `proctor_command` messages

**Key files**:
- `ecosystems/KryptonVigilSystem/Client/core/config_manager.{h,cpp}`
- `ecosystems/KryptonVigilSystem/Client/app/login_window.{h,cpp}` (new)
- `ecosystems/KryptonVigilSystem/Client/network/server_connection.cpp`
- `ecosystems/KryptonVigilSystem/Client/CMakeLists.txt`

**Verification**: Build on macOS/Linux/Windows; login dialog reachable; WS messages dispatched correctly.

### Issue 3.9 — Qt Client: QWebEngineView host + bridge    [size: L]

**Scope**:
- New `app/exam_webview.{h,cpp}` housing QWebEngineView
- `QWebChannel` exposes `qt.notifyExamSubmitted`, `qt.requestExit`, `qt.reportEvent`
- Webview lifecycle: open on session_opened, close on session_closed, recover after reconnect (using cached sessionId)

**Key files**:
- `ecosystems/KryptonVigilSystem/Client/app/exam_webview.{h,cpp}` (new)
- `ecosystems/KryptonVigilSystem/Client/CMakeLists.txt` (add Qt6::WebEngineWidgets, Qt6::WebChannel)

**Verification**: Spike from Issue 0.3 extended; full integration with `/exam-mode` works.

### Issue 3.10 — Qt Client: lockdown mode platform impls    [size: L]

**Scope**:
- New `monitor/lockdown_{windows,macos,linux}.cpp` siblings
- Hook system hotkeys: Alt+Tab, Win+D / Cmd+Tab, Ctrl+Esc, etc. Block when active
- Allow OS-modal whitelist (system credentials prompts)

**Key files**:
- `ecosystems/KryptonVigilSystem/Client/monitor/lockdown.{h,cpp}` + platform files (new)

**Verification**: On each OS: lockdown active → hotkeys captured (verify with test harness); lockdown off → no impact.

### Issue 3.11 — Vigil dashboard ui-next port (Tier A pages)    [size: XL — split]

This is large because it's the Dashboard absorption. Split into:

**3.11a — `vigil-api.ts` + `use-vigil-socket.ts`**    [size: M]

**Scope**: Typed REST client + WebSocket hook. Token sourced from `/api/admin/vigil/dashboard-token` (new OJ endpoint).

**Key files**:
- `packages/ui-next/src/lib/vigil-api.ts` (new)
- `packages/ui-next/src/hooks/use-vigil-socket.ts` (new)
- `packages/hydrooj/src/handler/vigil-integration.ts` (add dashboard-token endpoint)

**3.11b — Overview + ClientTable + EventList ports**    [size: L]

**Scope**: Port the three highest-value components from Vigil Dashboard to ui-next.

**Key files**:
- `packages/ui-next/src/pages/admin/vigil/overview.tsx`
- `packages/ui-next/src/components/vigil/client-table.tsx`
- `packages/ui-next/src/components/vigil/event-list.tsx`

**3.11c — ExamSession views + approvals + machine detail**    [size: L]

**Scope**: New views for the three-layer-identity model.

**Key files**:
- `packages/ui-next/src/pages/admin/vigil/exam-sessions.tsx`
- `packages/ui-next/src/pages/admin/vigil/session-detail.tsx`
- `packages/ui-next/src/pages/admin/vigil/approvals.tsx`
- `packages/ui-next/src/pages/admin/vigil/machine-detail.tsx`

**3.11d — Screenshots + retention + remaining**    [size: M]

**Scope**: Port remaining views; delete `ecosystems/KryptonVigilSystem/Dashboard/` after this lands.

### Issue 3.12 — Proctor commands: force_submit, force_close, transfer_machine    [size: M]

**Scope**:
- Vigil endpoints for each command; persist as `Command` + `ClientEvent`
- OJ-side handlers for `force_submit` (drives paper finalize) and `transfer_machine` (closes old ExamSession, allows new)
- ui-next buttons + confirm dialogs in session-detail.tsx

**Key files**:
- `ecosystems/KryptonVigilSystem/Server/app/api/proctor_commands.py` (new)
- `packages/hydrooj/src/handler/vigil-integration.ts` (extend)
- `packages/ui-next/src/pages/admin/vigil/session-detail.tsx` (extend)

**Verification**: Each command exercised end-to-end; high-severity events recorded; transfer-machine preserves elapsed time.

### Issue 3.13 — Session lifecycle: close + scheduled close-on-timeout    [size: M]

**Scope**:
- On `paper.finalize` completion, OJ calls `POST /api/integrations/oj/exam/:tid/close-session`
- Vigil scheduler closes any active session at `endAt+graceMin`
- Qt receives `session_closed` → closes webview

**Key files**:
- `packages/hydrooj/src/handler/paper.ts` (extend Issue 2.8)
- `ecosystems/KryptonVigilSystem/Server/app/services/session_lifecycle.py` (new)

**Verification**: Submit → session closed within 1s; timeout → all open sessions closed within graceMin.

### Issue 3.14 — Network reconnect handling    [size: M]

**Scope**:
- Qt: cached sessionId persisted; on Vigil reconnect, send `session_resume` message
- Vigil: validates sessionId is still active; if yes, re-emits `session_opened` to relaunch webview state; if not, falls back to login dialog
- Webview: handles 401 by re-fetching access token via Qt bridge

**Key files**:
- `ecosystems/KryptonVigilSystem/Client/network/server_connection.cpp` (extend)
- `ecosystems/KryptonVigilSystem/Server/app/api/routes.py` (extend ws handler)

**Verification**: Kill network for 30s → on reconnect, exam state restored without re-approval.

### Issue 3.15 — Lockdown opt-in + pauseOnDisconnect    [size: S]

**Scope**: Wire contest config fields to Qt behavior. Document UX in exam-create form per PRD §2.11.

**Key files**:
- `packages/ui-next/src/pages/contest-manage.tsx` (extend; copy text per PRD §2.11)
- `packages/hydrooj/src/model/contest.ts` (extend ExamRuleConfig)
- Qt: consume settings from `OjContest` payload on session_opened

**Verification**: Toggling lockdown in contest config changes client behavior on next session start.

### Phase 3 exit criteria

- All PRD §2.11 acceptance scenarios pass
- A full closed-beta exam runs end-to-end without manual intervention

---

## Phase 4 — ui-next Coverage Sweep (Task 4)

**Runs in parallel** with Phases 1-3 starting after Phase 0. Issues are independent and can be picked up out of order.

### Tier A issues

Each issue is roughly size M unless noted. Page list:

| Issue | Pages | Notes |
|---|---|---|
| 4.A.1 | `/admin/domain/users`, `/admin/domain/roles`, `/admin/domain/permissions` | Largest of A — domain mgmt triad. Size L |
| 4.A.2 | `/domain/:id/join`, `/admin/domain/applications` | Apply + queue |
| 4.A.3 | `/admin/system/users/import`, `/admin/system/users/priv` | Bulk import + priv editor |
| 4.A.4 | `/user/messages` | Inbox view; integrate with existing `message` model |
| 4.A.5 | `/user/files` | Personal storage; ties into S3 backend via `service/storage.ts` |
| 4.A.6 | `/p/:pid/files` | Problem files / testdata UI |
| 4.A.7 | `/admin/problems/import` | FPS / QDU / zip importer UI |
| 4.A.8 | `/status` | Judge daemons list; consume from `/api/status` |
| 4.A.9 | Record detail enhancements | Fold `record_detail_status` and `record_detail_summary` into existing `pages/records.tsx` detail view |

### Tier B issues

| Issue | Pages | Notes |
|---|---|---|
| 4.B.1 | `/c/:tid/clarifications` | Q&A — needed by exam scenarios too |
| 4.B.2 | `/c/:tid/participants` | Proctor name list |
| 4.B.3 | Scoreboard export button | Single component change |
| 4.B.4 | `/p/:pid/solutions` | Editorial |
| 4.B.5 | `/p/:pid/stats` | Submission distribution |
| 4.B.6 | `/c/:tid/balloons` | Skipped unless ACM scenario green-lit; stub with feature flag |

### Tier C issues

| Issue | Pages |
|---|---|
| 4.C.1 | `/user/security` |
| 4.C.2 | `/h/:tid/files`, `/t/:tid/files` |
| 4.C.3 | Verify `problem_config` / `problem_submit` are folded into existing pages; fix gaps if any |

### Coverage tracking

- New file `docs/ui-next-coverage.md` enumerates every ui-default template with status: covered / planned / skipped
- Each Phase-4 PR updates this table

---

## Milestones & Schedule (rough)

| Milestone | Phase coverage | Calendar feel |
|---|---|---|
| M1: foundations done | Phase 0 (4 issues) | ~1 week |
| M2: UserBind alpha | Phases 0 + 1 issues 1.1–1.6 | +2 weeks |
| M3: UserBind beta | Phase 1 complete | +1.5 weeks |
| M4: Paper alpha (no Vigil) | Phase 2 issues 2.1–2.12a | +3 weeks |
| M5: Paper beta | Phase 2 complete | +1.5 weeks |
| M6: Vigil integration alpha | Phase 3 issues 3.1–3.10 | +3 weeks |
| M7: Vigil integration beta | Phase 3 complete | +2 weeks |
| M8: Krypton 1.0 release | All phases + Tier A of Phase 4 | +1 week |

(Phase 4 Tier B/C work continues post-1.0 as ongoing.)

Rough total wall-clock: ~3 months single dev, ~6-8 weeks with 2-3 devs working in parallel (Phase 4 picked up by a dedicated frontend track).

## Tracking & process

- One issue per PR; PR description references the plan issue id (e.g., "Plan: P2.6")
- Daily standup (or async equivalent) walks the plan-issue board
- Each phase exits via a checklist that maps 1:1 to the acceptance criteria in the PRD
- Risks tracked in `docs/RISKS.md`; updated as discoveries land
- A `docs/decisions/` directory captures any plan deviations as short ADRs

## Hand-off

When this plan is in motion, the following resources should exist:
- `docs/KRYPTON-PRD.md` (this directory)
- `docs/KRYPTON-PLAN.md` (this file)
- `docs/spike-webview-notes.md` (after Phase 0)
- `docs/service-tokens.md` (after Phase 0)
- `docs/ui-next-coverage.md` (live during Phase 4)
- `docs/RISKS.md` (live)
- `docs/decisions/` (live)

Every PR landing on `master` should leave these in a self-consistent state.
