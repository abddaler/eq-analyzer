/** Small shared controls: a segmented switch and a labelled toggle. */

interface SegmentedProps<T extends string | number> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel?: string;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={`seg__btn${o.value === value ? ' seg__btn--active' : ''}`}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`seg__btn${checked ? ' seg__btn--active' : ''}`}
      style={{ border: '1px solid var(--line-strong)', borderRadius: 10, minHeight: 38 }}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      {label}
    </button>
  );
}
