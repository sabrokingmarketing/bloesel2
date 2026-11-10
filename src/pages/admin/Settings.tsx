import { useState, type FormEvent } from 'react';
import { useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { LoyaltyCard } from '../../components/LoyaltyCard';
import { updateSettings, useAdminDB, type ApiError } from '../../data/store';
import type { Customer } from '../../data/types';

export function SettingsPage() {
  const db = useAdminDB();
  const toast = useToast();
  const [storeName, setStoreName] = useState(db.settings.storeName);
  const [stamps, setStamps] = useState(db.settings.stampsRequired);
  const [reward, setReward] = useState(db.settings.rewardName);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const previewCustomer: Customer = {
    id: 'preview',
    code: 'BK-PREVW1',
    name: 'Preview Member',
    phone: '',
    stamps: Math.max(0, stamps - 3),
    totalStamps: 0,
    rewardsEarned: 0,
    rewardsRedeemed: 0,
    joinedAt: new Date().toISOString(),
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (pin && !/^\d{4,8}$/.test(pin)) return toast('PIN must be 4 to 8 digits', 'info');
    setBusy(true);
    try {
      await updateSettings({
        storeName: storeName.trim() || 'Bloeisel Koffie',
        stampsRequired: stamps,
        rewardName: reward.trim() || 'Any coffee, on us',
        ...(pin ? { pin } : {}),
      });
      setPin('');
      toast(pin ? 'Settings saved. Other tills will need the new PIN.' : 'Settings saved');
    } catch (err) {
      toast((err as ApiError).message, 'info');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings">
      <form className="card card-pad settings-form" onSubmit={save}>
        <h2 className="card-title">Loyalty programme</h2>
        <div className="field">
          <label htmlFor="s-store">Store name</label>
          <input id="s-store" className="input" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
        </div>
        <div className="field">
          <label>Stickers for a free coffee</label>
          <div className="stepper stepper-lg">
            <button type="button" onClick={() => setStamps((s) => Math.max(5, s - 1))} disabled={stamps <= 5} aria-label="Fewer">
              <Icon name="minus" />
            </button>
            <span className="tabular">{stamps}</span>
            <button type="button" onClick={() => setStamps((s) => Math.min(12, s + 1))} disabled={stamps >= 12} aria-label="More">
              <Icon name="plus" />
            </button>
          </div>
          <span className="field-hint">Between 5 and 12. Existing cards keep their stickers.</span>
        </div>
        <div className="field">
          <label htmlFor="s-reward">Reward</label>
          <input id="s-reward" className="input" value={reward} onChange={(e) => setReward(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="s-pin">New team PIN</label>
          <input id="s-pin" className="input" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="Leave blank to keep" />
          <span className="field-hint">4 to 8 digits; 6 or more is safer. Changing it signs out every other till.</span>
        </div>
        <button className="btn btn-dark" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </form>

      <div className="settings-side">
        <section className="card card-pad">
          <h2 className="card-title">Card preview</h2>
          <p className="faint settings-hint">How members will see a card with {stamps} stickers.</p>
          <LoyaltyCard customer={previewCustomer} settings={{ ...db.settings, stampsRequired: stamps, rewardName: reward }} compact />
        </section>
      </div>
    </div>
  );
}
