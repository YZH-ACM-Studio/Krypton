import { expect } from 'chai';
import { describe, it } from 'node:test';
import { localizeDomainPermissionCatalog } from '../src/lib/domain-permission-catalog';

describe('domain permission catalog localization', () => {
    it('sends localized names and capability explanations to the permission UI', () => {
        const translations = {
            'Create problems': '创建全部题型',
            'Create problems permission detail': '可创建全部八种题型；其中编程题仍创建为本人名下的隐藏托管草稿。',
            'Create managed programming drafts': '仅创建本人托管编程题草稿',
            'Create managed programming drafts permission detail': '仅可创建本人名下的隐藏自命题托管编程题草稿，不能导入、代指定出题人或发布。',
        };
        const catalog = localizeDomainPermissionCatalog(
            {
                perm_problem: [
                    { key: 1n, desc: 'Create problems' },
                    { key: 2n, desc: 'Create managed programming drafts' },
                ],
            },
            (key) => translations[key],
        );

        expect(catalog.perm_problem).to.deep.equal([
            {
                key: 1n,
                desc: '创建全部题型',
                detail: '可创建全部八种题型；其中编程题仍创建为本人名下的隐藏托管草稿。',
            },
            {
                key: 2n,
                desc: '仅创建本人托管编程题草稿',
                detail: '仅可创建本人名下的隐藏自命题托管编程题草稿，不能导入、代指定出题人或发布。',
            },
        ]);
    });
});
