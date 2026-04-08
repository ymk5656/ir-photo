# IR Photo - 적외선 카메라 앱

## 1. Project Overview

**Project Name**: IR Photo  
**Type**: 모바일 카메라 웹앱  
**Core Functionality**: 일반 카메라로 촬영한 이미지를 AI 기반으로 적외선 시뮬레이션하여 흑백 적외선 효과를 제공하는 앱  
**Target Users**: 적외선 카메라에 흥미가 있는 사진爱好者

---

## 2. UI/UX Specification

### Layout Structure

**메인 화면 (카메라 뷰)**
- 전체 화면을 카메라 미리보기(Viewfinder)가 차지
- 하단 중앙: 큰 원형 셔터 버튼
- 하단 좌측: 최근 촬영 사진 썸네일
- 하단 우측: 플래시 토글 / 설정 버튼
- 상단: 닫기 버튼, 타이틀, 모드 선택 탭

**모드 탭 (상단)**
- PHOTO (사진 모드)
- INFARED (적외선 모드) - 기본 선택

**촬영 후 화면**
- 중앙: 촬영된 이미지 미리보기
- 하단: 취소 / 저장 버튼
- 저장 시 갤러리-download

### Visual Design

**Color Palette**
- Primary: `#000000` (블랙)
- Secondary: `#FFFFFF` (화이트)
- Accent: `#FF9500` (오렌지 - 애플 스타일)
- Surface: `rgba(255, 255, 255, 0.1)` (블러 효과)
- Danger: `#FF3B30` (레드)

**Typography**
- Font Family: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text'`
- Heading: 17px, semibold
- Body: 15px, regular
- Caption: 13px, regular

**Spacing System**
- Base unit: 8px
- Component padding: 16px
- Safe area bottom: 34px (iPhone notch 대응)

**iOS Specific**
- 둥근 모서리 (border-radius: 10px)
- 블러 백드롭 효과
- 시스템 폰트 사용
- 하단 세이프エリア 패딩

### Components

1. **CameraViewfinder**
   - 전체 화면 video 요소
   - 스캐너 라인 애니메이션 (적외선 스캔 효과)

2. **ShutterButton**
   - 70px 원형 버튼
   - 클릭 시 스케일 애니메이션
   - 내부: 작은 원 + 네모 (사진 아이콘)

3. **ModeTab**
   - 가로 배치된 텍스트 버튼
   - 선택 시 하단 오렌지 바

4. **ThumbnailPreview**
   - 44px 둥근 사각형
   - 클릭 시 갤러리 미리보기

5. **IRFilterOverlay**
   - Canvas 기반 필터 효과
   - 스캔라인 + 블러 효과

6. **CaptureOverlay**
   - 촬영 직전 플래시 효과 (흰색 페이드아웃)

---

## 3. Functionality Specification

### Core Features

1. **카메라 캡처**
   - navigator.mediaDevices.getUserMedia API 사용
   - 후면 카메라 기본, 전면 카메라 지원
   - 고화질 캡처 (1920x1080 이상)

2. **AI 적외선 시뮬레이션**
   - Canvas 2D로 이미지 처리
   - 다음 알고리즘 적용:
     - 히스토그램 평활화 (명대비 강화)
     - 채널 분리 및 재혼합 (적색 강조, 청색 제거)
     - 가우시안 블러 (적외선 확산 효과)
     - 노이즈 추가 (필름 그레인)
     - 스캔라인 오버레이

3. **흑백 변환**
   - 그레이스케일 변환
   - 명대비 조정
   - 워밋(warm) 톤 적용 (적외선 느낌)

4. **이미지 저장**
   - Canvas to DataURL
   - 다운로드 링크 자동 생성

### User Interactions

1. **촬영流程**: 모드 선택 → 셔터 버튼 클릭 → 플래시 효과 → 캡처 → 필터 적용 → 저장 옵션
2. **카메라 전환**: 설정에서 전/후면 카메라 전환
3. **필터 강도**: 설정에서 적외선 효과 강도 조절

### Edge Cases

- 카메라 권한 거부: 권한 요청 메시지 표시
- 브라우저 미지원: 지원 불가 메시지
- 저장 실패: 재시도 옵션

---

## 4. Acceptance Criteria

- [ ] 카메라 뷰가 전체 화면으로 표시
- [ ] 셔터 버튼 클릭 시 사진 촬영
- [ ] 적외선 모드에서拍摄된 이미지に変換되어 표시
- [ ] 흑백 적외선 효과 (히스토그램, 채널 조정, 블러, 노이즈)
- [ ] 이미지 저장 시 다운로드
- [ ] 애플 카메라 UI 스타일 유지
- [ ] 모바일에서 정상 작동
