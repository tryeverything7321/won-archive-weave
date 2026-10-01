import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { PageFrame } from '../components/PageFrame'
import { MaterialRow } from '../components/ArchiveCards'
import type { ArchiveMaterial } from '../data/archive-repository'
import { materialVisibilityLabel } from '../data/material-access'
import { resourcesReturnPath } from '../data/archive-navigation'
import { publishedArchiveRepository } from '../data/firestore-archive-repository'
import { useFirebaseAudience } from '../features/auth/useFirebaseAudience'
import { MarkdownBody } from '../features/content/MarkdownBody'
import { InstagramReferenceList } from '../features/social/InstagramReferenceList'
import { OwnedSubmissionActions } from '../features/uploads/OwnedSubmissionActions'
import { isFirebaseConfigured } from '../lib/firebase/client'

export function MaterialDetailPage() {
  const { id = '' } = useParams()
  const { state } = useLocation()
  const returnTo = resourcesReturnPath(state?.resourcesReturn)
  const { audience, ready } = useFirebaseAudience()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; material?: ArchiveMaterial; failed?: boolean }>()
  const key = `${id}:${audience}:${attempt}`
  useEffect(() => {
    if (!ready) return
    let active = true
    const load = isFirebaseConfigured
      ? publishedArchiveRepository.getPublicMaterial(id, { audience })
      : Promise.resolve(undefined)
    void load.then((material) => { if (active) setResult({ key, material }) })
      .catch(() => { if (active) setResult({ key, failed: true }) })
    return () => { active = false }
  }, [id, audience, key, ready])

  const current = ready && result?.key === key ? result : undefined
  if (!current) return <PageFrame eyebrow="자료 나눔" title="자료를 불러오고 있어요" description="현재 공개 상태를 확인하고 있어요."><p role="status">잠시만 기다려 주세요.</p></PageFrame>
  if (!current.material) return <PageFrame eyebrow="자료 나눔" title={current.failed ? '자료를 불러오지 못했어요' : '지금은 이 자료를 볼 수 없어요'} description="공개가 중단되었거나 로그인이 필요한 자료일 수 있어요.">
    <div className="resource-status"><Link to="/resources">자료 목록으로</Link><button type="button" onClick={() => setAttempt((value) => value + 1)}>다시 확인</button><Link to="/profile">로그인 및 내 정보</Link></div>
  </PageFrame>
  const material = current.material
  const visibilityLabel = materialVisibilityLabel(material.visibility)
  return <PageFrame eyebrow="자료 나눔" title={material.title} description={material.owner ? `${material.owner} · ${visibilityLabel}` : visibilityLabel}>
    <Link className="back-link" to={returnTo}><ArrowLeft size={17} /> 자료 목록으로 돌아가기</Link>
    {material.updatedAt && <p>최근 수정 <time dateTime={material.updatedAt.toISOString()}>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(material.updatedAt)}</time></p>}
    {material.textContent && <section aria-label="자료 본문"><MarkdownBody body={material.textContent.body} /></section>}
    {material.type !== 'TEXT' && <section aria-label="첨부 및 원본"><MaterialRow material={{ ...material, textContent: undefined }} showDetail={false} /></section>}
    <InstagramReferenceList attachments={material.instagramAttachments ?? []} />
    <OwnedSubmissionActions id={id} returnTo={returnTo} />
  </PageFrame>
}
