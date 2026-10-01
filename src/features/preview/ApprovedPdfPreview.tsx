import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { FileText, X } from 'lucide-react'
import { createApprovedPreview, createOwnerSubmissionAttachmentAccess } from '../uploads/api'
import { getFirebaseServices } from '../../lib/firebase/client'
import { previewFailure, readApprovedPreviewLink, previewCsv, type ApprovedPreviewLink, type PreviewFailure } from './approved-preview'
import './ApprovedPdfPreview.css'

type PreviewState = { kind: 'idle' | 'loading' } | { kind: 'ready'; link: ApprovedPreviewLink } | { kind: 'error'; failure: PreviewFailure }

type ApprovedPdfPreviewProps = { title: string; triggerLabel?: string; triggerClassName?: string } & (
  | { materialId: string; submissionId?: never }
  | { submissionId: string; materialId?: never }
)

/** Renders only server-authorized previews; never falls back to a download on denial. */
export function ApprovedPdfPreview({ materialId, submissionId, title, triggerLabel = '미리보기', triggerClassName }: ApprovedPdfPreviewProps) {
  const headingId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const revision = useRef(0)
  const [state, setState] = useState<PreviewState>({ kind: 'idle' })
  const [fullImage, setFullImage] = useState(false)

  useEffect(() => {
    const services = getFirebaseServices()
    let owner = services?.auth.currentUser?.uid
    const unsubscribe = services && onAuthStateChanged(services.auth, user => {
      if (user?.uid !== owner) {
        owner = user?.uid
        revision.current += 1
        dialog.current?.close()
        setState({ kind: 'idle' })
      }
    })
    return () => { revision.current += 1; if (unsubscribe) unsubscribe() }
  }, [materialId, submissionId])

  useEffect(() => {
    if (state.kind !== 'ready') return
    const timeout = window.setTimeout(() => {
      revision.current += 1
      setState({ kind: 'error', failure: { title: '열람 시간 만료', message: '현재 공개 상태를 다시 확인한 뒤 새 미리보기를 열어 주세요.', retry: true } })
    }, Math.max(0, state.link.expiresAtMs - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [state])

  async function open() {
    setFullImage(false)
    const request = ++revision.current
    const requestedOwner = getFirebaseServices()?.auth.currentUser?.uid
    if (!dialog.current?.open) dialog.current?.showModal()
    setState({ kind: 'loading' })
    try {
      const response = submissionId
        ? await createOwnerSubmissionAttachmentAccess(submissionId, 'preview')
        : await createApprovedPreview(materialId as string)
      const link = readApprovedPreviewLink(response)
      if (request !== revision.current || !dialog.current?.open
        || requestedOwner !== getFirebaseServices()?.auth.currentUser?.uid) return
      setState({ kind: 'ready', link })
    } catch (error) {
      if (request === revision.current && dialog.current?.open) {
        setState({ kind: 'error', failure: previewFailure(error) })
      }
    }
  }

  return <>
    <button ref={trigger} type="button" className={triggerClassName} onClick={() => void open()}><FileText size={16} aria-hidden="true" />{triggerLabel}</button>
    {createPortal(<dialog ref={dialog} className="approved-pdf-dialog" aria-labelledby={headingId}
      onClose={() => { revision.current += 1; setState({ kind: 'idle' }); trigger.current?.focus() }}>
      <header>
        <h2 id={headingId}>{title}</h2>
        <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="미리보기 닫기"><X size={20} aria-hidden="true" />닫기</button>
      </header>
      {state.kind === 'loading' && <p role="status">미리보기를 준비하고 있어요. 한글·Office 문서는 처음 열 때 변환에 잠시 시간이 걸릴 수 있어요.</p>}
      {state.kind === 'error' && <div className="approved-preview-error" role="alert">
        <strong>{state.failure.title}</strong>
        <p>{state.failure.message}</p>
        {state.failure.retry && <button type="button" onClick={() => void open()}>미리보기 다시 시도</button>}
      </div>}
      {state.kind === 'ready' && <>
        {(!state.link.renderFormat || state.link.renderFormat === 'pdf') && <>
          <p>PDF 미리보기입니다. 문서 안에서 페이지를 이동하거나 확대할 수 있어요.</p>
          <iframe src={state.link.url} title={title + ' PDF 미리보기'} referrerPolicy="no-referrer" />
        </>}
        {state.link.renderFormat === 'image' && <><button type="button" aria-pressed={fullImage} onClick={() => setFullImage(value => !value)}>{fullImage ? '화면에 맞추기' : '원본 크기로 보기'}</button><div className={'approved-preview-image-wrap' + (fullImage ? ' is-expanded' : '')}><img className="approved-preview-image" src={state.link.url} alt={title} onError={() => setState({ kind: 'error', failure: { title: '이미지 표시 오류', message: '이미지를 표시하지 못했어요. 원본 다운로드가 허용된 자료라면 별도로 계속 이용할 수 있어요.', retry: true } })} /></div></>}
        {state.link.renderFormat === 'text' && <pre className="approved-preview-text">{state.link.text}</pre>}
        {state.link.renderFormat === 'csv' && <><p>미리보기는 최대 200행·50열이며 긴 셀은 일부만 표시해요. 전체 내용은 원본에서 확인하세요.</p><div className="approved-preview-table" tabIndex={0} role="region" aria-label="표 미리보기"><table><tbody>{previewCsv(state.link.text ?? '').map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></>}
        {state.link.truncated && <p>큰 파일이라 앞부분만 표시했어요. 전체 내용은 원본에서 확인하세요.</p>}
        <a href={state.link.url} target="_blank" rel="noopener noreferrer">파일을 새 창에서 열기</a>
      </>}
    </dialog>, document.body)}
  </>
}
