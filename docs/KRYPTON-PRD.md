# Krypton PRD

> Status: design-frozen, ready for implementation
> Last updated: 2026-05-19

This document is the consolidated product specification for four interlocking workstreams on the Krypton fork of Hydro OJ:

1. **Paper workflow & question types** — exam-style answer sheet with multi-kind questions, drafts, classed submission, and visual function-completion editor
2. **Vigil integration** — wire the KryptonVigilSystem anti-cheat into the OJ as a first-class admin surface, with three-layer identity and full exam lifecycle
3. **UserBind refactor** — rewrite the `CAUCOJUserBind` plugin into a clean built-in module with domain awareness and migration tooling
4. **ui-next coverage** — fill the page gaps that exist between `ui-default` (legacy) and `ui-next` (new SPA)

Each section is self-contained but cross-references the others. The implementation plan (sequencing, file touch points, milestones) lives in [`KRYPTON-PLAN.md`](KRYPTON-PLAN.md).

---

## 0. Architecture & Cross-Cutting

### 0.1 System diagram (target state)

```
                                              ┌──────────────────────┐
                                              │   Qt 6 Client         │
                                              │   (machine 端)        │
                                              │                       │
                                              │  - 学号姓名登录       │
                                              │  - WebView 嵌入       │
                                              │    exam-mode UI       │
                                              │  - 监控/截图/进程     │
                                              │  - lockdown 拦截      │
                                              └─────────┬────────────┘
                                                        │ WS/HTTP
                                                        │ X-KVS-Token
                                                        ▼
┌──────────────────────────────┐   双向 service token  ┌──────────────────────┐
│      hydrooj (Koa)            │ ◄────────────────►  │   Vigil Server        │
│                               │   KVS_OJ_TOKEN /    │   (FastAPI)           │
│  - 用户/题目/比赛/记录        │   KVS_VIGIL_TOKEN   │                       │
│  - exam contest rule (新)     │                     │  - ExamSession        │
│  - paper draft (新)           │                     │    (machine + user +  │
│  - 题型工作流 (新)            │                     │     contest)          │
│  - krypton-userbind (重构)    │                     │  - Event/Cmd/Shot     │
│  - lookupStudent API          │                     │  - OjContest 镜像      │
│  - 双向通知/审批接口          │                     │  - 审批队列           │
└──────────┬───────────────────┘                     └──────────┬───────────┘
           │ HTTP/Cookie session                                │ WS
           ▼                                                    │
┌──────────────────────────────┐                                │
│      ui-next (React)          │                                │
│                               │                                │
│  - /next/* (常规 OJ UI)       │                                │
│  - /admin/vigil/* ◄───────────┼────────────────────────────────┘
│    (反作弊面板，S2 集成)       │
│  - /admin/userbind/* (新)     │
│  - /exam-mode/* (考试 webview)│
│  - 答题卡 + tab + region 编辑器│
└──────────────────────────────┘
```

### 0.2 Glossary

| Term | Meaning |
|---|---|
| **Paper / 试卷** | An `exam`-rule `Tdoc` (contest) bound to a participant `UserGroup`, with a time window, an answer-sheet UI, and a set of problems spanning multiple question types |
| **Question kind** | Per-`answers[key]` metadata inside an `objective` problem: one of `single` / `multi` / `blank` / `fill_program` |
| **Problem type** | Top-level `Pdoc.config.type`: existing (`default`, `objective`, `submit_answer`, `interactive`, `communication`, `remote_judge`) plus new `fill_function` |
| **Region** | A user-editable range inside a function-completion problem's template source |
| **Draft** | A per-`{uid, tid, pid}` server-side blob holding in-progress answer state for paper questions |
| **Locked kind** | Within a draft, a kind the student has clicked "submit this kind" on; UI renders it read-only until final paper submission |
| **machine_id** | Persistent Qt Client identity, derived from `QSysInfo::machineUniqueId()` (hashed) and pinned in `config.kvs` |
| **user_id** | Persistent OJ user identity (`hydrooj.User._id`) |
| **ExamSession** | Temporary binding `{machine_id, user_id, contest_tid}` created at student login, closed at submit or end-of-window |
| **Approval mode** | Per-contest setting `strict` (every login requires proctor approval) or `auto` (auto-approve if student is in the participant `UserGroup`) |
| **Lockdown mode** | Per-contest setting that controls whether the Qt Client actively blocks `Alt+Tab`/`Win+D`/system hotkeys (vs. logging-only) |
| **Three binding paths** | The three ways a student's account becomes associated with a `studentId`: ① invite link, ② request + approval, ③ Vigil proctor approval (only as a temporary-account fallback when ① / ② haven't happened) |

### 0.3 Cross-cutting principles

- **OJ is the source of truth** for user identity, contest metadata, problem content, drafts, and records. Vigil mirrors what it needs and never edits OJ data.
- **Vigil is the source of truth** for events, screenshots, commands, machine state, and `ExamSession`. OJ never writes into Vigil's SQLite.
- **Service-to-service auth is bidirectional**: `KVS_OJ_TOKEN` (OJ → Vigil) and `KVS_VIGIL_TOKEN` (Vigil → OJ) rotate independently.
- **Answer data lives in OJ.** Evidence data lives in Vigil. The "complete evidence package" for an exam is produced by Vigil's exporter pulling drafts + records from OJ at export time, not by either side keeping a synced copy.
- **The Qt Client is a monitoring shell**; all answer UI is web (ui-next under `/exam-mode/*`) rendered in `QWebEngineView`. The Client never re-implements problem rendering.
- **`ui-next` is the long-term UI**. `ui-default` is in maintenance only; no new features land there.

---

## 1. Paper Workflow & Question Types  (Task 1)

### 1.1 Problem

Hydro's backend already supports `objective` (single/multi/blank with string match) and `submit_answer` judging. What's missing:

- **No paper UX**: no draft store, no tabbed answer sheet, no batched submission, no kind-level lock
- **No `fill_function` problem type**: completing one or more functions inside a runnable template
- **No question-kind metadata**: `objective.config.answers` flat-string-or-array gives no hint whether `"1-3"` is a single-choice, multi-choice, blank, or program-blank — the renderer has nothing to specialize on
- **`ui-next` has not rendered objective / submit_answer at all** — `problem-detail.tsx` only handles `default`

### 1.2 Scope

In scope:
- New problem type `ProblemType.FillFunction` with full edit / submit / judge pipeline
- New per-question `kind` metadata on `objective.config.answers[*]`
- New `exam` contest rule joining the existing six rules in `model/contest.ts`
- New `vigil.paper_draft` collection holding in-progress paper state
- New `/exam-mode/*` ui-next routes (also reused under Vigil-wrapped Qt WebView, see Task 2)
- Lock-on-begin: problem-judging fields freeze when `now >= contest.beginAt`
- Class-level submit semantics (e3 — lock-only, no early grading)
- Frontend visual region editor (CodeMirror 6 readonly ranges)

Out of scope:
- AST-based grading for `fill_program` (string match only — teachers list acceptable variants in the answer array)
- Per-question records (one record per problem; objective problems sum question scores)
- Real-time draft → Vigil event broadcast (hook is pre-laid but not fired in V1; see Task 2)

### 1.3 Data model

#### 1.3.1 `ProblemType` enum (extend `packages/common/types.ts`)

```ts
export enum ProblemType {
    Default = 'default',
    SubmitAnswer = 'submit_answer',
    Interactive = 'interactive',
    Communication = 'communication',
    Objective = 'objective',
    Remote = 'remote_judge',
    FillFunction = 'fill_function',   // NEW
}
```

#### 1.3.2 `ProblemConfigFile` additions

```ts
export interface ProblemConfigFile {
    // ... existing fields ...

    /** When type === 'objective', each answer entry gains an optional kind tag.
     *  Backward-compat: missing kind is inferred:
     *    - stdAns is array → 'multi'
     *    - stdAns is single string with no whitespace → 'single'
     *    - stdAns is single string with whitespace → 'blank' */
    answers?: Record<string, AnswerEntry>;

    /** When type === 'fill_function', defines the template + editable regions. */
    template?: FillFunctionTemplate;
}

export type AnswerEntry =
    | [string | string[], number]
    | [string | string[], number, { kind?: QuestionKind; prompt?: string }];

export type QuestionKind = 'single' | 'multi' | 'blank' | 'fill_program';

export interface FillFunctionTemplate {
    lang: string;             // 'cpp' | 'python' | etc — limits student submission lang
    source: string;           // full compilable template, with regions filled by the teacher's
                              //   own reference answer (used for self-test during authoring)
    regions: FillRegion[];
    sourceHash: string;       // SHA-256 of `source` — used for draft staleness detection
}

export interface FillRegion {
    id: string;               // stable id, e.g. 'r1', 'main_logic' — chosen by the teacher
    start: { line: number; col: number };
    end: { line: number; col: number };
    prompt?: string;          // shown above the editable area in the student UI
}
```

The lock-on-begin rule (§1.5) makes regions' `(start, end)` immutable post-begin, so we use the simpler hash-based staleness scheme (option A from the grilling).

#### 1.3.3 `vigil.paper_draft` collection (new)

```ts
interface PaperDraft {
    _id?: ObjectId;
    domainId: string;
    tid: ObjectId;            // contest._id
    pid: number;              // problem.docId
    uid: number;              // student user._id
    /** For objective problems: { questionKey -> studentAnswer (string or string[]) }
     *  For fill_function: { regionId -> studentSource } */
    answers: Record<string, string | string[]>;
    /** For default / fill_function only — the staged code (not yet submitted as record). */
    code?: string;
    lang?: string;
    /** Question kinds the student has clicked "submit this kind" on; rendered read-only. */
    lockedKinds: QuestionKind[];
    /** SHA-256 of the problem's judging fields at draft-create time. Compared on read; if
     *  the problem was force-unlocked and changed, the draft is invalidated. */
    problemFingerprint: string;
    updatedAt: Date;
    createdAt: Date;
}
```

Index: `{ domainId: 1, tid: 1, uid: 1, pid: 1 }` unique.

#### 1.3.4 `exam` contest rule (extend `packages/hydrooj/src/model/contest.ts`)

Registered alongside `acm / oi / homework / ioi / ledo / strictioi` in the `RULES` table. Built via the existing `buildContestRule(...)` factory.

Additional rule-specific fields stored in `Tdoc`:

```ts
interface ExamRuleConfig {
    approvalMode: 'strict' | 'auto';
    lockdownMode: boolean;
    pauseOnDisconnect: boolean;
    screenshotIntervalMs: number;
    /** Resolved into UserGroup ids (Task 3). When empty, falls back to contest.assign. */
    participantGroupIds: ObjectId[];
    /** If true, paper UI hides the "switch contest" affordance — student is bound to this exam. */
    exclusive: boolean;
}
```

The rule's `scoreboard` projection aggregates per-problem record scores normally. There's no per-question scoreboard.

### 1.4 Tab grouping & paper UI semantics

The answer sheet groups problems' answer-cells (= question-equivalents) across the whole paper:

- **Cell from objective problem**: `(problemDocId, answerKey)` — kind comes from `answers[answerKey].kind`
- **Cell from `default` problem**: `(problemDocId, null)` — fixed kind `'编程'`
- **Cell from `fill_function` problem**: `(problemDocId, null)` — fixed kind `'函数题'`

Tabs are computed:

```
单选 (N1) | 多选 (N2) | 填空 (N3) | 程序填空 (N4) | 函数题 (N5) | 编程 (N6)
```

`N*` = count of cells in each kind; tabs with `0` count are hidden.

The left navigator inside each tab shows a numeric grid for jumping to each cell. The right pane shows the cell's problem statement + the kind-specific renderer (radio for single, checkboxes for multi, input for blank, code-snippet input for fill_program, full CodeMirror with readonly ranges for fill_function, full editor for default).

### 1.5 Lock-on-begin (key invariant)

When `now >= contest.beginAt` for any contest containing problem P:

- The following `Pdoc` fields become **read-only** for non-superadmins:
  - `config.template` (entire object)
  - `config.answers` (entire map)
  - `config.regions` (if separately stored)
  - `config.checker` / `config.subtasks` (only the cases-bearing fields)
- Other fields stay editable: `title`, `content`, `tag`, `difficulty`, `score`.
- Superadmin override path: `POST /api/admin/problem/:pid/force-unlock` with confirm-twice. Triggers async `force-unlock-rejudge` task that re-runs the judger on every record for this problem in any active or closed exam contest. The new judging output replaces the old.

This lock removes the entire "what if teacher edits while drafts exist" branch. Drafts are still hash-checked on read against `problemFingerprint`, and `force-unlock` is the only way a hash mismatch can occur.

### 1.6 Submission semantics

| Trigger | What happens |
|---|---|
| Student clicks **save** | Upsert `paper_draft` for `(tid, pid, uid)`. UI debounces 1 s. If `updatedAt` collision detected against last seen → soft merge for objective (per-question), hard prompt for code |
| Student clicks **submit this kind** | Mark kind in `lockedKinds`. Locked questions render read-only. No record created. |
| Student clicks **submit programming problem** | (`default` / `fill_function` only). Take `code` + `lang` from draft. For `fill_function`: server splices region contents back into `template.source` using the regions' `(start, end)` and submits the joined source as the record's `code`. Goes straight to judger; record visible in record list. |
| Student clicks **final submit (交卷)** | Server reads all drafts under `(tid, uid)`. For each problem in the contest pid list: build a record. For `objective` → assemble YAML from `answers` (mapping back to Hydro's existing format `{ key: answer }`), submit. For `default` / `fill_function` → if a record was already submitted via "submit programming problem" use the latest; otherwise build now. Mark `ExamSession` (Task 2) as closed once all records dispatched. |
| Time runs out | Server-side scheduled task (Hydro `schedule` service) fires at `contest.endAt` and walks all `(tid, uid)` with `lockedKinds.length > 0 || draft exists`; performs same flow as final submit. Client-side React countdown is the primary UX trigger; this is the safety net. |
| Proctor force-submit (Task 2) | Same as final submit, but record carries `meta.proctorForced = true` for audit |

Records produced from final submit carry `Rdoc.contest = tid` (already supported by `record.add`). One record per problem per student per submit event.

### 1.7 fill_function visual editor (frontend)

Implementation surface: `packages/ui-next/src/components/region-editor.tsx` (new), built on CodeMirror 6.

Teacher authoring mode:
- Loads full `template.source` into editor
- Teacher selects a range → clicks "Mark as region" → assign id (default `r{N}`)
- Region appears as a highlighted box with handles
- Save sends `{ source, regions }` to server; server computes `sourceHash`
- Teacher's own filled-in region content is the reference answer; the server **does not enforce** that students reproduce it (judgment is by running testcases on the spliced result)

Student answering mode:
- Loads `template.source` with regions' content replaced by an empty placeholder line (or by saved draft content)
- Uses CodeMirror's `EditorState.changeFilter` to block edits outside any region
- Each region is a "soft" range: students may insert any number of lines; following source pushes down (line/col offsets shift only inside the editor view, not in the stored region anchors — anchors are stored against the canonical pre-edit source)
- All non-region code is fully visible (read-only). No folding / hiding.
- Submission flow: client sends `{ regionId -> regionContent }`; server splices into `template.source` server-side and produces the full source for the record.

Splicing algorithm: sort regions by `(start.line, start.col)` descending; replace each `(start..end)` range with the student's content; result is the submitted source. Anchors don't shift because regions are non-overlapping by construction and edits are applied from the end of the source backwards.

### 1.8 API additions (hydrooj)

New routes under `packages/hydrooj/src/handler/`:

```
GET    /api/contests/:tid/paper          → Paper layout (problem list + tab structure + countdown + locks)
GET    /api/contests/:tid/paper/draft    → All drafts for current user in this contest
PATCH  /api/contests/:tid/paper/draft/:pid   → Upsert draft for one problem
POST   /api/contests/:tid/paper/lock-kind   → { kind } → append to lockedKinds (idempotent)
POST   /api/contests/:tid/paper/submit-code/:pid   → Immediate code/fill_function submission
POST   /api/contests/:tid/paper/finalize   → Final submit (turn drafts into records)
GET    /api/contests/:tid/paper/record/:pid   → Per-problem record summary for review
```

All require `PERM_ATTEND_CONTEST` plus contest time-window check. Admin variants (proctor force-submit, force-unlock) live under `/api/admin/...`.

### 1.9 Acceptance

- Teacher creates exam contest with 3 single + 2 multi + 1 blank + 1 fill_program + 1 fill_function + 1 default problem; the answer sheet shows 6 tabs with correct counts
- Student answers, saves, switches tabs (unsaved-changes dialog appears when applicable), locks "单选" tab (single questions become read-only), submits programming problem (gets immediate verdict), finalizes paper (records appear for each problem)
- Time-runs-out path: contest with very short window → student answers a few, leaves draft → scheduled task auto-finalizes at endAt → records show up
- Lock-on-begin: teacher tries to edit problem config after `now >= beginAt` → frontend hides edit affordance, backend rejects with 403
- Force-unlock: admin force-unlocks one problem, edits its answers, confirms rejudge → all relevant records in all live exam contests show updated verdict

---

## 2. Vigil ↔ OJ Integration  (Task 2)

### 2.1 Problem

KryptonVigilSystem currently runs as an independent stack (FastAPI + React Dashboard + Qt 6 Client) with **zero** OJ integration. `ExamSession`, `ClientPolicy`, etc. are skeleton tables; `oj_base_url` / `oj_service_token` are config placeholders that nothing reads. There's no way for proctors to know which student is on which machine, and no way for the OJ to know that a contest is being supervised.

### 2.2 Scope

In scope:
- Vigil server schema refactor introducing three-layer identity (machine + user + session)
- Bidirectional service-token auth between hydrooj and Vigil server
- Qt Client student login UI (學號 + 姓名), webview-based exam UI mounted in `QWebEngineView`
- ui-next absorption of Vigil Dashboard as `/admin/vigil/*` (S2 form factor — Vigil server stays a separate process)
- Approval queue with proctor UX in dashboard
- Temporary-student creation path with claim mechanism
- Full exam lifecycle (5 phases) wired across OJ ↔ Vigil ↔ Client
- New proctor commands: `force_submit`, `force_close`, `transfer_machine`

Out of scope:
- Reverse migration (porting Vigil server's Python logic into hydrooj) — explicitly rejected as S4 in grilling
- iframe-style integration (rejected as S1)
- Native Qt answering UI (rejected as T3)

### 2.3 Three-layer identity

| Layer | Owner | Lifecycle | Storage |
|---|---|---|---|
| `machine_id` | Qt Client | Permanent per machine | `config.kvs.machine_id` — set on first boot from `sha256(QSysInfo::machineUniqueId())`, immutable thereafter; falls back to hostname if `machineUniqueId()` is empty |
| `user_id` | hydrooj | Permanent per user | `User._id` |
| `ExamSession` | Vigil server | Created at proctor approve, closed at submit / timeout / force-close | `vigil.exam_sessions` table |

### 2.4 Vigil schema changes (`ecosystems/KryptonVigilSystem/Server/app/models.py`)

```python
# Renamed: external_exam_id → oj_contest_id
class ExamSession(SQLModel, table=True):
    id: str = Field(primary_key=True)              # UUID
    machine_id: str = Field(index=True)            # NEW
    oj_user_id: int = Field(index=True)            # NEW
    oj_contest_id: str = Field(index=True)         # RENAMED from external_exam_id
    oj_domain_id: str = Field(index=True)          # NEW
    status: str = Field(default='active')          # active | closed | transferred | force_closed
    began_at: datetime
    closed_at: datetime | None = None
    close_reason: str | None = None
    is_temporary_user: bool = False                # NEW
    created_at: datetime
    updated_at: datetime

# DELETED entirely:
# class ClientEnrollment(SQLModel, table=True): ...

# Updated: add exam_session_id FK to evidence tables
class ClientEvent(SQLModel, table=True):
    # ... existing fields ...
    exam_session_id: str | None = Field(default=None, index=True, foreign_key='examsession.id')

class Screenshot(SQLModel, table=True):
    # ... existing fields ...
    exam_session_id: str | None = Field(default=None, index=True, foreign_key='examsession.id')

class Command(SQLModel, table=True):
    # ... existing fields ...
    exam_session_id: str | None = Field(default=None, index=True, foreign_key='examsession.id')

# NEW: OjContest mirror (push + lazy-fallback cache)
class OjContest(SQLModel, table=True):
    oj_contest_id: str = Field(primary_key=True)
    oj_domain_id: str = Field(index=True)
    title: str
    begin_at: datetime
    end_at: datetime
    approval_mode: str   # 'strict' | 'auto'
    lockdown_mode: bool
    pause_on_disconnect: bool
    screenshot_interval_ms: int
    exclusive: bool
    last_synced_at: datetime
    source: str   # 'push' | 'lazy'

# NEW: Approval queue
class ApprovalRequest(SQLModel, table=True):
    id: str = Field(primary_key=True)              # UUID
    machine_id: str = Field(index=True)
    oj_contest_id: str = Field(index=True)
    student_id_input: str                           # what the student typed
    real_name_input: str
    matched_oj_user_id: int | None = None           # from OJ lookup; null = unknown / temporary candidate
    is_unknown: bool = False                        # highlight as "unknown student" in dashboard
    status: str = Field(default='pending')          # pending | approved | rejected
    created_at: datetime
    reviewed_by_oj_user_id: int | None = None
    reviewed_at: datetime | None = None
    reject_reason: str | None = None
    resulting_session_id: str | None = None
```

### 2.5 Service-token auth

Two tokens, rotated independently:

```
KVS_OJ_TOKEN       OJ → Vigil   (OJ holds it; Vigil's .env stores expected value)
KVS_VIGIL_TOKEN    Vigil → OJ   (Vigil holds it; OJ's system settings store expected value)
```

Both passed as `X-Service-Token` header. Old-token / new-token coexistence during rotation: each side accepts up to 2 valid tokens (configured as a list), so the rotating side can switch first, then deprecate the old token on the accepting side.

### 2.6 OJ-side APIs (hydrooj, new)

All under `packages/hydrooj/src/handler/vigil-integration.ts` (new file). All require `KVS_VIGIL_TOKEN`.

```
POST  /api/vigil/lookup-student
        body: { domainId, studentId, realName }
        returns: { found, ojUserId?, eligibleExams: [{ tid, title, beginAt, endAt, ... }], reason? }

POST  /api/vigil/notify-session-opened
        body: { sessionId, ojUserId, tid, machineId }
        — fire-and-forget notification that Vigil opened a session; OJ records it on user

POST  /api/vigil/notify-session-closed
        body: { sessionId, closeReason }

POST  /api/vigil/exchange-access-token
        body: { sessionId, accessToken }
        returns: { ojCookieSession, expiresAt, exclusiveTid? }
        — webview calls this on first load; OJ verifies the opaque token with Vigil,
          if valid issues a real OJ session cookie

POST  /api/vigil/temporary-user
        body: { studentIdInput, realNameInput, machineId, tid, approvedByOjUserId }
        returns: { tempUserId, oneTimeToken }
        — creates an isTemporary OJ user, returns a one-shot token Vigil hands to the
          Qt Client for webview launch
```

### 2.7 Vigil-side APIs (FastAPI, new)

All under `ecosystems/KryptonVigilSystem/Server/app/api/oj_integration.py` (new file). All require `KVS_OJ_TOKEN`.

```
POST  /api/integrations/oj/exam
        body: { ojContestId, ojDomainId, title, beginAt, endAt, approvalMode, lockdownMode, ... }
        — push or refresh an OjContest mirror

DELETE  /api/integrations/oj/exam/:ojContestId
        — when a contest is deleted in OJ

POST  /api/integrations/oj/exam/:ojContestId/close-session
        body: { sessionId, closeReason }
        — OJ instructs Vigil to close a session (final-submit, timeout, etc.)
```

Plus a set of dashboard-facing endpoints (already mostly exist; tag with `exam_session_id` filter):

```
GET   /api/clients                 ← already exists
GET   /api/events                  ← already exists; add ?examSessionId= filter
GET   /api/exam-sessions           ← NEW; list sessions filterable by contest, user, machine, status
GET   /api/approvals               ← NEW; pending approval queue
POST  /api/approvals/:id/approve   ← NEW; approve, optionally mark as temporary
POST  /api/approvals/:id/reject    ← NEW
```

### 2.8 Qt Client changes

Locations under `ecosystems/KryptonVigilSystem/Client/`.

- `core/config_manager.cpp`: derive `client_id` from hashed `machineUniqueId()` on first boot, persist, never regenerate; rename field intent comment to "machine_id" (the JSON key may stay `client_id` for compatibility, but the value semantics is now machine).
- New module `app/login_window.{h,cpp}`: simple Qt Widgets dialog with two inputs (studentId, realName), submit button, status area. Posts `{machine_id, studentId, realName}` over the existing WebSocket as a new message type `login_request`.
- New module `app/exam_webview.{h,cpp}`: a `QWebEngineView` host. On `session_opened` WS message → load `${vigilWebviewUrl}?session=${sid}&token=${at}`. Bridge channel via `QWebChannel` exposes:
  - `qt.notifyExamSubmitted()` — called from web when final-submit succeeds; triggers session close
  - `qt.requestExit()` — called from web; UI confirms with proctor or no-op depending on lockdown mode
  - `qt.reportEvent(payload)` — let web push extra event metadata (e.g., focus loss) into the Vigil event stream
- `network/server_connection.cpp`: handle new server-pushed messages `session_opened`, `session_closed`, `proctor_command` (force_submit, force_close, transfer_machine, show_message, etc.)
- `monitor/lockdown.{h,cpp}` (NEW): platform-specific implementation of "block Alt+Tab, Win+D, Cmd+Tab, etc." Engaged only when `OjContest.lockdownMode === true`.

### 2.9 ui-next absorption (S2)

Layout:
```
packages/ui-next/src/pages/vigil/
├── overview.tsx           # /admin/vigil — dashboard home (machines + active sessions + recent events)
├── exam-sessions.tsx      # /admin/vigil/sessions
├── session-detail.tsx     # /admin/vigil/sessions/:id
├── approvals.tsx          # /admin/vigil/approvals
├── events.tsx             # /admin/vigil/events
├── screenshots.tsx        # /admin/vigil/screenshots
├── retention.tsx          # /admin/vigil/retention
└── machine-detail.tsx     # /admin/vigil/machines/:machineId

packages/ui-next/src/lib/vigil-api.ts          # REST client; uses OJ-issued short-lived dashboard token
packages/ui-next/src/hooks/use-vigil-socket.ts  # ws client; auths the same way

packages/ui-next/src/pages/exam-mode/         # Task 1 paper UI also lives under here
├── index.tsx              # /exam-mode — exam selection card grid (after Qt webview opens this URL)
└── paper.tsx              # /exam-mode/:tid — the answer sheet
```

OJ-side hook: `GET /api/admin/vigil/dashboard-token` issues a short-lived Vigil dashboard token bound to the current admin's session. ui-next code uses this when calling `vigil-api.ts` and opening the Vigil WebSocket.

The existing `Dashboard/` directory under `ecosystems/KryptonVigilSystem/` is **deleted** after migration. Its component code (`ClientTable`, `EventList`, `TimelinePanel`, `ScreenshotPreview`, etc.) is ported one-by-one into `packages/ui-next/src/components/vigil/*`.

### 2.10 Exam lifecycle (5 phases)

**Phase 1 — Before exam**

- Teacher creates `exam`-rule contest in OJ (Task 1 surface)
- OJ calls `POST /api/integrations/oj/exam` to push OjContest mirror to Vigil
- Machines may already be online (Qt Client running idle) or may come up later
- Proctor opens `/admin/vigil` → sees machines list and the contest cards in "upcoming"

**Phase 2 — Student entry**

```
1. Student sits at machine; Qt Client shows login dialog
2. Student types studentId + realName + clicks submit
3. Qt → Vigil over WS: { type:'login_request', machine_id, studentId, realName }
4. Vigil calls POST /api/vigil/lookup-student to OJ
5. OJ returns { found, ojUserId, eligibleExams }
6. Vigil decision:
   - approvalMode='auto' + matched + eligible → auto-create ExamSession, skip approval
   - approvalMode='strict' OR unknown student → create ApprovalRequest, push to dashboard
7. Proctor sees approval in /admin/vigil/approvals, clicks approve (or "approve as temporary")
8. Vigil creates ExamSession; if temporary case, first calls POST /api/vigil/temporary-user
9. Vigil generates opaque accessToken (24h or contest.endAt+1h whichever is sooner)
10. Vigil → Qt over WS: { type:'session_opened', sessionId, accessToken, webviewUrl, ...}
11. Qt launches QWebEngineView pointing at webviewUrl
12. Webview JS calls POST /api/vigil/exchange-access-token → gets real OJ cookie session
13. Webview lands on /exam-mode card grid; student picks contest (or auto-entered if exclusive=true)
```

**Phase 3 — During exam**

- Qt continues monitoring (screenshots / processes / hotkeys / clipboard hashing), all events tagged with `examSessionId`
- Webview is the answering UI (Task 1's paper)
- Drafts saved on student's "save" click — OJ MongoDB, no Vigil involvement
- Programming problems immediately graded → records visible in webview
- Proctor watches `/admin/vigil` for events; risk events surface
- Predefined OJ event `exam/draft-update` fires on each draft save (registered but no listeners in V1)

**Phase 4 — Submission**

- Trigger: student clicks final-submit / time expires / proctor force-submits
- OJ executes paper finalization (Task 1 §1.6), produces records, judges them
- OJ calls `POST /api/integrations/oj/exam/:tid/close-session` to Vigil with sessionId + reason
- Vigil marks ExamSession `closed`, pushes `session_closed` WS message to Qt
- Qt closes webview, returns to idle login screen

**Phase 5 — Anomalies**

| Anomaly | Handling |
|---|---|
| Webview reload / network blip | Cookie session persists; webview reconnects to OJ. Clock continues. |
| Qt Client crash | Existing watchdog restarts agent (already implemented in `watchdog/`). On reconnect Qt re-emits cached events; session ID stored in `config.kvs` to allow webview re-launch without redoing approval |
| Machine reboot / hardware failure | Proctor uses `transfer_machine` command — abandons old ExamSession (marks `transferred`), allows the same student to log in on a different machine; new ExamSession created; contest clock keeps running unless `pauseOnDisconnect=true` |
| Student abnormally exits | Lockdown mode prevents; non-lockdown mode logs `student.window-loss` event |
| Proctor force-close | Closes ExamSession with reason; no records generated; high-severity event logged |
| Force-unlock during exam (Task 1) | Affects records only after exam ends and admin issues rejudge; live drafts unaffected (their `problemFingerprint` still valid until they hit the changed problem on save → soft prompt) |

### 2.11 Acceptance

- Teacher creates exam contest → OjContest appears in Vigil dashboard
- Student logs in on a machine → approval appears → proctor approves → Qt Client switches to webview showing the exam card grid → student enters paper → answers → submits → record appears in OJ
- Unknown student approval path: proctor sees highlighted unknown card → clicks "approve as temporary" → Qt Client opens webview as a temp user → student takes exam → record persisted under temp user
- Time expiry: very short exam → countdown reaches 0 → webview auto-submits → OJ closes session → Qt returns to idle
- Force-submit: proctor force-submits → OJ generates record from current draft → webview shows submitted state → Qt session closed
- Transfer machine: while student is in exam on Machine A, proctor force-closes machine; student logs in on Machine B → new approval (since strict mode) → proctor sees "already has an active session" warning → clicks transfer → student resumes; total elapsed time continues from contest beginAt

---

## 3. UserBind Refactor  (Task 3)

### 3.1 Problem

`/Users/motricseven/Krypton/dev/CAUCOJUserBind` is a 4,452-line single-file plugin with 129 `console.log`s, 20 nunjucks templates, ~25 routes. It has organic growth artifacts: `groupType=1` (contest-only user group) duplicates Hydro's native contest assignment; "mark contest finished" duplicates `contest.endAt`; the nickname feature is unrelated. All collections are **globally scoped (no domainId)**, breaking Hydro's multi-domain design. Templates are nunjucks (ui-default era).

### 3.2 Scope

In scope:
- New package `packages/krypton-userbind/` (default-enabled, ships with hydrooj)
- Domain-scoped collections; cross-domain isolation for studentId namespaces
- Refactored data model with student records as independent documents (not inline arrays)
- Three binding paths preserved (① invite link, ② request+approval, ③ Vigil proctor approval gated to "temporary account only — no permanent bind")
- New ui-next admin and student pages; nunjucks templates fully retired
- Cross-domain migration tooling (CLI + ui-next admin shell)
- Atomic data migration from old `user_groups` / `school_groups` / `bind_tokens` / `binding_requests` collections, run as a `packages/hydrooj/src/upgrade.ts` step
- Drop: `groupType=1`, contest-permission page, mark-finished, nickname

Out of scope:
- Backwards-compatible behavior for the old `/user-bind/*` routes (404 / redirect during migration)
- Per-school custom permission roles (not requested)

### 3.3 Data model

```ts
// Collection: userbind.schools
interface School {
    _id: ObjectId;
    domainId: string;
    name: string;              // unique within (domainId, name)
    createdAt: Date;
    createdBy: number;
}

// Collection: userbind.user_groups
interface UserGroup {
    _id: ObjectId;
    domainId: string;
    name: string;              // unique within (domainId, schoolId, name)
    schoolId: ObjectId;        // parent school
    createdAt: Date;
    createdBy: number;
}

// Collection: userbind.students
// Independent student records. NOT inlined into school or group docs.
interface StudentRecord {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;        // every student belongs to exactly one school
    studentId: string;         // unique within (domainId, schoolId, studentId)
    realName: string;
    groupIds: ObjectId[];      // 0..N user groups
    boundUserId: number | null;  // null = not yet bound to an OJ user
    boundAt: Date | null;
    createdAt: Date;
    createdBy: number;
}

// Collection: userbind.bind_tokens
interface BindToken {
    _id: string;               // 32-byte hex
    domainId: string;
    studentRecordId: ObjectId; // one token = one student
    createdAt: Date;
    createdBy: number;
    expiresAt: Date | null;
    used: boolean;
    usedBy: number | null;
    usedAt: Date | null;
}

// Collection: userbind.binding_requests
interface BindingRequest {
    _id: ObjectId;
    domainId: string;
    userId: number;
    studentIdInput: string;
    realNameInput: string;
    schoolId: ObjectId;        // student picks which school in the request
    status: 'pending' | 'approved' | 'rejected';
    createdAt: Date;
    reviewedBy: number | null;
    reviewedAt: Date | null;
    rejectReason: string | null;
    /** If the request is to claim a temporary user's records, the temp uid is here. */
    claimTempUserId: number | null;
}
```

Hydro `User` document extension (keep existing field names):

```ts
interface UserDocument {
    realName?: string;
    studentId?: string;
    parentSchoolId?: ObjectId[];     // current schools the user belongs to (across domains)
    parentUserGroupId?: ObjectId[];  // current user groups the user belongs to
    isTemporary?: boolean;           // Task 2 — temporary exam user
}
```

### 3.4 API surface

Model exports (`packages/krypton-userbind/src/model.ts`):

```ts
export const userBindModel = {
    // Schools & groups
    createSchool(domainId, name, createdBy): Promise<School>,
    listSchools(domainId): Promise<School[]>,
    createUserGroup(domainId, schoolId, name, createdBy): Promise<UserGroup>,
    listUserGroups(domainId, schoolId?): Promise<UserGroup[]>,

    // Student records
    importStudents(domainId, schoolId, rows: { studentId, realName }[]): Promise<ImportResult>,
    listStudents(domainId, filter): Promise<StudentRecord[]>,
    assignStudentsToGroup(domainId, groupId, studentRecordIds): Promise<void>,

    // Bind paths
    generateInviteToken(domainId, studentRecordId, createdBy, ttl?): Promise<BindToken>,
    consumeInviteToken(tokenId, userId): Promise<{ studentRecord, school }>,
    submitBindingRequest(domainId, userId, schoolId, studentIdInput, realNameInput): Promise<BindingRequest>,
    approveBindingRequest(requestId, reviewerUid): Promise<void>,
    rejectBindingRequest(requestId, reviewerUid, reason): Promise<void>,

    // The Task 2 lookup (read-only fast path)
    lookupStudent(domainId, studentIdInput, realNameInput): Promise<{
        found: boolean;
        userId?: number;
        eligibleContestIds: ObjectId[];
        reason?: 'no_match' | 'not_bound' | 'name_mismatch';
    }>,

    // Temporary user claim
    claimTemporaryAccount(tempUid, realUid): Promise<{ recordsTransferred: number }>,

    // Migration tooling
    exportDomain(domainId): Promise<ExportPackage>,
    importDomain(targetDomainId, pkg, conflictPolicy): Promise<ImportReport>,
};
```

`lookupStudent` is the contract Task 2 depends on. The Vigil server calls a thin OJ handler `POST /api/vigil/lookup-student` (Task 2 §2.6) which in turn invokes `userBindModel.lookupStudent`.

### 3.5 Three binding paths

| Path | Trigger | Outcome |
|---|---|---|
| ① Invite link | Admin generates token → sends to student → student clicks `/bind/:token` → confirms studentId+realName match → submit | Student's User doc updated with realName/studentId; StudentRecord.boundUserId set; token marked used |
| ② Request + approval | Student visits `/user/bind` → picks school → enters studentId+realName → submits → admin reviews in `/admin/userbind/requests` → approves → bind effected | Same outcome as ①; BindingRequest stored as audit trail |
| ③ Vigil proctor approval | Student types studentId+realName in Qt Client → no match in userbind data → proctor explicitly clicks "approve as temporary" in Vigil dashboard | A **temporary OJ user** is created (`isTemporary=true`); **no permanent bind** is established; user can claim later via path ② |

### 3.6 Temporary-user claim flow

Post-exam, a student who took an exam as a temporary user (path ③) can claim those records:

1. Student creates a normal OJ account (if they don't have one already) and binds via path ② to their real studentId
2. Student visits `/user/bind/claim`, sees a list of past exams they took as temp users (matched by studentId+realName)
3. Submits claim request → goes through admin review → on approval, server runs `userBindModel.claimTemporaryAccount(tempUid, realUid)`:
   - All `Record` docs with `uid=tempUid` re-pointed to `uid=realUid`
   - Temp user's `isDisabled` flipped to `true`, displayName prefixed `[claimed]`
   - All contest tsdoc entries re-keyed (atomic; uses MongoDB session/transaction)

### 3.7 Migration

Hooks into `packages/hydrooj/src/upgrade.ts` as a new step. Runs once on next OJ start after deployment:

```
1. Read all docs from old collections: user_groups, school_groups, bind_tokens, binding_requests
2. For each old SchoolGroup:
     - Create userbind.schools doc with domainId='system' (or the OJ's default domain if configurable)
     - For each inline member: create userbind.students doc
3. For each old UserGroup with groupType=0:
     - Create userbind.user_groups doc, assign to school
     - For each inline student: link to existing userbind.students doc via groupIds
4. For each old UserGroup with groupType=1 (contest-only group):
     - Find the corresponding contest in tdoc (by name pattern or admin manual mapping)
     - Add the student User._ids to the contest's `assign` field (Hydro native)
     - Do NOT create a userbind.user_groups doc for it
5. For each old BindToken: copy to userbind.bind_tokens (1:1)
6. For each old BindingRequest: copy to userbind.binding_requests (1:1)
7. Leave UserDocument fields (realName/studentId/parentSchoolId/parentUserGroupId) as-is
8. Mark migration done in system.settings key 'userbind.migration_v1_done'
```

If `groupType=1` mapping is ambiguous (no clean contest match), the script writes a CSV report and pauses; admin reviews and re-runs the step.

Old routes `/user-bind/*`, `/user-group/*`, `/school-group/*`, `/nickname`, `/management`, `/bind/:token`, `/binding-request/*` either 410-Gone or 302 to their new equivalents under `/admin/userbind/*` and `/user/bind`.

### 3.8 Cross-domain migration tool

CLI command (registered via hydrooj's `commands/`):

```bash
hydrooj userbind:export <domainId> > out.json
hydrooj userbind:import <targetDomainId> --conflict=error|skip|overwrite < out.json
```

UI counterpart at `/admin/userbind/migrate` — file upload + target domain selector + conflict policy radio + diff preview before commit.

The exported `ExportPackage`:

```ts
interface ExportPackage {
    version: 1;
    sourceDomainId: string;
    exportedAt: string;
    schools: School[];
    userGroups: UserGroup[];
    students: StudentRecord[];   // boundUserId stripped (don't move bindings cross-domain)
    bindTokens: BindToken[];      // expired/used skipped
}
```

`importDomain` rewrites all `_id`s on insertion to avoid cross-domain collisions. Users are **not** auto-added to the target domain; admin handles via Hydro's native domain.addMember.

### 3.9 ui-next pages

```
/admin/userbind                      → home (school count, group count, recent bindings)
/admin/userbind/schools              → school list + create/edit
/admin/userbind/schools/:id          → school detail (students + groups)
/admin/userbind/groups               → all groups across schools
/admin/userbind/groups/:id           → group detail
/admin/userbind/students             → all students filtered by school
/admin/userbind/students/import      → bulk import (paste students or upload CSV)
/admin/userbind/tokens               → invite token list
/admin/userbind/requests             → binding request review queue
/admin/userbind/migrate              → cross-domain export/import

/user/bind                           → student self-service bind form (path ②)
/user/bind/claim                     → temp-user claim form
/bind/:token                         → invite link landing (path ①)
```

### 3.10 Acceptance

- Migration: existing OJ with old plugin data → run upgrade → all schools, groups, students, tokens, requests visible in new admin UI; `groupType=1` legacy groups translated into contest.assign with a CSV report of any ambiguities
- Path ①: admin creates a token for a student → student visits `/bind/:token` → submits → User doc updated, StudentRecord.boundUserId set
- Path ②: student submits request → admin sees in `/admin/userbind/requests` → approves → bound
- Path ③ (Task 2 integration): unknown student in Qt Client → temporary user created → no entry in StudentRecord; later claim via `/user/bind/claim` works end-to-end
- Cross-domain migration: export from domain A, import into domain B with conflict=skip → schools/groups/students replicated, no user bindings carried; admin then adds users to domain B as a separate operation
- `lookupStudent`: with valid (studentId, realName) returns matched ojUserId + eligibleContestIds; with wrong realName returns found=false reason='name_mismatch'

---

## 4. ui-next Coverage Gaps  (Task 4)

### 4.1 Strategy

"Edge-out" rather than "exhaustive upfront audit." During implementation of Tasks 1-3 we will encounter ui-next gaps in practice (e.g., when adding `/admin/vigil` we'll need an `/admin` layout; when adding `/admin/userbind/students/import` we'll need the user-import primitive). We close gaps when we hit them.

Three priority tiers are still set up so we can sweep through gaps systematically during a final cleanup phase (Phase 4 in the plan):

### 4.2 Tier A — Required for OJ completeness

| ui-default template | ui-next target | Notes |
|---|---|---|
| `domain_user` | `/admin/domain/users` | List, edit perms |
| `domain_role` | `/admin/domain/roles` | Role CRUD |
| `domain_permission` | `/admin/domain/permissions` | Permission matrix |
| `domain_join` | `/domain/:id/join` | Apply to join |
| `domain_join_applications` | `/admin/domain/applications` | Application queue |
| `manage_user_import` | `/admin/system/users/import` | Already partly covered by `admin.tsx`? verify on touch |
| `manage_user_priv` | `/admin/system/users/priv` | Privilege management |
| `home_messages` | `/user/messages` | Inbox; contest/system notifications land here |
| `home_files` | `/user/files` | Personal file storage; used by submit_answer |
| `problem_files` | `/p/:pid/files` | Testdata + statement attachments |
| `problem_import` | `/admin/problems/import` | FPS / QDU / Hydro zip import |
| `status` | `/status` | Judge daemons online list |
| `record_detail_status` | folded into `/r/:rid` | Real-time judge progress display |
| `record_detail_summary` | folded into `/r/:rid` | Per-case verdict details |

### 4.3 Tier B — Important per scenario

| Template | ui-next target | Notes |
|---|---|---|
| `contest_balloon` | `/c/:tid/balloons` | ACM only; skip if no on-site ACM |
| `contest_clarification` | `/c/:tid/clarifications` | Q&A — important for any timed exam, build this |
| `contest_print` | (skip) | Niche on-site feature |
| `contest_user` | `/c/:tid/participants` | Proctor name roster — needed during exam |
| `contest_scoreboard_download_html` | "Download" button on scoreboard page | Single export action |
| `problem_solution` | `/p/:pid/solutions` | Editorial / solutions |
| `problem_statistics` | `/p/:pid/stats` | Submission distribution |

### 4.4 Tier C — Edge

| Template | ui-next target | Notes |
|---|---|---|
| `home_security` | `/user/security` | 2FA enrollment / sessions / API keys |
| `homework_files` | `/h/:tid/files` | Attached materials |
| `training_files` | `/t/:tid/files` | Attached materials |
| `problem_config` | Already folded into `/p/:pid/edit/config` — verify on touch |
| `problem_submit` standalone | Already folded into `/p/:pid` — verify on touch |

### 4.5 Approach

- Phase 4 runs in parallel with Phases 1-3. Each gap-fix is a self-contained PR (low cross-coupling)
- For every page we add, we also keep the equivalent ui-default template intact for now (no functional regression) — `ui-default` deletion is a separate, post-Krypton-1.0 effort
- Each new page mirrors the existing ui-next conventions: TanStack Router route, shadcn/ui components, Tailwind, react-query for fetching, `lib/api.ts` for backend calls

### 4.6 Acceptance

- All Tier A pages have first-class ui-next implementations and the ui-default routes redirect (or set HTTP `Link` headers pointing) to them
- Tier B pages exist; the balloon and print pages may stub with "Not enabled in this deployment"
- Tier C pages exist where the underlying feature is active
- A coverage report under `docs/ui-next-coverage.md` is maintained — updated on each PR

---

## 5. Risks & Rollout

| Risk | Impact | Mitigation |
|---|---|---|
| Hidden business logic in the 4,452-line CAUCOJUserBind plugin gets lost during refactor | Functional regression after Phase 1 | Migration script runs in dry-run mode first; parallel-run with old plugin (read-only) for 1 week; data parity diff job before flipping reads |
| `QWebChannel` quirks across Qt versions / OS combinations | Phase 3 stalls | Phase 0 builds a minimal Qt + QWebEngineView + ui-next round-trip prototype before committing to T1 |
| `paper_draft` write storm during exam | MongoDB latency spikes; saves drop | Client-side debounce (1s); server idempotent upsert with `findOneAndUpdate`; load-test with 200 concurrent students before pilot |
| Temporary-user claim atomicity | Cross-collection writes (records, contest tsdocs, user doc) leave inconsistent state on failure | Wrap the claim operation in a MongoDB transaction; if no transactional support, write a recovery script that re-runs deltas |
| Service-token rotation outage | OJ ↔ Vigil traffic fails | Tokens stored as **lists** on each side; rotation procedure documented; alarms on `401`-rate per direction |
| Force-unlock-rejudge wipes correct verdicts | Teacher panic | Force-unlock takes a snapshot of all affected records before rejudge; rollback admin command available |
| Lockdown mode breaks legitimate workflows (e.g., switching to legitimate calculator on macOS) | Student blocked from work | Lockdown mode is opt-in per contest; whitelist of OS-essential modal dialogs (system credential prompts, etc.) cannot be blocked |
| ui-default ↔ ui-next divergence during Phase 4 | Users see inconsistent UIs in same session | Single sign-on state already shared; cosmetic difference acceptable; add a banner on ui-default pages "上线新版本：[link]" during the transition |

### 5.1 Rollout phases

1. **Phase 0** — foundations + spikes (admin shell, upgrade hook framework, Qt-WebView prototype)
2. **Phase 1** — Task 3 (UserBind refactor + migration)
3. **Phase 2** — Task 1 (paper workflow + question types + exam rule)
4. **Phase 3** — Task 2 (Vigil integration + Qt webview + lifecycle wiring)
5. **Phase 4** — Task 4 (ui-next coverage), runs in parallel with Phases 1-3

Detailed work breakdown lives in [`KRYPTON-PLAN.md`](KRYPTON-PLAN.md).

### 5.2 Pilot plan

- Internal alpha: dev domain with 5 hand-curated test students; full lifecycle dry-run of all three binding paths and the exam workflow
- Closed beta: one real course (≤50 students), exam-rule contest, lockdown off, approval mode strict; proctor stays in the room monitoring dashboard
- Open beta: ≤500-student course-wide exam; lockdown on; metrics: approval latency p95 < 5s, paper save error rate < 0.1%, force-submit success rate 100%
- GA: announced; ui-default no-feature freeze starts
