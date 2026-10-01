import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  getOperationsOverview,
  listOperationsQueue,
  type OperationsOverview,
  type OperationsQueueFilter,
  type OperationsQueueItem,
} from './operations-api'
import styles from './OperationsHome.module.css'

const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

function filterEquals(left: OperationsQueueFilter, right: OperationsQueueFilter): boolean {
  return left.type === right.type && left.priority === right.priority
}

export function OperationsHome() {
  const [overview, setOverview] = useState<OperationsOverview | null>(null)
  const [overviewState, setOverviewState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [filter, setFilter] = useState<OperationsQueueFilter>({ type: 'all', priority: 'all' })
  const [items, setItems] = useState<OperationsQueueItem[]>([])
  const [queueState, setQueueState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const loadOverview = useCallback(async () => {
    setOverviewState('loading')
    try {
      setOverview(await getOperationsOverview())
      setOverviewState('ready')
    } catch {
      setOverviewState('error')
    }
  }, [])

  const loadQueue = useCallback(async (nextCursor: string | null = null, append = false) => {
    setQueueState('loading')
    try {
      const result = await listOperationsQueue({ ...filter, cursor: nextCursor, limit: 30 })
      setItems((current) => append ? [...current, ...result.items] : result.items)
      setCursor(result.nextCursor)
      setHasMore(result.hasMore)
      setQueueState('ready')
    } catch {
      if (!append) setItems([])
      setQueueState('error')
    }
  }, [filter])

  useEffect(() => { void Promise.resolve().then(loadOverview) }, [loadOverview])
  useEffect(() => { void Promise.resolve().then(() => loadQueue()) }, [loadQueue])

  const refresh = () => {
    void loadOverview()
    void loadQueue()
  }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h2>운영 센터</h2>
          <p>{overview ? `${dateTime.format(overview.asOfMs)} 기준 · 서버 전체 건수` : '처리할 일과 서비스 연결 상태를 확인합니다'}</p>
        </div>
        <button className={`button button-secondary ${styles.refresh}`} type="button" onClick={refresh} disabled={overviewState === 'loading' || queueState === 'loading'}>
          <RefreshCw size={17} aria-hidden="true" /> 새로고침
        </button>
      </header>

      {overviewState === 'loading' && <p className={styles.state} role="status">운영 현황을 불러오는 중이에요</p>}
      {overviewState === 'error' && <p className={`${styles.state} ${styles.error}`} role="alert">운영 현황을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>}
      {overviewState === 'ready' && overview && (
        <div className={styles.cards} aria-label="운영 요약">
          {overview.cards.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`${styles.card} ${filterEquals(filter, card.filter) ? styles.cardActive : ''}`}
              aria-pressed={filterEquals(filter, card.filter)}
              onClick={() => setFilter(card.filter)}
            >
              <span>{card.label}</span>
              <strong>{card.count.toLocaleString('ko-KR')}건</strong>
            </button>
          ))}
        </div>
      )}

      <section className={styles.surface} aria-labelledby="operations-queue-title">
        <div className={styles.sectionHeading}>
          <div>
            <h3 id="operations-queue-title">지금 처리할 일</h3>
            <p>접수 시각이 최신인 항목부터 보여 줍니다</p>
          </div>
        </div>
        <div className={styles.filters}>
          <label>
            업무 종류
            <select value={filter.type} onChange={(event) => setFilter((current) => ({ ...current, type: event.target.value as OperationsQueueFilter['type'], ...(event.target.value !== 'all' && event.target.value !== 'report' && current.priority === 'urgent' ? { priority: 'all' as const } : {}) }))}>
              <option value="all">전체</option>
              <option value="report">신고</option>
              <option value="appeal">이의 제기</option>
              <option value="submission">활동·자료 오류</option>
            </select>
          </label>
          <label>
            우선순위
            <select value={filter.priority} onChange={(event) => setFilter((current) => ({ ...current, priority: event.target.value as OperationsQueueFilter['priority'], ...(event.target.value === 'urgent' ? { type: current.type === 'all' || current.type === 'report' ? current.type : 'all' } : {}) }))}>
              <option value="all">모든 항목</option>
              <option value="urgent">긴급</option>
              <option value="overdue">24시간 초과</option>
            </select>
          </label>
        </div>

        {queueState === 'loading' && <p className={styles.state} role="status">처리 목록을 불러오는 중이에요</p>}
        {queueState === 'error' && <p className={`${styles.state} ${styles.error}`} role="alert">처리 목록을 불러오지 못했어요. 0건으로 계산하지 않았습니다. 다시 시도해 주세요.</p>}
        {queueState === 'ready' && items.length === 0 && <p className={styles.state}>이 조건에 맞는 처리 항목이 없어요</p>}
        {queueState === 'ready' && items.length > 0 && (
          <ul className={styles.queue}>
            {items.map((item) => (
              <li className={styles.queueItem} key={`${item.type}:${item.id}`}>
                <div>
                  <div className={styles.badges}>
                    <span className={styles.badge}>{item.targetLabel}</span>
                    {item.urgent && <span className={`${styles.badge} ${styles.badgeUrgent}`}>긴급</span>}
                    {item.overdue && <span className={`${styles.badge} ${styles.badgeOverdue}`}>24시간 초과</span>}
                  </div>
                  <h4>{item.issueLabel}</h4>
                  <div className={styles.queueMeta}><time dateTime={new Date(item.createdAtMs).toISOString()}>{dateTime.format(item.createdAtMs)} 접수</time></div>
                </div>
                <Link className={styles.queueLink} to={item.href}>확인하기 <ArrowUpRight size={16} aria-hidden="true" /></Link>
              </li>
            ))}
          </ul>
        )}
        {queueState === 'ready' && hasMore && cursor && (
          <button className={`button button-secondary ${styles.more}`} type="button" onClick={() => void loadQueue(cursor, true)}>이전 항목 더 보기</button>
        )}
      </section>

      {overviewState === 'ready' && overview && (
        <section className={styles.surface} aria-labelledby="service-health-title">
          <div className={styles.sectionHeading}>
            <div>
              <h3 id="service-health-title">서비스 상태</h3>
              <p>서비스 데이터와 Cloud 관측 연결을 나누어 표시합니다</p>
            </div>
          </div>
          <ul className={styles.health}>
            {overview.serviceHealth.map((item) => {
              const external = item.destination.startsWith('http')
              const content = <>{item.status === 'connected' ? '현황 확인' : '확인 위치'} <ArrowUpRight size={16} aria-hidden="true" /></>
              return (
                <li className={styles.healthItem} key={item.id}>
                  <div>
                    <p>{item.label}</p>
                    <small className={item.status === 'connected' ? styles.healthStatus : styles.healthDisconnected}>
                      {item.status === 'connected' && item.observedAtMs ? `${dateTime.format(item.observedAtMs)} 관측` : '관측 미연결'}
                    </small>
                  </div>
                  {external
                    ? <a className={styles.healthLink} href={item.destination} target="_blank" rel="noreferrer">{content}</a>
                    : <Link className={styles.healthLink} to={item.destination}>{content}</Link>}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
