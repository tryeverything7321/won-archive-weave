import { useEffect, useRef, useState } from 'react';
import type { CalendarEventImage } from './calendar-model';
import { resolveMediaDisplayMode } from './calendar-media-presentation';

export function CalendarEventMedia({ image }: { image: CalendarEventImage }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === image.url;
  return <figure className="event-readable-media">
    {failed ? <p role="status">사진을 불러오지 못했어요. 행사 안내는 아래에서 확인해 주세요.</p> : <>
      <button ref={trigger} type="button" className="event-image-expand" aria-label={`${image.alt} 크게 보기`} onClick={() => dialog.current?.showModal()}>
        <img src={image.url} alt={image.alt} loading="lazy" onError={() => setFailedUrl(image.url)} style={{ objectFit: resolveMediaDisplayMode(image.displayMode) }} />
        <span>크게 보기</span>
      </button>
      <dialog ref={dialog} className="event-image-dialog" aria-label="행사 사진 크게 보기" onClose={() => trigger.current?.focus()}>
        <button type="button" autoFocus onClick={() => dialog.current?.close()}>닫기</button>
        <img src={image.url} alt={image.alt} />
      </dialog>
    </>}
  </figure>;
}

export function SelectedEventImagePreview({ file, displayMode }: { file: File; displayMode?: string }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    if (image.current) image.current.src = next;
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return <img ref={image} className="event-selected-preview" alt={`${file.name} 미리보기`} style={{ objectFit: resolveMediaDisplayMode(displayMode) }} />;
}
