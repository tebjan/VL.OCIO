export interface GhostRowProps {
  isDragOver?: boolean;
}

export function GhostRow({ isDragOver }: GhostRowProps) {
  if (!isDragOver) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '48px',
        margin: '4px 12px',
        borderRadius: '6px',
        border: '2px dashed var(--color-accent, #4fc3f7)',
        background: 'rgba(79, 195, 247, 0.06)',
        transition: 'border-color 0.15s, background 0.15s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          color: 'var(--color-accent, #4fc3f7)',
          fontSize: '12px',
          userSelect: 'none',
        }}
      >
        Drop EXR or DDS to add pipeline
      </span>
    </div>
  );
}
