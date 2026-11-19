import { useState } from 'react';
import { Icon } from './Icon';

/** A 4-digit PIN input: masked by default, numeric keypad on phones, with a show/hide toggle. */
export function PinField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  isNew = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  /** New PINs get autocomplete="new-password" so browsers offer to save rather than fill. */
  isNew?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pin-input">
        <input
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete={isNew ? 'new-password' : 'current-password'}
          placeholder="••••"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
          aria-invalid={!!error}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button type="button" className="pin-toggle" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide PIN' : 'Show PIN'} aria-pressed={shown}>
          <Icon name={shown ? 'eyeOff' : 'eye'} />
        </button>
      </div>
      {error ? (
        <span className="field-error">{error}</span>
      ) : (
        hint && (
          <span className="field-hint" id={`${id}-hint`}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}

/** Client-side mirror of the server's rule, for instant feedback. The server is the authority. */
export function pinProblem(pin: string) {
  if (!/^\d{4}$/.test(pin)) return 'Your PIN must be 4 digits';
  if (/^(\d)\1+$/.test(pin)) return 'Pick a PIN that is harder to guess';
  const d = pin.split('').map(Number);
  const run = (step: number) => d.every((x, i) => i === 0 || x === (d[i - 1]! + step + 10) % 10);
  if (run(1) || run(-1)) return 'Pick a PIN that is harder to guess';
  return null;
}
