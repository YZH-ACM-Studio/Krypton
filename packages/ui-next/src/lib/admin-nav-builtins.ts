/**
 * Register Hydro's built-in admin pages into the admin nav sidebar.
 *
 * These pages already exist as components elsewhere (admin.tsx,
 * domain-manage.tsx, system-manage.tsx, etc.) and are mapped to their
 * template names in pages/resolver.tsx — we simply add nav entries here
 * so the admin shell shows links to them.
 *
 * Imported once from main.tsx to trigger the side-effect registrations.
 */
import {
  BarChart3, Boxes, Building, Database, FileBox, Globe, HardDrive, KeySquare,
  LayoutDashboard, Mail, Server, Settings, ShieldAlert, UserCheck, Users, UserPlus, Wrench,
} from 'lucide-react';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { PRIV } from '@/lib/perms';

registerAdminNavSection({
  key: 'overview',
  label: '总览',
  order: 10,
  items: [
    {
      key: 'manage_dashboard', label: '系统总览', href: '/manage',
      icon: LayoutDashboard, templateNames: ['manage_dashboard.html'],
      requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
    },
    {
      key: 'domain_dashboard', label: '域总览', href: '/domain/dashboard',
      icon: Building, templateNames: ['domain_dashboard.html'],
    },
    {
      key: 'status', label: '评测机状态', href: '/status',
      icon: Server, templateNames: ['status.html'],
    },
  ],
});

registerAdminNavSection({
  key: 'domain',
  label: '域管理',
  order: 20,
  items: [
    {
      key: 'domain_edit', label: '基本设置', href: '/domain/edit',
      icon: Settings, templateNames: ['domain_edit.html'],
    },
    {
      key: 'domain_user', label: '域用户', href: '/domain/user',
      icon: Users, templateNames: ['domain_user.html', 'domain_user_raw.html'],
    },
    {
      key: 'domain_role', label: '角色', href: '/domain/role',
      icon: KeySquare, templateNames: ['domain_role.html'],
    },
    {
      key: 'domain_permission', label: '权限', href: '/domain/permission',
      icon: ShieldAlert, templateNames: ['domain_permission.html'],
    },
    {
      key: 'domain_join_applications', label: '入域申请', href: '/domain/join_applications',
      icon: UserPlus, templateNames: ['domain_join_applications.html'],
    },
  ],
});

registerAdminNavSection({
  key: 'system',
  label: '系统设置',
  order: 50,
  requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
  items: [
    {
      key: 'manage_setting', label: '配置项', href: '/manage/setting',
      icon: Settings, templateNames: ['manage_setting.html'],
      requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
    },
    {
      key: 'manage_config', label: '高级配置', href: '/manage/config',
      icon: Database, templateNames: ['manage_config.html'],
      requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
    },
    {
      key: 'manage_script', label: '脚本管理', href: '/manage/script',
      icon: Wrench, templateNames: ['manage_script.html'],
      requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
    },
    {
      key: 'manage_user_import', label: '批量导入', href: '/manage/user/import',
      icon: UserPlus, templateNames: ['manage_user_import.html'],
      requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
    },
    {
      key: 'manage_user_priv', label: '用户权限', href: '/manage/user/priv',
      icon: UserCheck, templateNames: ['manage_user_priv.html'],
      requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
    },
  ],
});

registerAdminNavSection({
  key: 'content',
  label: '内容管理',
  order: 25,
  items: [
    {
      key: 'problem_import', label: '题目导入', href: '/p/import',
      icon: FileBox, templateNames: ['problem_import.html'],
    },
  ],
});
