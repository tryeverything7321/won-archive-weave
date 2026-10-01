import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, RefreshCw, Search, ShieldCheck, UserRound } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getAdminMemberOverview,
  getAdminMemberPrivateDetails,
  listAdminMemberActivity,
  listAdminMembers,
  type AdminMember,
  type MemberActivityCounts,
  type MemberActivityItem,
  type MemberListFilters,
  type MemberPrivateDetails,
  type MemberSummary,
} from "./members-api";
import styles from "./MembersAdmin.module.css";

type LoadState = "idle" | "loading" | "ready" | "error";

const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });

function formatDate(value: string | null): string {
  if (!value) return "확인 불가";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "확인 불가" : dateTime.format(date);
}

function providerLabel(value: AdminMember["provider"]): string {
  return value === "kakao" ? "카카오" : value === "naver" ? "네이버" : "확인 불가";
}

function completionLabel(value: AdminMember["completion"]): string {
  return value === "complete" ? "가입 절차 완료" : value === "incomplete" ? "가입 절차 미완료" : "완료 여부 확인 불가";
}

function countLabel(value: number | null): string {
  return value === null ? "조회 실패" : `${value.toLocaleString("ko-KR")}건`;
}

function activityTotal(counts: MemberActivityCounts): number | null {
  const values = Object.values(counts);
  return values.every((value): value is number => typeof value === "number")
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

function exclusiveKstEnd(date: string): string | undefined {
  if (!date) return undefined;
  const value = new Date(`${date}T00:00:00+09:00`);
  value.setDate(value.getDate() + 1);
  return value.toISOString();
}

function inclusiveKstStart(date: string): string | undefined {
  return date ? new Date(`${date}T00:00:00+09:00`).toISOString() : undefined;
}

function listFilters(params: URLSearchParams): MemberListFilters {
  const provider = params.get("provider");
  const completion = params.get("completion");
  const activity = params.get("activity");
  return {
    ...(params.get("q") ? { search: params.get("q")! } : {}),
    ...(params.get("from") ? { createdFrom: inclusiveKstStart(params.get("from")!) } : {}),
    ...(params.get("to") ? { createdTo: exclusiveKstEnd(params.get("to")!) } : {}),
    provider: provider === "naver" || provider === "kakao" || provider === "unknown" ? provider : "all",
    completion: completion === "complete" || completion === "incomplete" || completion === "unknown" ? completion : "all",
    activity: activity === "present" || activity === "none" ? activity : "any",
  };
}

function Summary({ summary }: { summary: MemberSummary }) {
  const period = summary.period.from || summary.period.to
    ? `${summary.period.from ? formatDate(summary.period.from) : "처음 기록"}부터 ${summary.period.to ? formatDate(summary.period.to) : "현재"}까지`
    : "전체 기록 기간";
  return (
    <section className={styles.summary} aria-labelledby="member-summary-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>같은 검색 조건의 전체 회원</p>
          <h2 id="member-summary-title">회원 현황</h2>
        </div>
        <time dateTime={summary.refreshedAt}>{formatDate(summary.refreshedAt)} 갱신</time>
      </div>
      <div className={styles.summaryGrid}>
        <div><span>조건에 맞는 계정</span><strong>{summary.populationCount.toLocaleString("ko-KR")}명</strong></div>
        <div><span>오늘 생성</span><strong>{summary.createdToday.toLocaleString("ko-KR")}명</strong></div>
        <div><span>현재 가입 절차 완료</span><strong>{summary.completed.toLocaleString("ko-KR")}명</strong></div>
        <div><span>기록된 활동 있음</span><strong>{summary.membersWithRecordedActivity === null ? "집계 실패" : `${summary.membersWithRecordedActivity.toLocaleString("ko-KR")}명`}</strong></div>
      </div>
      <div className={styles.activitySummary} aria-label="기간 내 기록된 활동 건수">
        <div><span>글 작성</span><strong>{countLabel(summary.activityCounts?.post ?? null)}</strong></div>
        <div><span>댓글 작성</span><strong>{countLabel(summary.activityCounts?.comment ?? null)}</strong></div>
        <div><span>자료·활동 기록 제출</span><strong>{countLabel(summary.activityCounts?.submission ?? null)}</strong></div>
        <div><span>행사 등록</span><strong>{countLabel(summary.activityCounts?.event ?? null)}</strong></div>
      </div>
      <p className={styles.basis}>{summary.basis} · {period} · 한국 시간 기준</p>
      {!summary.complete && <p className={styles.warning} role="status">일부 활동 집계를 완료하지 못해 활동 합계는 표시하지 않습니다.</p>}
    </section>
  );
}

function MemberList() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<AdminMember[]>([]);
  const [summary, setSummary] = useState<MemberSummary | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const queryKey = params.toString();

  const load = () => {
    setState("loading");
    setError("");
    void listAdminMembers({
      ...listFilters(params),
      ...(params.get("cursor") ? { cursor: params.get("cursor")! } : {}),
      limit: 20,
    }).then((result) => {
      setItems(result.items);
      setSummary(result.summary);
      setNextCursor(result.nextCursor);
      setState("ready");
    }).catch(() => {
      setItems([]);
      setSummary(null);
      setError("회원 현황을 불러오지 못했습니다. 권한과 집계 상태를 확인한 뒤 다시 시도해 주세요.");
      setState("error");
    });
  };

  useEffect(() => {
    let active = true;
    void listAdminMembers({
      ...listFilters(params),
      ...(params.get("cursor") ? { cursor: params.get("cursor")! } : {}),
      limit: 20,
    }).then((result) => {
      if (!active) return;
      setItems(result.items);
      setSummary(result.summary);
      setNextCursor(result.nextCursor);
      setState("ready");
    }).catch(() => {
      if (!active) return;
      setItems([]);
      setSummary(null);
      setError("회원 현황을 불러오지 못했습니다. 권한과 집계 상태를 확인한 뒤 다시 시도해 주세요.");
      setState("error");
    });
    return () => { active = false; };
  }, [params, queryKey]);

  const updateFilter = (name: string, value: string) => {
    setState("loading");
    const next = new URLSearchParams(params);
    if (value && value !== "all" && value !== "any") next.set(name, value);
    else next.delete(name);
    next.delete("cursor");
    setParams(next);
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setState("loading");
    const next = new URLSearchParams(params);
    if (search.trim()) next.set("q", search.trim());
    else next.delete("q");
    next.delete("cursor");
    setParams(next);
  };

  const returnQuery = encodeURIComponent(params.toString());

  return (
    <div className={styles.stack}>
      <header className={styles.intro}>
        <div><p className={styles.eyebrow}>관리자 전용</p><h1>회원 현황</h1></div>
        <p>계정 생성 정보와 서버에 남은 작성·등록 기록을 확인합니다. 마지막 접속이나 유입 경로는 수집하지 않습니다.</p>
      </header>

      <form className={styles.filters} onSubmit={submitSearch} aria-label="회원 검색과 필터">
        <label className={styles.search}><span>가명 또는 운영 식별값</span><span className={styles.inputWithIcon}><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="가명 또는 wm_ 식별값" /></span></label>
        <label><span>계정 생성 시작일</span><input type="date" value={params.get("from") ?? ""} onChange={(event) => updateFilter("from", event.target.value)} /></label>
        <label><span>계정 생성 종료일</span><input type="date" value={params.get("to") ?? ""} onChange={(event) => updateFilter("to", event.target.value)} /></label>
        <label><span>현재 로그인 제공자</span><select value={params.get("provider") ?? "all"} onChange={(event) => updateFilter("provider", event.target.value)}><option value="all">전체</option><option value="kakao">카카오</option><option value="naver">네이버</option><option value="unknown">확인 불가</option></select></label>
        <label><span>가입 절차</span><select value={params.get("completion") ?? "all"} onChange={(event) => updateFilter("completion", event.target.value)}><option value="all">전체</option><option value="complete">완료</option><option value="incomplete">미완료</option><option value="unknown">확인 불가</option></select></label>
        <label><span>기록된 활동</span><select value={params.get("activity") ?? "any"} onChange={(event) => updateFilter("activity", event.target.value)}><option value="any">전체</option><option value="present">있음</option><option value="none">없음</option></select></label>
        <button className={styles.searchButton} type="submit">검색</button>
      </form>

      {summary && <Summary summary={summary} />}
      {state === "loading" && <div className={styles.state} role="status">회원 현황을 불러오는 중입니다.</div>}
      {state === "error" && <div className={styles.state} role="alert"><p>{error}</p><button type="button" onClick={load}><RefreshCw size={16} /> 다시 시도</button></div>}
      {state === "ready" && items.length === 0 && <div className={styles.state}>이 조건에 맞는 회원이 없습니다.</div>}
      {state === "ready" && items.length > 0 && (
        <section className={styles.listSection} aria-labelledby="member-list-title">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>회원 목록</p><h2 id="member-list-title">계정과 기록된 활동</h2></div><span>현재 페이지 {items.length}명</span></div>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>회원</th><th>계정 생성</th><th>가입 방식</th><th>가입 절차</th><th>마지막 기록된 활동</th><th>활동 건수</th><th><span className={styles.srOnly}>상세</span></th></tr></thead>
              <tbody>{items.map((member) => {
                const total = activityTotal(member.activityCounts);
                return <tr key={member.memberId}>
                  <td><strong>{member.pseudonym ?? "가명 미설정"}</strong><small>{member.memberId}</small></td>
                  <td>{formatDate(member.accountCreatedAt)}</td>
                  <td>{providerLabel(member.provider)}</td>
                  <td><span className={`${styles.status} ${styles[member.completion]}`}>{completionLabel(member.completion)}</span></td>
                  <td>{member.lastRecordedActivityAt ? formatDate(member.lastRecordedActivityAt) : member.activityCountsComplete ? "기록 없음" : "조회 실패"}</td>
                  <td><div className={styles.activityCounts}><strong>합계 {countLabel(total)}</strong><small>글 {countLabel(member.activityCounts.post)} · 댓글 {countLabel(member.activityCounts.comment)} · 자료 {countLabel(member.activityCounts.submission)} · 행사 {countLabel(member.activityCounts.event)}</small></div></td>
                  <td><Link className={styles.detailLink} to={`/admin/members/${member.memberId}?return=${returnQuery}`} aria-label={`${member.pseudonym ?? member.memberId} 회원 상세 보기`}><ArrowRight size={18} /></Link></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          {nextCursor && <div className={styles.pagination}><button type="button" onClick={() => { setState("loading"); const next = new URLSearchParams(params); next.set("cursor", nextCursor); setParams(next); }}>다음 회원 보기 <ArrowRight size={17} /></button></div>}
        </section>
      )}
    </div>
  );
}

const activityLabels: Record<MemberActivityItem["kind"], string> = {
  account: "계정 생성",
  post: "글 작성",
  comment: "댓글 작성",
  submission: "자료·활동 기록 제출",
  event: "행사 등록",
};

function MemberDetail({ memberId }: { memberId: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [reason, setReason] = useState("");
  const [member, setMember] = useState<AdminMember | null>(null);
  const [activity, setActivity] = useState<MemberActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [notCollected, setNotCollected] = useState<string[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [notice, setNotice] = useState("");
  const [privateReason, setPrivateReason] = useState("");
  const [privateDetails, setPrivateDetails] = useState<MemberPrivateDetails | null>(null);
  const [privateNotice, setPrivateNotice] = useState("");
  const returnTo = useMemo(() => {
    const query = params.get("return");
    return query ? `/admin/members?${query}` : "/admin/members";
  }, [params]);

  const load = async (cursor?: string) => {
    if (reason.trim().length < 2) {
      setNotice("회원 기록 조회 사유를 2자 이상 입력해 주세요.");
      return;
    }
    setState("loading");
    setNotice("");
    try {
      const [overview, timeline] = await Promise.all([
        cursor ? Promise.resolve(null) : getAdminMemberOverview({ memberId, reason: reason.trim() }),
        listAdminMemberActivity({ memberId, reason: reason.trim(), ...(cursor ? { cursor } : {}), limit: 30 }),
      ]);
      if (overview) setMember(overview.member);
      setActivity((current) => cursor ? [...current, ...timeline.items] : timeline.items);
      setNextCursor(timeline.nextCursor);
      setNotCollected(timeline.notCollected);
      setState("ready");
    } catch {
      setNotice("회원 기록을 불러오지 못했습니다. 조회 권한과 사유를 확인해 주세요.");
      setState("error");
    }
  };

  const loadPrivateDetails = async () => {
    if (privateReason.trim().length < 2) {
      setPrivateNotice("제한 정보 조회 사유를 2자 이상 입력해 주세요.");
      return;
    }
    setPrivateNotice("");
    try {
      const result = await getAdminMemberPrivateDetails({ memberId, reason: privateReason.trim() });
      setPrivateDetails(result.details);
    } catch {
      setPrivateDetails(null);
      setPrivateNotice("제한 정보 조회 권한이 없거나 정보를 불러오지 못했습니다.");
    }
  };

  return (
    <div className={styles.stack}>
      <button className={styles.back} type="button" onClick={() => navigate(returnTo)}><ArrowLeft size={18} /> 회원 목록으로</button>
      <header className={styles.intro}>
        <div><p className={styles.eyebrow}>회원 상세</p><h1>{member?.pseudonym ?? "회원 기록 확인"}</h1></div>
        <p>{member?.memberId ?? memberId}</p>
      </header>

      {!member && (
        <section className={styles.reasonCard} aria-labelledby="member-read-reason">
          <ShieldCheck aria-hidden="true" />
          <div><h2 id="member-read-reason">조회 사유를 남겨 주세요</h2><p>회원별 기록을 열면 조회자, 사유, 시각이 감사 기록에 남습니다.</p></div>
          <label><span>조회 사유</span><input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="예: 회원 문의에 따른 작성 기록 확인" /></label>
          <button type="button" onClick={() => void load()}>회원 기록 열기</button>
          {notice && <p className={styles.warning} role="alert">{notice}</p>}
        </section>
      )}

      {member && <>
        <section className={styles.profileGrid} aria-label="회원 가입 정보">
          <div><span>가명</span><strong>{member.pseudonym ?? "미설정"}</strong></div>
          <div><span>계정 생성일</span><strong>{formatDate(member.accountCreatedAt)}</strong><small>Firebase Auth 기록</small></div>
          <div><span>현재 로그인 제공자</span><strong>{providerLabel(member.provider)}</strong><small>최초 유입 경로가 아닙니다</small></div>
          <div><span>가입 절차</span><strong>{completionLabel(member.completion)}</strong></div>
        </section>

        <section className={styles.countSection} aria-labelledby="activity-count-title">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>현재 조회 가능한 기록</p><h2 id="activity-count-title">활동별 건수</h2></div></div>
          <div className={styles.countGrid}>
            <div><span>글</span><strong>{countLabel(member.activityCounts.post)}</strong></div>
            <div><span>댓글</span><strong>{countLabel(member.activityCounts.comment)}</strong></div>
            <div><span>자료·활동 기록</span><strong>{countLabel(member.activityCounts.submission)}</strong></div>
            <div><span>행사</span><strong>{countLabel(member.activityCounts.event)}</strong></div>
          </div>
        </section>

        <section className={styles.timelineSection} aria-labelledby="timeline-title">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>시간순</p><h2 id="timeline-title">기록된 활동</h2></div></div>
          {state === "loading" && <div className={styles.state} role="status">활동을 불러오는 중입니다.</div>}
          {state === "error" && <div className={styles.state} role="alert">{notice}</div>}
          {state === "ready" && activity.length === 0 && <div className={styles.state}>서버에 남은 작성·등록 활동이 없습니다.</div>}
          <ol className={styles.timeline}>{activity.map((item) => <li key={`${item.kind}-${item.id}`}>
            <span className={styles.timelineIcon}><UserRound size={17} /></span>
            <div><small>{activityLabels[item.kind]} · {formatDate(item.occurredAt)}</small><strong>{item.title}</strong><span>현재 상태: {item.status}</span></div>
            {item.href && <Link to={item.href} aria-label={`${item.title} 현재 공개 화면 열기`}><ExternalLink size={17} /></Link>}
          </li>)}</ol>
          {nextCursor && <button className={styles.more} type="button" disabled={state === "loading"} onClick={() => void load(nextCursor)}>이전 활동 더 보기</button>}
          {notCollected.length > 0 && <p className={styles.basis}>수집하지 않는 정보: {notCollected.join(", ")}</p>}
        </section>

        <details className={styles.privatePanel}>
          <summary>회원이 직접 입력한 제한 정보</summary>
          <p>별도 권한이 있는 관리자만 업무 사유를 남기고 조회할 수 있습니다. 입력값은 인증된 신원 정보가 아닙니다.</p>
          <label><span>제한 정보 조회 사유</span><input value={privateReason} maxLength={200} onChange={(event) => setPrivateReason(event.target.value)} /></label>
          <button type="button" onClick={() => void loadPrivateDetails()}>제한 정보 확인</button>
          {privateNotice && <p className={styles.warning} role="alert">{privateNotice}</p>}
          {privateDetails && <dl className={styles.privateDetails}><div><dt>실명</dt><dd>{privateDetails.realName ?? "미입력"}</dd></div><div><dt>소속</dt><dd>{privateDetails.organization ?? "미입력"}</dd></div><div><dt>이메일</dt><dd>{privateDetails.email ?? "미입력"}</dd></div><div><dt>전화번호</dt><dd>{privateDetails.phone ?? "미입력"}</dd></div></dl>}
        </details>
      </>}
    </div>
  );
}

export function MembersAdmin() {
  const { memberId } = useParams<{ memberId: string }>();
  return memberId ? <MemberDetail memberId={memberId} /> : <MemberList />;
}
