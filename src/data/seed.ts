import type { Activity, Campaign, Customer, DB } from './types';

export const DRINKS = [
  'Cappuccino',
  'Flat White',
  'Rose Latte',
  'Cortado',
  'Americano',
  'Chai Latte',
  'Mocha',
  'Iced Latte',
] as const;

/** Weighted so the analytics have a believable favourite. */
const DRINK_WEIGHTS = [26, 20, 18, 10, 9, 7, 6, 4];

const FIRST = [
  'Lerato', 'Anika', 'Thabo', 'Jana', 'Sipho', 'Mia', 'Pieter', 'Zanele', 'Ruan', 'Naledi',
  'Chloé', 'Kagiso', 'Elsa', 'Ayanda', 'Wian', 'Lindiwe', 'Marco', 'Imke', 'Bongani', 'Lise',
  'Nomvula', 'Dewald', 'Hannah', 'Tumi', 'Karla', 'Sibusiso', 'Annelie', 'Yusuf', 'Refilwe', 'Johan',
  'Palesa', 'Liam', 'Amahle', 'Francois', 'Kim', 'Musa', 'Ilse', 'Gugu', 'Daniel', 'Megan',
];
const LAST = [
  'Mokoena', 'van der Merwe', 'Nkosi', 'Botha', 'Dlamini', 'Pretorius', 'Naidoo', 'Khumalo',
  'du Plessis', 'Mahlangu', 'Smit', 'Ndlovu', 'Venter', 'Molefe', 'Jacobs', 'Sithole',
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function uid(prefix = '') {
  const s = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  return prefix + s;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode(rand: () => number = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return `BK-${s}`;
}

function pickWeighted(rand: () => number) {
  const total = DRINK_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < DRINKS.length; i++) {
    r -= DRINK_WEIGHTS[i];
    if (r <= 0) return DRINKS[i];
  }
  return DRINKS[0];
}

/** A café-shaped hour: morning rush, lunch bump, slow afternoon. */
function pickHour(rand: () => number) {
  const hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const w = [9, 16, 13, 8, 7, 10, 9, 5, 6, 4];
  const total = w.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < hours.length; i++) {
    r -= w[i];
    if (r <= 0) return hours[i];
  }
  return 9;
}

export const DEMO_CUSTOMER_ID = 'cus_demo_lerato';

export function createSeed(now = new Date()): DB {
  const rand = mulberry32(20261110);
  const customers: Customer[] = [];
  const activity: Activity[] = [];
  const DAY = 86_400_000;
  const nowMs = now.getTime();

  const at = (daysAgo: number, hour: number, minute: number) => {
    const d = new Date(nowMs - daysAgo * DAY);
    d.setHours(hour, minute, Math.floor(rand() * 60), 0);
    return d;
  };

  for (let i = 0; i < 46; i++) {
    const isDemo = i === 0;
    const first = isDemo ? 'Lerato' : FIRST[i % FIRST.length];
    const last = isDemo ? 'Mokoena' : LAST[Math.floor(rand() * LAST.length)];
    const id = isDemo ? DEMO_CUSTOMER_ID : `cus_${i.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
    const joinedDaysAgo = isDemo ? 58 : 3 + Math.floor(rand() * 85);
    const joined = at(joinedDaysAgo, 8 + Math.floor(rand() * 6), Math.floor(rand() * 60));
    // Regulars visit more; a long tail visits rarely.
    const loyalty = isDemo ? 0 : rand();
    const visitEvery = loyalty > 0.75 ? 1.6 : loyalty > 0.4 ? 3.5 : 8;
    const favourite = pickWeighted(rand);

    const c: Customer = {
      id,
      code: isDemo ? 'BK-LRT7K2' : makeCode(rand),
      name: `${first} ${last}`,
      phone: `+27 ${60 + Math.floor(rand() * 24)} ${100 + Math.floor(rand() * 900)} ${1000 + Math.floor(rand() * 9000)}`,
      email: `${first.toLowerCase().replace(/[^a-z]/g, '')}@example.com`,
      stamps: 0,
      totalStamps: 0,
      rewardsEarned: 0,
      rewardsRedeemed: 0,
      favourite,
      joinedAt: joined.toISOString(),
    };
    activity.push({ id: uid('act_'), customerId: id, type: 'join', at: joined.toISOString() });

    const visitDays: number[] = [];
    if (isDemo) {
      // Two finished cards and seven stickers on the current one.
      // 29 visits: 10 stickers, redeem, 10 stickers, redeem, 7 stickers.
      for (let d = 57; d >= 1; d -= 2) visitDays.push(d);
    } else {
      for (let d = joinedDaysAgo; d >= 0; d -= Math.max(1, Math.round(visitEvery * (0.5 + rand())))) {
        visitDays.push(d);
      }
    }

    for (const d of visitDays) {
      const h = pickHour(rand);
      const when = at(d, h, Math.floor(rand() * 60));
      if (when.getTime() > nowMs) continue;
      const drink = rand() < 0.6 ? favourite : pickWeighted(rand);
      // A completed card is usually redeemed on the next visit.
      if (c.stamps >= 10) {
        c.stamps = 0;
        c.rewardsRedeemed++;
        activity.push({ id: uid('act_'), customerId: id, type: 'redeem', at: when.toISOString(), drink });
        c.lastVisit = when.toISOString();
        continue;
      }
      c.stamps++;
      c.totalStamps++;
      if (c.stamps === 10) c.rewardsEarned++;
      activity.push({ id: uid('act_'), customerId: id, type: 'stamp', at: when.toISOString(), drink });
      c.lastVisit = when.toISOString();
    }
    customers.push(c);
  }

  activity.sort((a, b) => b.at.localeCompare(a.at));

  const campaigns: Campaign[] = [
    {
      id: 'qr_counter',
      name: 'Counter sign-up',
      kind: 'join',
      url: '/app/join?src=counter',
      placement: 'Till counter acrylic stand',
      scans: 412,
      active: true,
      createdAt: new Date(nowMs - 80 * DAY).toISOString(),
    },
    {
      id: 'qr_tables',
      name: 'Table talkers',
      kind: 'join',
      url: '/app/join?src=tables',
      placement: 'All 14 indoor tables',
      scans: 238,
      active: true,
      createdAt: new Date(nowMs - 64 * DAY).toISOString(),
    },
    {
      id: 'qr_window',
      name: 'Window decal',
      kind: 'join',
      url: '/app/join?src=window',
      placement: 'Front window, street side',
      scans: 96,
      active: true,
      createdAt: new Date(nowMs - 31 * DAY).toISOString(),
    },
    {
      id: 'qr_spring',
      name: 'Spring menu',
      kind: 'menu',
      url: 'https://bloeiselkoffie.co.za',
      placement: 'Takeaway cup sleeves',
      scans: 57,
      active: false,
      createdAt: new Date(nowMs - 20 * DAY).toISOString(),
    },
  ];

  return {
    version: 1,
    customers,
    activity,
    campaigns,
    settings: {
      storeName: 'Bloeisel Koffie',
      stampsRequired: 10,
      rewardName: 'Any coffee, on us',
      adminPin: '1234',
    },
  };
}
