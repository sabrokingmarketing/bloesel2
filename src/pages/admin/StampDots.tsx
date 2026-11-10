export function StampDots({ value, max }: { value: number; max: number }) {
  return (
    <span className="stamp-dots" aria-label={`${value} of ${max} stickers`}>
      {Array.from({ length: max }).map((_, i) => (
        <i key={i} className={`${i < value ? 'on' : ''} ${i === max - 1 ? 'gift' : ''}`} />
      ))}
      <b className="tabular">
        {value}/{max}
      </b>
    </span>
  );
}
