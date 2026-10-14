'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface ProductoImageFieldProps {
  currentImage?: string;
  disabled?: boolean;
  onChange: (file: File | null, removeExisting: boolean) => void;
}

export function ProductoImageField({ currentImage, disabled, onChange }: ProductoImageFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function clearPreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreview(null);
    setFileName('');
  }

  function selectImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || disabled) return;
    if (!IMAGE_TYPES.has(file.type)) {
      setError('El archivo no se agregó. Elige una imagen JPG, PNG o WebP.');
      return;
    }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      setError('El archivo no se agregó. La imagen debe tener contenido y pesar como máximo 5 MB.');
      return;
    }

    clearPreview();
    const nextPreview = URL.createObjectURL(file);
    previewRef.current = nextPreview;
    setPreview(nextPreview);
    setFileName(file.name);
    setRemoved(false);
    setError('');
    onChange(file, false);
  }

  function removeImage() {
    clearPreview();
    setRemoved(Boolean(currentImage));
    setError('');
    onChange(null, Boolean(currentImage));
  }

  function keepCurrentImage() {
    clearPreview();
    setRemoved(false);
    setError('');
    onChange(null, false);
  }

  const imageSrc = preview || (!removed ? currentImage : undefined);
  const descriptionId = `${inputId}-help${error ? ` ${inputId}-error` : ''}`;

  return (
    <div>
      <label className="label" htmlFor={inputId}>Imagen del producto <span className="font-normal text-gray-500">(opcional)</span></label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={selectImage}
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
        aria-describedby={descriptionId}
      />
      {imageSrc ? (
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <div className="relative w-32 h-32 shrink-0 overflow-hidden border border-gray-200 bg-gray-50">
            <Image src={imageSrc} alt="Vista previa del producto" fill sizes="128px" className="object-contain" unoptimized />
          </div>
          <div className="flex min-w-0 flex-col items-start gap-2">
            {fileName && <p className="text-sm text-gray-600 break-all">{fileName}</p>}
            <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled} aria-describedby={descriptionId}>
              Cambiar imagen
            </Button>
            <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={removeImage} disabled={disabled}>
              Quitar imagen
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-describedby={descriptionId}
          className="w-full min-h-32 border border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 p-4 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ImageIcon className="w-8 h-8 text-gray-400" />
          <span className="text-sm">Elegir imagen</span>
        </button>
      )}
      <p id={`${inputId}-help`} className="mt-2 text-xs text-gray-500">JPG, PNG o WebP, máximo 5 MB. La imagen se guarda al guardar el producto.</p>
      {currentImage && (removed || preview) && (
        <p className="mt-2 text-sm text-gray-600" role="status">
          {removed ? 'La imagen se quitará al guardar.' : 'La imagen se reemplazará al guardar.'}{' '}
          <button type="button" className="underline disabled:opacity-50" disabled={disabled} onClick={keepCurrentImage}>
            Conservar imagen actual
          </button>
        </p>
      )}
      {error && <p id={`${inputId}-error`} role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
