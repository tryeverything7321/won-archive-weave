import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeContentUrl } from './text-content';
import styles from './TextContent.module.css';

export function MarkdownBody({ body, format = 'markdown' }: { body: string; format?: 'markdown' | 'plain' }) {
  if (format === 'plain') return <div className={`${styles.body} ${styles.plainBody}`} role="region" aria-label="공백과 줄바꿈을 유지한 본문" tabIndex={0}>{body}</div>;
  return <div className={styles.body}>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeContentUrl}
      components={{
        img: ({ alt }) => <span>[이미지: {alt || '본문 이미지는 자동으로 불러오지 않아요'}]</span>,
        a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
        h1: ({ children }) => <h3>{children}</h3>,
        h2: ({ children }) => <h3>{children}</h3>,
      }}
    >{body}</Markdown>
  </div>;
}
