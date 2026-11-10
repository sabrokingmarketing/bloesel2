import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Confetti } from '../../components/Confetti';
import { useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { LoyaltyCard } from '../../components/LoyaltyCard';
import { addStamp, adjustStamps, findByCode, redeemReward, useDB } from '../../data/store';
import { DRINKS } from '../../data/seed';
import { initials, timeAgo } from '../../lib/format';

type CamState = 'idle' | 'starting' | 'live' | 'denied' | 'unsupported';

async function decode(image: ImageData) {
  const { default: jsQR } = await import('jsqr');
  return jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

export function Scan() {
  const db = useDB();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState<CamState>('idle');
  const [manual, setManual] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drink, setDrink] = useState<string>(DRINKS[0]);
  const [newIndex, setNewIndex] = useState<number | null>(null);
  const [celebrate, setCelebrate] = useState(0);
  const [flash, setFlash] = useState(false);
  const [lastStampId, setLastStampId] = useState<string | null>(null);

  const customer = selectedId ? db.customers.find((c) => c.id === selectedId) : undefined;
  const max = db.settings.stampsRequired;

  const select = useCallback(
    (raw: string) => {
      const c = findByCode(raw);
      if (!c) {
        toast('No member found for that code', 'info');
        return false;
      }
      setSelectedId(c.id);
      setNewIndex(null);
      setLastStampId(null);
      setDrink(c.favourite ?? DRINKS[0]);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 500);
      navigator.vibrate?.(30);
      return true;
    },
    [toast],
  );

  // Deep link: /admin/scan?code=BK-XXXXXX
  useEffect(() => {
    const code = params.get('code');
    if (code) {
      select(code);
      params.delete('code');
      setParams(params, { replace: true });
    }
  }, [params, setParams, select]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCam((s) => (s === 'live' || s === 'starting' ? 'idle' : s));
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setCam('unsupported');
    setCam('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setCam('live');
      let busy = false;
      let lastHit = '';
      const tick = async () => {
        rafRef.current = requestAnimationFrame(tick);
        if (busy || v.readyState < 2) return;
        busy = true;
        const c = canvasRef.current!;
        const w = 480;
        const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(v, 0, 0, w, h);
        const text = await decode(ctx.getImageData(0, 0, w, h));
        if (text && text !== lastHit) {
          lastHit = text;
          if (select(text)) {
            window.setTimeout(() => (lastHit = ''), 2500);
          }
        }
        busy = false;
      };
      tick();
    } catch {
      setCam('denied');
    }
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await img.decode().catch(() => {});
    const c = canvasRef.current!;
    const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    const text = await decode(ctx.getImageData(0, 0, c.width, c.height));
    if (!text) toast("Couldn't find a QR code in that photo", 'info');
    else select(text);
  };

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    if (select(manual)) setManual('');
  };

  const stamp = () => {
    if (!customer) return;
    const res = addStamp(customer.id, drink);
    if (!res.ok) return toast(res.reason === 'full' ? 'Card is full. Redeem the reward first.' : 'Member not found', 'info');
    setNewIndex(res.customer.stamps - 1);
    setLastStampId(customer.id);
    if (res.completed) {
      setCelebrate(Date.now());
      toast(`${customer.name.split(' ')[0]} unlocked a free coffee!`, 'gift');
    } else {
      toast(`Sticker ${res.customer.stamps} of ${max} added`, 'check');
    }
  };

  const undo = () => {
    if (!customer) return;
    adjustStamps(customer.id, -1, 'Undo at till');
    setNewIndex(null);
    setLastStampId(null);
    toast('Last sticker removed', 'refresh');
  };

  const redeem = () => {
    if (!customer) return;
    if (redeemReward(customer.id)) {
      setNewIndex(null);
      setLastStampId(null);
      setCelebrate(Date.now());
      toast('Free coffee redeemed. Fresh card started.', 'gift');
    }
  };

  const recent = [...db.customers].sort((a, b) => (b.lastVisit ?? '').localeCompare(a.lastVisit ?? '')).slice(0, 6);
  const complete = customer ? customer.stamps >= max : false;

  return (
    <div className="scan">
      {celebrate > 0 && <Confetti key={celebrate} seed={celebrate} />}
      <section className="scan-left">
        <div className={`viewfinder ${cam === 'live' ? 'is-live' : ''} ${flash ? 'is-flash' : ''}`}>
          <video ref={videoRef} playsInline muted aria-label="Camera preview" />
          <canvas ref={canvasRef} hidden />
          <div className="vf-frame" aria-hidden="true">
            <span className="tl" />
            <span className="tr" />
            <span className="bl" />
            <span className="br" />
            {cam === 'live' && <i className="vf-line" />}
          </div>
          {cam !== 'live' && (
            <div className="vf-idle">
              <span className="vf-icon">
                <Icon name={cam === 'denied' ? 'info' : 'camera'} />
              </span>
              <strong>
                {cam === 'denied' ? 'Camera access was blocked' : cam === 'unsupported' ? 'Camera not available here' : cam === 'starting' ? 'Starting camera…' : 'Ready to scan'}
              </strong>
              <p>
                {cam === 'denied'
                  ? 'Allow camera access in your browser settings, or enter the member code below.'
                  : cam === 'unsupported'
                    ? 'Upload a photo of the QR or type the member code.'
                    : 'Point the camera at the member’s pink QR screen.'}
              </p>
              {(cam === 'idle' || cam === 'denied') && (
                <button className="btn btn-primary" onClick={start}>
                  <Icon name="camera" /> Start camera
                </button>
              )}
            </div>
          )}
          {cam === 'live' && (
            <button className="vf-stop" onClick={stop}>
              <Icon name="pause" /> Stop
            </button>
          )}
        </div>

        <div className="scan-alt card card-pad">
          <form onSubmit={submitManual} className="scan-manual">
            <label htmlFor="code" className="sr-only">
              Member code
            </label>
            <div className="scan-input">
              <span>BK-</span>
              <input
                id="code"
                value={manual.replace(/^BK-?/i, '')}
                onChange={(e) => setManual(e.target.value.toUpperCase().slice(0, 9))}
                placeholder="6-letter code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </div>
            <button className="btn btn-dark" disabled={manual.replace(/^BK-?/i, '').length < 6}>
              Find
            </button>
          </form>
          <button className="btn btn-ghost btn-block" onClick={() => fileRef.current?.click()}>
            <Icon name="image" /> Scan from a photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      </section>

      <section className="scan-right">
        {!customer ? (
          <div className="card card-pad scan-empty">
            <div className="scan-empty-art" aria-hidden="true">
              <Icon name="qr" />
            </div>
            <h2 className="display">Waiting for a scan</h2>
            <p className="muted">Scan a member’s QR, or pick a regular below to stamp their card.</p>
            <div className="quick-pick">
              {recent.map((c) => (
                <button key={c.id} onClick={() => select(c.code)}>
                  <span className="avatar">{initials(c.name)}</span>
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      {c.stamps}/{max} · {timeAgo(c.lastVisit)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="card card-pad scan-result rise" key={customer.id}>
            <div className="scan-who">
              <span className="avatar">{initials(customer.name)}</span>
              <div>
                <h2>{customer.name}</h2>
                <p className="faint tabular">
                  {customer.code} · {customer.phone}
                </p>
              </div>
              <button className="icon-btn ghost" onClick={() => setSelectedId(null)} aria-label="Clear member">
                <Icon name="close" />
              </button>
            </div>

            <LoyaltyCard customer={customer} settings={db.settings} newIndex={newIndex} compact />

            {complete ? (
              <div className="scan-reward">
                <div>
                  <strong>Free coffee ready</strong>
                  <span>{db.settings.rewardName}</span>
                </div>
                <button className="btn btn-dark btn-lg" onClick={redeem}>
                  <Icon name="gift" /> Redeem now
                </button>
              </div>
            ) : (
              <>
                <div className="drink-pick" role="radiogroup" aria-label="Drink ordered">
                  {DRINKS.map((d) => (
                    <button key={d} role="radio" aria-checked={drink === d} onClick={() => setDrink(d)} className={drink === d ? 'on' : ''}>
                      {d}
                    </button>
                  ))}
                </div>
                <button className="btn btn-primary btn-lg btn-block scan-stamp" onClick={stamp}>
                  <Icon name="plus" /> Add sticker · {drink}
                </button>
              </>
            )}
            <div className="scan-meta">
              <span>
                <Icon name="bean" /> {customer.totalStamps} lifetime
              </span>
              <span>
                <Icon name="gift" /> {customer.rewardsRedeemed} redeemed
              </span>
              {lastStampId === customer.id && (
                <button className="link" onClick={undo}>
                  Undo last sticker
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
