export type RuleId = 'DS001' | 'DS002' | 'DS003' | 'DS004' | 'DS005' | 'DS006' | 'DS007'
  | 'DS009' | 'DS010' | 'DS011' | 'DS012' | 'DS013' | 'DS014' | 'DS015';

export interface Rule {
  id: RuleId;
  description: string;
  exemptUi: boolean;
}

export interface Violation {
  file: string;
  line: number;
  rule: RuleId;
  snippet: string;
}

export type Counts = Record<string, Partial<Record<RuleId, number>>>;

export interface Baseline {
  version: 1;
  files: Counts;
}

export interface BaselineIncrease {
  file: string;
  rule: RuleId;
  baseline: number;
  current: number;
}

export interface OpenTag {
  line: number;
  text: string;
}

export const RULES: readonly Rule[];

export function scanSource(source: string, file: string): Violation[];

export function scanFile(file: string): Violation[];

export function scanTree(): Counts;

export function scanOpenTags(source: string, tag: string): OpenTag[];

export function compareToBaseline(current: Counts, baseline: Baseline): BaselineIncrease[];

export function lowerBaseline(current: Counts, baseline: Baseline): Baseline;
