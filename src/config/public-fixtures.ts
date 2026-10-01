/**
 * 실제 콘텐츠가 충분히 쌓이기 전까지 공개 서비스에서도 둘러보기 예시를 제공합니다
 *
 * 일시적으로 숨겨야 할 때만 VITE_SHOW_PUBLIC_FIXTURES=false를 명시합니다
 */
export const showPublicFixtures =
  import.meta.env.VITE_SHOW_PUBLIC_FIXTURES !== "false";
