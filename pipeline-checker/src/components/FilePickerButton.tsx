import { useRef } from 'react';

export interface FilePickerButtonProps {
  onFileSelected: (file: File) => void | Promise<void>;
  accept?: string;
  label?: string;
  title?: string;
}

export function FilePickerButton({
  onFileSelected,
  accept = '.exr,image/*',
  label = 'Open File',
  title = 'Open an EXR or image file',
}: FilePickerButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title={title}
        style={{
          height: '28px',
          padding: '0 10px',
          borderRadius: '6px',
          border: '1px solid var(--surface-700)',
          background: 'var(--surface-800)',
          color: 'var(--color-text)',
          fontSize: '12px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFileSelected(file);
          // Allow re-selecting the same file.
          e.currentTarget.value = '';
        }}
      />
    </>
  );
}
