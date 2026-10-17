import type { LegacyCatalogs } from '@/pages/teach/legacy-forms';
import { FormField } from '@/components/ui/form';
import { MultiSelect } from '@/components/ui/multi-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type AudienceMode = 'all' | 'groups' | 'schools';

export interface AudienceValue {
  mode: AudienceMode | null;
  groupIds: string[];
  schoolIds: string[];
}

type AudienceGroup = LegacyCatalogs['groups'][number];
type AudienceSchool = LegacyCatalogs['schools'][number];

const GROUP_DESCRIPTION = '只有组里已绑定的学生能看到';
const SCHOOL_DESCRIPTION = '按学生记录所在学校限定';
const GROUP_HINT = '只能选你自己的组，或学校开放给老师的组。';
const CHOOSE_ERROR = '请选择给谁做';
const GROUP_ERROR = '请至少选择一个用户组';
const SCHOOL_ERROR = '请至少选择一所学校';
const ARCHIVED_SUFFIX = '（已归档）';

export function audienceErrors(value: AudienceValue): string | null {
  if (value.mode === null) return CHOOSE_ERROR;
  if (value.mode === 'all') return null;
  if (value.mode === 'groups') return value.groupIds.length === 0 ? GROUP_ERROR : null;
  if (value.mode === 'schools') return value.schoolIds.length === 0 ? SCHOOL_ERROR : null;
  const unexpected: never = value.mode;
  throw new TypeError(`audience_mode_invalid:${String(unexpected)}`);
}

function groupKey(group: AudienceGroup): string {
  return group.id;
}

function groupLabel(group: AudienceGroup): string {
  return group.archived ? `${group.name}${ARCHIVED_SUFFIX}` : group.name;
}

function schoolKey(school: AudienceSchool): string {
  return school.id;
}

function schoolLabel(school: AudienceSchool): string {
  return school.name;
}

// MultiSelect chips are dnd-kit buttons named by the label, same as the open
// list row. The extra word keeps the closed chip from impersonating that row.
function selectedChip(label: string) {
  return (
    <>
      {label}
      <span className="sr-only">已选</span>
    </>
  );
}

function selectedFromCatalog<T extends { id: string }>(
  ids: readonly string[],
  catalog: readonly T[],
  missing: (id: string) => T,
): T[] {
  const byId = new Map<string, T>();
  for (const item of catalog) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const selected: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    selected.push(byId.get(id) ?? missing(id));
  }
  return selected;
}

export function AudienceField({
  name,
  value,
  onChange,
  allowSchools,
  groups,
  schools,
  allDescription,
  error,
  lockedReason,
}: {
  name: string;
  value: AudienceValue;
  onChange: (next: AudienceValue) => void;
  allowSchools: boolean;
  groups: LegacyCatalogs['groups'];
  schools: LegacyCatalogs['schools'];
  allDescription: string;
  error?: string | null;
  lockedReason?: string | null;
}) {
  const lockedText = lockedReason || null;
  const selectedGroups = selectedFromCatalog(value.groupIds, groups, (id) => ({ id, name: id, archived: false }));
  const selectedSchools = selectedFromCatalog(value.schoolIds, schools, (id) => ({ id, name: id }));

  function selectMode(mode: AudienceMode) {
    if (lockedText) return;
    onChange({ mode, groupIds: value.groupIds, schoolIds: value.schoolIds });
  }

  return (
    <FormField label="给谁做" required error={error || undefined}>
      <RadioGroup orientation="vertical">
        <RadioGroupItem
          name={name}
          value="all"
          checked={value.mode === 'all'}
          disabled={lockedText !== null}
          label="所有人"
          description={allDescription}
          onChange={() => selectMode('all')}
        />
        <RadioGroupItem
          name={name}
          value="groups"
          checked={value.mode === 'groups'}
          disabled={lockedText !== null}
          label="指定用户组"
          description={GROUP_DESCRIPTION}
          onChange={() => selectMode('groups')}
        />
        {allowSchools ? (
          <RadioGroupItem
            name={name}
            value="schools"
            checked={value.mode === 'schools'}
            disabled={lockedText !== null}
            label="指定学校"
            description={SCHOOL_DESCRIPTION}
            onChange={() => selectMode('schools')}
          />
        ) : null}
      </RadioGroup>
      {value.mode === 'groups' ? (
        <>
          <MultiSelect
            options={groups}
            value={selectedGroups}
            onChange={(next) => {
              onChange({
                mode: value.mode,
                groupIds: next.map((group) => group.id),
                schoolIds: value.schoolIds,
              });
            }}
            getKey={groupKey}
            getLabel={groupLabel}
            renderChip={(group) => selectedChip(groupLabel(group))}
            placeholder="搜索用户组"
            disabled={lockedText !== null}
          />
          <p className="text-xs text-fg-subtle">{GROUP_HINT}</p>
        </>
      ) : null}
      {value.mode === 'schools' && allowSchools ? (
        <MultiSelect
          options={schools}
          value={selectedSchools}
          onChange={(next) => {
            onChange({
              mode: value.mode,
              groupIds: value.groupIds,
              schoolIds: next.map((school) => school.id),
            });
          }}
          getKey={schoolKey}
          getLabel={schoolLabel}
          renderChip={(school) => selectedChip(schoolLabel(school))}
          placeholder="搜索学校"
          disabled={lockedText !== null}
        />
      ) : null}
      {lockedText ? <p className="text-xs text-fg-muted">{lockedText}</p> : null}
    </FormField>
  );
}
