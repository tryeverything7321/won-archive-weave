import { ExternalLink, Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import { InstagramGlyph } from "../../components/InstagramGlyph";
import {
  appendInstagramAttachment,
  maxInstagramAttachments,
  type InstagramPostAttachmentValue,
} from "./instagram-url";

export function InstagramPostAttachment({
  value,
  onChange,
  required = false,
}: {
  value: InstagramPostAttachmentValue[];
  onChange: (next: InstagramPostAttachmentValue[]) => void;
  required?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [author, setAuthor] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    setError("");
    try {
      onChange(appendInstagramAttachment(value, url, author));
      setUrl("");
      setAuthor("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Instagram 링크를 확인해 주세요");
    }
  };

  return (
    <section className="instagram-post-attachment" aria-labelledby="instagram-post-attachment-title">
      <div className="instagram-post-attachment-heading">
        <InstagramGlyph size={20} />
        <div>
          <h3 id="instagram-post-attachment-title">Instagram 게시물 함께 연결하기{required ? " (1개 이상 필수)" : ""}</h3>
          <p>공개 게시물이나 릴 링크를 연결해 주세요. 로그인 정보는 저장하지 않습니다.</p>
        </div>
      </div>
      <div className="instagram-post-attachment-fields">
        <label>
          <span>게시물 또는 릴 URL</span>
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.instagram.com/p/.../"
          />
        </label>
        <label>
          <span>원문 계정 이름 <small>선택</small></span>
          <input
            value={author}
            maxLength={31}
            onChange={(event) => setAuthor(event.target.value)}
            placeholder="예: won_buddhism_youth"
          />
        </label>
        <button
          className="button button-secondary"
          type="button"
          disabled={!url.trim() || value.length >= maxInstagramAttachments}
          onClick={add}
        >
          <Link2 size={17} aria-hidden="true" /> 링크 연결
        </button>
      </div>
      <small className="instagram-post-attachment-help">공개 링크는 바로 연결됩니다. 원문이 비공개로 바뀌거나 삭제되면 나중에 열리지 않을 수 있어요.</small>
      {error && <p className="instagram-post-attachment-error" role="alert">{error}</p>}
      {value.length > 0 && (
        <ul className="instagram-post-attachment-list" aria-label="연결한 Instagram 원문">
          {value.map((attachment) => (
            <li className="instagram-post-attachment-item" key={attachment.sourceUrl}>
              <InstagramGlyph size={18} />
              <div>
                <b>{attachment.mediaType === "reel" ? "Instagram 릴" : "Instagram 게시물"}</b>
                <span>{attachment.originalAuthor ? `등록자가 입력한 계정: @${attachment.originalAuthor}` : "원문에서 작성자를 확인해 주세요"}</span>
                <a href={attachment.sourceUrl} target="_blank" rel="noreferrer noopener">
                  원문 열기 <ExternalLink size={14} aria-hidden="true" />
                </a>
              </div>
              <button
                className="instagram-post-attachment-remove"
                type="button"
                aria-label={`${attachment.originalAuthor ? `@${attachment.originalAuthor}의 ` : ""}Instagram 링크 제거`}
                onClick={() => onChange(value.filter((item) => item.sourceUrl !== attachment.sourceUrl))}
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
