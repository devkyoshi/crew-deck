'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** The square the person drags the picture in, in CSS pixels. The result is always 512 x 512. */
const VIEW = 288;
const OUT = 512;
const MAX_ZOOM = 4;

/**
 * Crops a picture to a 1:1 square. Drag to move it, scroll or use the slider to zoom, or use the arrow
 * keys and + / - when the frame is focused. Nothing is uploaded here: `onApply` gets the cropped file.
 */
export function ImageCropDialog({
  file,
  shape = 'round',
  title = 'Crop your picture',
  onCancel,
  onApply,
}: {
  file: File | null;
  shape?: 'round' | 'square';
  title?: string;
  onCancel: () => void;
  onApply: (cropped: File) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const img = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    setSize(null);
    setZoom(1);
    setOff({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // The smallest scale at which the picture still covers the whole square.
  const base = size ? Math.max(VIEW / size.w, VIEW / size.h) : 1;
  const scale = base * zoom;

  const clamp = useCallback(
    (x: number, y: number, s: number) => {
      if (!size) return { x: 0, y: 0 };
      const mx = Math.max(0, (size.w * s - VIEW) / 2);
      const my = Math.max(0, (size.h * s - VIEW) / 2);
      return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
    },
    [size],
  );

  const setZoomTo = (z: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(next);
    setOff((o) => clamp(o.x, o.y, base * next));
  };

  function apply() {
    if (!file || !size || !img.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d')!;
    const sSize = VIEW / scale;
    const sx = size.w / 2 - sSize / 2 - off.x / scale;
    const sy = size.h / 2 - sSize / 2 - off.y / scale;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img.current, sx, sy, sSize, sSize, 0, 0, OUT, OUT);
    const png = file.type === 'image/png';
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const ext = png ? 'png' : 'jpg';
        const name = file.name.replace(/\.[a-z0-9]+$/i, '') + `-square.${ext}`;
        onApply(new File([blob], name, { type: blob.type }));
      },
      png ? 'image/png' : 'image/jpeg',
      0.92,
    );
  }

  const step = 12;
  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Drag to move the picture and zoom to fit. It is saved as a square.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            role="group"
            tabIndex={0}
            aria-label="Crop area. Use the arrow keys to move the picture, plus and minus to zoom."
            style={{ width: VIEW, height: VIEW, touchAction: 'none' }}
            className="bg-muted relative cursor-grab overflow-hidden rounded-xl outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              setOff(clamp(d.ox + e.clientX - d.x, d.oy + e.clientY - d.y, scale));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => setZoomTo(zoom - e.deltaY / 400)}
            onKeyDown={(e) => {
              const k = e.key;
              if (k === '+' || k === '=') setZoomTo(zoom + 0.2);
              else if (k === '-') setZoomTo(zoom - 0.2);
              else if (k.startsWith('Arrow')) {
                e.preventDefault();
                const dx = k === 'ArrowLeft' ? step : k === 'ArrowRight' ? -step : 0;
                const dy = k === 'ArrowUp' ? step : k === 'ArrowDown' ? -step : 0;
                setOff((o) => clamp(o.x + dx, o.y + dy, scale));
              }
            }}
          >
            {url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={img}
                src={url}
                alt=""
                draggable={false}
                onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                style={
                  size
                    ? {
                        position: 'absolute',
                        left: VIEW / 2 + off.x - (size.w * scale) / 2,
                        top: VIEW / 2 + off.y - (size.h * scale) / 2,
                        width: size.w * scale,
                        height: size.h * scale,
                        maxWidth: 'none',
                      }
                    : { opacity: 0 }
                }
              />
            )}
            {/* The part that will be cut away is dimmed; the round mask shows how an avatar will look. */}
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-0 border border-white/40',
                shape === 'round' ? 'rounded-full shadow-[0_0_0_999px_rgba(0,0,0,0.45)]' : 'rounded-xl',
              )}
            />
          </div>

          <div className="flex w-full items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom out"
              onClick={() => setZoomTo(zoom - 0.2)}
            >
              <Minus />
            </Button>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoomTo(Number(e.target.value))}
              aria-label="Zoom"
              className="accent-primary h-1 flex-1 cursor-pointer"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom in"
              onClick={() => setZoomTo(zoom + 0.2)}
            >
              <Plus />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Reset"
              onClick={() => {
                setZoom(1);
                setOff({ x: 0, y: 0 });
              }}
            >
              <RotateCcw />
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={apply} disabled={!size}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
