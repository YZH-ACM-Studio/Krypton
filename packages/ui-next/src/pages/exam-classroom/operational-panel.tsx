import type { JSX } from 'react';
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Ban,
    CheckCircle2,
    CircleDashed,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import {
    DISABLED_REASON_LABELS,
    FACING_LABELS,
    formatDate,
    type SeatDisabledReason,
    type SeatFacing,
    type SeatOperationalProfile,
} from './model';

const FACINGS: readonly SeatFacing[] = ['unset', 'up', 'right', 'down', 'left'];

const DISABLED_REASON_OPTIONS: Array<{ value: SeatDisabledReason; label: string }> = (
    Object.keys(DISABLED_REASON_LABELS) as SeatDisabledReason[]
).map((reason) => ({
    value: reason,
    label: DISABLED_REASON_LABELS[reason],
}));

function FacingIcon({ facing }: { facing: SeatFacing }) {
    if (facing === 'up') return <ArrowUp aria-hidden="true" />;
    if (facing === 'right') return <ArrowRight aria-hidden="true" />;
    if (facing === 'down') return <ArrowDown aria-hidden="true" />;
    if (facing === 'left') return <ArrowLeft aria-hidden="true" />;
    return <CircleDashed aria-hidden="true" />;
}

function disabledReasonFromSelect(value: string): SeatDisabledReason {
    switch (value) {
        case 'computer_failure':
        case 'client_incompatible':
        case 'physical_seat_unavailable':
        case 'manual_reserve':
            return value;
        default:
            throw new Error(`未知的禁用原因：${value}`);
    }
}

function revisionLine(profile: SeatOperationalProfile, displayName: (uid: number | null | undefined) => string): string {
    let text = `当前 revision ${profile.revision}`;
    if (profile.previousRevision !== null) text += ` · 上一版 r${profile.previousRevision}`;
    if (profile.persisted && profile.createdAt !== null) {
        text += ` · ${formatDate(profile.createdAt)} · ${displayName(profile.createdBy)}`;
    } else {
        text += ' · 当前布局使用未持久化默认值';
    }
    return text;
}

export function OperationalPanel({
    profile,
    selectedSeatIds,
    visibleSeatIds,
    busy,
    disabledReason,
    note,
    displayName,
    onDisabledReasonChange,
    onNoteChange,
    onSelectVisible,
    onClear,
    onFacing,
    onDisable,
    onRestore,
}: {
    profile: SeatOperationalProfile;
    selectedSeatIds: Set<string>;
    visibleSeatIds: string[];
    busy: boolean;
    disabledReason: SeatDisabledReason;
    note: string;
    displayName: (uid: number | null | undefined) => string;
    onDisabledReasonChange: (reason: SeatDisabledReason) => void;
    onNoteChange: (note: string) => void;
    onSelectVisible: () => void;
    onClear: () => void;
    onFacing: (facing: SeatFacing) => void;
    onDisable: () => void;
    onRestore: () => void;
}): JSX.Element {
    const selectedCount = selectedSeatIds.size;
    const selectionLocked = busy || selectedCount === 0;
    const canRestore = profile.entries.some((entry) => selectedSeatIds.has(entry.sourceSeatId) && !entry.enabled);
    return (
        <Panel title="批量设置运行配置" description="不修改布局几何和终端绑定，每次操作立即保存为新版本。">
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p>
                        <span className="sr-only">{`已选 ${selectedCount} 个座位`}</span>
                        <span className="text-xl font-semibold tabular">{selectedCount}</span>
                        {' '}
                        <span className="text-xs text-fg-subtle">个座位已选</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="ghost" size="sm" type="button" disabled={busy || visibleSeatIds.length === 0} onClick={onSelectVisible}>
                            选择当前结果
                        </Button>
                        <Button variant="ghost" size="sm" type="button" disabled={selectionLocked} onClick={onClear}>
                            清空选择
                        </Button>
                    </div>
                </div>
                <p className="text-xs text-fg-subtle">点击座位切换选择，或在布局空白处拖动框选。</p>
                <fieldset disabled={selectionLocked} className="flex flex-col gap-2">
                    <legend className="text-xs font-medium">朝向</legend>
                    <div className="grid grid-cols-5 gap-1.5">
                        {FACINGS.map((facing) => (
                            <Button key={facing} variant="secondary" size="sm" type="button" onClick={() => onFacing(facing)}>
                                <FacingIcon facing={facing} />
                                {FACING_LABELS[facing]}
                            </Button>
                        ))}
                    </div>
                </fieldset>
                <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium">禁用</p>
                    <SimpleSelect
                        ariaLabel="禁用原因"
                        value={disabledReason}
                        onValueChange={(reason) => onDisabledReasonChange(disabledReasonFromSelect(reason))}
                        disabled={busy}
                        size="sm"
                        options={DISABLED_REASON_OPTIONS}
                    />
                    <Input
                        aria-label="禁用备注（可选）"
                        value={note}
                        maxLength={240}
                        onChange={(event) => onNoteChange(event.target.value)}
                        placeholder="可选备注，最多 240 字"
                        disabled={busy}
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <Button variant="danger-soft" size="sm" type="button" disabled={selectionLocked} onClick={onDisable}>
                            <Ban aria-hidden="true" />
                            禁用所选
                        </Button>
                        <Button variant="secondary" size="sm" type="button" disabled={busy || !canRestore} onClick={onRestore}>
                            <CheckCircle2 aria-hidden="true" />
                            恢复所选
                        </Button>
                    </div>
                </div>
                <p className="font-mono text-2xs text-fg-subtle">{revisionLine(profile, displayName)}</p>
            </div>
        </Panel>
    );
}
