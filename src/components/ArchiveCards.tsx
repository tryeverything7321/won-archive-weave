import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ExternalLink,
  BookOpen,
  ChevronRight,
  FileText,
  LoaderCircle,
  Link2,
  Pencil,
  Trash2,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getActivity, type Activity, type Material } from "../content";
import type { ArchiveMaterial } from "../data/archive-repository";
import { createApprovedDownload, requestSubmissionChange, type SubmissionManagement } from "../features/uploads/api";
import { getMaterialLinkImpact } from "../features/uploads/material-links-api";
import { ApprovedPdfPreview } from "../features/preview/ApprovedPdfPreview";
import { canPreviewNativeType } from "../features/preview/approved-preview";
import { sentence } from "../lib/text";
import { WeaveBadge } from "./WeaveBadge";
import { formatBadgeTone } from "./weave-badge-model";
import { MarkdownBody } from '../features/content/MarkdownBody';
import { attachmentStatusCopy, materialVisibilityLabel } from '../data/material-access';
import discoveryStyles from "../features/discovery/DiscoveryExperience.module.css";

const materialTypeLabels: Record<Material["type"], string> = {
  TEXT: '글·회의록',
  IMAGE: '사진·포스터',
  TXT: '텍스트 파일',
  CSV: '표 데이터',
  FILE: '첨부 파일',
  PDF: "PDF 문서",
  PPTX: "발표 자료·PPT",
  DOCX: "워드 문서",
  HWP: "한글 문서",
  HWPX: "한글 문서",
  XLSX: "엑셀 자료",
  LINK: "웹 링크",
};

export function ActivityCard({ activity }: { activity: Activity & { origin?: "fixture" | "published" } }) {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const isFixture = activity.origin !== "published";
  return (
    <motion.article
      layout={!reduceMotion}
      className={`${discoveryStyles.activityCard} activity-card`}
      whileHover={reduceMotion ? undefined : { y: -8, rotate: -0.35 }}
      whileTap={reduceMotion ? undefined : { scale: 0.985 }}
    >
      <div className={`card-visual ${activity.tone}`}>
        <div className="card-record-graphic" aria-hidden="true">
          <span>활동 기록</span>
          <strong>{activity.type}</strong>
          {!isFixture && activity.place && <small>{activity.place}</small>}
        </div>
      </div>
      <div className="card-content">
        {isFixture && <WeaveBadge family="provenance" tone="fixture" size="compact" className={discoveryStyles.fixtureNotice}>예시</WeaveBadge>}
        <div className="card-meta badge-row" data-badge-primary-count="1" data-badge-secondary-count="1">
          {activity.topic.trim() && <WeaveBadge family="classification" tone="neutral" size="compact">{activity.topic.trim()}</WeaveBadge>}
          {activity.type.trim() && <WeaveBadge family="classification" tone="neutral" size="compact">{activity.type.trim()}</WeaveBadge>}
        </div>
        <h3><Link className={discoveryStyles.cardTitleLink} to={`/activities/${activity.slug}`} state={{ archiveReturn: `${location.pathname}${location.search}` }}>{activity.title}</Link></h3>
        <p>{sentence(activity.summary)}</p>
        <Link to={`/activities/${activity.slug}`} state={{ archiveReturn: `${location.pathname}${location.search}` }}>
          기록 자세히 보기 <ChevronRight size={16} />
        </Link>
      </div>
    </motion.article>
  );
}

export function MaterialRow({
  material,
  showActivity = false,
  showDetail = true,
  ownedManagement,
  onDeleted,
}: {
  material: ArchiveMaterial | Material;
  showActivity?: boolean;
  showDetail?: boolean;
  ownedManagement?: SubmissionManagement;
  onDeleted?: (id: string) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const activity = getActivity(material.activitySlug);
  const [downloadState, setDownloadState] = useState<
    "idle" | "working" | "error"
  >("idle");
  const [editState, setEditState] = useState<"idle" | "working" | "error">("idle");
  const [deleteState, setDeleteState] = useState<"idle" | "working" | "error">("idle");
  const openOwnEditor = async () => {
    setEditState("working");
    try {
      if (ownedManagement?.availableActions.includes("request_revision")) {
        await requestSubmissionChange(material.id, "request_revision");
      }
      navigate(`/contribute?submissionId=${encodeURIComponent(material.id)}`);
    } catch {
      setEditState("error");
    }
  };
  const deleteOwnMaterial = async () => {
    setDeleteState("working");
    try {
      const impact = await getMaterialLinkImpact(material.id);
      const count = `${impact.linkedActivityCount}${impact.hasMore ? "개 이상" : "개"}`;
      const retention = ownedManagement?.status === "revision_requested"
        ? "원본은 내 위브에 남습니다. 다시 공개하려면 운영 안내를 확인해 주세요."
        : "원본은 내 위브에 남고 비공개 초안으로 복원할 수 있어요.";
      if (!window.confirm(`이 자료를 삭제할까요? 연결된 활동 ${count}에서도 보이지 않게 됩니다. ${retention}`)) {
        setDeleteState("idle");
        return;
      }
      await requestSubmissionChange(material.id, "unpublish");
      onDeleted?.(material.id);
    } catch {
      setDeleteState("error");
    }
  };
  const isPublished = "origin" in material && material.origin === "published";
  const redistribution =
    "redistribution" in material ? material.redistribution : "view_only";
  const canDownload =
    isPublished &&
    material.availability === "available" &&
    redistribution === "download_allowed";
  const canOpenSource =
    isPublished &&
    redistribution === "source_link_only" &&
    "sourceUrl" in material &&
    Boolean(material.sourceUrl);
  const instagramAttachments = "instagramAttachments" in material
    ? material.instagramAttachments ?? []
    : [];
  const instagramSource = instagramAttachments[0];
  const canPreview =
    isPublished &&
    (("previewStatus" in material && material.previewStatus === "ready")
      || (material.availability === 'available' && redistribution !== 'source_link_only' && ['DOCX', 'PPTX', 'XLSX', 'HWP', 'HWPX'].includes(material.type))
      || (canDownload && canPreviewNativeType(material.type)));
  const textContent = 'textContent' in material ? material.textContent : undefined;
  const attachmentMessage = attachmentStatusCopy('attachmentStatus' in material ? material.attachmentStatus : undefined);
  const hasAvailableSource = Boolean(textContent) || canDownload || canPreview || canOpenSource || Boolean(instagramSource);
  const reduceMotion = useReducedMotion();

  const download = async () => {
    setDownloadState("working");
    try {
      const result = await createApprovedDownload(material.id);
      window.location.assign(result.url);
      setDownloadState("idle");
    } catch {
      setDownloadState("error");
    }
  };

  return (
    <motion.div
      className={`material-item material-format-${material.type.toLowerCase()} ${!hasAvailableSource && isPublished ? "is-unavailable" : ""}`}
      initial={false}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, amount: 0.45 }}
      transition={{
        duration: reduceMotion ? 0 : 0.55,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <div className={`material-icon material-icon-${material.type.toLowerCase()}`} aria-hidden="true">
        <FileText size={20} />
      </div>
      <div className="material-copy">
        <div className="material-card-topline">
        <div className="material-labels badge-row" data-badge-primary-count="1" data-badge-secondary-count="2">
          <WeaveBadge
            family="format"
            tone={formatBadgeTone(material.type)}
            size="compact"
            className={`material-kind material-kind-${material.type.toLowerCase()}`}
            title={`자료 유형: ${materialTypeLabels[material.type]}`}
          >
            {materialTypeLabels[material.type]}
          </WeaveBadge>
          <WeaveBadge family="access" tone={material.visibility === "공개" ? "public" : "restricted"} size="compact">{materialVisibilityLabel(material.visibility)}</WeaveBadge>
          <WeaveBadge family="provenance" tone={isPublished ? "official" : "fixture"} size="compact">{isPublished ? "공유 자료" : "예시 자료"}</WeaveBadge>
        </div>
        {isPublished && ownedManagement && (
          <div className="owner-action-pair" role="group" aria-label={`${material.title} 관리`}>
            {(ownedManagement.availableActions.includes("request_revision") || (ownedManagement.status === "revision_requested" && ownedManagement.availableActions.includes("edit"))) && (
              <button className="owner-icon-action" type="button" title="자료 수정" aria-label={`${material.title} 수정`} onClick={() => void openOwnEditor()} disabled={editState === "working" || deleteState === "working"}>
                <Pencil size={18} aria-hidden="true" />
              </button>
            )}
            {ownedManagement.availableActions.includes("unpublish") && onDeleted && (
              <button className="owner-icon-action owner-icon-action-danger" type="button" title="자료 삭제" aria-label={`${material.title} 삭제`} onClick={() => void deleteOwnMaterial()} disabled={editState === "working" || deleteState === "working"}>
                <Trash2 size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        </div>
        <h3>{isPublished && showDetail ? <Link className={discoveryStyles.cardTitleLink} to={`/materials/${encodeURIComponent(material.id)}`} state={location.pathname === "/resources" ? { resourcesReturn: `${location.pathname}${location.search}` } : undefined}>{material.title}</Link> : material.title}</h3>
        {attachmentMessage && <p role="status">{attachmentMessage}</p>}
        <p className={discoveryStyles.materialExcerpt}>
          {[showActivity && activity ? activity.title : "", isPublished ? material.owner : "", material.description.trim() ? sentence(material.description) : ""].filter((part) => part.trim()).join(" · ")}
        </p>
        {textContent && <details className={discoveryStyles.materialBody}><summary>본문 읽기</summary><MarkdownBody body={textContent.body} /></details>}
      </div>
      <div className="material-action">
        {editState === "error" && <small role="alert">수정 화면을 열지 못했어요. 다시 시도해 주세요.</small>}
        {deleteState === "error" && <small role="alert">자료를 삭제하지 못했어요. 다시 시도해 주세요.</small>}
        {isPublished && showDetail && (
          <Link
            to={`/materials/${encodeURIComponent(material.id)}`}
            state={location.pathname === "/resources" ? { resourcesReturn: `${location.pathname}${location.search}` } : undefined}
          >
            자료 자세히 보기 <ArrowRight size={16} />
          </Link>
        )}
        {isPublished && ownedManagement && (
          <Link
            to={`/archive-relations/new?targetType=material&targetId=${encodeURIComponent(material.id)}&returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
          >
            행사에 연결 <Link2 size={16} />
          </Link>
        )}
        {canPreview && <ApprovedPdfPreview key={material.id} materialId={material.id} title={material.title} />}
        {canDownload ? (
          <button
            type="button"
            onClick={download}
            disabled={downloadState === "working"}
          >
            {downloadState === "working" ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <ArrowDownToLine size={16} />
            )}
            {downloadState === "working" ? "준비 중" : "다운로드"}
          </button>
        ) : canOpenSource && "sourceUrl" in material ? (
          <a href={material.sourceUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} /> 원본 열기
          </a>
        ) : instagramSource ? (
          <a href={instagramSource.sourceUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} /> Instagram 원문 열기{instagramAttachments.length > 1 ? ` · ${instagramAttachments.length}개 중 첫 게시물` : ""}
          </a>
        ) : isPublished && !textContent ? (
          <span className="material-limited">
            {redistribution === "source_link_only"
              ? "원본에서 열람"
              : "열람 전용"}
          </span>
        ) : !isPublished && location.pathname === `/activities/${material.activitySlug}` ? (
          <span className="material-limited">예시 자료 · 다운로드 없음</span>
        ) : activity ? (
          <Link to={`/activities/${material.activitySlug}`} state={{ archiveReturn: `${location.pathname}${location.search}` }}>
            관련 활동 보기 <ArrowRight size={16} />
          </Link>
        ) : null}
        {showActivity && activity && hasAvailableSource && (
          <Link className="material-related-activity" to={`/activities/${material.activitySlug}`} state={{ archiveReturn: `${location.pathname}${location.search}` }}>
            관련 활동 보기 <ArrowRight size={16} />
          </Link>
        )}
        {downloadState === "error" && (
          <small role="status">내려받기 링크를 만들지 못했어요</small>
        )}
      </div>
    </motion.div>
  );
}

export function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="empty-state">
      <BookOpen size={29} />
      <h3>조건에 맞는 기록이 없어요</h3>
      <p>검색어 또는 관심 주제를 다시 선택해 보세요.</p>
      <button type="button" onClick={onReset}>
        전체 기록 보기
      </button>
    </div>
  );
}
