import { Link } from "react-router-dom";
import { FilePenLine } from "lucide-react";
import { ArchiveDiscoveryPanel } from "../features/event-archive/ArchiveDiscoveryPanel";
import styles from "../features/event-archive/EventArchive.module.css";

export function ResourcesPage() {
  return <section className={styles.resourcesPage}>
    <header className={styles.resourcesHeader}><div><h1>자료 나눔</h1><p>회의록과 발표 자료를 찾고 나눠요</p></div>
      <Link className="button button-primary" to="/contribute?kind=material"><FilePenLine size={18} aria-hidden="true"/>자료 올리기</Link>
    </header>
    <ArchiveDiscoveryPanel resourcesOnly />
  </section>;
}
