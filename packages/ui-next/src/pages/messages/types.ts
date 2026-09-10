export interface MessageDoc {
  _id: string;
  from?: number;
  to?: number | number[];
  flag?: number;
  content?: unknown;
}

export interface MessageUser {
  _id?: number;
  uname?: string;
  avatarUrl?: string;
}

export interface Conv {
  uid: number;
  udoc: MessageUser;
  messages: MessageDoc[];
}
