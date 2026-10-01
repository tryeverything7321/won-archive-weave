import type { CommunityPostPurpose } from "./api";

export type CommunityFixturePost = {
  id: string;
  purpose: CommunityPostPurpose;
  topic: string;
  pseudonym: string;
  body: string;
  response: string;
};

export const communityFixturePosts: CommunityFixturePost[] = [
  {
    id: "fixture-first-visit",
    purpose: "질문",
    topic: "배움과 신앙",
    pseudonym: "맑은바람",
    body: "원불교 모임이 처음이라 용어를 잘 모르는데, 공부 모임에 바로 가도 괜찮을까요? 처음 온 사람이 미리 알고 가면 좋은 것도 궁금해요.",
    response: "처음에는 모르는 말이 있어도 괜찮아요. 모임 성격과 준비물을 주최자에게 한 번 물어보고, 당일에는 편하게 듣는 것부터 시작해 보세요.",
  },
  {
    id: "fixture-welcome",
    purpose: "경험과 노하우",
    topic: "관계와 공동체",
    pseudonym: "느린파도",
    body: "처음 온 분을 잘 맞이하고 싶어서 입구 안내와 짝 대화를 준비했어요. 프로그램보다 시작 전 10분에 먼저 말을 걸어 준 일이 가장 도움이 됐다는 이야기를 들었습니다.",
    response: "좋은 경험이네요. 다음 모임에서 바로 참고할 수 있도록 안내 문구와 역할을 어떻게 나눴는지도 함께 알려 주세요.",
  },
  {
    id: "fixture-career-talk",
    purpose: "도움 요청",
    topic: "일과 진로",
    pseudonym: "초록연필",
    body: "지역에서 여섯 명 정도 모이는 진로 대화 자리를 열어 보려고 해요. 직업 소개로 끝나지 않고 삶의 선택까지 들으려면 선배에게 어떤 질문을 드리는 게 좋을까요?",
    response: "지금 하는 일보다 그 일을 선택한 계기, 흔들렸던 순간, 생활을 지키는 방법을 먼저 물어보면 자연스럽게 깊은 이야기가 이어져요.",
  },
  {
    id: "fixture-local-action",
    purpose: "함께할 사람 찾기",
    topic: "사회와 실천",
    pseudonym: "작은등불",
    body: "부산에서 한 달 동안 일회용품을 줄이고 서로의 실천을 기록해 볼 분을 찾고 있어요. 부담 없이 한 가지씩 정하고 주말에 짧게 안부를 나누려 합니다.",
    response: "지역과 기간, 예상하는 참여 방식을 함께 적어 두면 관심 있는 사람이 참여 여부를 판단하기 쉬워요.",
  },
  {
    id: "fixture-rest",
    purpose: "생각 나눔",
    topic: "나와 마음",
    pseudonym: "여름구름",
    body: "좋아해서 시작한 활동도 오래 이어 가다 보면 지칠 때가 있네요. 잠시 쉬면 미안하고, 계속하면 마음이 메말라지는 것 같을 때 여러분은 어떻게 균형을 찾나요?",
    response: "쉬는 시간을 활동을 그만두는 일로 보지 않고 오래 함께하기 위한 과정으로 생각해도 좋겠어요. 역할과 속도를 다시 나누는 방법도 함께 이야기해 봐요.",
  },
];
