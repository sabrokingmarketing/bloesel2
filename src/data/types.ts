export type Customer = {
  id: string;
  /** Short member code encoded in the customer's QR, e.g. "BK-7F3K29". */
  code: string;
  name: string;
  phone: string;
  email?: string;
  /** Stickers on the current card. */
  stamps: number;
  /** Lifetime stickers collected. */
  totalStamps: number;
  rewardsEarned: number;
  rewardsRedeemed: number;
  favourite?: string;
  joinedAt: string;
  lastVisit?: string;
};

export type ActivityType = 'join' | 'stamp' | 'redeem' | 'adjust';

export type Activity = {
  id: string;
  customerId: string;
  type: ActivityType;
  at: string;
  drink?: string;
  /** For 'adjust': signed change applied. */
  delta?: number;
  note?: string;
};

export type CampaignKind = 'join' | 'menu' | 'custom';

export type Campaign = {
  id: string;
  name: string;
  kind: CampaignKind;
  url: string;
  placement: string;
  scans: number;
  active: boolean;
  createdAt: string;
};

export type Settings = {
  storeName: string;
  stampsRequired: number;
  rewardName: string;
  adminPin: string;
};

export type DB = {
  version: number;
  customers: Customer[];
  activity: Activity[];
  campaigns: Campaign[];
  settings: Settings;
};
