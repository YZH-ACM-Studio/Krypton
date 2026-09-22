import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(resolve(import.meta.dirname, '../src/pages/admin-stats.tsx'), 'utf8');

describe('admin stats echarts dashboard', () => {
  it('renders every chart through EChart and drops the local SVG/CSS charts', () => {
    expect(page).to.include("import { EChart } from '@/components/ui/echart'");
    expect(page).to.include('<EChart option=');
    expect(page).to.include('h-[280px] w-full min-w-0');
    expect(page).to.match(/echarts?/i);
    expect(page).not.to.include('function LineChart');
    expect(page).not.to.include('<polyline');
    expect(page).not.to.include('function BarRows');
    expect(page).not.to.include('min-w-[600px]');
  });

  it('keeps GET field names, CSV filenames, and formula-safe headers', () => {
    expect(page).to.include('action="/admin/stats"');
    expect(page).to.include('name="view"');
    expect(page).to.include('contestId');
    expect(page).to.include('trainingId');
    expect(page).to.include('name="q"');
    expect(page).to.include('uid=');
    expect(page).to.include('name="groupIds"');
    expect(page).to.include('<StatsGroupFields');
    expect(page).to.include('groupMemberCount');
    expect(page).to.include('range=');
    expect(page).to.include('name="tag"');
    expect(page).to.include('if (/^[=+\\-@\\t\\r]/.test(text))');

    expect(page).to.include('filename="比赛统计.csv"');
    expect(page).to.include("headers={['题号', '题目', '提交', 'AC', '通过率']}");
    expect(page).to.include('filename="题集成员进度.csv"');
    expect(page).to.include("headers={['UID', '用户名', '姓名', '学号', '完成', '总题数', '完成率']}");
    expect(page).to.include('filename="用户近30天统计.csv"');
    expect(page).to.include("headers={['日期', '提交', 'AC']}");
    expect(page).to.include('filename="班级组对比.csv"');
    expect(page).to.include("headers={['班级组', '绑定成员', '活跃成员', '人均提交', '人均AC']}");
    expect(page).to.include(['filename={', '`全站近$', '{data.range}', '天统计.csv`', '}'].join(''));
    expect(page).to.include("headers={['日期', '提交', 'AC', '活跃用户']}");
    expect(page).to.include('filename="题目难度统计.csv"');
    expect(page).to.include("headers={['题号', '题目', '提交', 'AC', '通过率', 'WA', 'TLE', 'CE']}");
  });

  it('keeps the scanned labels, 12-col dashboard layout, and admin gate', () => {
    for (const label of ['总提交', 'AC 提交', '参赛人数', '每题通过分布', '按小时提交曲线', '语言分布']) {
      expect(page).to.include(label);
    }
    for (const label of ['报名人数', '每题完成人数', '完成率分布', '成员进度榜']) {
      expect(page).to.include(label);
    }
    for (const label of ['按人', '班级组', '大盘', '按题目', '导出 CSV', '日活跃用户', '错误类型占比']) {
      expect(page).to.include(label);
    }
    expect(page).to.include('title="统计中心"');
    expect(page).to.include('hideSidebar');
    expect(page).to.include('PRIV.PRIV_EDIT_SYSTEM');
    expect(page).not.to.include('registerAdminNavSection');
    expect(page).to.include('grid-cols-12');
    expect(page).to.include('lg:grid-cols-12');
    expect(page).to.include('lg:col-span-8');
    expect(page).to.include('lg:col-span-4');
    expect(page).to.include('shadow-none');
    expect(page).to.include('w-full min-w-0');
    expect(page).not.to.include('xl:grid-cols-[minmax(0,1fr)_320px]');
  });
});
