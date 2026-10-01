export function landingServiceStatus(loginAvailable: boolean) {
  return loginAvailable
    ? {
        label: "공개 베타",
        message: "공개된 기록을 둘러보고, 로그인하면 기록과 일정을 직접 남길 수 있어요",
      }
    : {
        label: "둘러보기",
        message: "공개된 기록과 예시 콘텐츠를 먼저 살펴볼 수 있어요",
      };
}
