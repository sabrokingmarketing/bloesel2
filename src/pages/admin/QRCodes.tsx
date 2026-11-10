import { useState, type FormEvent } from 'react';
import { BrandQR } from '../../components/BrandQR';
import { Sheet, useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { campaignQrUrl, createCampaign, deleteCampaign, updateCampaign, useAdminDB, type ApiError } from '../../data/store';
import type { Campaign, CampaignKind } from '../../data/types';
import { shortDate } from '../../lib/format';
import { absoluteUrl, downloadDataUrl, qrToPngDataUrl } from '../../lib/qr';

const KIND_LABEL: Record<CampaignKind, string> = { join: 'Join the card', menu: 'Menu / website', custom: 'Custom link' };

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

async function printPoster(c: Campaign) {
  const png = await qrToPngDataUrl(campaignQrUrl(c), { size: 1000 });
  const w = window.open('', '_blank', 'width=800,height=1000');
  if (!w) return false;
  const headline = c.kind === 'join' ? 'Scan for your<br/><em>free 10th coffee</em>' : `Scan for<br/><em>${c.name}</em>`;
  w.document.write(`<!doctype html><html><head><title>${c.name} · Bloeisel Koffie</title>
<style>
@page{size:A5;margin:0}
*{box-sizing:border-box}body{margin:0;font-family:Poppins,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.p{width:148mm;height:210mm;margin:0 auto;padding:14mm 12mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;
background:radial-gradient(130% 80% at 50% 0%,#ff8fd3,#ff66c4 45%,#a8246f);color:#fff}
.b{font-family:Georgia,serif;font-style:italic;font-size:30px;font-weight:600;letter-spacing:-.5px}.b small{display:block;font-style:normal;font-family:Poppins,sans-serif;font-size:10px;letter-spacing:.42em;text-transform:uppercase;opacity:.85;margin-top:2px}
h1{font-family:Georgia,serif;font-weight:600;font-size:40px;line-height:1.05;margin:0}h1 em{color:#ffdcf0}
.q{background:#fff;border-radius:28px;padding:16px;box-shadow:0 20px 40px -20px rgba(0, 0, 0,.4)}.q img{width:78mm;height:78mm;display:block}
p{margin:0;font-size:13px;opacity:.9}
</style></head><body><div class="p"><div class="b">Bloeisel<small>Koffie</small></div><h1>${headline}</h1><div class="q"><img src="${png}"/></div>
<p>Collect a sticker with every coffee.<br/>Ten stickers and the next cup is on us.</p></div>
<script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
  w.document.close();
  return true;
}

export function QRCodes() {
  const db = useAdminDB();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<Campaign | null>(null);
  const totalScans = db.campaigns.reduce((s, c) => s + c.scans, 0);
  const featured = db.campaigns.find((c) => c.kind === 'join' && c.active) ?? db.campaigns[0];

  const download = async (c: Campaign) => {
    const png = await qrToPngDataUrl(campaignQrUrl(c), { title: c.name, subtitle: 'Bloeisel Koffie · scan to collect stickers' });
    downloadDataUrl(png, `bloeisel-qr-${slug(c.name)}.png`);
    toast('QR code downloaded', 'download');
  };

  const copy = async (c: Campaign) => {
    try {
      await navigator.clipboard.writeText(campaignQrUrl(c));
      toast('Link copied', 'link');
    } catch {
      toast('Could not copy link', 'info');
    }
  };

  return (
    <div className="qrm">
      <section className="qrm-hero">
        <div className="qrm-hero-copy">
          <span className="chip qrm-chip">
            <Icon name="sparkle" /> Branded codes
          </span>
          <h2 className="display">Put your card where people pause.</h2>
          <p>Every code below opens the Bloeisel sign-up in one scan. Print them for the till, tables and window, then watch which spots bring people in.</p>
          <div className="qrm-hero-stats">
            <div>
              <strong className="display tabular">{totalScans.toLocaleString('en-ZA')}</strong>
              <span>total scans</span>
            </div>
            <div>
              <strong className="display tabular">{db.campaigns.filter((c) => c.active).length}</strong>
              <span>live codes</span>
            </div>
          </div>
          <div className="qrm-hero-actions">
            <button className="btn btn-white" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New QR code
            </button>
            {featured && (
              <button className="btn qrm-ghost" onClick={() => printPoster(featured).then((ok) => !ok && toast('Allow pop-ups to print', 'info'))}>
                <Icon name="printer" /> Print counter poster
              </button>
            )}
          </div>
        </div>
        {featured && (
          <div className="qrm-poster" aria-label="Poster preview">
            <div className="qrm-poster-inner">
              <Logo tone="light" size="sm" />
              <p className="display">
                Scan for your <em>free 10th coffee</em>
              </p>
              <div className="qrm-poster-qr">
                <BrandQR value={campaignQrUrl(featured)} label={`QR code for ${featured.name}`} />
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="qrm-grid">
        {db.campaigns.map((c) => (
          <article key={c.id} className={`card qr-tile ${c.active ? '' : 'is-off'}`}>
            <button className="qr-tile-art" onClick={() => setPreview(c)} aria-label={`Preview ${c.name}`}>
              <BrandQR value={campaignQrUrl(c)} label={`QR code for ${c.name}`} />
              {!c.active && <span className="qr-tile-paused">Paused</span>}
            </button>
            <div className="qr-tile-body">
              <div className="qr-tile-head">
                <div>
                  <h3>{c.name}</h3>
                  <p className="faint">{c.placement}</p>
                </div>
                <label className="switch" title={c.active ? 'Pause' : 'Activate'}>
                  <input type="checkbox" checked={c.active} onChange={(e) => updateCampaign(c.id, { active: e.target.checked }).catch((err: ApiError) => toast(err.message, 'info'))} aria-label={`${c.name} active`} />
                  <span />
                </label>
              </div>
              <div className="qr-tile-meta">
                <span className="chip chip-neutral">{KIND_LABEL[c.kind]}</span>
                <span className="qr-tile-scans">
                  <strong className="tabular">{c.scans}</strong> scans
                </span>
              </div>
              <div className="qr-tile-actions">
                <button className="btn btn-sm btn-soft" onClick={() => download(c)}>
                  <Icon name="download" /> PNG
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => printPoster(c).then((ok) => !ok && toast('Allow pop-ups to print', 'info'))}>
                  <Icon name="printer" /> Poster
                </button>
                <button className="icon-btn ghost" onClick={() => copy(c)} aria-label="Copy link">
                  <Icon name="link" />
                </button>
              </div>
            </div>
          </article>
        ))}
        <button className="qr-tile-new" onClick={() => setCreating(true)}>
          <span>
            <Icon name="plus" />
          </span>
          <strong>Create a QR code</strong>
          <small className="faint">For a new spot, event or menu</small>
        </button>
      </section>

      <NewCampaignSheet open={creating} onClose={() => setCreating(false)} />

      <Sheet open={!!preview} onClose={() => setPreview(null)} title={preview?.name}>
        {preview && (
          <div className="qr-preview">
            <div className="qr-preview-art">
              <BrandQR value={campaignQrUrl(preview)} label={`QR code for ${preview.name}`} />
            </div>
            <p className="faint qr-preview-url">Opens {absoluteUrl(preview.url)}</p>
            <div className="qr-preview-stats">
              <span>
                <strong className="tabular">{preview.scans}</strong> scans
              </span>
              <span>Created {shortDate(preview.createdAt)}</span>
            </div>
            <div className="qr-preview-actions">
              <button className="btn btn-primary" onClick={() => download(preview)}>
                <Icon name="download" /> Download PNG
              </button>
              <button
                className="btn btn-danger"
                onClick={() =>
                  deleteCampaign(preview.id)
                    .then(() => {
                      setPreview(null);
                      toast('QR code deleted', 'trash');
                    })
                    .catch((err: ApiError) => toast(err.message, 'info'))
                }
              >
                <Icon name="trash" /> Delete
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function NewCampaignSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [placement, setPlacement] = useState('');
  const [kind, setKind] = useState<CampaignKind>('join');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');

  const [busy, setBusy] = useState(false);
  const previewUrl = kind === 'custom' ? url || 'https://' : kind === 'menu' ? 'https://bloeiselkoffie.co.za' : '/app/join';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setErr('Give the code a name');
    if (kind === 'custom' && !/^https?:\/\/\S+\.\S+/.test(url)) return setErr('Enter a full link, starting with https://');
    setBusy(true);
    try {
      await createCampaign({ name: name.trim(), placement: placement.trim(), kind, targetUrl: kind === 'custom' ? url.trim() : undefined });
    } catch (error) {
      setErr((error as ApiError).message);
      return;
    } finally {
      setBusy(false);
    }
    toast('QR code created', 'qr');
    setName('');
    setPlacement('');
    setUrl('');
    setErr('');
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="New QR code">
      <form className="new-qr" onSubmit={submit}>
        <div className="new-qr-preview">
          <BrandQR value={absoluteUrl(previewUrl)} label="Preview" />
        </div>
        <div className="new-qr-fields">
          <div className="field">
            <label htmlFor="qr-name">Name</label>
            <input id="qr-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Saturday market stall" />
          </div>
          <div className="field">
            <label htmlFor="qr-place">Where will it live?</label>
            <input id="qr-place" className="input" value={placement} onChange={(e) => setPlacement(e.target.value)} placeholder="e.g. Market gazebo banner" />
          </div>
          <div className="field">
            <label>Opens</label>
            <div className="segmented">
              {(Object.keys(KIND_LABEL) as CampaignKind[]).map((k) => (
                <button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          {kind === 'custom' && (
            <div className="field">
              <label htmlFor="qr-url">Link</label>
              <input id="qr-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
            </div>
          )}
          {err && <p className="field-error">{err}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            <Icon name="qr" /> Create QR code
          </button>
        </div>
      </form>
    </Sheet>
  );
}
