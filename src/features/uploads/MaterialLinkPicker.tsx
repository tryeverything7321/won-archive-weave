import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ArchiveMaterial, ArchiveMaterialCursor } from '../../data/archive-repository'
import { publishedArchiveRepository } from '../../data/firestore-archive-repository'
import { getActivityMaterialLinks, setActivityMaterialLinks } from './material-links-api'
import styles from './MaterialLinkPicker.module.css'

export function MaterialLinkPicker({ activityId }: { activityId: string }) {
  const [open, setOpen] = useState(false)
  return <details className={styles.panel} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>기존 자료 연결</summary>
    {open && <PickerContent key={activityId} activityId={activityId} />}
  </details>
}

function PickerContent({ activityId }: { activityId: string }) {
  const [items, setItems] = useState<ArchiveMaterial[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [cursor, setCursor] = useState<ArchiveMaterialCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('연결된 자료를 확인하고 있어요.')
  const [reload, setReload] = useState(0)
  const pending = useRef<{ key: string; requestId: string } | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([getActivityMaterialLinks(activityId), publishedArchiveRepository.listPublicMaterialsPage({ audience: 'member' })])
      .then(async ([links, page]) => {
        const linked = await Promise.all(links.materialIds.map((id) => publishedArchiveRepository.getPublicMaterial(id, { audience: 'member' })))
        if (!active) return
        const visible = linked.filter((item): item is ArchiveMaterial => Boolean(item))
        setItems([...new Map([...visible, ...page.items].map((item) => [item.id, item])).values()])
        setSelected(links.materialIds)
        setCursor(page.nextCursor)
        setHasMore(page.hasMore)
        setReady(true)
        setMessage('')
      }).catch(() => { if (active) setMessage('자료를 불러오지 못했어요. 다시 시도해 주세요.') })
    return () => { active = false }
  }, [activityId, reload])

  const more = async () => {
    if (!cursor || busy) return
    setBusy(true)
    try {
      const page = await publishedArchiveRepository.listPublicMaterialsPage({ audience: 'member', cursor })
      setItems((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()])
      setCursor(page.nextCursor); setHasMore(page.hasMore)
    } catch { setMessage('자료를 더 불러오지 못했어요. 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }
  const save = async () => {
    if (busy || !ready) return
    setBusy(true)
    const key = JSON.stringify(selected)
    if (pending.current?.key !== key) pending.current = { key, requestId: crypto.randomUUID() }
    try {
      await setActivityMaterialLinks(activityId, selected, pending.current.requestId)
      pending.current = null
      setMessage('자료 연결을 저장했어요. 활동 상세에서 확인할 수 있어요.')
    } catch { setMessage('연결을 저장하지 못했어요. 선택은 유지되니 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }
  const unavailable = selected.filter((id) => !items.some((item) => item.id === id))
  return <div className={styles.content}>
    <p>이미 올라온 자료를 이 활동에서도 보여 줘요. 연결을 해제해도 원본 자료는 삭제되지 않아요. 처음 올린 자료는 유지되며, 추가 자료와 합쳐 최대 30개까지 연결할 수 있어요.</p>
    {message && <p role="status">{message}</p>}
    {!ready && <button type="button" onClick={() => setReload((value) => value + 1)}>다시 불러오기</button>}
    {ready && <>
      {unavailable.length > 0 && <p>지금은 읽을 수 없는 연결 자료가 {unavailable.length}개 있어요. <button type="button" disabled={busy} onClick={() => setSelected((ids) => ids.filter((id) => !unavailable.includes(id)))}>이 연결 해제</button></p>}
      <div className={styles.list}>
        {items.map((item) => <label className={styles.option} key={item.id}>
          <input type="checkbox" checked={selected.includes(item.id)} disabled={busy || item.id === activityId || (!selected.includes(item.id) && selected.length >= 30)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />
          <span>{item.title}<small>{item.owner} · {item.visibility}{item.id === activityId ? ' · 처음 올린 자료' : ''}</small></span>
        </label>)}
      </div>
      {items.length === 0 && <p>연결할 수 있는 자료가 아직 없어요.</p>}
      <div className={styles.actions}>
        {hasMore && <button type="button" disabled={busy} onClick={() => void more()}>자료 더 보기</button>}
        <button className="button button-primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? '처리 중' : `연결 저장 (${selected.length}/30)`}</button>
        <Link to="/contribute?intent=material">새 자료 올리기</Link>
        <Link to={`/activities/${encodeURIComponent(activityId)}`}>활동 보기</Link>
      </div>
    </>}
  </div>
}
