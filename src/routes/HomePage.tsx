import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { ActivityCard } from "../components/ArchiveCards";
import { activities } from "../content";
import { InstagramFeed } from "../features/social/InstagramFeed";
import { PurposeHome } from "../features/experience/PurposeHome";
import { UpcomingEvents } from "../features/landing/UpcomingEvents";
import { showPublicFixtures } from "../config/public-fixtures";
import fixtureStyles from "./FixtureDisclosure.module.css";

export function HomePage() {
  return (
    <>
      <PurposeHome />
      <UpcomingEvents />
      {showPublicFixtures && <section
        className="home-preview section-frame"
        aria-labelledby="preview-title"
      >
        <h2 className="sr-only" id="preview-title">활동 기록 사용 예시</h2>
        <details className={fixtureStyles.disclosure}>
          <summary className={fixtureStyles.summary}>사용 예시 보기 <span>활동 기록 3개</span></summary>
          <div className={fixtureStyles.content}>
            <div className="archive-top">
              <p>이런 활동을 기록으로 남길 수 있어요.</p>
              <Link className="text-link" to="/archive">
                활동 기록 둘러보기 <ArrowRight size={17} />
              </Link>
            </div>
            <div className="activity-grid">
              {activities.slice(0, 3).map((activity) => (
                <ActivityCard activity={activity} key={activity.slug} />
              ))}
            </div>
          </div>
        </details>
      </section>}
      <InstagramFeed />
    </>
  );
}
