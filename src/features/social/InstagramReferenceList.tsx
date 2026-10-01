import { ExternalLink } from "lucide-react";
import { InstagramGlyph } from "../../components/InstagramGlyph";
import type { InstagramPostAttachmentValue } from "./instagram-url";

export function InstagramReferenceList({
  attachments,
  title = "함께 연결한 Instagram 원문",
}: {
  attachments: InstagramPostAttachmentValue[];
  title?: string;
}) {
  if (!attachments.length) return null;

  return (
    <section className="instagram-post-attachment" aria-labelledby="instagram-reference-list-title">
      <div className="instagram-post-attachment-heading">
        <InstagramGlyph size={21} />
        <div>
          <h3 id="instagram-reference-list-title">{title}</h3>
          <p>활동을 소개하거나 기록한 공개 게시물의 원문 링크예요</p>
        </div>
      </div>
      <ul className="instagram-post-attachment-list" aria-label="Instagram 원문 링크">
        {attachments.map((attachment) => (
          <li className="instagram-post-attachment-item" key={attachment.sourceUrl}>
            <InstagramGlyph size={20} />
            <div>
              <b>{attachment.originalAuthor ? `@${attachment.originalAuthor}` : "작성자 계정 미표기"}</b>
              <span>{attachment.mediaType === "reel" ? "Instagram 릴" : "Instagram 게시물"}</span>
            </div>
            <a href={attachment.sourceUrl} target="_blank" rel="noopener noreferrer">
              원문 보기 <ExternalLink size={14} />
            </a>
          </li>
        ))}
      </ul>
      <small className="instagram-post-attachment-help">
        원문이 비공개로 바뀌거나 삭제되면 Instagram에서 열리지 않을 수 있어요. 위브는 게시물 내용을 복사하거나 보관하지 않습니다.
      </small>
    </section>
  );
}
