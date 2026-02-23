import { useState, useRef, useEffect } from 'react';
export { generateSampleImage } from '../sampleImage';

/** File types the pipeline can load. */
export type LoadedFileType = 'exr' | 'dds' | 'image' | 'sample';

interface DropZoneProps {
  /** Called when a file is dropped on the window (fallback for drops outside pipeline rows). */
  onFileDrop: (file: File, fileHandle?: FileSystemFileHandle) => void;
  /** Called when drag state changes (true when dragging over window). */
  onDragStateChange?: (isDragging: boolean) => void;
}

/**
 * Global drag-and-drop detection using window-level event listeners.
 * Prevents browser default file handling and provides fallback drop handling.
 * Pipeline rows handle their own targeted drops and stopPropagation.
 * Renders nothing — visual feedback is on the pipeline rows themselves.
 */
export function DropZone({ onFileDrop, onDragStateChange }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCountRef = useRef(0);

  // Notify parent of drag state changes
  useEffect(() => {
    onDragStateChange?.(isDragging);
  }, [isDragging, onDragStateChange]);

  // Window-level drag event listeners
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCountRef.current++;
      if (dragCountRef.current === 1) {
        setIsDragging(true);
      }
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCountRef.current--;
      if (dragCountRef.current <= 0) {
        dragCountRef.current = 0;
        setIsDragging(false);
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    // Fallback: handles drops that miss pipeline rows (no stopPropagation from a row)
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      dragCountRef.current = 0;

      const items = e.dataTransfer?.items;
      if (!items || items.length === 0) return;
      const item = items[0];
      const file = item.getAsFile();
      if (!file) return;

      // Try to get a FileSystemFileHandle for session persistence (Chrome/Edge)
      let fileHandle: FileSystemFileHandle | undefined;
      const getHandle = (item as any).getAsFileSystemHandle as (() => Promise<FileSystemHandle>) | undefined;
      if (getHandle) {
        try {
          const h = await getHandle.call(item);
          if (h.kind === 'file') fileHandle = h as FileSystemFileHandle;
        } catch { /* not supported or denied */ }
      }

      onFileDrop(file, fileHandle);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [onFileDrop]);

  return null;
}

/**
 * Extract file and optional FileSystemFileHandle from a React drag event.
 * Must be called synchronously in the drop event handler.
 */
export function extractDroppedFile(
  e: React.DragEvent,
): { file: File; handlePromise?: Promise<FileSystemFileHandle | undefined> } | null {
  const items = e.dataTransfer?.items;
  if (!items || items.length === 0) return null;
  const item = items[0];
  const file = item.getAsFile();
  if (!file) return null;

  // Start handle extraction synchronously (before DataTransfer expires)
  let handlePromise: Promise<FileSystemFileHandle | undefined> | undefined;
  const getHandle = (item as any).getAsFileSystemHandle as (() => Promise<FileSystemHandle>) | undefined;
  if (getHandle) {
    handlePromise = getHandle.call(item).then(
      (h) => (h.kind === 'file' ? (h as FileSystemFileHandle) : undefined),
      () => undefined,
    );
  }

  return { file, handlePromise };
}

export function halfToFloat(h: number): number {
  const sign = (h >>> 15) & 0x1;
  const exponent = (h >>> 10) & 0x1f;
  const mantissa = h & 0x3ff;

  if (exponent === 0) {
    if (mantissa === 0) return sign ? -0 : 0;
    return (sign ? -1 : 1) * Math.pow(2, -14) * (mantissa / 1024);
  }

  if (exponent === 31) {
    return mantissa === 0
      ? (sign ? -Infinity : Infinity)
      : NaN;
  }

  return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
}
