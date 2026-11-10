import { useState, type FormEvent } from 'react';
import { BrandQR } from '../../components/BrandQR';
import { Sheet, useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import poppins500 from '@fontsource/poppins/files/poppins-latin-500-normal.woff2?url';
import poppins700 from '@fontsource/poppins/files/poppins-latin-700-normal.woff2?url';
import { Logo, LOGO_PATH, LOGO_VIEWBOX } from '../../components/Logo';
import { campaignQrUrl, counterQrUrl, createCampaign, deleteCampaign, updateCampaign, updateCounter, useAdminDB, type ApiError } from '../../data/store';
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

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function printPoster(c: Campaign) {
  const name = escapeHtml(c.name);
  const headline = c.kind === 'join' ? 'Scan for your<br/><em>free 10th coffee</em>' : `Scan for<br/><em>${name}</em>`;
  return printQrPoster(campaignQrUrl(c), c.name, headline, 'Collect a sticker with every coffee.<br/>Ten stickers and the next cup is on us.');
}

/** Opens an A5 print-ready poster. `headline` and `footer` are trusted HTML; `title` is escaped. */
async function printQrPoster(qrValue: string, title: string, headline: string, footer: string) {
  const png = await qrToPngDataUrl(qrValue, { size: 1000 });
  const w = window.open('', '_blank', 'width=800,height=1000');
  if (!w) return false;
  const name = escapeHtml(title);
  // The poster window can't see the app's fonts, so it loads the same Poppins files directly.
  const font = (url: string, weight: number) => `@font-face{font-family:Poppins;font-weight:${weight};src:url(${new URL(url, window.location.href)}) format('woff2')}`;
  w.document.write(`<!doctype html><html><head><title>${name} · Bloeisel</title>
<style>
${font(poppins500, 500)}${font(poppins700, 700)}
@page{size:A5;margin:0}
*{box-sizing:border-box}body{margin:0;font-family:Poppins,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.p{width:148mm;height:210mm;margin:0 auto;padding:14mm 12mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;
background:radial-gradient(130% 80% at 50% 0%,#ff8fd3,#ff66c4 45%,#f24fb4);color:#1f1210}
.logo{width:52mm;height:auto;color:#fff}
h1{font-weight:700;font-size:38px;line-height:1.08;letter-spacing:-.03em;margin:0;text-transform:capitalize}h1 em{font-style:normal;color:#fff}
.q{background:#fff;border-radius:28px;padding:16px;box-shadow:0 20px 40px -20px rgba(80,10,50,.45)}.q img{width:78mm;height:78mm;display:block}
p{margin:0;font-size:13px;font-weight:500}
</style></head><body><div class="p">
<svg class="logo" viewBox="${LOGO_VIEWBOX}" role="img" aria-label="Bloeisel"><path d="${LOGO_PATH}" fill="currentColor" fill-rule="evenodd"/></svg>
<h1>${headline}</h1><div class="q"><img src="${png}" alt="QR code"/></div>
<p>${footer}</p></div>
<script>document.fonts.ready.then(()=>setTimeout(()=>window.print(),250))</script></body></html>`);
  w.document.close();
  return true;
}

const COOLDOWNS: Array<[number, string]> = [
  [0, 'No limit'],
  [60, '1 hour'],
  [120, '2 hours'],
  [180, '3 hours'],
  [360, '6 hours'],
  [720, '12 hours'],
  [1440, '24 hours'],
];

/** The one printed QR customers scan themselves to collect a sticker. */
function CounterPanel() {
  const { counter } = useAdminDB();
  const toast = useToast();
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = counterQrUrl(counter.code);

  const save = async (patch: Parameters<typeof updateCounter>[0], done: string) => {
    setBusy(true);
    try {
      await updateCounter(patch);
      toast(done, 'check');
    } catch (err) {
      toast((err as ApiError).message, 'info');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`card counter-panel ${counter.enabled ? '' : 'is-off'}`} aria-labelledby="counter-title">
      <div className="counter-panel-art">
        <BrandQR value={url} label="Counter sticker QR code" />
        {!counter.enabled && <span className="qr-tile-paused">Off</span>}
      </div>
      <div className="counter-panel-body">
        <div className="counter-panel-head">
          <div>
            <span className={`chip ${counter.enabled ? 'chip-success' : 'chip-neutral'}`}>
              <span className="dot" /> {counter.enabled ? 'Live at the counter' : 'Switched off'}
            </span>
            <h2 id="counter-title" className="card-title counter-panel-title">
              Counter sticker QR
            </h2>
          </div>
          <label className="switch" title={counter.enabled ? 'Switch off' : 'Switch on'}>
            <input
              type="checkbox"
              checked={counter.enabled}
              disabled={busy}
              onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? 'Counter QR switched on' : 'Counter QR switched off')}
              aria-label="Counter QR on"
            />
            <span />
          </label>
        </div>
        <p className="muted">
          Print this and stand it by the till. After paying, customers scan it with their phone camera and a sticker lands on their card. New
          customers create a card first, then get the sticker.
        </p>
        <div className="field counter-panel-field">
          <label htmlFor="cooldown">One sticker per card every</label>
          <select
            id="cooldown"
            className="select"
            value={counter.cooldownMinutes}
            disabled={busy}
            onChange={(e) => save({ cooldownMinutes: Number(e.target.value) }, 'Time limit saved')}
          >
            {COOLDOWNS.map(([m, l]) => (
              <option key={m} value={m}>
                {l}
              </option>
            ))}
          </select>
          <span className="field-hint">
            <Icon name="shield" size={13} /> Stops a photo of the poster being used from home to collect more than one sticker per visit.
          </span>
        </div>
        <div className="counter-panel-actions">
          <button
            className="btn btn-primary"
            onClick={() =>
              printQrPoster(url, 'Counter sticker QR', 'Scan to collect<br/><em>your sticker</em>', 'Point your phone camera at the code after you pay.<br/>Ten stickers and the next cup is on us.').then(
                (ok) => !ok && toast('Allow pop-ups to print', 'info'),
              )
            }
          >
            <Icon name="printer" /> Print poster
          </button>
          <button
            className="btn btn-soft"
            onClick={async () => {
              downloadDataUrl(await qrToPngDataUrl(url, { title: 'Scan for your sticker', subtitle: 'Bloeisel · point your phone camera here' }), 'bloeisel-counter-sticker-qr.png');
              toast('QR code downloaded', 'download');
            }}
          >
            <Icon name="download" /> PNG
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmReplace(true)} disabled={busy}>
            <Icon name="refresh" /> Replace code
          </button>
        </div>
      </div>

      <Sheet open={confirmReplace} onClose={() => setConfirmReplace(false)} title="Replace the counter code?">
        <div className="confirm">
          <p className="muted">
            Every printed copy of this QR stops working straight away, including any photos of it. Use this if the code has been shared. Then
            print the new poster.
          </p>
          <div className="confirm-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmReplace(false)}>
              Keep current code
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                setConfirmReplace(false);
                await save({ replaceCode: true }, 'New code ready. Print the new poster.');
              }}
            >
              Replace code
            </button>
          </div>
        </div>
      </Sheet>
    </section>
  );
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
      <CounterPanel />
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
                <Icon name="printer" /> Print sign-up poster
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
