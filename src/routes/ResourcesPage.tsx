import { Link } from "react-router-dom";
import { FilePenLine, FolderOpen } from "lucide-react";
import { PageFrame } from "../components/PageFrame";
import { ArchiveDiscoveryPanel } from "../features/event-archive/ArchiveDiscoveryPanel";
import styles from "../features/event-archive/EventArchive.module.css";

export function ResourcesPage() {
  return <PageFrame eyebrow="자료 나눔" title="필요한 자료를 찾고 나눠요" description="회의록부터 발표 자료까지, 파일 개수와 관계없이 한곳에서 찾아보세요.">
    <div className={styles.resourceActions}>
      <Link className="button button-primary" to="/contribute?kind=material"><FilePenLine size={18} aria-hidden="true" />자료 올리기</Link>
      <Link className="button button-secondary" to="/collections"><FolderOpen size={18} aria-hidden="true" />자료 모음 보기</Link>
    </div>
    <ArchiveDiscoveryPanel resourcesOnly />
  </PageFrame>;
}
