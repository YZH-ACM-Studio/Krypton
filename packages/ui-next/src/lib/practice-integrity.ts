export interface PracticeEntryTarget {
  containerKind: 'course' | 'problemSet';
  containerId: string;
  scopeKind: 'chapter' | 'stage';
  scopeId: number;
}

export interface PracticeIntegrityPolicyView {
  prohibitExternalCodeInjection: boolean;
  removeIndependentSubmitForm: boolean;
  antiAiCopyInjection: boolean;
}

export interface PracticeIntegrityRevisionView extends PracticeEntryTarget {
  revision: number;
}

export interface PracticeIntegrityPageContext {
  controlled: boolean;
  bypassed: boolean;
  previewAvailable: boolean;
  entry: PracticeEntryTarget;
  previewUrl?: string;
  contextId?: string;
  expiresAt?: string;
  mode?: 'student' | 'preview';
  policy?: PracticeIntegrityPolicyView;
  revisions?: PracticeIntegrityRevisionView[];
}

function canonicalObjectId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{24}$/.test(value)) throw new TypeError(`${field} must be a canonical ObjectId`);
  return value;
}

function canonicalPositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError(`${field} must be a positive integer`);
  return Number(value);
}

function readEntry(value: unknown, field: string): PracticeEntryTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  const entry = value as Record<string, unknown>;
  const containerKind = entry.containerKind;
  const scopeKind = entry.scopeKind;
  if (containerKind !== 'course' && containerKind !== 'problemSet') throw new TypeError(`${field}.containerKind is invalid`);
  if (scopeKind !== 'chapter' && scopeKind !== 'stage') throw new TypeError(`${field}.scopeKind is invalid`);
  if ((containerKind === 'course') !== (scopeKind === 'chapter')) throw new TypeError(`${field} container and scope kinds do not match`);
  return {
    containerKind,
    containerId: canonicalObjectId(entry.containerId, `${field}.containerId`),
    scopeKind,
    scopeId: canonicalPositiveInteger(entry.scopeId, `${field}.scopeId`),
  };
}

export function readPracticeIntegrityPageContext(value: unknown): PracticeIntegrityPageContext | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('practiceIntegrity must be an object');
  const raw = value as Record<string, unknown>;
  if (typeof raw.controlled !== 'boolean' || typeof raw.bypassed !== 'boolean' || typeof raw.previewAvailable !== 'boolean') {
    throw new TypeError('practiceIntegrity state flags are invalid');
  }
  const entry = readEntry(raw.entry, 'practiceIntegrity.entry');
  if (raw.previewUrl !== undefined && (typeof raw.previewUrl !== 'string' || !raw.previewUrl.startsWith('/'))) {
    throw new TypeError('practiceIntegrity.previewUrl is invalid');
  }
  if (!raw.controlled) {
    if (raw.contextId !== undefined || raw.policy !== undefined || raw.revisions !== undefined) {
      throw new TypeError('uncontrolled practiceIntegrity must not contain a trusted context');
    }
    return {
      controlled: false,
      bypassed: raw.bypassed,
      previewAvailable: raw.previewAvailable,
      entry,
      ...(raw.previewUrl ? { previewUrl: raw.previewUrl } : {}),
    };
  }
  if (raw.bypassed) throw new TypeError('controlled practiceIntegrity cannot bypass its policy');
  const contextId = canonicalObjectId(raw.contextId, 'practiceIntegrity.contextId');
  if (typeof raw.expiresAt !== 'string' || Number.isNaN(new Date(raw.expiresAt).getTime())) {
    throw new TypeError('practiceIntegrity.expiresAt is invalid');
  }
  if (raw.mode !== 'student' && raw.mode !== 'preview') throw new TypeError('practiceIntegrity.mode is invalid');
  if (!raw.policy || typeof raw.policy !== 'object' || Array.isArray(raw.policy)) throw new TypeError('practiceIntegrity.policy is invalid');
  const policy = raw.policy as Record<string, unknown>;
  for (const field of ['prohibitExternalCodeInjection', 'removeIndependentSubmitForm', 'antiAiCopyInjection']) {
    if (typeof policy[field] !== 'boolean') throw new TypeError(`practiceIntegrity.policy.${field} is invalid`);
  }
  if (!Array.isArray(raw.revisions) || !raw.revisions.length) throw new TypeError('practiceIntegrity.revisions is invalid');
  const revisions = raw.revisions.map((revision, index) => ({
    ...readEntry(revision, `practiceIntegrity.revisions[${index}]`),
    revision: canonicalPositiveInteger((revision as Record<string, unknown>).revision, `practiceIntegrity.revisions[${index}].revision`),
  }));
  return {
    controlled: true,
    bypassed: false,
    previewAvailable: raw.previewAvailable,
    entry,
    ...(raw.previewUrl ? { previewUrl: raw.previewUrl } : {}),
    contextId,
    expiresAt: raw.expiresAt,
    mode: raw.mode,
    policy: {
      prohibitExternalCodeInjection: policy.prohibitExternalCodeInjection as boolean,
      removeIndependentSubmitForm: policy.removeIndependentSubmitForm as boolean,
      antiAiCopyInjection: policy.antiAiCopyInjection as boolean,
    },
    revisions,
  };
}

export function practiceProblemEntryUrl(base: string, target: PracticeEntryTarget, preview = false): string {
  const query = new URLSearchParams({
    practiceContainerKind: target.containerKind,
    practiceContainerId: target.containerId,
    practiceScopeKind: target.scopeKind,
    practiceScopeId: String(target.scopeId),
  });
  if (preview) query.set('practicePreview', 'true');
  return `${base}${base.includes('?') ? '&' : '?'}${query.toString()}`;
}

export function practiceDraftIdentity(context: PracticeIntegrityPageContext): string | null {
  if (!context.controlled || !context.revisions || !context.mode) return null;
  const revisions = context.revisions
    .map((revision) => [revision.containerKind, revision.containerId, revision.scopeKind, revision.scopeId, revision.revision].map(String).join(':'))
    .sort()
    .join('|');
  return `${context.mode}|${revisions}`;
}
