// A static import fails collection while objective-sheet.tsx is absent.
import { type ComponentType } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, it, vi,
  type Mock,
} from 'vitest';

const sheetLoaders = import.meta.glob('../../src/pages/teach/compose/objective-sheet.tsx');

const SHEET_SOURCE = 'src/pages/teach/compose/objective-sheet.tsx';
const ORIGIN = 'http://krypton.local';
const SAVE = '保存并加入试卷';
const CANCEL = '取消';
const ADD_OPTION = '加一个选项';
const STEM_PLACEHOLDER = '支持 Markdown 和公式';
const EMPTY_TITLE = '请填写题干';
const GUARD = '这个类型不能加客观题';
const SCORE_HINT = '默认用本组的每题分值。';
const KNOWLEDGE_HINT = '过渡期只能选公开导图的知识点。';
const BLANK_HINT = '学生答案与标准答案逐字比较，前后空格忽略。';
const SINGLE_HINT = '选一个正确答案';
const MULTI_HINT = '勾选全部正确答案';
const OWNED = '题目归你所有，进「我的题目」，默认不共享。';
const SERVER_MESSAGE = '这个知识点不能挂题。';
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
const KIND_ORDER = ['判断题', '单选题', '多选题', '填空题'] as const;
const CREATE_FIELDS = [
  'content',
  'editorProblemKind',
  'knowledgeMapId',
  'knowledgeNodeIds',
  'structuredConfig',
  'title',
] as const;

type TeachType = 'practice' | 'homework' | 'exam' | 'acm' | 'oi';
type BasicObjectiveKind = 'true_false' | 'single' | 'multi' | 'blank';
type User = ReturnType<typeof userEvent.setup>;
type TextControl = HTMLInputElement | HTMLTextAreaElement;

const SCORES: Record<BasicObjectiveKind, number> = {
  true_false: 2,
  single: 3,
  multi: 4,
  blank: 5,
};

const STACK = { id: 'node-stack', mapId: 'map-algo', label: '栈' };
const QUEUE = { id: 'node-queue', mapId: 'map-ds', label: '队列' };

interface CreatedItem {
  docId: number;
  pid: string;
  title: string;
  kind: string;
  score: number | null;
  hidden: boolean;
  stageId: number | null;
}

interface ObjectiveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: TeachType;
  initialKind: BasicObjectiveKind;
  defaultScore: (kind: BasicObjectiveKind) => number | null;
  knowledgeOptions: Array<{ id: string; mapId: string; label: string }>;
  defaultNodeId: string | null;
  onCreated: (item: CreatedItem) => void;
}

interface CapturedCall {
  pathname: string;
  method: string;
  fields: Record<string, string>;
  credentials: string;
  accept: string;
}

interface SheetHandle {
  onCreated: Mock<(item: CreatedItem) => void>;
  onOpenChange: Mock<(open: boolean) => void>;
  unmount: () => void;
}

let captured: CapturedCall[] = [];
let nextBody: unknown = { ok: true, pid: 42, hidden: true, problemKind: 'single', structureRevision: 1 };
let nextStatus = 200;
let fetchHold: Promise<void> | null = null;
let releaseHeldFetch: (() => void) | null = null;
let Sheet: ComponentType<ObjectiveSheetProps>;

function scoreFor(kind: BasicObjectiveKind): number | null {
  return SCORES[kind];
}

function sheetDescription(kindLabel: string, nodeLabel: string | null): string {
  const attached = nodeLabel ? `挂到知识点「${nodeLabel}」，并` : '';
  return `保存后${attached}加入「${kindLabel}」组。${OWNED}`;
}

function createdItem(fields: { docId: number; title: string; kind: string; score: number | null }): CreatedItem {
  return {
    docId: fields.docId,
    pid: `P${fields.docId}`,
    title: fields.title,
    kind: fields.kind,
    score: fields.score,
    hidden: true,
    stageId: null,
  };
}

function readField(record: object, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(sheetLoaders)) {
    if (key.endsWith(SHEET_SOURCE)) return () => load();
  }
  return undefined;
}

async function loadSheet(): Promise<ComponentType<ObjectiveSheetProps>> {
  const load = loader();
  expect(typeof load, SHEET_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${SHEET_SOURCE} must exist`);
  const imported: unknown = await load();
  if (!isRecord(imported)) throw new TypeError(`${SHEET_SOURCE} must be a module`);
  const component = readField(imported, 'ObjectiveSheet');
  expect(typeof component, 'ObjectiveSheet').toBe('function');
  if (typeof component !== 'function') throw new TypeError('ObjectiveSheet must be exported');
  return component as ComponentType<ObjectiveSheetProps>;
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  if (!headers) return '';
  const wanted = name.toLowerCase();
  if (headers instanceof Headers) return headers.get(name) ?? '';
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === wanted);
    return found?.[1] ?? '';
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && typeof value === 'string') return value;
  }
  return '';
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, ORIGIN);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function requestCredentials(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.credentials) return init.credentials;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.credentials;
  return '';
}

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  const body = init?.body;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') params.append(key, value);
    }
    return params.toString();
  }
  if (typeof Request !== 'undefined' && input instanceof Request && init?.body === undefined) {
    return input.clone().text();
  }
  return '';
}

function formFields(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const fields: Record<string, string> = {};
  for (const [key, value] of params.entries()) fields[key] = value;
  return fields;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function reply(body: unknown, status = 200) {
  nextBody = body;
  nextStatus = status;
}

function successBody(pid: number, kind: BasicObjectiveKind): Record<string, unknown> {
  return {
    ok: true, pid, hidden: true, problemKind: kind, structureRevision: 1,
  };
}

function serverError(message: string, status = 400): Record<string, unknown> {
  return {
    error: {
      name: 'ValidationError',
      errorCode: 'ValidationError',
      code: status,
      status,
      params: [],
      message,
    },
  };
}

function holdFetch() {
  let finish: ((value: void) => void) | null = null;
  fetchHold = new Promise<void>((done) => {
    finish = done;
  });
  releaseHeldFetch = () => {
    const done = finish;
    fetchHold = null;
    releaseHeldFetch = null;
    if (done) done();
  };
}

function releaseFetch() {
  releaseHeldFetch?.();
}

function installFetch() {
  captured = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const hold = fetchHold;
    const headers = init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
    captured.push({
      pathname: requestUrl(input).pathname,
      method: requestMethod(input, init),
      fields: formFields(await readBody(input, init)),
      credentials: requestCredentials(input, init),
      accept: headerValue(headers, 'accept'),
    });
    if (hold) await hold;
    return jsonResponse(nextBody, nextStatus);
  }));
}

function posts(): CapturedCall[] {
  return captured.filter((call) => call.method === 'POST');
}

function sheetProps(overrides: Partial<ObjectiveSheetProps> = {}): ObjectiveSheetProps {
  return {
    open: true,
    type: 'exam',
    initialKind: 'single',
    defaultScore: scoreFor,
    knowledgeOptions: [STACK, QUEUE],
    defaultNodeId: STACK.id,
    onCreated: () => {},
    onOpenChange: () => {},
    ...overrides,
  };
}

function renderSheet(overrides: Partial<ObjectiveSheetProps> = {}): SheetHandle {
  const onCreated = vi.fn<(item: CreatedItem) => void>();
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const view = render(<Sheet {...sheetProps({ ...overrides, onCreated, onOpenChange })} />);
  return { onCreated, onOpenChange, unmount: view.unmount };
}

function renderOpenSheet(): SheetHandle & { setOpen: (open: boolean) => void } {
  const onCreated = vi.fn<(item: CreatedItem) => void>();
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const view = render(<Sheet {...sheetProps({ onCreated, onOpenChange })} />);
  return {
    onCreated,
    onOpenChange,
    unmount: view.unmount,
    setOpen: (open: boolean) => {
      view.rerender(<Sheet {...sheetProps({ open, onCreated, onOpenChange })} />);
    },
  };
}

function findLabel(name: string): HTMLLabelElement {
  const found = [...document.querySelectorAll('label')].find((label) => {
    return (label.textContent ?? '').replace(/\*/g, '').replace(/\s+/g, '') === name;
  });
  if (!(found instanceof HTMLLabelElement)) throw new TypeError(`missing label ${name}`);
  return found;
}

function preferredControl(scope: ParentNode, label: HTMLElement): HTMLElement | null {
  for (const node of scope.querySelectorAll('textarea, input, [role="combobox"]')) {
    if (!(node instanceof HTMLElement) || label.contains(node)) continue;
    const type = node.getAttribute('type');
    if (type === 'hidden' || type === 'radio' || type === 'checkbox') continue;
    return node;
  }
  return null;
}

function controlFromLabel(name: string): HTMLElement {
  const label = findLabel(name);
  const id = label.getAttribute('for');
  if (id) {
    const linked = document.getElementById(id);
    if (linked instanceof HTMLElement) return linked;
  }
  let scope: HTMLElement | null = label.parentElement;
  while (scope) {
    const control = preferredControl(scope, label);
    if (control) return control;
    scope = scope.parentElement;
  }
  throw new TypeError(`missing control ${name}`);
}

function asField(element: HTMLElement): TextControl {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element;
  throw new TypeError('expected a text field');
}

function stemControl(): TextControl {
  return asField(controlFromLabel('题干'));
}

function scoreControl(): TextControl {
  return asField(controlFromLabel('分值'));
}

function knowledgeControl(): HTMLElement {
  return controlFromLabel('知识点');
}

function optionInputs(): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const letter of OPTION_LETTERS) {
    const input = screen.queryByRole('textbox', { name: `选项 ${letter}` });
    if (!input) break;
    found.push(input);
  }
  return found;
}

function optionInput(letter: string): HTMLElement {
  return screen.getByRole('textbox', { name: `选项 ${letter}` });
}

function resetValueTracker(element: TextControl) {
  if (!Object.hasOwn(element, '_valueTracker')) return;
  const tracker: unknown = Reflect.get(element, '_valueTracker');
  if (!isRecord(tracker)) return;
  const setValue = tracker.setValue;
  if (typeof setValue !== 'function') return;
  Reflect.apply(setValue, tracker, ['']);
}

function setNativeValue(element: TextControl, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new TypeError('missing value setter');
  act(() => {
    resetValueTracker(element);
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function replaceValue(user: User, element: TextControl, value: string) {
  await user.click(element);
  await user.clear(element);
  if (value !== '') await user.paste(value);
  if (element.value !== value) setNativeValue(element, value);
  expect(element.value).toBe(value);
}

async function fillOptionCount(user: User, count: number) {
  for (let guard = 0; guard < 12 && optionInputs().length < count; guard += 1) {
    await user.click(screen.getByRole('button', { name: ADD_OPTION }));
  }
  for (let guard = 0; guard < 12 && optionInputs().length > count; guard += 1) {
    const inputs = optionInputs();
    const last = inputs[inputs.length - 1];
    const letter = (last?.getAttribute('aria-label') ?? '').replace('选项 ', '');
    await user.click(screen.getByRole('button', { name: `删除选项 ${letter}` }));
  }
  expect(optionInputs()).toHaveLength(count);
}

async function clickSave(user: User) {
  await user.click(screen.getByRole('button', { name: SAVE }));
}

async function postedForm(): Promise<CapturedCall> {
  await waitFor(() => {
    expect(posts()).toHaveLength(1);
  });
  const form = posts()[0];
  if (!form) throw new TypeError('missing create request');
  return form;
}

function expectCreate(form: CapturedCall, pathname: string) {
  expect(captured.every((call) => call.method === 'POST')).toBe(true);
  expect(form.pathname).toBe(pathname);
  expect(form.credentials).toBe('same-origin');
  expect(form.accept.toLowerCase()).toContain('application/json');
  expect(Object.keys(form.fields).sort()).toEqual([...CREATE_FIELDS].sort());
}

function expectConfig(form: CapturedCall, main: Record<string, unknown>) {
  const parsed: unknown = JSON.parse(form.fields.structuredConfig ?? '');
  expect(parsed).toEqual({ main });
}

async function expectNoPost() {
  await waitFor(() => {
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(posts()).toHaveLength(0);
  });
}

async function expectNoPostText(text: string) {
  await waitFor(() => {
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(posts()).toHaveLength(0);
    expect(document.body.textContent ?? '').toContain(text);
  });
}

async function prepareChoices(user: User, kind: 'single' | 'multi') {
  await fillOptionCount(user, 2);
  await replaceValue(user, asField(optionInput('A')), '甲');
  await replaceValue(user, asField(optionInput('B')), '乙');
  if (kind === 'single') {
    await user.click(screen.getByRole('radio', { name: 'B 是正确答案' }));
    return;
  }
  for (const letter of OPTION_LETTERS) {
    const box = screen.queryByRole('checkbox', { name: `${letter} 是正确答案` });
    if (box instanceof HTMLInputElement && box.checked) await user.click(box);
  }
  const target = screen.getByRole('checkbox', { name: 'B 是正确答案' });
  if (target instanceof HTMLInputElement && !target.checked) await user.click(target);
}

async function prepareSingle(user: User, stem: string, score?: string) {
  await prepareChoices(user, 'single');
  await replaceValue(user, stemControl(), stem);
  if (score !== undefined) await replaceValue(user, scoreControl(), score);
}

function expectClosed(handle: SheetHandle) {
  expect(handle.onOpenChange).toHaveBeenCalledWith(false);
}

beforeEach(async () => {
  fetchHold = null;
  releaseHeldFetch = null;
  reply(successBody(42, 'single'));
  installFetch();
  Sheet = await loadSheet();
});

afterEach(() => {
  releaseFetch();
  vi.unstubAllGlobals();
});

describe('objective quick-create sheet', () => {
  it('renders the single sheet on the selected public knowledge point', async () => {
    renderSheet();

    expect(screen.getByRole('dialog')).toHaveAttribute('data-side', 'right');
    expect(screen.getByRole('heading', { name: '新建单选题' })).toBeInTheDocument();
    expect(document.body.textContent ?? '').toContain(sheetDescription('单选题', '栈'));
    expect(screen.getAllByRole('tab').map((tab) => (tab.textContent ?? '').trim())).toEqual([...KIND_ORDER]);
    expect(screen.getByRole('tab', { name: '单选题' })).toHaveAttribute('aria-selected', 'true');
    expect(stemControl()).toHaveAttribute('placeholder', STEM_PLACEHOLDER);
    expect(findLabel('题干').textContent ?? '').toContain('*');
    expect(findLabel('知识点').textContent ?? '').toContain('*');
    expect(screen.getByText(SINGLE_HINT)).toBeInTheDocument();
    expect(screen.getByText(SCORE_HINT)).toBeInTheDocument();
    expect(screen.getByText(KNOWLEDGE_HINT)).toBeInTheDocument();
    expect(scoreControl().value).toBe('3');
    expect(scoreControl().className).toContain('w-24');
    expect(knowledgeControl().textContent ?? '').toContain('栈');
    expect(screen.getByRole('button', { name: CANCEL })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByRole('button', { name: SAVE })).toHaveAttribute('data-variant', 'primary');
    expect(screen.getByRole('button', { name: ADD_OPTION })).toHaveAttribute('data-variant', 'ghost');
    expect(screen.getByRole('button', { name: ADD_OPTION })).toHaveAttribute('data-size', 'sm');
  });

  it('posts two single options with the stripped title and answer b', async () => {
    const user = userEvent.setup();
    const handle = renderSheet();
    const stem = '# 下列说法正确的是';
    await prepareSingle(user, stem, '12');
    expect(screen.getByRole('radio', { name: 'B 是正确答案' })).toBeChecked();

    await clickSave(user);
    const form = await postedForm();

    expectCreate(form, '/problem/create/single');
    expect(form.fields.title).toBe('下列说法正确的是');
    expect(form.fields.content).toBe(stem);
    expect(form.fields.editorProblemKind).toBe('single');
    expect(form.fields.knowledgeMapId).toBe(STACK.mapId);
    expect(form.fields.knowledgeNodeIds).toBe(STACK.id);
    expectConfig(form, { options: ['甲', '乙'], answerIndex: 1 });
    await waitFor(() => expect(handle.onCreated).toHaveBeenCalledTimes(1));
    expect(handle.onCreated.mock.calls[0]?.[0]).toEqual(createdItem({
      docId: 42,
      title: '下列说法正确的是',
      kind: 'single',
      score: 12,
    }));
    expectClosed(handle);
  });

  it('posts a true or false question to the true-false path', async () => {
    const user = userEvent.setup();
    reply(successBody(7, 'true_false'));
    const handle = renderSheet({ initialKind: 'true_false' });
    const group = screen.getByRole('radiogroup');

    expect(screen.getByRole('heading', { name: '新建判断题' })).toBeInTheDocument();
    expect(group.className).toContain('flex-row');
    expect(screen.getByRole('radio', { name: '正确' })).toBeChecked();
    expect(scoreControl().value).toBe('2');
    await user.click(screen.getByRole('radio', { name: '错误' }));
    await replaceValue(user, stemControl(), '栈空时 top 为 -1');
    await clickSave(user);
    const form = await postedForm();

    expectCreate(form, '/problem/create/true-false');
    expect(form.fields.title).toBe('栈空时 top 为 -1');
    expect(form.fields.content).toBe('栈空时 top 为 -1');
    expect(form.fields.editorProblemKind).toBe('true_false');
    expect(form.fields.knowledgeMapId).toBe(STACK.mapId);
    expect(form.fields.knowledgeNodeIds).toBe(STACK.id);
    expectConfig(form, { answer: false });
    await waitFor(() => expect(handle.onCreated).toHaveBeenCalledTimes(1));
    expect(handle.onCreated.mock.calls[0]?.[0]).toEqual(createdItem({
      docId: 7,
      title: '栈空时 top 为 -1',
      kind: 'true_false',
      score: 2,
    }));
    expectClosed(handle);
  });

  it('shows an error and does not post without a knowledge point', async () => {
    const user = userEvent.setup();
    const missing = renderSheet({ defaultNodeId: null });
    expect(document.body.textContent ?? '').toContain(sheetDescription('单选题', null));
    expect(document.body.textContent ?? '').not.toContain('挂到知识点');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    await prepareSingle(user, '队列的出队');
    await clickSave(user);
    await expectNoPost();
    expect(missing.onCreated).not.toHaveBeenCalled();
    expect(missing.onOpenChange).not.toHaveBeenCalledWith(false);
    missing.unmount();

    captured.length = 0;
    const unknown = renderSheet({ defaultNodeId: 'missing-node' });
    expect(document.body.textContent ?? '').not.toContain('挂到知识点');
    await prepareSingle(user, '队列的出队');
    await clickSave(user);
    await expectNoPost();
    expect(unknown.onCreated).not.toHaveBeenCalled();
  });

  it('shows only the objective guard for acm and oi', () => {
    for (const type of ['acm', 'oi'] as const) {
      const handle = renderSheet({ type, initialKind: 'single' });
      expect(screen.getByText(GUARD)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.queryByPlaceholderText(STEM_PLACEHOLDER)).toBeNull();
      expect(screen.queryByRole('textbox', { name: '选项 A' })).toBeNull();
      expect(screen.queryByText(SINGLE_HINT)).toBeNull();
      handle.unmount();
    }
    expect(posts()).toHaveLength(0);
  });

  it('derives the title from the first line and rejects an empty one', async () => {
    const user = userEvent.setup();
    // 链接语法和正文里的 # 有两种合理拆法，这里不断言。
    const cases = [
      { stem: '下列说法\n第二行不进标题', title: '下列说法' },
      { stem: '**加粗**和`码`和$a$', title: '加粗和码和a' },
      { stem: `## ${'题'.repeat(61)}`, title: '题'.repeat(60) },
      { stem: '##没有空格标题', title: '没有空格标题' },
    ];
    for (const [index, entry] of cases.entries()) {
      reply(successBody(20 + index, 'single'));
      captured.length = 0;
      const handle = renderSheet();
      await prepareSingle(user, entry.stem, '6');
      await clickSave(user);
      const form = await postedForm();
      expect(form.fields.title).toBe(entry.title);
      expect(form.fields.content).toBe(entry.stem);
      expect(form.pathname).toBe('/problem/create/single');
      await waitFor(() => expect(handle.onCreated).toHaveBeenCalledTimes(1));
      expect(handle.onCreated.mock.calls[0]?.[0]).toEqual(createdItem({
        docId: 20 + index,
        title: entry.title,
        kind: 'single',
        score: 6,
      }));
      handle.unmount();
    }

    for (const stem of ['', '   ', '###', '#\n第二行正文']) {
      captured.length = 0;
      const handle = renderSheet();
      await prepareSingle(user, stem, '6');
      expect(screen.queryAllByRole('alert')).toHaveLength(0);
      await clickSave(user);
      await expectNoPostText(EMPTY_TITLE);
      expect(handle.onCreated).not.toHaveBeenCalled();
      handle.unmount();
    }
  });

  it('rejects an empty option, an empty blank, and a score outside 1 to 1000', async () => {
    const user = userEvent.setup();
    const emptyOption = renderSheet();
    await fillOptionCount(user, 2);
    await replaceValue(user, asField(optionInput('B')), '乙');
    await user.click(screen.getByRole('radio', { name: 'B 是正确答案' }));
    await replaceValue(user, stemControl(), '题干还在');
    await clickSave(user);
    await expectNoPost();
    expect(emptyOption.onCreated).not.toHaveBeenCalled();
    emptyOption.unmount();

    captured.length = 0;
    const blank = renderSheet({ initialKind: 'blank' });
    await replaceValue(user, stemControl(), '填空题干');
    expect(screen.getByText(BLANK_HINT)).toBeInTheDocument();
    await clickSave(user);
    await expectNoPost();
    blank.unmount();

    captured.length = 0;
    const scored = renderSheet();
    await prepareSingle(user, '分值边界');
    for (const score of ['', '0', '1001', '1.5', '-1']) {
      captured.length = 0;
      await replaceValue(user, scoreControl(), score);
      await clickSave(user);
      await expectNoPost();
    }
    reply(successBody(11, 'single'));
    captured.length = 0;
    await replaceValue(user, scoreControl(), '1');
    await clickSave(user);
    const low = await postedForm();
    expect(low.fields.title).toBe('分值边界');
    await waitFor(() => expect(scored.onCreated).toHaveBeenCalledTimes(1));
    expect(scored.onCreated.mock.calls[0]?.[0]).toEqual(createdItem({
      docId: 11, title: '分值边界', kind: 'single', score: 1,
    }));
    reply(successBody(12, 'single'));
    captured.length = 0;
    await replaceValue(user, scoreControl(), '1000');
    await clickSave(user);
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() => expect(scored.onCreated).toHaveBeenCalledTimes(2));
    expect(scored.onCreated.mock.calls[1]?.[0]).toEqual(createdItem({
      docId: 12, title: '分值边界', kind: 'single', score: 1000,
    }));
  });

  it('posts multi and blank answers and keeps two to eight options', async () => {
    const user = userEvent.setup();
    const choices = renderSheet({ initialKind: 'single' });
    await fillOptionCount(user, 3);
    expect(screen.getByRole('button', { name: '删除选项 C' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '删除选项 C' })).toHaveAttribute('data-variant', 'ghost');
    await fillOptionCount(user, 2);
    expect(screen.queryByRole('textbox', { name: '选项 C' })).toBeNull();
    const floor = ['A', 'B']
      .map((letter) => screen.queryByRole('button', { name: `删除选项 ${letter}` }))
      .filter((button): button is HTMLElement => button instanceof HTMLElement);
    for (const button of floor) expect(button).toBeDisabled();
    await fillOptionCount(user, 8);
    const add = screen.getByRole('button', { name: ADD_OPTION });
    const addDisabled = add.hasAttribute('disabled') || add.getAttribute('aria-disabled') === 'true';
    if (!addDisabled) await user.click(add);
    expect(optionInputs()).toHaveLength(8);
    expect(screen.queryByRole('textbox', { name: '选项 I' })).toBeNull();
    choices.unmount();

    captured.length = 0;
    reply(successBody(31, 'multi'));
    const multi = renderSheet({ initialKind: 'multi' });
    expect(screen.getByText(MULTI_HINT)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'A 是正确答案' })).toBeNull();
    await prepareChoices(user, 'multi');
    for (const letter of ['A', 'B']) {
      const box = screen.getByRole('checkbox', { name: `${letter} 是正确答案` });
      if (box instanceof HTMLInputElement && box.checked) await user.click(box);
    }
    await replaceValue(user, stemControl(), '多选至少一项');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    await clickSave(user);
    await expectNoPost();
    const checked = screen.getByRole('checkbox', { name: 'B 是正确答案' });
    if (checked instanceof HTMLInputElement && !checked.checked) await user.click(checked);
    captured.length = 0;
    await clickSave(user);
    const multiForm = await postedForm();
    expectCreate(multiForm, '/problem/create/multi');
    expect(multiForm.fields.editorProblemKind).toBe('multi');
    expect(multiForm.fields.title).toBe('多选至少一项');
    expectConfig(multiForm, { options: ['甲', '乙'], answerIndexes: [1], partialCreditPercent: 0 });
    await waitFor(() => expect(multi.onCreated).toHaveBeenCalledTimes(1));
    expect(multi.onCreated.mock.calls[0]?.[0]).toEqual(createdItem({
      docId: 31, title: '多选至少一项', kind: 'multi', score: 4,
    }));
    multi.unmount();

    captured.length = 0;
    reply(successBody(32, 'blank'));
    const blank = renderSheet({ initialKind: 'blank' });
    await replaceValue(user, stemControl(), '循环队列');
    await replaceValue(user, asField(controlFromLabel('标准答案')), 'n-1');
    await clickSave(user);
    const blankForm = await postedForm();
    expectCreate(blankForm, '/problem/create/blank');
    expect(blankForm.fields.editorProblemKind).toBe('blank');
    expect(blankForm.fields.title).toBe('循环队列');
    expect(blankForm.fields.content).toBe('循环队列');
    expectConfig(blankForm, { answer: 'n-1' });
    await waitFor(() => expect(blank.onCreated).toHaveBeenCalledTimes(1));
    expect(blank.onCreated.mock.calls[0]?.[0]).toEqual(createdItem({
      docId: 32, title: '循环队列', kind: 'blank', score: 5,
    }));
  });

  it('shows the server message and rejects a pid that is not an integer doc id', async () => {
    const user = userEvent.setup();
    reply(serverError(SERVER_MESSAGE), 400);
    const failed = renderSheet();
    await prepareSingle(user, '服务端会拒绝');
    await clickSave(user);
    await waitFor(() => {
      expect(posts()).toHaveLength(1);
      expect(document.body.textContent ?? '').toContain(SERVER_MESSAGE);
    });
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(failed.onCreated).not.toHaveBeenCalled();
    expect(failed.onOpenChange).not.toHaveBeenCalledWith(false);
    failed.unmount();

    for (const pid of ['P42', 42.5, null]) {
      captured.length = 0;
      reply({ ok: true, pid, hidden: true, problemKind: 'single', structureRevision: 1 });
      const handle = renderSheet();
      await prepareSingle(user, '返回的不是题号');
      expect(screen.queryAllByRole('alert')).toHaveLength(0);
      await clickSave(user);
      await waitFor(() => {
        expect(posts()).toHaveLength(1);
        expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
      });
      expect(handle.onCreated).not.toHaveBeenCalled();
      expect(handle.onOpenChange).not.toHaveBeenCalledWith(false);
      handle.unmount();
    }
  });

  it('cancels without posting and follows the selected kind and knowledge point', async () => {
    const user = userEvent.setup();
    const closed = renderSheet({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    closed.unmount();

    const handle = renderSheet();
    await user.click(screen.getByRole('button', { name: CANCEL }));
    expect(handle.onOpenChange).toHaveBeenCalledWith(false);
    expect(handle.onCreated).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);

    expect(scoreControl().value).toBe(String(SCORES.single));
    const keptStem = '题干留下来';
    await replaceValue(user, stemControl(), keptStem);
    await fillOptionCount(user, 3);
    await replaceValue(user, asField(optionInput('A')), '甲');
    await replaceValue(user, asField(optionInput('B')), '乙');
    await replaceValue(user, asField(optionInput('C')), '丙');
    await user.click(screen.getByRole('radio', { name: 'C 是正确答案' }));
    await user.click(screen.getByRole('tab', { name: '多选题' }));
    await replaceValue(user, asField(optionInput('A')), '多甲');
    await replaceValue(user, asField(optionInput('B')), '多乙');
    const multiA = screen.getByRole('checkbox', { name: 'A 是正确答案' });
    const multiB = screen.getByRole('checkbox', { name: 'B 是正确答案' });
    if (multiA instanceof HTMLInputElement && !multiA.checked) await user.click(multiA);
    if (multiB instanceof HTMLInputElement && !multiB.checked) await user.click(multiB);
    await user.click(screen.getByRole('tab', { name: '填空题' }));
    await replaceValue(user, asField(controlFromLabel('标准答案')), '旧填空');
    await user.click(screen.getByRole('tab', { name: '判断题' }));
    await user.click(screen.getByRole('radio', { name: '错误' }));
    expect(screen.getByRole('radio', { name: '错误' })).toBeChecked();

    await user.click(screen.getByRole('tab', { name: '单选题' }));
    expect(optionInputs()).toHaveLength(2);
    expect(asField(optionInput('A')).value).toBe('');
    expect(asField(optionInput('B')).value).toBe('');
    expect(screen.queryByRole('textbox', { name: '选项 C' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'A 是正确答案' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'B 是正确答案' })).not.toBeChecked();
    expect(stemControl().value).toBe(keptStem);
    expect(knowledgeControl().textContent ?? '').toContain(STACK.label);

    await user.click(screen.getByRole('tab', { name: '多选题' }));
    expect(optionInputs()).toHaveLength(2);
    expect(asField(optionInput('A')).value).toBe('');
    expect(asField(optionInput('B')).value).toBe('');
    expect(screen.getByRole('checkbox', { name: 'A 是正确答案' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'B 是正确答案' })).not.toBeChecked();
    expect(stemControl().value).toBe(keptStem);
    expect(knowledgeControl().textContent ?? '').toContain(STACK.label);

    await user.click(screen.getByRole('tab', { name: '判断题' }));
    expect(screen.getByRole('radio', { name: '正确' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '错误' })).not.toBeChecked();
    expect(stemControl().value).toBe(keptStem);
    expect(knowledgeControl().textContent ?? '').toContain(STACK.label);

    await user.click(screen.getByRole('tab', { name: '填空题' }));
    expect(asField(controlFromLabel('标准答案')).value).toBe('');
    expect(screen.queryByRole('textbox', { name: '选项 A' })).toBeNull();
    expect(stemControl().value).toBe(keptStem);
    expect(knowledgeControl().textContent ?? '').toContain(STACK.label);

    await user.click(screen.getByRole('tab', { name: '单选题' }));
    expect(scoreControl().value).toBe(String(SCORES.single));
    await user.click(screen.getByRole('tab', { name: '多选题' }));
    expect(screen.getByRole('heading', { name: '新建多选题' })).toBeInTheDocument();
    expect(document.body.textContent ?? '').toContain(sheetDescription('多选题', '栈'));
    expect(scoreControl().value).toBe(String(SCORES.multi));
    expect(screen.getByText(MULTI_HINT)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '填空题' }));
    expect(screen.getByRole('heading', { name: '新建填空题' })).toBeInTheDocument();
    expect(screen.getByText(BLANK_HINT)).toBeInTheDocument();
    expect(screen.queryByText(SINGLE_HINT)).toBeNull();
    expect(screen.queryByRole('textbox', { name: '选项 A' })).toBeNull();
    expect(scoreControl().value).toBe(String(SCORES.blank));

    await user.click(screen.getByRole('tab', { name: '判断题' }));
    expect(screen.getByRole('radiogroup').className).toContain('flex-row');
    expect(screen.getByRole('radio', { name: '正确' })).toBeChecked();
    expect(scoreControl().value).toBe(String(SCORES.true_false));
    expect(document.body.textContent ?? '').toContain(sheetDescription('判断题', '栈'));

    await user.click(knowledgeControl());
    await user.click(await screen.findByRole('option', { name: QUEUE.label }));
    expect(knowledgeControl().textContent ?? '').toContain(QUEUE.label);
    expect(document.body.textContent ?? '').toContain(sheetDescription('判断题', QUEUE.label));
    expect(document.body.textContent ?? '').not.toContain(sheetDescription('判断题', STACK.label));

    reply(successBody(9, 'true_false'));
    await replaceValue(user, stemControl(), '切换后的判断');
    await clickSave(user);
    const form = await postedForm();
    expectCreate(form, '/problem/create/true-false');
    expect(form.fields.editorProblemKind).toBe('true_false');
    expect(form.fields.knowledgeMapId).toBe(QUEUE.mapId);
    expect(form.fields.knowledgeNodeIds).toBe(QUEUE.id);
    expect(form.fields.title).toBe('切换后的判断');
    expectConfig(form, { answer: true });
    await waitFor(() => expect(handle.onCreated).toHaveBeenCalledTimes(1));
    expect(handle.onCreated.mock.calls[0]?.[0]).toEqual(createdItem({
      docId: 9, title: '切换后的判断', kind: 'true_false', score: 2,
    }));
  });

  it('strips markdown links out of the saved title', async () => {
    const user = userEvent.setup();
    const handle = renderSheet();
    const stem = '见[说法](https://example.com/a)和![图](https://example.com/b.png)及[参考][1]';
    await prepareSingle(user, stem, '8');
    await clickSave(user);
    const form = await postedForm();
    expect(form.fields.title).toBe('见说法和图及参考');
    expect(form.fields.content).toBe(stem);
    await waitFor(() => expect(handle.onCreated).toHaveBeenCalledTimes(1));
    expect(handle.onCreated.mock.calls[0]?.[0]).toEqual(createdItem({
      docId: 42,
      title: '见说法和图及参考',
      kind: 'single',
      score: 8,
    }));
  });

  it('offers the four objective kinds for practice and homework', () => {
    for (const type of ['practice', 'homework'] as const) {
      const handle = renderSheet({ type, initialKind: 'blank' });
      expect(screen.queryByText(GUARD)).toBeNull();
      expect(screen.getByRole('button', { name: SAVE })).toBeInTheDocument();
      expect(screen.getAllByRole('tab').map((tab) => (tab.textContent ?? '').trim())).toEqual([...KIND_ORDER]);
      expect(screen.getByRole('tab', { name: '填空题' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText(BLANK_HINT)).toBeInTheDocument();
      handle.unmount();
    }
  });

  it('keeps the checked choice when an earlier option is removed', async () => {
    const user = userEvent.setup();
    const handle = renderSheet();
    await fillOptionCount(user, 3);
    await replaceValue(user, asField(optionInput('A')), '甲');
    await replaceValue(user, asField(optionInput('B')), '乙');
    await replaceValue(user, asField(optionInput('C')), '丙');
    await user.click(screen.getByRole('radio', { name: 'C 是正确答案' }));
    await user.click(screen.getByRole('button', { name: '删除选项 A' }));
    expect(screen.queryByRole('textbox', { name: '选项 C' })).toBeNull();
    expect(asField(optionInput('A')).value).toBe('乙');
    expect(asField(optionInput('B')).value).toBe('丙');
    expect(screen.getByRole('radio', { name: 'B 是正确答案' })).toBeChecked();
    await replaceValue(user, stemControl(), '删掉前面的选项');
    await clickSave(user);
    const form = await postedForm();
    expectCreate(form, '/problem/create/single');
    expectConfig(form, { options: ['乙', '丙'], answerIndex: 1 });
    await waitFor(() => expect(handle.onCreated).toHaveBeenCalledTimes(1));
  });

  it('rejects a blank answer that is only spaces', async () => {
    const user = userEvent.setup();
    const handle = renderSheet({ initialKind: 'blank' });
    await replaceValue(user, stemControl(), '空格不能当答案');
    await replaceValue(user, asField(controlFromLabel('标准答案')), '   ');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    await clickSave(user);
    await expectNoPostText('请填写标准答案。');
    expect(handle.onCreated).not.toHaveBeenCalled();
  });

  it('rejects an option that is only spaces', async () => {
    const user = userEvent.setup();
    const handle = renderSheet();
    await fillOptionCount(user, 2);
    await replaceValue(user, asField(optionInput('A')), '   ');
    await replaceValue(user, asField(optionInput('B')), '乙');
    await user.click(screen.getByRole('radio', { name: 'B 是正确答案' }));
    await replaceValue(user, stemControl(), '空格选项');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    await clickSave(user);
    await expectNoPostText('选项不能为空。');
    expect(handle.onCreated).not.toHaveBeenCalled();
  });

  it('keeps score 15 and the current error when the selected single tab is clicked again', async () => {
    const user = userEvent.setup();
    const handle = renderSheet();
    await prepareChoices(user, 'single');
    await replaceValue(user, scoreControl(), '15');
    await clickSave(user);
    await expectNoPostText(EMPTY_TITLE);
    await user.click(screen.getByRole('tab', { name: '单选题' }));
    expect(screen.getByRole('tab', { name: '单选题' })).toHaveAttribute('aria-selected', 'true');
    expect(scoreControl().value).toBe('15');
    expect(screen.getByRole('alert').textContent ?? '').toContain(EMPTY_TITLE);
    await replaceValue(user, stemControl(), '分值没有被重置');
    captured.length = 0;
    await clickSave(user);
    const form = await postedForm();
    expect(form.fields.title).toBe('分值没有被重置');
    await waitFor(() => expect(handle.onCreated).toHaveBeenCalledTimes(1));
    expect(handle.onCreated.mock.calls[0]?.[0]).toEqual(createdItem({
      docId: 42,
      title: '分值没有被重置',
      kind: 'single',
      score: 15,
    }));
  });

  it('stays loading and ignores escape until the held create request finishes', async () => {
    const user = userEvent.setup();
    holdFetch();
    const handle = renderSheet();
    await prepareSingle(user, '保存中不能关');
    await clickSave(user);
    await waitFor(() => {
      expect(posts()).toHaveLength(1);
      expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
    });
    const save = screen.getByRole('button', { name: SAVE });
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: CANCEL })).toBeDisabled();
    expect(handle.onCreated).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(handle.onOpenChange).not.toHaveBeenCalledWith(false);
    releaseFetch();
    await waitFor(() => expect(handle.onCreated).toHaveBeenCalledTimes(1));
  });

  it('reports the created problem once after the parent closes and unmounts the sheet', async () => {
    const user = userEvent.setup();
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onRejection);
    holdFetch();
    const handle = renderOpenSheet();
    try {
      await prepareSingle(user, '卸载后仍加入');
      await clickSave(user);
      await waitFor(() => expect(posts()).toHaveLength(1));
      handle.setOpen(false);
      handle.unmount();
      releaseFetch();
      await waitFor(() => expect(handle.onCreated).toHaveBeenCalledTimes(1));
      expect(rejections).toEqual([]);
    } finally {
      window.removeEventListener('unhandledrejection', onRejection);
      releaseFetch();
    }
  });

  it('places an empty stem alert outside the sheet body and before save', async () => {
    const user = userEvent.setup();
    const handle = renderSheet();
    await prepareSingle(user, '');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    await clickSave(user);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toContain(EMPTY_TITLE);
    expect(alert.closest('[data-scroll-owner="sheet"]')).toBeNull();
    const save = screen.getByRole('button', { name: SAVE });
    const position = alert.compareDocumentPosition(save);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(posts()).toHaveLength(0);
    expect(handle.onCreated).not.toHaveBeenCalled();
  });
});
