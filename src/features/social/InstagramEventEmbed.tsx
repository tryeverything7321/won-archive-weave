import { useEffect, useRef, useState } from 'react';
import { normalizeInstagramPostUrl, type InstagramPostAttachmentValue } from './instagram-url';
import { InstagramGlyph } from '../../components/InstagramGlyph';

type InstagramWindow = Window & { instgrm?: { Embeds: { process(): void } } };
let scriptLoad: Promise<void> | undefined;
function loadInstagramScript(): Promise<void> {
  if ((window as InstagramWindow).instgrm) return Promise.resolve();
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.instagram.com/embed.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); reject(new Error('embed_unavailable')); };
    document.head.append(script);
  }).catch(error => { scriptLoad = undefined; throw error; });
  return scriptLoad;
}

function InstagramEventPost({ post }: { post: InstagramPostAttachmentValue }) {
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const url = normalizeInstagramPostUrl(post.sourceUrl).sourceUrl;
  useEffect(() => {
    if (!enabled || !container.current) return;
    let active = true;
    const target = container.current;
    const block = document.createElement('blockquote');
    block.className = 'instagram-media';
    block.dataset.instgrmPermalink = url;
    block.dataset.instgrmVersion = '14';
    const link = document.createElement('a');
    link.href = url;
    link.textContent = 'Instagram에서 원문 보기';
    block.append(link);
    target.replaceChildren(block);
    const timer = window.setTimeout(() => {
      if (active && !target.querySelector('iframe')) setUnavailable(true);
    }, 10000);
    void loadInstagramScript().then(() => {
      if (active) (window as InstagramWindow).instgrm?.Embeds.process();
    }).catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; window.clearTimeout(timer); target.replaceChildren(); };
  }, [enabled, url]);
  return <article className="event-instagram-post">
    {post.originalAuthor && <p>등록자가 입력한 계정: @{post.originalAuthor}</p>}
    <a href={url} target="_blank" rel="noopener noreferrer">Instagram에서 원문 보기</a>
    {!enabled && <button type="button" className="button button-secondary" onClick={() => setEnabled(true)}>Instagram 게시물 보기</button>}
    {enabled && <button type="button" className="button button-secondary" onClick={() => { setEnabled(false); setUnavailable(false); }}>게시물 접기</button>}
    {unavailable && <p role="status">게시물을 표시하지 못했어요. 원문 링크에서 확인해 주세요.</p>}
    <div ref={container} className="event-instagram-embed" />
  </article>;
}

export function InstagramEventEmbed({ posts }: { posts: InstagramPostAttachmentValue[] }) {
  if (!posts.length) return null;
  return <section className="event-instagram-section">
    <h2><InstagramGlyph size={24} /> Instagram 행사 소식</h2>
    <p>게시물 보기를 누르면 Instagram에 연결되며 Meta의 개인정보 처리방침이 적용됩니다. 원문이 삭제되거나 비공개로 바뀌면 표시되지 않을 수 있어요.</p>
    {posts.map(post => <InstagramEventPost key={post.sourceUrl} post={post} />)}
  </section>;
}
