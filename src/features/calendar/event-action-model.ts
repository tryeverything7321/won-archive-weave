import type { CalendarEvent, CalendarRegistrationStatus } from "./calendar-model";

export type EventActionModel = {
  state: "canceled" | "ended" | "spectators" | CalendarRegistrationStatus;
  label: string;
  description: string;
  canAddToCalendar: boolean;
  registration: { url: string; label: string } | null;
};

export function eventActionModel(
  event: CalendarEvent,
  now = new Date(),
): EventActionModel {
  if (event.eventState === "canceled") {
    return {
      state: "canceled",
      label: "행사 취소",
      description: "취소된 행사예요. 이동하기 전에 주최 측의 최신 안내를 확인해 주세요.",
      canAddToCalendar: false,
      registration: null,
    };
  }

  if (event.endAt.getTime() <= now.getTime()) {
    return {
      state: "ended",
      label: "행사 종료",
      description: event.sourceUrl
        ? "이미 끝난 행사예요. 원문에서 다음 일정을 확인할 수 있어요."
        : "이미 끝난 행사예요. 다른 일정을 살펴보세요.",
      canAddToCalendar: false,
      registration: null,
    };
  }

  // Organizer-confirmed notice, 2026-10-13. Keep cancellation/end guards above it.
  if (event.id === "draft-09a61249-fad3-4190-b6b2-73f233aa632f" && event.origin !== "fixture") {
    return {
      state: "spectators",
      label: "발표 접수 종료 · 일반 관람 가능",
      description: "발표 참가 접수는 종료됐어요. 일반 관람은 가능하며, 관람 방법은 원불교 청년회 공식 인스타그램으로 문의해 주세요.",
      canAddToCalendar: true,
      registration: {
        url: "https://www.instagram.com/won_buddhism_youth/",
        label: "공식 인스타그램에 문의",
      },
    };
  }

  const deadlinePassed = Boolean(
    event.registrationDeadline
      && event.registrationDeadline.getTime() <= now.getTime(),
  );
  const state = deadlinePassed
    ? "closed"
    : event.registrationStatus ?? (event.registrationUrl ? "open" : "not_required");

  if (state === "closed") {
    return {
      state,
      label: "신청 마감",
      description: "신청이 마감됐어요. 대기 신청이나 현장 참여 여부는 주최 측 안내를 확인해 주세요.",
      canAddToCalendar: true,
      registration: null,
    };
  }

  if (state === "not_required") {
    return {
      state,
      label: "별도 신청 없음",
      description: "별도 신청 없이 참여하는 행사예요. 참석 전에 주최 측 안내를 확인해 주세요.",
      canAddToCalendar: true,
      registration: null,
    };
  }

  if (!event.registrationUrl) {
    return {
      state,
      label: "신청 방법 확인",
      description: "신청 링크가 등록되지 않았어요. 참여 방법은 주최 측에 확인해 주세요.",
      canAddToCalendar: true,
      registration: null,
    };
  }

  return {
    state,
    label: state === "closing_soon" ? "곧 신청 마감" : "신청 가능",
    description: state === "closing_soon"
      ? "신청 마감이 가까워요. 외부 신청 페이지에서 남은 자리를 확인해 주세요."
      : "외부 신청 페이지에서 참여 방법과 남은 자리를 확인해 주세요.",
    canAddToCalendar: true,
    registration: {
      url: event.registrationUrl,
      label: state === "closing_soon" ? "마감 전 신청하기" : "외부에서 신청하기",
    },
  };
}
