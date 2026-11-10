import { useEffect, useState } from 'react';
import { claimUrl } from '../data/store';
import { BrandQR } from './BrandQR';
import { Sheet, useToast } from './Feedback';
import { Icon } from './Icon';

export type Transfer = { token: string; expiresAt: string };

/** Shows a one-time "move this card" QR with a live countdown. */
export function TransferSheet({ transfer, onClose, who }: { transfer: Transfer | null; onClose: () => void; who: string }) {
  const toast = useToast();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!transfer) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [transfer]);

  if (!transfer) return null;
  const url = claimUrl(transfer.token);
  const left = Math.max(0, Math.round((new Date(transfer.expiresAt).getTime() - now) / 1000));
  const expired = left === 0;

  return (
    <Sheet open onClose={onClose} title="Move to a new phone">
      <div className="transfer">
        <p className="muted">
          Scan this with the new phone's camera to move {who} card there. It works once, and the old phone is signed out.
        </p>
        <div className={`transfer-qr ${expired ? 'is-expired' : ''}`}>
          <BrandQR value={url} label="One-time card transfer QR code" />
        </div>
        <p className={`transfer-timer tabular ${expired ? 'is-expired' : ''}`}>
          <Icon name="clock" />
          {expired ? 'Expired. Close and make a new one.' : `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
        </p>
        <button
          className="btn btn-ghost btn-block"
          disabled={expired}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast('Link copied. Send it to the new phone.', 'link');
            } catch {
              toast('Could not copy the link', 'info');
            }
          }}
        >
          <Icon name="copy" /> Copy link instead
        </button>
      </div>
    </Sheet>
  );
}
