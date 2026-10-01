import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { listOperatorAuditEvents, type OperatorAuditEvent } from './operations-api'
import styles from './OperationsHome.module.css'

const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
const categoryLabels: Record<OperatorAuditEvent['category'], string> = {
  community: '커뮤니티',
  submission: '활동·자료',
  calendar: '행사',
  account: '계정',
  members: '회원 조회',
}

const resultLabels: Record<string, string> = {
  active: '공개',
  held: '숨김',
  removed: '공개 중단',
  resolved: '처리 완료',
  dismissed: '종결',
  accepted: '수용',
  rejected: '기각',
  published: '공개 완료',
  publishing_failed: '공개 실패',
  clean: '검사 통과',
  blocked: '차단',
  error: '오류',
}

export function OperatorAudit() {
  const [items, setItems] = useState<OperatorAuditEvent[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [partial, setPartial] = useState(false)
  const [asOfMs, setAsOfMs] = useState<number | null>(null)

  const load = useCallback(async (nextCursor: string | null = null, append = false) => {
    setState('loading')
    try {
      const page = await listOperatorAuditEvents({ cursor: nextCursor, limit: 30 })
      setItems((current) => append ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setPartial(page.completeness === 'partial')
      setAsOfMs(page.asOfMs)
      setState('ready')
    } catch {
      if (!append) setItems([])
      setState('error')
    }
  }, [])

  useEffect(() => { void Promise.resolve().then(() => load()) }, [load])

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h2>운영 이력</h2>
          <p>{asOfMs ? `${dateTime.format(asOfMs)} 조회 · 허용된 운영 사건만 표시` : '서버에 기록된 실제 운영 사건을 확인합니다'}</p>
        </div>
        <button className={`button button-secondary ${styles.refresh}`} type="button" onClick={() => void load()} disabled={state === 'loading'}>
          <RefreshCw size={17} aria-hidden="true" /> 새로고침
        </button>
      </header>

      <section className={styles.surface} aria-label="운영 이력 목록">
        {state === 'loading' && <p className={styles.state} role="status">운영 이력을 불러오는 중이에요</p>}
        {state === 'error' && <p className={`${styles.state} ${styles.error}`} role="alert">운영 이력을 불러오지 못했어요. 이력이 없는 상태와 구분해 표시합니다.</p>}
        {state === 'ready' && partial && <p className={`${styles.state} ${styles.error}`} role="status">허용된 이력을 찾는 범위가 커서 이번 조회가 일부에서 멈췄어요. 더 보기를 눌러 이어서 확인해 주세요.</p>}
        {state === 'ready' && items.length === 0 && <p className={styles.state}>표시할 운영 이력이 없어요</p>}
        {state === 'ready' && items.length > 0 && (
          <ol className={styles.auditList}>
            {items.map((item) => (
              <li className={styles.auditItem} key={item.id}>
                <div className={styles.badges}>
                  <span className={styles.badge}>{categoryLabels[item.category]}</span>
                  {item.result && <span className={styles.badge}>{resultLabels[item.result] ?? item.result}</span>}
                </div>
                <h4>{item.label}</h4>
                <div className={styles.auditMeta}>
                  <time dateTime={new Date(item.occurredAtMs).toISOString()}>{dateTime.format(item.occurredAtMs)}</time>
                  {item.targetId && <span>대상 {item.targetId.slice(-8)}</span>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {state === 'ready' && hasMore && cursor && (
          <button className={`button button-secondary ${styles.more}`} type="button" onClick={() => void load(cursor, true)}>이전 이력 더 보기</button>
        )}
      </section>
    </div>
  )
}
