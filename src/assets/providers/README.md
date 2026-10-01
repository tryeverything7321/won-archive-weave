# 로그인 제공자 자산 출처

이 디렉터리의 provider UI는 아래 공식 가이드를 기준으로 사용합니다.

2026-09-06: 카카오 로그인 버튼은 공식 `kakao_login_large_narrow.png` 원본(366×90)을 사용합니다. 원본 URL은 `https://developers.kakao.com/tool/resource/static/img/button/login/full/ko/kakao_login_large_narrow.png`이며, 화면에서는 최대 244×60으로 표시합니다. 기존 183×45 래퍼 확대에 따른 흐림을 줄였으며 작은 제공자 배지는 별도 심볼을 유지합니다.

- 카카오 로그인 디자인 가이드: https://developers.kakao.com/docs/ko/kakaologin/design-guide
- 카카오 공식 로그인 리소스: https://developers.kakao.com/tool/resource/login
- 네이버 로그인 버튼 사용 가이드: https://developers.naver.com/docs/login/bi/bi.md
- 네이버 공식 한글 PNG 묶음: https://developers.naver.com/inc/devcenter/downloads/bi/NAVER_login_KR.zip

적용 규칙:

- 카카오 컨테이너 `#FEE500`, 심볼 `#000000`, 레이블 `rgba(0, 0, 0, 0.85)`, radius `12px`
- 카카오 기본 완성형 레이블 `카카오 로그인`
- 네이버 컨테이너 `#03A94D`, N 심볼과 레이블 `#FFFFFF`
- 네이버 N 심볼과 가운데 정렬 레이블 사이 간격 `8px`
- 두 제공자 심볼의 형태와 비율은 변경하지 않음

SVG 파일은 공식 배포 PNG 바이트를 data URI로 감싼 저장소 번들용 래퍼입니다.
PNG 자체를 다시 그리거나 자르거나 변색하지 않았으며 `preserveAspectRatio`로 원본
비율을 유지합니다.

원본 SHA-256:

- `kakao-login-ko-medium-narrow.svg` 내 PNG:
  `4abeab7b4d16b5b00562cb9ae27decb2df99a047d8ae89500243735bd1bea80c`
- `kakao-login-ko-compact.svg` 내 PNG:
  `f9bea43a3155da65fd13ca826efe757475edd4e3625f79864e2e16d104551c93`
- `naver-login-ko-green-narrow.svg` 내 PNG:
  `97ac11a1cd03b7897a1e06bd9b18fcf47efe1cc8b9a1f30aaebf0b04b2b71f88`
- `naver-login-green-icon.svg` 내 PNG:
  `377a2830ba897eca666a0f29ccc9009340c2803be4adb4bc8d0ce655bde28b12`
