import {
  createContext,
  type PropsWithChildren,
  useContext,
} from 'react';

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
  signedIn: boolean;
  theme: string;
  viewLang: string;
  unreadMessages: number;
  rp: number;
  bio: string;
  priv: number;
  role: string;
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
  page: KryptonPage;
}

declare global {
  interface Window {
    __KRYPTON_BOOTSTRAP__?: KryptonBootstrap;
  }
}

const BootstrapContext = createContext<KryptonBootstrap | null>(null);

export function BootstrapProvider({
  bootstrap,
  children,
}: PropsWithChildren<{ bootstrap: KryptonBootstrap }>) {
  return (
    <BootstrapContext.Provider value={bootstrap}>
      {children}
    </BootstrapContext.Provider>
  );
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
