import {
  problemKindToSlug,
  TEACH_ALLOWED_KINDS,
} from '@hydrooj/common';
import type { BasicObjectiveKind, TeachType } from '@hydrooj/common';
import { Plus, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MiniTabs, type MiniTabItem } from '@/components/ui/mini-tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SimpleSelect } from '@/components/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { postForm } from '../api';
import { TEACH_KIND_LABEL, type TeachComposePayload } from '../model';
import type { PaperItem } from '../paper';

const BASIC_KIND_ORDER = ['true_false', 'single', 'multi', 'blank'] as const satisfies readonly BasicObjectiveKind[];
const OPTION_MIN = 2;
const OPTION_MAX = 8;
const TITLE_MAX = 60;
const TITLE_CODE_UNITS = 64;
const SCORE_MIN = 1;
const SCORE_MAX = 1000;
const CREATE_FALLBACK = '新建题目失败';
const EMPTY_STEM = '请填写题干';
const EMPTY_OPTION = '选项不能为空。';
const SINGLE_ANSWER = '请选择一个正确答案。';
const MULTI_ANSWER = '至少勾选一个正确答案。';
const EMPTY_BLANK = '请填写标准答案。';
const BAD_SCORE = '分值必须是 1 到 1000 的整数。';
const EMPTY_NODE = '请选择知识点。';
const BAD_PID = '服务器返回的题号不是数字。';
const OBJECTIVE_GUARD = '这个类型不能加客观题';
const OWNED = '题目归你所有，进「我的题目」，默认不共享。';
const SINGLE_HINT = '选一个正确答案';
const MULTI_HINT = '勾选全部正确答案';
const SCORE_HINT = '默认用本组的每题分值。';
const KNOWLEDGE_HINT = '选择这道题属于的知识点。';
const BLANK_HINT = '学生答案与标准答案逐字比较，前后空格忽略。';
const STEM_PLACEHOLDER = '支持 Markdown 和公式';

type KnowledgeOption = TeachComposePayload['knowledgeOptions'][number];

interface ObjectiveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: TeachType;
  initialKind: BasicObjectiveKind;
  defaultScore: (kind: BasicObjectiveKind) => number | null;
  knowledgeOptions: TeachComposePayload['knowledgeOptions'];
  defaultNodeId: string | null;
  onCreated: (item: PaperItem) => void;
}

interface ReadyCreate {
  title: string;
  content: string;
  score: number;
  mapId: string;
  nodeId: string;
  main: Record<string, unknown>;
}

function objectiveKindsFor(type: TeachType): BasicObjectiveKind[] {
  if (!Object.hasOwn(TEACH_ALLOWED_KINDS, type)) throw new TypeError('teach_type_invalid');
  const allowed = TEACH_ALLOWED_KINDS[type];
  return BASIC_KIND_ORDER.filter((kind) => allowed.includes(kind));
}

function startingKind(type: TeachType, initialKind: BasicObjectiveKind): BasicObjectiveKind {
  const kinds = objectiveKindsFor(type);
  if (kinds.includes(initialKind)) return initialKind;
  return kinds[0] ?? initialKind;
}

function scoreFieldValue(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return String(value);
}

function resolveNodeId(defaultNodeId: string | null, options: readonly KnowledgeOption[]): string {
  if (typeof defaultNodeId !== 'string' || defaultNodeId === '') return '';
  return options.some((option) => option.id === defaultNodeId) ? defaultNodeId : '';
}

function optionLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 25) {
    throw new TypeError(`选项序号 ${index} 超出 A 到 Z`);
  }
  return String.fromCharCode(65 + index);
}

/** First line, markdown marks removed, then at most 60 code points and 64 UTF-16 code units. */
function objectiveTitle(stem: string): string {
  const line = stem.split(/\r?\n/, 1)[0] ?? '';
  const withoutLinks = line
    .replace(/!?\[([^[\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^[\]]*)\]\[[^\]]*\]/g, '$1');
  const plain = withoutLinks.replace(/[#*`$]/g, '').trim();
  const points = Array.from(plain);
  let end = Math.min(points.length, TITLE_MAX);
  let title = points.slice(0, end).join('');
  while (end > 0 && title.length > TITLE_CODE_UNITS) {
    end -= 1;
    title = points.slice(0, end).join('');
  }
  return title;
}

function parseScore(raw: string): number | null {
  const text = raw.trim();
  if (!/^[1-9]\d{0,3}$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < SCORE_MIN || value > SCORE_MAX) return null;
  return value;
}

function readDocId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    if (error.message.startsWith('teach_payload_invalid:')) return '服务器返回了无法解析的响应。';
    return error.message;
  }
  return CREATE_FALLBACK;
}

function sheetDescription(kindLabel: string, nodeLabel: string | null): string {
  const attached = nodeLabel ? `挂到知识点「${nodeLabel}」，并` : '';
  return `保存后${attached}加入「${kindLabel}」组。${OWNED}`;
}

function ObjectiveForm({
  type,
  initialKind,
  defaultScore,
  knowledgeOptions,
  defaultNodeId,
  onOpenChange,
  onCreated,
  blockCloseRef,
  closeEpochRef,
}: Omit<ObjectiveSheetProps, 'open'> & {
  blockCloseRef: { current: boolean };
  closeEpochRef: { current: number };
}) {
  const kinds = objectiveKindsFor(type);
  const stemId = useId();
  const scoreId = useId();
  const knowledgeId = useId();
  const blankId = useId();
  const [kind, setKind] = useState(() => startingKind(type, initialKind));
  const [stem, setStem] = useState('');
  const [score, setScore] = useState(() => scoreFieldValue(defaultScore(startingKind(type, initialKind))));
  const [nodeId, setNodeId] = useState(() => resolveNodeId(defaultNodeId, knowledgeOptions));
  const [options, setOptions] = useState<string[]>(() => ['', '']);
  const [singleAnswer, setSingleAnswer] = useState(0);
  const [multiAnswers, setMultiAnswers] = useState<number[]>([]);
  const [trueAnswer, setTrueAnswer] = useState(true);
  const [blankAnswer, setBlankAnswer] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const requestSeq = useRef(0);
  const mountedRef = useRef(true);
  const activeKind = kinds.includes(kind) ? kind : (kinds[0] ?? kind);
  const selectedNode = knowledgeOptions.find((option) => option.id === nodeId) ?? null;
  const kindLabel = TEACH_KIND_LABEL[activeKind];

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function selectKind(next: BasicObjectiveKind) {
    if (next === kind) return;
    setKind(next);
    setScore(scoreFieldValue(defaultScore(next)));
    setOptions(['', '']);
    setSingleAnswer(0);
    setMultiAnswers([]);
    setTrueAnswer(true);
    setBlankAnswer('');
    setError('');
  }

  function setOption(index: number, value: string) {
    setOptions((current) => current.map((option, optionIndex) => (optionIndex === index ? value : option)));
  }

  function addOption() {
    setOptions((current) => (current.length >= OPTION_MAX ? current : [...current, '']));
  }

  function removeOption(index: number) {
    if (options.length <= OPTION_MIN) return;
    setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index));
    setSingleAnswer((current) => {
      if (index < current) return current - 1;
      if (index === current) return 0;
      return current;
    });
    setMultiAnswers((current) => current.flatMap((answer) => {
      if (answer === index) return [];
      return [answer > index ? answer - 1 : answer];
    }));
  }

  function toggleMulti(index: number, checked: boolean) {
    setMultiAnswers((current) => {
      if (checked) return current.includes(index) ? current : [...current, index];
      return current.filter((answer) => answer !== index);
    });
  }

  function validate(): { ok: true; value: ReadyCreate } | { ok: false; message: string } {
    const title = objectiveTitle(stem);
    if (title === '') return { ok: false, message: EMPTY_STEM };
    let main: Record<string, unknown>;
    if (activeKind === 'single' || activeKind === 'multi') {
      if (options.length < OPTION_MIN || options.length > OPTION_MAX) return { ok: false, message: '选项需要 2 到 8 个。' };
      if (options.some((option) => option.trim() === '')) return { ok: false, message: EMPTY_OPTION };
      if (activeKind === 'single') {
        if (!Number.isInteger(singleAnswer) || singleAnswer < 0 || singleAnswer >= options.length) {
          return { ok: false, message: SINGLE_ANSWER };
        }
        main = { options, answerIndex: singleAnswer };
      } else {
        const answerIndexes = [...multiAnswers]
          .filter((index) => Number.isInteger(index) && index >= 0 && index < options.length)
          .sort((left, right) => left - right);
        if (answerIndexes.length < 1) return { ok: false, message: MULTI_ANSWER };
        main = { options, answerIndexes, partialCreditPercent: 0 };
      }
    } else if (activeKind === 'true_false') {
      main = { answer: trueAnswer };
    } else if (activeKind === 'blank') {
      if (blankAnswer.trim() === '') return { ok: false, message: EMPTY_BLANK };
      main = { answer: blankAnswer };
    } else {
      return { ok: false, message: OBJECTIVE_GUARD };
    }
    const parsedScore = parseScore(score);
    if (parsedScore === null) return { ok: false, message: BAD_SCORE };
    if (!selectedNode || selectedNode.id.trim() === '' || selectedNode.mapId.trim() === '') {
      return { ok: false, message: EMPTY_NODE };
    }
    return {
      ok: true,
      value: {
        title,
        content: stem,
        score: parsedScore,
        mapId: selectedNode.mapId,
        nodeId: selectedNode.id,
        main,
      },
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    setError('');
    const ready = validate();
    if (!ready.ok) {
      setError(ready.message);
      return;
    }
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    const epoch = closeEpochRef.current + 1;
    closeEpochRef.current = epoch;
    savingRef.current = true;
    blockCloseRef.current = true;
    setSaving(true);
    let created: PaperItem | null = null;
    try {
      const body = new URLSearchParams();
      body.set('title', ready.value.title);
      body.set('content', ready.value.content);
      body.set('knowledgeMapId', ready.value.mapId);
      body.set('knowledgeNodeIds', ready.value.nodeId);
      body.set('editorProblemKind', activeKind);
      body.set('structuredConfig', JSON.stringify({ main: ready.value.main }));
      const response = await postForm(`/problem/create/${problemKindToSlug(activeKind)}`, body, CREATE_FALLBACK);
      const docId = readDocId(response.pid);
      if (docId === null) throw new Error(BAD_PID);
      created = {
        docId,
        pid: `P${docId}`,
        title: ready.value.title,
        kind: activeKind,
        score: ready.value.score,
        hidden: true,
        stageId: null,
      };
    } catch (caught) {
      console.error('objective sheet create failed', { kind: activeKind, stage: 'create', error: caught });
      if (mountedRef.current && seq === requestSeq.current) setError(messageOf(caught));
    } finally {
      savingRef.current = false;
      if (closeEpochRef.current === epoch) blockCloseRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
    if (!created) return;
    // The server already created the hidden problem. Deliver it even if this sheet unmounted.
    onCreated(created);
    if (mountedRef.current) onOpenChange(false);
  }

  const tabs: MiniTabItem<BasicObjectiveKind>[] = kinds.map((item) => ({
    value: item,
    label: TEACH_KIND_LABEL[item],
  }));
  const attachedLabel = selectedNode && selectedNode.label !== '' ? selectedNode.label : null;

  return (
    <>
      <SheetHeader>
        <SheetTitle>{`新建${kindLabel}`}</SheetTitle>
        <p className="mt-0.5 text-sm text-fg-muted">{sheetDescription(kindLabel, attachedLabel)}</p>
      </SheetHeader>
      <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody>
        <div className="flex flex-col gap-5 px-5 py-4">
          <MiniTabs size="sm" aria-label="题型" value={activeKind} onValueChange={selectKind} items={tabs} />
          <FormField label="题干" htmlFor={stemId} required>
            <Textarea
              id={stemId}
              value={stem}
              onChange={(event) => setStem(event.target.value)}
              placeholder={STEM_PLACEHOLDER}
              rows={5}
            />
          </FormField>
          {activeKind === 'true_false' ? (
            <FormField label="标准答案">
              <RadioGroup orientation="horizontal" aria-label="标准答案">
                <RadioGroupItem
                  name="objective-true-false"
                  checked={trueAnswer}
                  onChange={() => setTrueAnswer(true)}
                  label="正确"
                />
                <RadioGroupItem
                  name="objective-true-false"
                  checked={!trueAnswer}
                  onChange={() => setTrueAnswer(false)}
                  label="错误"
                />
              </RadioGroup>
            </FormField>
          ) : null}
          {activeKind === 'blank' ? (
            <FormField label="标准答案" htmlFor={blankId} hint={BLANK_HINT}>
              <Input
                id={blankId}
                value={blankAnswer}
                onChange={(event) => setBlankAnswer(event.target.value)}
              />
            </FormField>
          ) : null}
          {activeKind === 'single' || activeKind === 'multi' ? (
            <FormField
              label={(
                <span className="inline-flex min-w-0 items-baseline gap-1.5">
                  选项
                  <span className="text-xs font-normal text-fg-subtle">
                    {activeKind === 'single' ? SINGLE_HINT : MULTI_HINT}
                  </span>
                </span>
              )}
            >
              <div className="flex flex-col gap-2">
                {options.map((option, index) => {
                  const letter = optionLetter(index);
                  return (
                    <div key={letter} className="flex min-w-0 items-center gap-2">
                      {activeKind === 'single' ? (
                        <RadioGroupItem
                          name="objective-choice"
                          checked={singleAnswer === index}
                          onChange={() => setSingleAnswer(index)}
                          aria-label={`${letter} 是正确答案`}
                        />
                      ) : (
                        <Checkbox
                          size="sm"
                          checked={multiAnswers.includes(index)}
                          onCheckedChange={(checked) => toggleMulti(index, checked)}
                          aria-label={`${letter} 是正确答案`}
                        />
                      )}
                      <span className="w-4 shrink-0 text-center font-mono text-xs text-fg-subtle">{letter}</span>
                      <Input
                        aria-label={`选项 ${letter}`}
                        value={option}
                        onChange={(event) => setOption(index, event.target.value)}
                        className="min-w-0 flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        iconOnly
                        aria-label={`删除选项 ${letter}`}
                        disabled={options.length <= OPTION_MIN}
                        onClick={() => removeOption(index)}
                      >
                        <X />
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={options.length >= OPTION_MAX}
                  onClick={addOption}
                >
                  <Plus />
                  加一个选项
                </Button>
              </div>
            </FormField>
          ) : null}
          <FormField label="分值" htmlFor={scoreId} hint={SCORE_HINT}>
            <Input
              id={scoreId}
              className="w-24"
              value={score}
              onChange={(event) => setScore(event.target.value)}
            />
          </FormField>
          <FormField label="知识点" htmlFor={knowledgeId} required hint={KNOWLEDGE_HINT}>
            <SimpleSelect
              id={knowledgeId}
              value={nodeId}
              onValueChange={setNodeId}
              placeholder="选择知识点"
              options={knowledgeOptions.map((option) => ({ value: option.id, label: option.label }))}
            />
          </FormField>
        </div>
      </SheetBody>
      {error ? (
        <div className="shrink-0 px-5 pt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">
        <Button type="button" variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          保存并加入试卷
        </Button>
      </div>
    </form>
    </>
  );
}

export function ObjectiveSheet({
  open,
  onOpenChange,
  type,
  initialKind,
  defaultScore,
  knowledgeOptions,
  defaultNodeId,
  onCreated,
}: ObjectiveSheetProps): JSX.Element {
  const kinds = objectiveKindsFor(type);
  const wasOpen = useRef(open);
  const blockCloseRef = useRef(false);
  const closeEpochRef = useRef(0);
  const [session, setSession] = useState(0);

  useEffect(() => {
    const previous = wasOpen.current;
    wasOpen.current = open;
    if (!open || previous) return;
    setSession((current) => current + 1);
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next && blockCloseRef.current) return;
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right">
        {kinds.length === 0 ? (
          <>
            <SheetHeader>
              <SheetTitle>新建客观题</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <p className="px-5 py-4 text-sm text-fg">{OBJECTIVE_GUARD}</p>
            </SheetBody>
            <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
                取消
              </Button>
            </div>
          </>
        ) : (
          <ObjectiveForm
            key={session}
            type={type}
            initialKind={initialKind}
            defaultScore={defaultScore}
            knowledgeOptions={knowledgeOptions}
            defaultNodeId={defaultNodeId}
            onOpenChange={handleOpenChange}
            onCreated={onCreated}
            blockCloseRef={blockCloseRef}
            closeEpochRef={closeEpochRef}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
