import { useState } from 'react';
export function EventShareLink({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const url = `${window.location.origin}/events/${encodeURIComponent(eventId)}`;
  return <div className="event-share-link">
    <button type="button" className="button button-secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(url); setStatus('copied'); }
      catch { setStatus('manual'); }
    }}>행사 링크 복사</button>
    {status === 'copied' && <p role="status">행사 링크를 복사했어요</p>}
    {status === 'manual' && <label>아래 주소를 직접 복사해 주세요<input readOnly value={url} onFocus={event => event.target.select()} /></label>}
  </div>;
}
