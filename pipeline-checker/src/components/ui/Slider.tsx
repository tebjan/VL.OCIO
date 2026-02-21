import { useState, useRef } from 'react';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  decimals?: number;
  unit?: string;
  onChange: (value: number) => void;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  defaultValue,
  decimals = 2,
  unit = '',
  onChange,
}: SliderProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleValueClick = () => {
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    setEditing(false);
    const raw = inputRef.current?.value;
    if (raw !== undefined) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) {
        onChange(Math.min(max, Math.max(min, parsed)));
      }
    }
  };

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
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => {
          if (defaultValue !== undefined) onChange(defaultValue);
        }}
        style={{ flex: 1, accentColor: 'var(--surface-400)' }}
      />
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          defaultValue={value.toFixed(decimals)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
          style={{
            width: '52px',
            flexShrink: 0,
            background: 'var(--surface-800)',
            border: '1px solid var(--surface-600)',
            borderRadius: '3px',
            color: 'var(--surface-200)',
            fontSize: '11px',
            fontFamily: 'monospace',
            textAlign: 'right',
            padding: '1px 4px',
            outline: 'none',
          }}
        />
      ) : (
        <span
          onClick={handleValueClick}
          style={{
            color: 'var(--surface-300)',
            fontSize: '11px',
            fontFamily: 'monospace',
            width: '52px',
            textAlign: 'right',
            flexShrink: 0,
            cursor: 'text',
          }}
        >
          {value.toFixed(decimals)}{unit}
        </span>
      )}
    </div>
  );
}
