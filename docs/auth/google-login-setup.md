# 구글 로그인 연결

구현은 Firebase Authentication의 Google 팝업 로그인 뒤 `completeGoogleLogin` 서버 함수를 호출한다. 서버는 검증된 `google.com` 로그인만 허용하고, 기존 카카오·네이버 계정을 이메일로 자동 병합하지 않는다. 가입 후 약관 동의와 필수 실명·소속 입력은 기존 가입 흐름을 따른다.

운영 연결 시 확인할 항목:

1. Firebase `won-archive-weave` → Authentication → Sign-in method → Google 활성화와 지원 이메일 설정
2. Authentication → Settings → Authorized domains에서 사용할 웹사이트 도메인 확인
3. `completeGoogleLogin` 및 회원 정보 관련 Functions를 배포한 뒤 프런트엔드 배포
4. 실제 계정으로 팝업 성공·취소, 약관·필수 정보·별명, 로그아웃 후 최근 로그인 표시 확인

이 변경에서 운영 콘솔 설정과 실제 구글 계정 로그인은 실행하지 않았다. 4193 로컬 미리보기는 구글 계정에 연결하지 않는 시험 화면이다. 최근 로그인은 이 브라우저의 마지막 성공 방식만 저장하며 다른 기기와 동기화하지 않는다.

참고: https://firebase.google.com/docs/auth/web/google-signin
