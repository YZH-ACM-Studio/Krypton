import { createContext, type PropsWithChildren, useContext } from 'react';

export interface KryptonUrls {
  home: string;
  problems: string;
  contests: string;
  homework: string;
  training: string;
  ranking: string;
  discussions: string;
  domains: string;
  messages: string;
  login: string;
  register: string;
  logout: string;
  settings: string;
  security: string;
  files: string;
  records: string;
  domainDashboard: string;
  manage: string;
  status: string;
  problemDetail: string;
  contestDetail: string;
  homeworkDetail: string;
  trainingDetail: string;
  discussionDetail: string;
  discussionNode: string;
  userDetail: string;
  recordDetail: string;
}

export interface KryptonUser {
  id: number;
  name: string;
  mail: string;
  signedIn: boolean;
  theme: string;
  viewLang: string;
  unreadMessages: number;
  rp: number;
  bio: string;
  priv: number;
  role: string;
  tfa: boolean;
  authn: boolean;
  pinnedDomains: string[];
  /** Hydro avatar spec, e.g. 'url:/file/12/.avatar.png?t=1234' or 'gravatar:…'. */
  avatar?: string;
  /** Fully-resolved image URL (always populated for signed-in users). */
  avatarUrl?: string;
  /** 服务端统一算出的题库枚举能力；缺失/异常时服务端固定下发 false。 */
  canBrowseProblemBank: boolean;
  /** system 域荣誉数据维护能力；仅控制前端入口，服务端仍会鉴权。 */
  canImportRankboard?: boolean;
  /** system 域荣誉结构维护能力；MANAGE 蕴含 IMPORT。 */
  canManageRankboard?: boolean;
  /** 当前域公告维护能力；服务端按 PRIV_EDIT_SYSTEM / PERM_EDIT_DOMAIN 计算。 */
  canManageAnnouncements?: boolean;
  /** 当前域任务创建/管理能力；仅控制前端入口，路由仍按服务端权限鉴权。 */
  canManageTasks?: boolean;
  /** 管理员代理身份；只来自服务端 session，普通账号不可自行声明。 */
  impersonation?: {
    actorUid: number;
    actorName: string;
    targetUid: number;
    targetName: string;
    startedAt: string | null;
  } | null;
}

export interface KryptonDomain {
  id: string;
  name: string;
  bulletin: string;
  avatar: string;
}

export interface GenericUserDoc {
  _id: number;
  uname?: string;
  rp?: number;
  bio?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface KryptonPage {
  templateName: string;
  data: Record<string, any>;
}

export interface KryptonFooter {
  /** HTML lines from `system.ui-default.footer_extra_html`, newline-split. */
  systemHtml?: string;
  /** HTML lines from `domain.ui.footer_extra_html`, newline-split. */
  domainHtml?: string;
}

export interface KryptonBootstrap {
  appName: string;
  siteName: string;
  locale: string;
  theme: 'light' | 'dark';
  generatedAt: string;
  user: KryptonUser;
  domain: KryptonDomain;
  urls: KryptonUrls;
  udict: Record<string, GenericUserDoc>;
  footer?: KryptonFooter;
  page: KryptonPage;
}

declare global {
  interface Window {
    __KRYPTON_BOOTSTRAP__?: KryptonBootstrap;
  }
}

const BootstrapContext = createContext<KryptonBootstrap | null>(null);

export function BootstrapProvider({ bootstrap, children }: PropsWithChildren<{ bootstrap: KryptonBootstrap }>) {
  return <BootstrapContext.Provider value={bootstrap}>{children}</BootstrapContext.Provider>;
}

export function useBootstrap() {
  const value = useContext(BootstrapContext);
  if (!value) throw new Error('Krypton bootstrap data is missing.');
  return value;
}

export function getBootstrapFromWindow(): KryptonBootstrap {
  if (!window.__KRYPTON_BOOTSTRAP__) {
    throw new Error('window.__KRYPTON_BOOTSTRAP__ is not available.');
  }
  const bs = window.__KRYPTON_BOOTSTRAP__;
  // Ensure page always exists (guards against stale/incomplete bootstrap data)
  if (!bs.page) {
    (bs as any).page = { templateName: 'main.html', data: {} };
  }
  return bs;
}
