import { ArrowRight, CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { eventDateTimeLabel, type CalendarEvent } from "../calendar/calendar-model";
import { firestoreCalendarRepository } from "../calendar/firestore-calendar-repository";
import { isFirebaseConfigured } from "../../lib/firebase/client";
import { loadUpcomingEvents } from "./upcoming-events";
import styles from "./UpcomingEvents.module.css";

type EventState = { status: "loading" | "ready" | "error"; events: CalendarEvent[] };

function EventCard({ event, featured = false }: { event: CalendarEvent; featured?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = Boolean(event.thumbnail && !imageFailed);
  return (
    <Link to={`/events/${event.id}`} className={`${styles.card} ${featured ? styles.featured : ""} ${hasImage ? styles.withImage : ""}`}>
      {hasImage && event.thumbnail && (
        <div className={styles.media}>
          <img
            alt={event.thumbnail.alt}
            loading="lazy"
            onError={() => setImageFailed(true)}
            src={event.thumbnail.url}
            style={{ objectFit: event.thumbnail.displayMode === "cover" ? "cover" : "contain" }}
          />
        </div>
      )}
      <div className={styles.content}>
        <p className={styles.date}><CalendarDays aria-hidden="true" size={18} />{eventDateTimeLabel(event)}</p>
        <div className={styles.copy}>
          <h3>{event.title}</h3>
          {event.summary.trim() && <p className={styles.summary}>{event.summary}</p>}
          <div className={styles.meta}>
            {event.region.trim() && <span>{event.region}</span>}
            {event.organizerName.trim() && <span>{event.organizerName}</span>}
          </div>
        </div>
        <span className={styles.detailLink}>행사 보기</span>
      </div>
    </Link>
  );
}

export function UpcomingEvents() {
  const [state, setState] = useState<EventState>({
    status: isFirebaseConfigured ? "loading" : "ready",
    events: [],
  });

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    let active = true;
    loadUpcomingEvents(firestoreCalendarRepository, new Date(), (events) => {
      if (active) setState({ status: "loading", events });
    })
      .then((events) => {
        if (active) setState({ status: "ready", events });
      })
      .catch(() => {
        if (active) setState((current) => ({ status: "error", events: current.events }));
      });
    return () => { active = false; };
  }, []);

  return (
    <section aria-labelledby="upcoming-events-title" className={`${styles.section} section-frame`}>
      <div className={styles.heading}>
        <div>
          <p>새로운 만남</p>
          <h2 id="upcoming-events-title">다가오는 행사</h2>
        </div>
        <Link className="text-link" to="/calendar">전체 일정</Link>
      </div>
      {state.status === "loading" && state.events.length === 0 && <p className={styles.message} role="status">다가오는 행사를 불러오는 중이에요.</p>}
      {state.status === "error" && (
        <div className={styles.message} role="status">
          <p>{state.events.length ? "일부 일정을 불러오지 못했어요. 전체 일정에서 확인해 주세요." : "행사를 불러오지 못했어요. 전체 일정에서 다시 확인해 주세요."}</p>
          <Link to="/calendar">행사 일정 보기 <ArrowRight aria-hidden="true" size={17} /></Link>
        </div>
      )}
      {state.status === "ready" && state.events.length === 0 && (
        <div className={styles.message}>
          <p>아직 예정된 공개 행사가 없어요.</p>
          <Link to="/calendar">행사 일정 보기 <ArrowRight aria-hidden="true" size={17} /></Link>
        </div>
      )}
      {state.events.length > 0 && (
        <div className={styles.grid} data-count={state.events.length}>
          {state.events.map((event, index) => <EventCard event={event} featured={index === 0} key={event.id} />)}
        </div>
      )}
    </section>
  );
}
