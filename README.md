# Glok

휴대폰에서 직접 돌아가는 Glok 앱(안드로이드)입니다.

- 화면: `app/src/main/assets/Glok.html` (브라우저용 Glok.html과 같은 파일, 앱 안에서는 앱 모드로 동작)
- 엔진: llama.cpp (`app/src/main/cpp`, 서브모듈 고정 커밋 46ca246d)
- 백그라운드: 답변·그림·모델 다운로드가 진행되는 동안 포그라운드 서비스와 웨이크락으로 앱이 멈추지 않음
- 빌드: GitHub Actions(`.github/workflows/build.yml`)가 APK를 만들고 실제 모델로 엔진과 에뮬레이터 테스트를 돌린 뒤 릴리스에 올림
