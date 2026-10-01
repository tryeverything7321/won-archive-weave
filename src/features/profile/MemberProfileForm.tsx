import { FieldRequirement } from "../../components/forms/FieldRequirement";
import { useEffect, useId, useRef, useState } from 'react'
import { Camera, CheckCircle2, CircleAlert, LoaderCircle, Trash2, UserRound } from 'lucide-react'
import {
  deleteMyProfilePhoto,
  getMyMemberProfile,
  readMyProfilePhoto,
  updateMyMemberProfile,
  uploadMyProfilePhoto,
} from './member-profile-api'
import {
  emptyMemberProfile,
  ageBandLabels,
  membershipLabels,
  religionConsentVersion,
  memberProfileError,
  memberProfileLimits,
  normalizeMemberProfile,
  profilePhotoError,
  profilePhotoPolicy,
  type MemberProfileField,
  type MemberProfileInput,
  type MemberProfileValue,
} from './member-profile-model'
import {
  classifyProfileLoadError,
  isCurrentProfileLoad,
  type ProfileLoadIssue,
} from './profile-load-state'

import experienceStyles from '../experience/Experience.module.css'

type MemberProfileFormProps = {
  user: { uid: string } | null
  onPhotoChanged?: () => void
}

type FormStatus = {
  tone: 'idle' | 'working' | 'success' | 'error'
  message: string
}

const initialStatus: FormStatus = { tone: 'idle', message: '' }

function profileLoadMessage(issue: ProfileLoadIssue): string {
  if (issue === 'permission') return '내 정보에 접근할 권한을 확인하지 못했어요. 다시 로그인한 뒤 시도해 주세요.'
  if (issue === 'network') return '네트워크 문제로 내 정보를 불러오지 못했어요. 연결 상태를 확인해 주세요.'
  if (issue === 'format') return '저장된 내 정보의 형식을 확인할 수 없어요. 다시 시도해도 계속되면 운영자에게 알려 주세요.'
  return '내 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
}

function photoLoadMessage(issue: ProfileLoadIssue): string {
  if (issue === 'permission') return '프로필 사진을 확인할 권한이 없어요. 다른 정보는 계속 편집할 수 있어요.'
  if (issue === 'network') return '네트워크 문제로 프로필 사진만 불러오지 못했어요. 다른 정보는 계속 편집할 수 있어요.'
  if (issue === 'format') return '프로필 사진 형식을 확인할 수 없어요. 다른 정보는 계속 편집할 수 있어요.'
  return '프로필 사진만 불러오지 못했어요. 다른 정보는 계속 편집할 수 있어요.'
}

function editableValue(profile: MemberProfileValue): MemberProfileInput {
  return {
    bio: profile.bio,
    region: profile.region,
    organization: profile.organization,
    realName: profile.realName,
    email: profile.email,
    phone: profile.phone,
    ageBand: profile.ageBand,
    wonBuddhismMembership: profile.wonBuddhismMembership,
    religionConsentVersion: profile.religionConsentVersion,
  }
}

export function MemberProfileForm({ user, onPhotoChanged }: MemberProfileFormProps) {
  const formId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef('')
  const activeUidRef = useRef(user?.uid ?? '')
  const mountedRef = useRef(false)
  const loadGenerationRef = useRef(0)
  const operationRevisionRef = useRef(0)
  const editRevisionRef = useRef(0)
  const photoRequestRef = useRef(0)
  const savingRef = useRef(false)
  const deletingRef = useRef(false)
  const [value, setValue] = useState<MemberProfileInput>(() => editableValue(emptyMemberProfile))
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [hasPhoto, setHasPhoto] = useState(false)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [loadedUid, setLoadedUid] = useState('')
  const [loadMessage, setLoadMessage] = useState('')
  const [photoLoadState, setPhotoLoadState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
  const [photoLoadMessageText, setPhotoLoadMessageText] = useState('')
  const [status, setStatus] = useState<FormStatus>(initialStatus)
  const [deletingPhoto, setDeletingPhoto] = useState(false)

  const replacePreviewUrl = (nextUrl: string) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = nextUrl
    setPhotoUrl(nextUrl)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadGenerationRef.current += 1
      operationRevisionRef.current += 1
      editRevisionRef.current += 1
      photoRequestRef.current += 1
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  useEffect(() => {
    let active = true
    const uid = user?.uid
    const generation = loadGenerationRef.current + 1
    const photoRequest = photoRequestRef.current + 1
    loadGenerationRef.current = generation
    operationRevisionRef.current += 1
    editRevisionRef.current += 1
    photoRequestRef.current = photoRequest
    savingRef.current = false
    deletingRef.current = false
    activeUidRef.current = uid ?? ''

    if (!uid) {
      queueMicrotask(() => {
        if (!active) return
        setValue(editableValue(emptyMemberProfile))
        setPhotoFile(null)
        replacePreviewUrl('')
        setHasPhoto(false)
        setDeletingPhoto(false)
        setStatus(initialStatus)
        setLoadMessage('')
        setLoadState('idle')
        setPhotoLoadMessageText('')
        setPhotoLoadState('idle')
        setLoadedUid('')
        if (fileInputRef.current) fileInputRef.current.value = ''
      })
      return () => {
        active = false
      }
    }

    queueMicrotask(() => {
      if (!active) return
      setValue(editableValue(emptyMemberProfile))
      setPhotoFile(null)
      replacePreviewUrl('')
      setHasPhoto(false)
      setDeletingPhoto(false)
      setStatus(initialStatus)
      setLoadMessage('')
      setLoadState('loading')
      setPhotoLoadMessageText('')
      setPhotoLoadState('loading')
      setLoadedUid('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    })
    const request = { uid, generation }
    void getMyMemberProfile()
      .then((profile) => {
        if (!active || !isCurrentProfileLoad(
          request,
          activeUidRef.current,
          loadGenerationRef.current,
          { mounted: mountedRef.current },
        )) return
        setValue(editableValue(profile))
        setLoadedUid(uid)
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        if (!active || !isCurrentProfileLoad(
          request,
          activeUidRef.current,
          loadGenerationRef.current,
          { mounted: mountedRef.current },
        )) return
        setLoadMessage(profileLoadMessage(classifyProfileLoadError(error)))
        setLoadState('error')
      })
    void readMyProfilePhoto(uid)
      .then((photo) => {
        if (
          !active
          || photoRequestRef.current !== photoRequest
          || !isCurrentProfileLoad(
            request,
            activeUidRef.current,
            loadGenerationRef.current,
            { mounted: mountedRef.current },
          )
        ) return
        setHasPhoto(Boolean(photo))
        replacePreviewUrl(photo ? URL.createObjectURL(photo) : '')
        setPhotoLoadMessageText('')
        setPhotoLoadState(photo ? 'ready' : 'empty')
      })
      .catch((error: unknown) => {
        if (
          !active
          || photoRequestRef.current !== photoRequest
          || !isCurrentProfileLoad(
            request,
            activeUidRef.current,
            loadGenerationRef.current,
            { mounted: mountedRef.current },
          )
        ) return
        setPhotoLoadMessageText(photoLoadMessage(classifyProfileLoadError(error)))
        setPhotoLoadState('error')
      })

    return () => {
      active = false
    }
  }, [user?.uid])

  const setField = (field: MemberProfileField, next: string) => {
    editRevisionRef.current += 1
    setValue((current) => ({ ...current, [field]: next }))
    if (status.tone !== 'idle' && status.tone !== 'working') setStatus(initialStatus)
  }

  const choosePhoto = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const error = profilePhotoError(file)
    if (error) {
      if (fileInputRef.current) fileInputRef.current.value = ''
      setStatus({ tone: 'error', message: error })
      return
    }
    photoRequestRef.current += 1
    setPhotoFile(file)
    replacePreviewUrl(URL.createObjectURL(file))
    setPhotoLoadMessageText('')
    setPhotoLoadState('ready')
    if (status.tone !== 'working') {
      setStatus({ tone: 'idle', message: '새 사진을 선택했어요. 저장하면 현재 사진을 교체합니다.' })
    }
  }

  const retryProfile = async () => {
    if (!user || loadState === 'loading') return
    const request = { uid: user.uid, generation: loadGenerationRef.current }
    setLoadMessage('')
    setLoadState('loading')
    try {
      const profile = await getMyMemberProfile()
      if (!isCurrentProfileLoad(
        request,
        activeUidRef.current,
        loadGenerationRef.current,
        { mounted: mountedRef.current },
      )) return
      setValue(editableValue(profile))
      setLoadedUid(request.uid)
      setLoadState('ready')
    } catch (error: unknown) {
      if (!isCurrentProfileLoad(
        request,
        activeUidRef.current,
        loadGenerationRef.current,
        { mounted: mountedRef.current },
      )) return
      setLoadMessage(profileLoadMessage(classifyProfileLoadError(error)))
      setLoadState('error')
    }
  }

  const retryPhoto = async () => {
    if (!user || photoLoadState === 'loading') return
    const request = { uid: user.uid, generation: loadGenerationRef.current }
    const photoRequest = photoRequestRef.current + 1
    photoRequestRef.current = photoRequest
    setPhotoLoadMessageText('')
    setPhotoLoadState('loading')
    try {
      const photo = await readMyProfilePhoto(request.uid)
      if (
        photoRequestRef.current !== photoRequest
        || !isCurrentProfileLoad(
          request,
          activeUidRef.current,
          loadGenerationRef.current,
          { mounted: mountedRef.current },
        )
      ) return
      setHasPhoto(Boolean(photo))
      replacePreviewUrl(photo ? URL.createObjectURL(photo) : '')
      setPhotoLoadState(photo ? 'ready' : 'empty')
    } catch (error: unknown) {
      if (
        photoRequestRef.current !== photoRequest
        || !isCurrentProfileLoad(
          request,
          activeUidRef.current,
          loadGenerationRef.current,
          { mounted: mountedRef.current },
        )
      ) return
      setPhotoLoadMessageText(photoLoadMessage(classifyProfileLoadError(error)))
      setPhotoLoadState('error')
    }
  }

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user || savingRef.current || deletingRef.current) return
    const error = memberProfileError(value)
    if (error) {
      setStatus({ tone: 'error', message: error })
      return
    }

    const uid = user.uid
    const generation = loadGenerationRef.current
    const operationRevision = operationRevisionRef.current + 1
    const editRevision = editRevisionRef.current
    const photoRevision = photoRequestRef.current
    const selectedPhoto = photoFile
    operationRevisionRef.current = operationRevision
    savingRef.current = true
    const accountRequest = { uid, generation, operationRevision }
    const isCurrentAccountOperation = () => isCurrentProfileLoad(
      accountRequest,
      activeUidRef.current,
      loadGenerationRef.current,
      {
        mounted: mountedRef.current,
        operationRevision: operationRevisionRef.current,
      },
    )
    const isCurrentEdit = () => isCurrentProfileLoad(
      { ...accountRequest, editRevision },
      activeUidRef.current,
      loadGenerationRef.current,
      {
        mounted: mountedRef.current,
        operationRevision: operationRevisionRef.current,
        editRevision: editRevisionRef.current,
      },
    )
    const isCurrentPhoto = () => isCurrentProfileLoad(
      { ...accountRequest, photoRevision },
      activeUidRef.current,
      loadGenerationRef.current,
      {
        mounted: mountedRef.current,
        operationRevision: operationRevisionRef.current,
        photoRevision: photoRequestRef.current,
      },
    )
    setStatus({
      tone: 'working',
      message: selectedPhoto ? '내 정보와 새 프로필 사진을 저장하고 있어요.' : '내 정보를 저장하고 있어요.',
    })
    try {
      const profile = await updateMyMemberProfile(normalizeMemberProfile(value))
      if (!isCurrentAccountOperation()) return
      if (isCurrentEdit()) setValue(editableValue(profile))
      if (selectedPhoto) {
        if (!isCurrentPhoto()) {
          setStatus(initialStatus)
          return
        }
        try {
          await uploadMyProfilePhoto(uid, selectedPhoto)
          if (!isCurrentPhoto()) {
            if (isCurrentAccountOperation()) setStatus(initialStatus)
            return
          }
          const photo = await readMyProfilePhoto(uid)
          if (!isCurrentPhoto()) {
            if (isCurrentAccountOperation()) setStatus(initialStatus)
            return
          }
          if (photo) replacePreviewUrl(URL.createObjectURL(photo))
          setHasPhoto(Boolean(photo))
          setPhotoLoadMessageText('')
          setPhotoLoadState(photo ? 'ready' : 'empty')
          setPhotoFile((current) => current === selectedPhoto ? null : current)
          if (fileInputRef.current) fileInputRef.current.value = ''
          onPhotoChanged?.()
        } catch {
          if (!isCurrentPhoto()) {
            if (isCurrentAccountOperation()) setStatus(initialStatus)
            return
          }
          setStatus({
            tone: 'error',
            message: '입력한 정보는 저장했지만 사진은 올리지 못했어요. 사진만 다시 선택해 주세요.',
          })
          return
        }
      }
      if (isCurrentEdit() && isCurrentPhoto()) {
        setStatus({ tone: 'success', message: '내 정보를 저장했어요.' })
        window.dispatchEvent(new Event('weave:profile-saved'))
      } else if (isCurrentAccountOperation()) {
        setStatus(initialStatus)
      }
    } catch {
      if (!isCurrentAccountOperation()) return
      setStatus({
        tone: 'error',
        message: '내 정보를 저장하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.',
      })
    } finally {
      if (isCurrentAccountOperation()) savingRef.current = false
    }
  }

  const removePhoto = async () => {
    if (!user || deletingRef.current || savingRef.current) return
    const uid = user.uid
    const generation = loadGenerationRef.current
    const operationRevision = operationRevisionRef.current + 1
    const photoRevision = photoRequestRef.current + 1
    operationRevisionRef.current = operationRevision
    photoRequestRef.current = photoRevision
    deletingRef.current = true
    const request = { uid, generation, operationRevision, photoRevision }
    const isCurrentDelete = () => isCurrentProfileLoad(
      request,
      activeUidRef.current,
      loadGenerationRef.current,
      {
        mounted: mountedRef.current,
        operationRevision: operationRevisionRef.current,
        photoRevision: photoRequestRef.current,
      },
    )
    const isCurrentAccountOperation = () => isCurrentProfileLoad(
      { uid, generation, operationRevision },
      activeUidRef.current,
      loadGenerationRef.current,
      {
        mounted: mountedRef.current,
        operationRevision: operationRevisionRef.current,
      },
    )
    setDeletingPhoto(true)
    setStatus({ tone: 'working', message: '프로필 사진을 삭제하고 있어요.' })
    try {
      await deleteMyProfilePhoto(uid)
      if (!isCurrentDelete()) return
      setPhotoFile(null)
      replacePreviewUrl('')
      setHasPhoto(false)
      setPhotoLoadMessageText('')
      setPhotoLoadState('empty')
      if (fileInputRef.current) fileInputRef.current.value = ''
      onPhotoChanged?.()
      setStatus({ tone: 'success', message: '프로필 사진을 삭제했어요.' })
    } catch {
      if (!isCurrentDelete()) return
      setStatus({ tone: 'error', message: '프로필 사진을 삭제하지 못했어요. 다시 시도해 주세요.' })
    } finally {
      if (isCurrentAccountOperation()) {
        deletingRef.current = false
        setDeletingPhoto(false)
        if (!isCurrentDelete()) setStatus(initialStatus)
      }
    }
  }

  if (!user) {
    return (
      <section className="member-profile-form member-profile-form--signed-out" aria-labelledby={`${formId}-title`}>
        <h2 id={`${formId}-title`}>내 정보</h2>
        <p>내 정보를 관리하려면 먼저 카카오 또는 네이버로 로그인해 주세요.</p>
      </section>
    )
  }

  if ((loadState === 'loading' || loadedUid !== user.uid) && loadState !== 'error') {
    return (
      <section className="member-profile-form member-profile-form--state" aria-labelledby={`${formId}-title`}>
        <h2 id={`${formId}-title`}>내 정보</h2>
        <div role="status" aria-live="polite">
          <LoaderCircle className="spin" size={24} aria-hidden="true" />
          <p>저장된 내 정보를 불러오고 있어요.</p>
        </div>
      </section>
    )
  }

  if (loadState === 'error') {
    return (
      <section className="member-profile-form member-profile-form--state" aria-labelledby={`${formId}-title`}>
        <h2 id={`${formId}-title`}>내 정보</h2>
        <div role="alert">
          <CircleAlert size={22} aria-hidden="true" />
          <p>{loadMessage}</p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void retryProfile()}>
          다시 시도하기
        </button>
      </section>
    )
  }

  return (
    <section className="member-profile-form" aria-labelledby={`${formId}-title`}>
      {new URLSearchParams(window.location.search).get("registration") === "required" && <p role="status">위브를 계속 이용하려면 실명과 소속을 한 번 입력해 주세요. 저장하면 이전 화면으로 돌아갑니다.</p>}
      <header className="member-profile-heading">
        <div>
          <p className="section-kicker">내 정보</p>
          <h2 id={`${formId}-title`}>내 가입 정보를 관리해요</h2>
        </div>
        <p>실명과 소속은 필수입니다. 다른 이용자에게는 공개되지 않으며, 업무 권한이 있는 관리자만 필요한 경우 확인합니다.</p>
      </header>

      <form onSubmit={save}>
<fieldset className="member-profile-section member-profile-basic-fields"><legend>필수 가입 정보</legend>          <label className="member-profile-field" htmlFor={`${formId}-real-name`}>
            <span>실명 <FieldRequirement /></span>
            <input
              id={`${formId}-real-name`}
              value={value.realName}
              maxLength={memberProfileLimits.realName}
              autoComplete="name"
              required
              onChange={(event) => setField('realName', event.target.value)}
            />
          </label>          <label className="member-profile-field" htmlFor={`${formId}-organization`}>
            <span>소속 교당·모임 <FieldRequirement /></span>
            <input
              id={`${formId}-organization`}
              value={value.organization}
              maxLength={memberProfileLimits.organization}
              autoComplete="organization"
              required
              disabled={value.organization === "소속 없음"}
              placeholder="예: ○○교당 청년회"
              onChange={(event) => setField('organization', event.target.value)}
            />
          </label>
          <label className="member-profile-field"><span><input type="checkbox" checked={value.organization === '소속 없음'} onChange={event => setField('organization', event.target.checked ? '소속 없음' : '')} /> 소속 없음</span></label></fieldset>
        <details className="member-profile-optional"><summary>선택 정보 추가</summary>
        <fieldset className="member-profile-section member-profile-photo-section">
          <legend>프로필 사진</legend>
          <div className="member-profile-photo-preview">
            {photoUrl ? (
              <img src={photoUrl} alt="내 프로필 사진 미리보기" />
            ) : (
              <span aria-hidden="true"><UserRound /></span>
            )}
          </div>
          <div className="member-profile-photo-actions">
            <label className="button button-secondary" htmlFor={`${formId}-photo`}>
              <Camera size={18} aria-hidden="true" />
              {hasPhoto || photoFile ? '사진 교체하기' : '사진 선택하기'}
            </label>
            <input
              ref={fileInputRef}
              id={`${formId}-photo`}
              data-profile-photo-input
              className="member-profile-file-input"
              type="file"
              accept={profilePhotoPolicy.accept}
              aria-describedby={`${formId}-photo-help`}
              onChange={(event) => choosePhoto(event.target.files)}
            />
            {(hasPhoto || photoFile) && (
              <button
                className="button button-secondary member-profile-photo-delete"
                type="button"
                disabled={deletingPhoto || status.tone === 'working'}
                onClick={() => void removePhoto()}
              >
                <Trash2 size={18} aria-hidden="true" />
                {deletingPhoto ? '삭제 중' : '사진 삭제'}
              </button>
            )}
            <small id={`${formId}-photo-help`}>JPEG, PNG, WebP · 최대 5MB · 내 계정에서만 확인</small>
            {photoLoadState === 'loading' && (
              <div role="status" aria-live="polite">
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
                <p>프로필 사진을 불러오는 중이에요. 다른 정보는 바로 편집할 수 있어요.</p>
              </div>
            )}
            {photoLoadState === 'error' && (
              <div role="alert">
                <CircleAlert size={18} aria-hidden="true" />
                <p>{photoLoadMessageText}</p>
                <button className="button button-secondary" type="button" onClick={() => void retryPhoto()}>
                  사진만 다시 불러오기
                </button>
              </div>
            )}
          </div>
        </fieldset>

        <fieldset className="member-profile-section member-profile-basic-fields">
          <legend>나를 위한 기본 정보</legend>
          <p className="member-profile-section-help">공개 별명과 별개로 내 활동을 준비할 때 참고하는 정보예요.</p>
          <label className="member-profile-field member-profile-field--wide" htmlFor={`${formId}-bio`}>
            <span>짧은 소개</span>
            <textarea
              id={`${formId}-bio`}
              value={value.bio}
              maxLength={memberProfileLimits.bio}
              rows={4}
              aria-describedby={`${formId}-bio-help`}
              onChange={(event) => setField('bio', event.target.value)}
            />
            <small id={`${formId}-bio-help`}>관심 있는 활동이나 요즘 나누고 싶은 이야기를 적을 수 있어요.</small>
          </label>
          <label className="member-profile-field" htmlFor={`${formId}-region`}>
            <span>지역</span>
            <input
              id={`${formId}-region`}
              value={value.region}
              maxLength={memberProfileLimits.region}
              autoComplete="address-level1"
              placeholder="예: 서울"
              onChange={(event) => setField('region', event.target.value)}
            />
          </label>

        </fieldset>

        <fieldset className="member-profile-section member-profile-event-fields">
          <legend>행사 신청에 불러올 정보</legend>
          <p className="member-profile-section-help">
            향후 위브에 행사 신청 기능이 연결되면 입력을 덜 수 있도록 준비하는 정보예요. 지금 자동으로 신청되거나 주최자에게 전달되지는 않아요.
          </p>

          <label className="member-profile-field" htmlFor={`${formId}-email`}>
            <span>이메일</span>
            <input
              id={`${formId}-email`}
              type="email"
              inputMode="email"
              value={value.email}
              maxLength={memberProfileLimits.email}
              autoComplete="email"
              onChange={(event) => setField('email', event.target.value)}
            />
          </label>
          <label className="member-profile-field" htmlFor={`${formId}-phone`}>
            <span>전화번호</span>
            <input
              id={`${formId}-phone`}
              type="tel"
              inputMode="tel"
              value={value.phone}
              maxLength={memberProfileLimits.phone}
              autoComplete="tel"
              placeholder="예: 010-1234-5678"
              onChange={(event) => setField('phone', event.target.value)}
            />
          </label>
          <aside className="member-profile-privacy-note">
            <CircleAlert size={19} aria-hidden="true" />
            <p>로그인 제공자의 이름이나 연락처를 자동으로 가져오지 않아요. 직접 적고 저장한 정보만 사용합니다.</p>
          </aside>
        </fieldset>

        <fieldset className="member-profile-section member-profile-basic-fields">
          <legend>선택 정보</legend>
          <p className="member-profile-section-help">청년회 활동과 프로그램을 준비하기 위한 통계에 사용합니다. 답하지 않아도 위브를 이용할 수 있고, 내 정보에서 언제든 삭제할 수 있습니다. 계정 탈퇴 시 삭제됩니다.</p>
          <label className="member-profile-field"><span>연령대 <FieldRequirement optional /></span><select value={value.ageBand ?? ''} onChange={event => { editRevisionRef.current += 1; setValue(current => ({ ...current, ageBand: event.target.value })); }}><option value="">선택하지 않음</option>{Object.entries(ageBandLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="member-profile-field member-profile-field--wide"><span><input type="checkbox" checked={value.religionConsentVersion === religionConsentVersion} onChange={event => { editRevisionRef.current += 1; setValue(current => ({ ...current, religionConsentVersion: event.target.checked ? religionConsentVersion : undefined, wonBuddhismMembership: event.target.checked ? current.wonBuddhismMembership : undefined })); }} /> 원불교 입교 여부의 수집·이용에 동의합니다 <FieldRequirement optional /></span><small>수집 항목: 입교 여부 · 목적: 회원 구성 통계와 활동 기획 · 보유 기간: 동의 철회 또는 계정 탈퇴까지. 동의를 거부해도 서비스 이용에 불이익이 없습니다. 동의를 해제하고 저장하면 기존 응답을 삭제합니다.</small></label>
          <label className="member-profile-field"><span>원불교 입교 여부 <FieldRequirement optional /></span><select disabled={value.religionConsentVersion !== religionConsentVersion} value={value.wonBuddhismMembership ?? ''} onChange={event => { editRevisionRef.current += 1; setValue(current => ({ ...current, wonBuddhismMembership: event.target.value })); }}><option value="">선택하지 않음</option>{Object.entries(membershipLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small>직접 입력하는 정보이며 입교 인증으로 사용하지 않습니다.</small></label>
        </fieldset>
        </details>
        <div
          className={`member-profile-status member-profile-status--${status.tone}`}
          role={status.tone === 'error' ? 'alert' : 'status'}
          aria-live={status.tone === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          {status.tone === 'working' && <LoaderCircle className="spin" size={19} aria-hidden="true" />}
          {status.tone === 'success' && <CheckCircle2 size={19} aria-hidden="true" />}
          {status.tone === 'error' && <CircleAlert size={19} aria-hidden="true" />}
          {status.message && <p>{status.message}</p>}
        </div>

        <div className={`member-profile-submit ${experienceStyles.saveBar}`}>
          <button
            className={`button button-primary ${experienceStyles.saveButton}`}
            type="submit"
            disabled={status.tone === 'working' || deletingPhoto}
          >
            {status.tone === 'working' ? '저장 중' : '내 정보 저장하기'}
          </button>
        </div>
      </form>
    </section>
  )
}
