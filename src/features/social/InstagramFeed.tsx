import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { InstagramGlyph } from "../../components/InstagramGlyph";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { getFirebaseServices } from "../../lib/firebase/client";

type InstagramItem = {
  id: string;
  permalink: string;
  caption: string;
  publishedAtMs: number;
  imageUrl?: string;
};

function safeUrl(value: unknown, kind: "permalink" | "image") {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    if (kind === "permalink") {
      return url.hostname === "instagram.com" || url.hostname.endsWith(".instagram.com") ? url.toString() : undefined;
    }
    return url.hostname.endsWith(".fbcdn.net") || url.hostname.endsWith(".cdninstagram.com") ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function InstagramFeed() {
  const services = useMemo(() => getFirebaseServices(), []);
  const [items, setItems] = useState<InstagramItem[]>([]);

  useEffect(() => {
    if (!services) return;
    return onSnapshot(query(
      collection(services.firestore, "socialImports"),
      where("visible", "==", true),
      where("reviewStatus", "==", "approved"),
      where("sourceStatus", "==", "active"),
      orderBy("publishedAtMs", "desc"),
      limit(6),
    ), (snapshot) => setItems(snapshot.docs.flatMap((document) => {
      const permalink = safeUrl(document.get("permalink"), "permalink");
      if (!permalink) return [];
      const imageUrl = safeUrl(document.get("thumbnailUrl") ?? document.get("mediaUrl"), "image");
      return [{
        id: document.id,
        permalink,
        caption: String(document.get("caption") ?? "원불교 청년회의 새로운 소식"),
        publishedAtMs: Number(document.get("publishedAtMs") ?? 0),
        ...(imageUrl ? { imageUrl } : {}),
      }];
    })), () => setItems([]));
  }, [services]);

  if (items.length === 0) return null;
  return (
    <section className="instagram-feed section-frame" aria-labelledby="instagram-feed-title">
      <div className="archive-top">
        <div className="section-heading"><p><InstagramGlyph size={18} /> 공식 Instagram</p><h2 id="instagram-feed-title"><span>여러 곳에서 시작된 이야기 </span><span>위브에서 이어서 만나요</span></h2></div>
        <a className="text-link" href="https://www.instagram.com/won_buddhism_youth/" target="_blank" rel="noopener noreferrer">공식 계정 보기 <ArrowRight size={17} /></a>
      </div>
      <div className="instagram-feed-grid">
        {items.map((item, index) => (
          <a href={item.permalink} target="_blank" rel="noopener noreferrer" className={`instagram-feed-card tone-${index % 3}`} key={item.id}>
            <div className="instagram-feed-media">{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <InstagramGlyph size={54} />}</div>
            <div><p>{item.caption}</p><span>{item.publishedAtMs ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(item.publishedAtMs)) : "최근 소식"}</span></div>
          </a>
        ))}
      </div>
    </section>
  );
}
