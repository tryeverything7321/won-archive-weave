import { ArrowDownToLine, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { ApprovedPdfPreview } from '../preview/ApprovedPdfPreview'
import { readOwnerAttachmentDownload } from '../preview/approved-preview'
import { getFirebaseServices } from '../../lib/firebase/client'
import { createOwnerSubmissionAttachmentAccess } from './api'
import { runOwnerAttachmentDownload, type OwnerDownloadState } from './owner-attachment-download'

export function OwnerAttachmentActions({ submissionId, title }: { submissionId: string; title: string }) {
  const [downloadState, setDownloadState] = useState<OwnerDownloadState>('idle')

  async function download() {
    const requestedOwner = getFirebaseServices()?.auth.currentUser?.uid
    await runOwnerAttachmentDownload(async () => {
      const response = await createOwnerSubmissionAttachmentAccess(submissionId, 'download')
      if (!requestedOwner || requestedOwner !== getFirebaseServices()?.auth.currentUser?.uid) {
        throw new Error('attachment_owner_changed')
      }
      const link = readOwnerAttachmentDownload(response)
      return { url: link.url }
    }, (url) => window.location.assign(url), setDownloadState)
  }

  return (
    <div className="submission-manager-actions" aria-label={`${title} 비공개 첨부 열람`}>
      <ApprovedPdfPreview submissionId={submissionId} title={title} triggerLabel="첨부 미리보기" triggerClassName="button button-secondary" />
      <button type="button" className="button button-secondary" onClick={() => void download()} disabled={downloadState === 'working'}>
        {downloadState === 'working'
          ? <LoaderCircle className="spin" size={16} aria-hidden="true" />
          : <ArrowDownToLine size={16} aria-hidden="true" />}
        {downloadState === 'working' ? '원본 준비 중' : '첨부 원본 다운로드'}
      </button>
      {downloadState === 'error' && <p role="alert">첨부 원본을 내려받지 못했어요. 상태를 새로고침한 뒤 다시 확인해 주세요.</p>}
    </div>
  )
}
