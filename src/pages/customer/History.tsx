import { Icon } from '../../components/Icon';
import { MiniSticker } from '../../components/Sticker';
import type { Activity } from '../../data/types';
import { useCustomerCtx } from './CustomerLayout';

function label(a: Activity) {
  switch (a.type) {
    case 'stamp':
      return { title: a.drink ?? 'Coffee', sub: a.note === 'Counter QR' ? '+1 sticker · scanned at the counter' : '+1 sticker' };
    case 'redeem':
      return { title: 'Free coffee', sub: 'Reward redeemed' };
    case 'adjust':
      return { title: 'Card adjusted', sub: `${a.delta && a.delta > 0 ? '+' : ''}${a.delta ?? 0} sticker${Math.abs(a.delta ?? 0) === 1 ? '' : 's'}${a.note ? ` · ${a.note}` : ''}` };
    default:
      return { title: 'Joined Bloeisel', sub: 'Welcome to the club' };
  }
}

export function History() {
  const { activity: items } = useCustomerCtx();

  const groups = new Map<string, Activity[]>();
  for (const a of items) {
    const k = new Date(a.at).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }

  return (
    <div className="cx-page">
      <header className="cx-page-head rise">
        <p className="eyebrow">Visits</p>
        <h1 className="display cx-page-title">Your coffee story</h1>
      </header>

      {items.length === 0 ? (
        <div className="card empty">
          <Icon name="clock" />
          <p>No visits yet.</p>
        </div>
      ) : (
        <div className="timeline rise rise-1">
          {[...groups.entries()].map(([month, list]) => (
            <section key={month} className="timeline-group">
              <h2 className="timeline-month">{month}</h2>
              <ul className="card timeline-list">
                {list.map((a, i) => {
                  const l = label(a);
                  return (
                    <li key={a.id} className={`timeline-item is-${a.type}`}>
                      {a.type === 'stamp' ? (
                        <MiniSticker index={i + month.length} size={38} />
                      ) : (
                        <span className="timeline-icon">
                          <Icon name={a.type === 'redeem' ? 'gift' : a.type === 'join' ? 'sparkle' : 'edit'} />
                        </span>
                      )}
                      <div className="timeline-text">
                        <strong>{l.title}</strong>
                        <span>{l.sub}</span>
                      </div>
                      <time className="timeline-time">
                        {new Date(a.at).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' })}
                        <span>{new Date(a.at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</span>
                      </time>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
