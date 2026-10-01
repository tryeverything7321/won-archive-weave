export const draftPolicyCopy = {
  storage: "초안은 현재 탭에 최대 24시간 보관되고 로그아웃하면 삭제됩니다. 브라우저의 탭 복원 기능으로 다시 보일 수 있으니 공용 기기에서는 꼭 로그아웃해 주세요.",
  files: "선택한 파일 내용은 저장하지 않습니다. 이어서 작성할 때 파일을 다시 선택해 주세요.",
};

export function requiresDraftDiscardConfirmation(action: "continue" | "start_new" | "delete"): boolean {
  return action !== "continue";
}
