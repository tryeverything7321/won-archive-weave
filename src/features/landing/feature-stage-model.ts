import type { LucideIcon } from "lucide-react";
import { CalendarDays, FolderArchive, MessageCircleMore, WandSparkles } from "lucide-react";
import recordScene from "./assets/home-record-v1.webp";
import calendarScene from "./assets/home-calendar-v1.webp";
import communityScene from "./assets/home-community-v1.webp";
import planScene from "./assets/home-plan-v1.webp";

export type LandingScene = {
  id: string;
  number: string;
  title: string;
  description: string;
  action: string;
  to: string;
  icon: LucideIcon;
  notes: readonly string[];
  visualLabel: string;
  imageSrc: string;
};

export const landingScenes: readonly LandingScene[] = [
  {
    id: "archive",
    number: "01",
    title: "활동이 기록으로 남는 곳",
    description:
      "어떻게 시작했고 무엇이 남았는지, 다음 사람이 활용할 자료와 함께 살펴봅니다.",
    action: "활동 기록 둘러보기",
    to: "/archive",
    icon: FolderArchive,
    notes: ["시작한 이유", "활동의 과정과 결과", "이어 쓰는 자료"],
    visualLabel: "하나의 활동이 기록과 자료로 이어지는 모습",
    imageSrc: recordScene,
  },
  {
    id: "calendar",
    number: "02",
    title: "이번에는 어디서 만날까요",
    description:
      "지역과 교당·주최를 기준으로 다가오는 행사와 모임을 찾습니다.",
    action: "행사 일정 살펴보기",
    to: "/calendar",
    icon: CalendarDays,
    notes: ["이번 달", "지역과 주최", "행사 내용"],
    visualLabel: "여러 지역의 일정이 한곳으로 모이는 모습",
    imageSrc: calendarScene,
  },
  {
    id: "community",
    number: "03",
    title: "경험에서 시작하는 대화",
    description:
      "요즘의 고민과 직접 겪으며 알게 된 노하우를 꺼내고 서로의 생각에 답합니다.",
    action: "커뮤니티 둘러보기",
    to: "/community",
    icon: MessageCircleMore,
    notes: ["의견", "직접 겪은 경험", "서로의 답"],
    visualLabel: "서로 다른 생각이 대화로 연결되는 모습",
    imageSrc: communityScene,
  },
  {
    id: "planner",
    number: "04",
    title: "필요한 자료를 함께 나눠요",
    description:
      "행사 안내문, 발표 자료, 한글 양식처럼 우리 모임에서도 쓸 수 있는 파일과 링크를 찾습니다.",
    action: "자료 나눔 둘러보기",
    to: "/resources",
    icon: WandSparkles,
    notes: ["행사 안내문", "발표 자료", "한글 양식"],
    visualLabel: "다음 활동에 활용할 자료를 살펴보는 모습",
    imageSrc: planScene,
  },
] as const;
