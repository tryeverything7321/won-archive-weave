export type Topic = '나와 마음' | '관계와 공동체' | '일과 진로' | '배움과 신앙' | '사회와 실천'
export type Visibility = '공개' | '회원 전용' | '검토 중'

export type Material = {
  id: string
  title: string
  type: 'TEXT' | 'PDF' | 'PPTX' | 'DOCX' | 'HWP' | 'HWPX' | 'XLSX' | 'LINK' | 'IMAGE' | 'TXT' | 'CSV' | 'FILE'
  activitySlug: string
  owner: string
  visibility: Visibility
  availability: 'available' | 'unavailable'
  description: string
}

export type Activity = {
  slug: string
  title: string
  topic: Topic
  type: string
  date: string
  place: string
  summary: string
  story: string
  outcome: string
  nextAction: string
  tone: string
  recipe?: {
    purpose: string
    preparation: string
    promotion: string
    lessons: string
  }
}

export type ReviewStatus = '검토 대기' | '보완 요청' | '승인' | '보류' | '반려'

export type Submission = {
  id: string
  title: string
  kind: '활동 기록' | '자료' | '활동 레시피'
  contributor: string
  submittedAt: string
  source: string
  owner: string
  visibility: Visibility
  consent: '확인됨' | '추가 확인 필요'
  retention: '2년 뒤 재검토' | '다음 검토일 미정'
  status: ReviewStatus
  summary: string
  tags: string[]
  reviewLog: { status: ReviewStatus; note: string; at: string }[]
}

export const topics: Topic[] = ['나와 마음', '관계와 공동체', '일과 진로', '배움과 신앙', '사회와 실천']

export const activities: Activity[] = [
  { slug: 'listening-retreat', title: '서로의 삶을 듣는 청년 정기훈련', topic: '관계와 공동체', type: '함께 공부하기', date: '기록 예시', place: '전국 청년회', summary: '한 사람의 질문에서 시작해 서로의 일상과 마음을 듣는 시간', story: '처음 온 사람도 자기 이야기를 꺼낼 수 있도록 작은 모둠과 질문 카드로 시작합니다', outcome: '대화 가이드와 회고 질문을 남겼어요', nextAction: '대화 가이드로 다음 모임 준비하기', tone: 'sunrise' },
  { slug: 'event-from-scratch', title: '처음부터 함께 만드는 행사', topic: '관계와 공동체', type: '활동 레시피', date: '기록 예시', place: '청년 기획팀', summary: '모집부터 진행, 마무리 회고까지 함께 만드는 행사 운영법', story: '행사 준비가 한 사람에게 몰리지 않도록 역할과 준비 과정을 모두가 볼 수 있게 만들었습니다', outcome: '모집 문구와 운영 체크리스트를 모았어요', nextAction: '행사 레시피를 우리 지역에 맞게 활용하기', tone: 'blueprint', recipe: { purpose: '처음 기획하는 청년도 함께 행사를 만들 수 있게 합니다', preparation: '역할표와 일정을 공유하며 준비합니다', promotion: '초대하고 싶은 사람을 떠올리며 문구부터 함께 씁니다', lessons: '행사가 끝나면 바로 회고를 남깁니다' } },
  { slug: 'local-service', title: '내가 있는 자리에서 시작하는 봉공', topic: '사회와 실천', type: '지역 활동', date: '기록 예시', place: '지역 교당', summary: '크지 않아도 꾸준히 이어지는 지역의 만남과 실천을 기록합니다', story: '우리 동네에서 필요한 일을 찾고 함께할 사람을 초대하는 것부터 시작했습니다', outcome: '지역별 아이디어를 다음 활동으로 연결했어요', nextAction: '우리 지역의 작은 실천 기록하기', tone: 'greenroom' },
  { slug: 'work-and-life', title: '나의 일과 삶을 다시 묻는 밤', topic: '일과 진로', type: '청년 대화', date: '기록 예시', place: '온라인 · 오프라인', summary: '일과 삶을 어떻게 이어 갈지 함께 이야기합니다', story: '서로 다른 직업과 생활을 가진 청년들이 일상에서 마주한 고민을 나눴습니다', outcome: '질문 카드와 추천 읽을거리를 만들었어요', nextAction: '질문 카드로 대화 모임 열기', tone: 'nightshift' },
  { slug: 'everyday-practice', title: '생활 속 마음공부를 시작하는 법', topic: '배움과 신앙', type: '배움 모임', date: '기록 예시', place: '청년 공부방', summary: '거창한 결심보다 오늘의 일상에서 다시 시작하는 작은 공부', story: '하루에 한 번 멈춰 서서 마음을 돌아보는 방법을 함께 실천했습니다', outcome: '초보자를 위한 7일 실천표를 나눴어요', nextAction: '7일 실천표로 오늘 시작하기', tone: 'paperday' },
  { slug: 'first-time-visit', title: '처음 온 사람을 맞이하는 법', topic: '관계와 공동체', type: '환대 가이드', date: '기록 예시', place: '청년 환대팀', summary: '낯선 사람에게 먼저 말을 거는 일부터 함께 준비한 환대의 기록', story: '행사 첫 10분이 낯설지 않도록 안내와 짝 대화 순서를 만들었습니다', outcome: '처음 온 사람을 위한 안내 문구를 남겼어요', nextAction: '환대 가이드 살펴보기', tone: 'sunrise', recipe: { purpose: '처음 온 사람이 혼자 남지 않게 합니다', preparation: '도착 전 안내와 현장 역할을 정합니다', promotion: '처음이어도 괜찮다는 문장을 앞에 둡니다', lessons: '안내는 짧게 하고 인사는 충분히 나눕니다' } },
  { slug: 'relationship-circle', title: '관계가 복잡할 때 나누는 마음공부', topic: '나와 마음', type: '질문 모임', date: '기록 예시', place: '청년 공부방', summary: '답을 주기보다 서로의 마음을 안전하게 듣는 대화 모임', story: '서로 조언하기 전에 질문을 되묻고 감정을 정리하는 시간을 가졌습니다', outcome: '대화의 약속과 질문 순서를 만들었어요', nextAction: '질문 순서로 대화 시작하기', tone: 'paperday' },
  { slug: 'career-visit', title: '선배의 일터에서 만난 진로 이야기', topic: '일과 진로', type: '현장 방문', date: '기록 예시', place: '지역 청년회', summary: '직업 정보보다 삶의 선택을 먼저 듣는 진로 방문 기록', story: '선배의 일터를 찾아가 어떤 마음으로 일과 생활을 이어가는지 들었습니다', outcome: '방문 전 질문과 회고 양식을 남겼어요', nextAction: '우리 지역 선배에게 방문 제안하기', tone: 'blueprint' },
  { slug: 'climate-action', title: '기후를 생각하는 일상의 선택', topic: '사회와 실천', type: '실천 캠페인', date: '기록 예시', place: '청년 실천팀', summary: '생활 속 선택을 바꾸며 서로의 실천을 응원하는 작은 캠페인', story: '각자의 생활에서 실천할 수 있는 변화를 적고 한 달 동안 함께 돌아봤습니다', outcome: '실천 목록과 홍보 이미지를 모았어요', nextAction: '한 가지 실천부터 기록하기', tone: 'greenroom' },
  { slug: 'study-host', title: '공부 모임을 오래 이어가는 운영법', topic: '배움과 신앙', type: '운영 레시피', date: '기록 예시', place: '전국 공부 모임', summary: '꾸준히 만날 수 있도록 진행하고 기록하는 방법', story: '참여자가 번갈아 진행하고 회고를 남기며 운영 경험을 함께 쌓았습니다', outcome: '진행 순서와 회고 템플릿을 남겼어요', nextAction: '운영 레시피 활용하기', tone: 'nightshift', recipe: { purpose: '공부 모임이 한 사람에게만 의지하지 않게 합니다', preparation: '진행 순서와 담당을 미리 나눕니다', promotion: '무엇을 함께 읽고 나눌지 분명하게 알립니다', lessons: '모임이 짧아도 회고는 반드시 남깁니다' } },
]

export const materials: Material[] = [
  {
    id: 'listening-retreat-guide',
    title: '대화를 여는 질문 카드와 모둠 진행안',
    type: 'PPTX',
    activitySlug: 'listening-retreat',
    owner: '둘러보기 예시 기획팀',
    visibility: '공개',
    availability: 'available',
    description: '처음 만난 사람도 부담 없이 이야기하도록 도입 질문, 모둠 크기, 진행자의 말을 순서대로 정리한 발표 자료',
  },
  {
    id: 'listening-retreat-review',
    title: '정기훈련 회고 기록지',
    type: 'HWPX',
    activitySlug: 'listening-retreat',
    owner: '둘러보기 예시 기획팀',
    visibility: '공개',
    availability: 'available',
    description: '참여자의 반응과 진행 중 막혔던 지점, 다음 모임에서 바꿀 점을 한 장에 남기는 한글 양식',
  },
  {
    id: 'event-from-scratch-checklist',
    title: '청년 행사 준비 체크리스트',
    type: 'XLSX',
    activitySlug: 'event-from-scratch',
    owner: '둘러보기 예시 운영팀',
    visibility: '공개',
    availability: 'available',
    description: '기획, 모집, 공간, 진행, 정산, 회고 업무를 담당자와 마감일별로 나누어 보는 엑셀 자료',
  },
  {
    id: 'event-from-scratch-invitation',
    title: '모집 문구와 신청 안내 예시',
    type: 'DOCX',
    activitySlug: 'event-from-scratch',
    owner: '둘러보기 예시 운영팀',
    visibility: '공개',
    availability: 'available',
    description: '처음 오는 사람도 행사 분위기와 준비물을 바로 알 수 있도록 초대 문구와 신청 안내를 다듬은 문서',
  },
  {
    id: 'local-service-proposal',
    title: '우리 동네 봉공 활동 제안서',
    type: 'HWP',
    activitySlug: 'local-service',
    owner: '둘러보기 예시 지역팀',
    visibility: '공개',
    availability: 'available',
    description: '지역에서 필요한 일을 찾는 질문부터 협력할 곳, 예상 인원, 활동 뒤 기록 방법까지 담은 한글 문서',
  },
  {
    id: 'local-service-roles',
    title: '준비물과 역할 분담표',
    type: 'XLSX',
    activitySlug: 'local-service',
    owner: '둘러보기 예시 지역팀',
    visibility: '공개',
    availability: 'available',
    description: '현장 안내, 물품 준비, 사진 기록, 마무리 연락을 한 사람에게 몰리지 않게 나누는 표',
  },
  {
    id: 'work-and-life-questions',
    title: '일과 삶을 묻는 대화 카드',
    type: 'PDF',
    activitySlug: 'work-and-life',
    owner: '둘러보기 예시 대화팀',
    visibility: '공개',
    availability: 'available',
    description: '직업 이름보다 선택의 계기, 흔들렸던 순간, 일상을 지키는 방법을 묻는 열두 가지 질문',
  },
  {
    id: 'work-and-life-host',
    title: '초대할 선배와 질문을 정리하는 양식',
    type: 'HWPX',
    activitySlug: 'work-and-life',
    owner: '둘러보기 예시 대화팀',
    visibility: '회원 전용',
    availability: 'available',
    description: '초대 이유와 꼭 듣고 싶은 이야기, 사전에 전할 안내, 행사 뒤 감사 연락을 함께 적는 한글 양식',
  },
  {
    id: 'everyday-practice-seven-days',
    title: '7일 마음공부 실천표',
    type: 'PDF',
    activitySlug: 'everyday-practice',
    owner: '둘러보기 예시 공부팀',
    visibility: '공개',
    availability: 'available',
    description: '하루 한 번 멈춰 본 순간과 그때의 마음, 내일 다시 해볼 일을 짧게 기록하는 일주일 실천표',
  },
  {
    id: 'everyday-practice-board',
    title: '온라인 실천 기록 공유판',
    type: 'LINK',
    activitySlug: 'everyday-practice',
    owner: '둘러보기 예시 공부팀',
    visibility: '공개',
    availability: 'available',
    description: '각자의 자리에서 남긴 짧은 기록을 모으고 다음 공부 모임에서 함께 돌아보는 외부 링크 예시',
  },
  {
    id: 'first-time-visit-flow',
    title: '처음 온 사람을 위한 환대 동선',
    type: 'PPTX',
    activitySlug: 'first-time-visit',
    owner: '둘러보기 예시 환대팀',
    visibility: '공개',
    availability: 'available',
    description: '도착 전 안내부터 첫 인사, 자리 소개, 짝 대화, 마무리 연락까지 실제 움직임을 따라 정리한 발표 자료',
  },
  {
    id: 'first-time-visit-messages',
    title: '행사 전후 안내 메시지 모음',
    type: 'DOCX',
    activitySlug: 'first-time-visit',
    owner: '둘러보기 예시 환대팀',
    visibility: '공개',
    availability: 'available',
    description: '신청 확인, 오시는 길, 준비물, 행사 뒤 감사 인사를 상황에 맞게 고쳐 쓸 수 있는 문구 모음',
  },
  {
    id: 'relationship-circle-promise',
    title: '안전한 대화를 위한 약속',
    type: 'PDF',
    activitySlug: 'relationship-circle',
    owner: '둘러보기 예시 진행팀',
    visibility: '공개',
    availability: 'available',
    description: '조언을 서두르지 않고 서로를 특정할 정보를 옮기지 않으며, 말하지 않을 권리도 존중하는 대화 약속',
  },
  {
    id: 'relationship-circle-order',
    title: '마음을 묻는 질문 순서',
    type: 'HWPX',
    activitySlug: 'relationship-circle',
    owner: '둘러보기 예시 진행팀',
    visibility: '회원 전용',
    availability: 'available',
    description: '사실, 감정, 바라는 점, 내가 해볼 일을 차례로 살피도록 만든 소모임 진행 양식',
  },
  {
    id: 'career-visit-before',
    title: '일터 방문 전 질문지',
    type: 'HWP',
    activitySlug: 'career-visit',
    owner: '둘러보기 예시 진로팀',
    visibility: '공개',
    availability: 'available',
    description: '검색으로 알 수 있는 정보는 덜고 현장에서만 들을 수 있는 선택과 생활의 이야기를 준비하는 질문지',
  },
  {
    id: 'career-visit-review',
    title: '방문 뒤 회고와 다음 행동',
    type: 'DOCX',
    activitySlug: 'career-visit',
    owner: '둘러보기 예시 진로팀',
    visibility: '공개',
    availability: 'available',
    description: '기억에 남은 말, 내 생각이 달라진 지점, 더 알아볼 사람과 다음 행동을 적는 회고 문서',
  },
  {
    id: 'climate-action-plan',
    title: '한 달 실천 캠페인 운영안',
    type: 'PPTX',
    activitySlug: 'climate-action',
    owner: '둘러보기 예시 실천팀',
    visibility: '공개',
    availability: 'available',
    description: '큰 목표 대신 생활에서 바꿀 한 가지를 고르고 매주 서로의 기록을 확인하는 캠페인 진행안',
  },
  {
    id: 'climate-action-log',
    title: '참여 기록과 변화 살펴보기',
    type: 'XLSX',
    activitySlug: 'climate-action',
    owner: '둘러보기 예시 실천팀',
    visibility: '공개',
    availability: 'unavailable',
    description: '참여 횟수와 느낀 점을 함께 모으되 개인을 평가하거나 순위를 매기지 않도록 설계한 기록표',
  },
  {
    id: 'study-host-runbook',
    title: '공부 모임 60분 진행안',
    type: 'PDF',
    activitySlug: 'study-host',
    owner: '둘러보기 예시 공부모임',
    visibility: '공개',
    availability: 'available',
    description: '안부, 읽은 내용, 마음에 남은 질문, 다음 실천을 한 시간 안에 고르게 나누는 진행 순서',
  },
  {
    id: 'study-host-handover',
    title: '진행자 인수인계 노트',
    type: 'LINK',
    activitySlug: 'study-host',
    owner: '둘러보기 예시 공부모임',
    visibility: '공개',
    availability: 'available',
    description: '다음 진행자가 지난 대화의 맥락과 준비할 일을 빠르게 확인하도록 이어 쓰는 외부 문서 예시',
  },
]

export const getActivity = (slug: string) => activities.find((activity) => activity.slug === slug)
export const getActivityMaterials = (slug: string) => materials.filter((material) => material.activitySlug === slug)

export const submissions: Submission[] = [
  { id: 'sub-welcome', title: '처음 온 사람을 위한 환대 동선', kind: '활동 기록', contributor: '서울 청년회', submittedAt: '오늘', source: '작성자 제공', owner: '서울 청년회', visibility: '공개', consent: '확인됨', retention: '2년 뒤 재검토', status: '검토 대기', summary: '처음 온 사람이 혼자 남지 않도록 도착부터 마무리까지 순서를 정리한 기록', tags: ['관계와 공동체', '환대'], reviewLog: [{ status: '검토 대기', note: '작성자가 출처와 공개 범위를 입력했어요', at: '오늘' }] },
  { id: 'sub-climate', title: '기후 실천 모임 회고 자료', kind: '자료', contributor: '청년 실천팀', submittedAt: '어제', source: '교당 공유 폴더', owner: '청년 실천팀', visibility: '회원 전용', consent: '추가 확인 필요', retention: '다음 검토일 미정', status: '보완 요청', summary: '한 달간 이어진 기후 실천 모임의 진행 자료와 회고', tags: ['사회와 실천', '기후'], reviewLog: [{ status: '검토 대기', note: '자료를 검토 목록에 추가했어요', at: '어제' }, { status: '보완 요청', note: '공개 동의를 확인해 주세요', at: '오늘' }] },
  { id: 'sub-study', title: '공부 모임 진행 순서', kind: '활동 레시피', contributor: '전국 공부 모임', submittedAt: '3일 전', source: '작성자 제공', owner: '전국 공부 모임', visibility: '공개', consent: '확인됨', retention: '2년 뒤 재검토', status: '보류', summary: '진행자를 돌아가며 맡는 공부 모임의 순서와 회고 방식', tags: ['배움과 신앙', '모임 운영'], reviewLog: [{ status: '검토 대기', note: '작성자가 레시피를 남겼어요', at: '3일 전' }, { status: '보류', note: '기존 자료와 중복 여부를 확인 중이에요', at: '어제' }] },
]
