import { SimpleSelect } from '@/components/ui/select';

export type ContestParticipationMode = 'individual' | 'team';

export const ACM_PARTICIPATION_OPTIONS = [
  { value: 'individual', label: '个人赛' },
  { value: 'team', label: '1–3 人团队 ACM' },
];

interface ContestParticipationFieldProps {
  rule: string;
  value: ContestParticipationMode;
  onValueChange: (value: ContestParticipationMode) => void;
}

export function ContestParticipationField({ rule, value, onValueChange }: ContestParticipationFieldProps) {
  if (rule !== 'acm') return <input type="hidden" name="participationMode" value="individual" />;

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">参赛身份</label>
      <SimpleSelect
        name="participationMode"
        value={value}
        onValueChange={(nextValue) => onValueChange(nextValue as ContestParticipationMode)}
        options={ACM_PARTICIPATION_OPTIONS}
      />
      <p className="text-[11px] text-muted-foreground">团队模式强制通过 Vigil Client 进入且不计个人 Rating。</p>
    </div>
  );
}
