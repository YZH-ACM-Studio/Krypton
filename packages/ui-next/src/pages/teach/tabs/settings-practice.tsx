import type { TeachTab } from '@hydrooj/common';
import { useEffect, useState, type ReactElement } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { toast } from '@/components/ui/toast';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { useBootstrap } from '@/lib/bootstrap';
import { practiceFormBody, type PracticeFormState } from '../legacy-forms';
import type { TeachWorkbenchPayload } from '../model';
import {
  countChangedKeys,
  DangerPanel,
  SaveBar,
  SharePanel,
  SwitchRow,
  useLegacySnapshot,
  useWorkbenchDirty,
} from '../settings-kit';

const LOADING = '正在读取设置。';
const LOAD_FAILED = '题目集设置没有加载出来。';
const WRONG_KIND = '读到的不是练习设置。';
const SAVE_FAILED = '保存失败。';
const SAVED = '已保存';
const CONTENT_HINT = '学生在详情页看到，支持 Markdown';
const DESCRIPTION_HINT = '列表里显示的一句话';
const PIN_LABEL = '置顶';
const PIN_DESCRIPTION = '在题集列表最前面显示。';
const PRACTICE_NOUN = '练习';

interface PracticeSettingsDraft {
  title: string;
  description: string;
  content: string;
  pin: boolean;
}

const BASIC_KEYS = ['title', 'description', 'content'] as const satisfies readonly (keyof PracticeSettingsDraft)[];
const PINNED_KEYS = ['title', 'description', 'content', 'pin'] as const satisfies readonly (keyof PracticeSettingsDraft)[];

function fieldsOf(state: PracticeFormState): PracticeSettingsDraft {
  return {
    title: state.title,
    description: state.description,
    content: state.content,
    pin: state.pin,
  };
}

function saveMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return SAVE_FAILED;
}

export function SettingsPracticeTab({
  payload,
}: {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}): ReactElement {
  const { status, snapshot, error, reload, save } = useLegacySnapshot();
  const { setTabDirty } = useWorkbenchDirty();
  const locale = useBootstrap().locale;
  const titleId = 'practice-settings-title';
  const descriptionId = 'practice-settings-description';
  const pinId = 'practice-settings-pin';
  const practice = snapshot?.kind === 'practice' ? snapshot.value : null;
  const [draft, setDraft] = useState<PracticeSettingsDraft | null>(null);
  const [base, setBase] = useState<PracticeSettingsDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const canPin = payload.capabilities.canPin;
  const dirtyCount = draft && base ? countChangedKeys(base, draft, canPin ? PINNED_KEYS : BASIC_KEYS) : 0;
  const navigationGuard = useUnsavedChangesGuard(dirtyCount > 0);
  const wrongKind = status === 'ready' && snapshot !== null && snapshot.kind !== 'practice';

  useEffect(() => {
    if (!practice) return;
    const next = fieldsOf(practice.state);
    setBase(next);
    setDraft(next);
  }, [practice]);

  useEffect(() => {
    setTabDirty('settings', dirtyCount > 0);
  }, [dirtyCount, setTabDirty]);

  useEffect(() => () => setTabDirty('settings', false), [setTabDirty]);

  function patch(next: Partial<PracticeSettingsDraft>) {
    if (saving) return;
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function discard() {
    if (!base || saving) return;
    setDraft(base);
    setSaveError(null);
  }

  function retry() {
    void reload().catch((caught: unknown) => {
      console.error('teach practice settings reload failed', { id: payload.container.id, error: caught });
    });
  }

  async function onSave() {
    if (!draft || saving) return;
    const current = draft;
    setSaving(true);
    setSaveError(null);
    try {
      await save((latest) => {
        if (latest.kind !== 'practice') throw new Error(WRONG_KIND);
        return practiceFormBody({
          ...latest.value.state,
          title: current.title,
          description: current.description,
          content: current.content,
          ...(canPin ? { pin: current.pin } : {}),
        });
      });
      toast.success(SAVED);
    } catch (caught) {
      console.error('teach practice settings save failed', { id: payload.container.id, error: caught });
      setSaveError(saveMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (payload.container.type !== 'practice') {
    return <Alert tone="danger">{WRONG_KIND}</Alert>;
  }

  const loadError = wrongKind ? WRONG_KIND : status === 'error' ? (error ?? LOAD_FAILED) : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Panel title="基本信息">
        {draft ? (
          <div className="flex flex-col gap-5">
            <FormField label="标题" htmlFor={titleId} inline>
              <Input
                id={titleId}
                value={draft.title}
                disabled={saving}
                onChange={(event) => patch({ title: event.target.value })}
              />
            </FormField>
            <FormField label="简介" htmlFor={descriptionId} hint={DESCRIPTION_HINT} inline>
              <Input
                id={descriptionId}
                value={draft.description}
                disabled={saving}
                onChange={(event) => patch({ description: event.target.value })}
              />
            </FormField>
            <FormField label="说明" hint={CONTENT_HINT} inline>
              <div className={saving ? 'pointer-events-none' : undefined}>
                <MarkdownEditor
                  name="content"
                  value={draft.content}
                  preferredLang={locale}
                  minHeight={240}
                  onChange={(content) => {
                    if (saving) return;
                    patch({ content });
                  }}
                />
              </div>
            </FormField>
            {canPin ? (
              <div className="border-t border-line-subtle">
                <SwitchRow
                  id={pinId}
                  label={PIN_LABEL}
                  description={PIN_DESCRIPTION}
                  checked={draft.pin}
                  disabled={saving}
                  onCheckedChange={(pin) => patch({ pin })}
                />
              </div>
            ) : null}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-start gap-3">
            <Alert tone="danger">{loadError}</Alert>
            <Button type="button" variant="secondary" onClick={retry}>重试</Button>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{LOADING}</p>
        )}
      </Panel>
      <SharePanel type="practice" id={payload.container.id} canShare={payload.capabilities.canShare} />
      <DangerPanel
        type="practice"
        id={payload.container.id}
        title={draft?.title || payload.container.title}
        noun={PRACTICE_NOUN}
        canDelete={payload.capabilities.canDelete}
      />
      {saveError ? <Alert tone="danger">{saveError}</Alert> : null}
      <SaveBar dirtyCount={dirtyCount} saving={saving} onSave={() => { void onSave(); }} onDiscard={discard} />
      {navigationGuard.guardDialog}
    </div>
  );
}
