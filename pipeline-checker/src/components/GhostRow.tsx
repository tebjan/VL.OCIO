import { useState, useRef } from 'react';
import { extractDroppedFile } from './DropZone';

export interface GhostRowProps {
  /** True when a file is being dragged over the window. */
  isDragOver?: boolean;
  /** Called when a file is dropped here (create new pipeline). */
  onFileDrop?: (file: File, fileHandle?: FileSystemFileHandle) => void;
}

export function GhostRow({ isDragOver, onFileDrop }: GhostRowProps) {
  if (!isDragOver) return null;

  return <GhostRowInner onFileDrop={onFileDrop} />;
}

/** Inner component — only mounted during drag to avoid hook rule issues. */
function GhostRowInner({ onFileDrop }: { onFileDrop?: GhostRowProps['onFileDrop'] }) {
  const [isHovering, setIsHovering] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsHovering(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsHovering(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsHovering(false);

    const result = extractDroppedFile(e);
    if (!result || !onFileDrop) return;

    const fileHandle = result.handlePromise ? await result.handlePromise : undefined;
    onFileDrop(result.file, fileHandle);
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '32px',
        margin: '2px 6px',
        borderRadius: '0',
        border: isHovering
          ? '2px solid var(--color-accent, #4fc3f7)'
          : '2px dashed var(--color-accent, #4fc3f7)',
        background: isHovering
          ? 'rgba(79, 195, 247, 0.12)'
          : 'rgba(79, 195, 247, 0.06)',
        transition: 'border-color 0.1s, background 0.1s',
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
        {isHovering ? 'Release to add new pipeline' : 'Drop file to add pipeline'}
      </span>
    </div>
  );
}
