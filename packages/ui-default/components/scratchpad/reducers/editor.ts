let cacheKey = `${UserContext._id}/${UiContext.pdoc.domainId}/${UiContext.pdoc.docId}`;
if (UiContext.tdoc?._id) cacheKey += `@${UiContext.tdoc._id}`;
const controlled = UiContext.practiceIntegrity?.controlled === true;
if (controlled) {
  const context = UiContext.practiceIntegrity;
  if (!['student', 'preview'].includes(context.mode) || !Array.isArray(context.revisions) || !context.revisions.length) {
    throw new TypeError('controlled practice integrity draft identity is invalid');
  }
  const revisions = context.revisions
    .map((revision) => [revision.containerKind, revision.containerId, revision.scopeKind, revision.scopeId, revision.revision].map(String).join(':'))
    .sort()
    .join('|');
  cacheKey += `@practice:${context.mode}|${revisions}`;
}
const codeKey = (lang: string) => (controlled ? `${cacheKey}#code:${encodeURIComponent(lang)}` : cacheKey);
const initialLang = localStorage.getItem(`${cacheKey}#lang`) || UiContext.codeLang;

// TODO switch to indexeddb
export default function reducer(
  state = {
    lang: initialLang,
    code: localStorage.getItem(codeKey(initialLang)) ?? UiContext.codeTemplate,
  },
  action: any = {},
) {
  if (action.type === 'SCRATCHPAD_EDITOR_UPDATE_CODE') {
    localStorage.setItem(codeKey(state.lang), action.payload);
    return {
      ...state,
      code: action.payload,
    };
  }
  if (action.type === 'SCRATCHPAD_EDITOR_SET_LANG') {
    localStorage.setItem(`${cacheKey}#lang`, action.payload);
    return {
      ...state,
      lang: action.payload,
      ...(controlled ? { code: localStorage.getItem(codeKey(action.payload)) ?? UiContext.codeTemplate } : {}),
    };
  }
  return state;
}
