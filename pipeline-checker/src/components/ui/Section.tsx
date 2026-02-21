import { useState } from 'react';

export interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function Section({ title, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          padding: '6px 0',
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: 'var(--surface-500)',
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        <span
          style={{
            fontSize: '8px',
            transition: 'transform 0.15s',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▶
        </span>
        {title}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0 8px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
