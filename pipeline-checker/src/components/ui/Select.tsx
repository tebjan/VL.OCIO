export interface SelectProps {
  label: string;
  value: number;
  options: ReadonlyArray<{ value: number; label: string }>;
  onChange: (value: number) => void;
}

export function Select({ label, value, options, onChange }: SelectProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span
        style={{
          color: 'var(--surface-300)',
          fontSize: '12px',
          width: '96px',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        style={{
          flex: 1,
          background: 'var(--surface-800)',
          color: 'var(--surface-200)',
          border: '1px solid var(--surface-600)',
          borderRadius: '4px',
          padding: '4px 8px',
          fontSize: '12px',
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
