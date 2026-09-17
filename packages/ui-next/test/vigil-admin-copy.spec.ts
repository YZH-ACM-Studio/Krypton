import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspace, path), 'utf8');
}

describe('vigil admin operator copy', () => {
  it('points vigil.baseUrl at 系统设置 and keeps dashboardToken off the settings page', () => {
    const page = source('packages/ui-next/src/pages/vigil/index.tsx');
    expect(page).to.include('请到系统设置 → 反作弊填写 vigil.baseUrl，保存后重启 hydrooj。');
    expect(page).not.to.include('不会出现在系统设置页面');
    expect(page).not.to.include('mongosh 写入该键');
    expect(page).to.include(
      'OJ 端获取访问令牌失败。该令牌来自 Mongo system 键 vigil.dashboardToken，不是系统设置项。请检查该键以及 OJ 服务状态。',
    );
  });
});

describe('fps importer limit copy', () => {
  it('points import-fps.limit at plugin Config on /manage/config', () => {
    const importer = source('packages/fps-importer/index.ts');
    expect(importer).to.include(
      '若您确有需要，此限制可在系统配置（/manage/config）的 FPS Importer 插件项中更改。我们建议您使用 Hydro 自带的 zip 格式存储或是交换题目。',
    );
    expect(importer).to.include(
      'If you really need it, this limit can be changed in the system configuration (/manage/config) under the FPS Importer plugin.',
    );
    expect(importer).not.to.include('此限制可在系统设置中更改');
    expect(importer).not.to.include('this limit can be changed in the system settings.');
    expect(importer).to.include("handler.ctx.setting.get('fps-importer.limit')");
    expect(importer).not.to.include("SystemModel.get('import-fps.limit')");
  });
});
