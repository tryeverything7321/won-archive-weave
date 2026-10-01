import assert from "node:assert/strict";
import test from "node:test";
import {
  applyComposerHint,
  conversationStarterHints,
} from "./composer-intent.ts";

test("the empty-result example path keeps an existing Korean body and changes its visible intent", () => {
  const current = {
    body: "제가 직접 적은 이야기입니다",
    purpose: "생각 나눔",
    topic: "나와 마음",
    hint: "",
  };

  assert.deepEqual(
    applyComposerHint(current, {
      purpose: "질문",
      topic: "배움과 신앙",
      hint: "배움과 신앙에 대해 나누고 싶은 이야기를 적어 주세요",
    }),
    {
      body: "제가 직접 적은 이야기입니다",
      purpose: "질문",
      topic: "배움과 신앙",
      hint: "배움과 신앙에 대해 나누고 싶은 이야기를 적어 주세요",
    },
  );
});

test("the starter path keeps multiline Markdown while exposing its prompt as a hint", () => {
  const markdown = "첫 문단\n\n- 내가 적은 내용\n- 지우면 안 되는 내용";

  assert.deepEqual(
    applyComposerHint(
      {
        body: markdown,
        purpose: "생각 나눔",
        topic: "나와 마음",
        hint: "",
      },
      conversationStarterHints[1],
    ),
    {
      body: markdown,
      purpose: "경험과 노하우",
      topic: "관계와 공동체",
      hint: "직접 해보며 알게 된 노하우를 적어 보세요",
    },
  );
});

test("the feed-adjacent example path keeps an empty body empty", () => {
  assert.deepEqual(
    applyComposerHint(
      {
        body: "",
        purpose: "경험과 노하우",
        topic: "관계와 공동체",
        hint: "이전 도움말",
      },
      {
        purpose: "도움 요청",
        topic: "일과 진로",
        hint: "일과 진로에 대해 나누고 싶은 이야기를 적어 주세요",
      },
    ),
    {
      body: "",
      purpose: "도움 요청",
      topic: "일과 진로",
      hint: "일과 진로에 대해 나누고 싶은 이야기를 적어 주세요",
    },
  );
});

test("each starter has a concrete purpose, topic, and non-body hint", () => {
  assert.deepEqual(conversationStarterHints, [
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
  ]);
});
