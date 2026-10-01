import type { CommunityPostPurpose } from "./api";

export type ComposerIntent = {
  body: string;
  purpose: CommunityPostPurpose;
  topic: string;
  hint: string;
};

export type ComposerHint = {
  purpose: CommunityPostPurpose;
  topic: string;
  hint: string;
};

export type ComposerStarter = ComposerHint & {
  label: string;
};

export const conversationStarterHints: ComposerStarter[] = [
  {
    label: "요즘 마음에 남은 이야기",
    purpose: "생각 나눔",
    topic: "나와 마음",
    hint: "요즘 마음에 남은 이야기를 편하게 적어 보세요",
  },
  {
    label: "직접 해보며 알게 된 노하우",
    purpose: "경험과 노하우",
    topic: "관계와 공동체",
    hint: "직접 해보며 알게 된 노하우를 적어 보세요",
  },
  {
    label: "함께 이야기하고 싶은 주제",
    purpose: "질문",
    topic: "관계와 공동체",
    hint: "함께 이야기하고 싶은 질문이나 주제를 적어 보세요",
  },
];

export function applyComposerHint(
  current: ComposerIntent,
  selection: ComposerHint,
): ComposerIntent {
  return {
    ...current,
    purpose: selection.purpose,
    topic: selection.topic,
    hint: selection.hint,
  };
}
