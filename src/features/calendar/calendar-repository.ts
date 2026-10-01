import type {
  CalendarEvent,
  CalendarEventPage,
  CalendarEventPageCursor,
} from "./calendar-model";

export type CalendarMonthQuery = {
  monthKey: string;
  includeMember: boolean;
  cursor?: CalendarEventPageCursor | null;
  pageSize?: number;
};

export interface CalendarRepository {
  listMonth(query: CalendarMonthQuery): Promise<CalendarEventPage>;
  getVisibleEvent(eventId: string, includeMember: boolean): Promise<CalendarEvent | undefined>;
}
