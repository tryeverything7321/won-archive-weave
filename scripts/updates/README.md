# 위브 업데이트 기록

`main`에 푸시하면 `.github/workflows/update-history.yml`이 커밋 기록을 읽어 `public/updates.json`을 갱신한다. 자동 갱신 커밋은 목록에 다시 넣지 않는다. 서버·개인 계정·비밀 설정은 읽지 않으며 공개 Weave 저장소만 허용한다.

사이트 `/updates`는 배포본의 기록을 먼저 표시한 뒤 공개 저장소의 최신 기록을 확인한다. 새 기록을 읽지 못하면 배포본을 유지한다. 따라서 페이지 구현을 한 번 배포한 뒤에는 새 변경 기록마다 Hosting을 다시 배포할 필요가 없다.

## 이용자가 읽을 설명 남기기

커밋 본문에 다음 항목을 붙인다. 선택 사항이며 없으면 커밋 제목과 변경 파일 경로로 기록한다. 계정 정보나 내부 오류 원문을 적지 않는다.

```
Update-Title: 파일을 더 쉽게 올릴 수 있어요
Update-Area: 자료 등록
Update-Note: 파일을 끌어 놓아 추가할 수 있어요
Update-Note: 실패한 파일만 다시 올릴 수 있어요
```

기능 분류: 화면·사용성 / 자료 등록 / 행사·탐색 / 가입·로그인 / 커뮤니티 / 운영·관리 / 개발·문서

기존 변경의 설명은 `content/update-notes.json`의 커밋별 항목에서 보완한다. 날짜·시간은 실제 Git 커밋 시각을 한국 시간으로 표시하며 배포 시각으로 바꾸어 쓰지 않는다.

## 배포 확인 후 상태 갱신

푸시만으로 서비스 배포를 완료 처리하지 않는다. Hosting·서버 배포를 검증한 뒤, 배포한 소스 커밋의 전체 SHA를 명시한다.

```sh
node scripts/updates/mark-deployed.mjs <검증한_소스_커밋_SHA>
git add content/update-notes.json
git commit -m 'chore(updates): mark deployed release'
git push origin main
```

이 명령은 배포를 수행하지 않고 확인된 배포 경계만 기록한다. 그 커밋과 선행 커밋은 ‘반영 완료’, 이후 커밋은 ‘개발 기록’으로 표시된다. 자동 기록 커밋이 생기므로 다음 수동 작업 전 `git pull --ff-only`로 최신 상태를 받는다.

## 로컬 확인

```sh
node --test scripts/updates/generate.test.mjs
node scripts/updates/generate.mjs
```

상위 개인 저장소에서 작업하는 경우 공개 게시용 checkout을 지정한다.

```sh
node scripts/updates/generate.mjs --repo ../weave-github-publish
```
