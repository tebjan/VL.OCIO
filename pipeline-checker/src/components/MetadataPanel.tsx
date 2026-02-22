import { Section } from './grading/Section';

export interface ChannelStats {
  min: [number, number, number, number];
  max: [number, number, number, number];
}

export interface ImageMetadata {
  width: number;
  height: number;
  channels: string;
  fileSizeMB: string;
  stats: ChannelStats | null;
}

export interface MetadataPanelProps {
  metadata: ImageMetadata | null;
}

/** Compute per-channel min/max from raw Float32Array pixel data. Run once at EXR load time. */
export function computeChannelStats(data: Float32Array, width: number, height: number): ChannelStats {
  const min: [number, number, number, number] = [Infinity, Infinity, Infinity, Infinity];
  const max: [number, number, number, number] = [-Infinity, -Infinity, -Infinity, -Infinity];
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;
    for (let c = 0; c < 4; c++) {
      const v = data[base + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }

  return { min, max };
}

const LABEL_STYLE: React.CSSProperties = {
  color: 'var(--surface-400)',
  fontSize: '12px',
  fontFamily: 'monospace',
};

const VALUE_STYLE: React.CSSProperties = {
  color: 'var(--surface-100)',
  fontSize: '12px',
  fontFamily: 'monospace',
  textAlign: 'right' as const,
};

export function MetadataPanel({ metadata }: MetadataPanelProps) {
  if (!metadata) return null;

  const { width, height, channels, fileSizeMB, stats } = metadata;
  const channelNames = ['R', 'G', 'B', 'A'] as const;

  return (
    <Section title="Image Info" defaultOpen={false}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '2px 12px',
        }}
      >
        <span style={LABEL_STYLE}>Resolution</span>
        <span style={VALUE_STYLE}>{width} x {height}</span>

        <span style={LABEL_STYLE}>Format</span>
        <span style={VALUE_STYLE}>{channels}</span>

        <span style={LABEL_STYLE}>File size</span>
        <span style={VALUE_STYLE}>{fileSizeMB} MB</span>

        {stats && (
          <>
            <span style={{ ...LABEL_STYLE, gridColumn: '1 / -1', marginTop: '6px' }}>
              Per-channel range
            </span>

            {channelNames.map((ch, i) => (
              <div key={ch} style={{ display: 'contents' }}>
                <span style={LABEL_STYLE}>{ch}</span>
                <span style={VALUE_STYLE}>
                  [{stats.min[i].toFixed(5)}, {stats.max[i].toFixed(5)}]
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </Section>
  );
}
