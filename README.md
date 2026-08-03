# 대구광역시 폭염 취약지역 분석

대구광역시 150개 행정동의 토지피복, 고령인구, 무더위쉼터, 그늘막을
결합해 **구조적 폭염 취약도**를 산출하고 네이버 지도 위에 시각화하는
프로젝트입니다. 자외선, 인구이동량, 기온, 폭염특보, 열대야특보,
온열질환 자료는 시점·공간 단위가 다른 점을 고려해 참고 맥락으로
분리했습니다.

## 기술 구성

- FastAPI: 웹 서버와 `/api/heat-vulnerability` 분석 결과 API
- Jinja2: 지도 화면 렌더링
- Naver Maps JavaScript API: 지도, 행정동 폴리곤, 검색·필터·선택
- GeoJSON: 대구 행정동 150개, 대구 외곽선, 외부 마스크
- Python 표준 라이브러리: 원본 CSV 결합·정규화·검증

## 실행

프로젝트 루트의 `.env`에 네이버 지도 Client ID를 설정합니다.

```env
NAVER_MAP_CLIENT_ID=발급받은_클라이언트_ID
```

```powershell
uv run python -m uvicorn main:app --reload
```

브라우저에서 `http://127.0.0.1:8000`을 엽니다.

## 데이터 폴더

- `data/raw/collected_2026-07-30/`: 전달받은 원본 전체를 비파괴 복사
- `data/raw/collected_2026-07-30/extracted/`: ZIP별 압축 해제 결과
- `data/processed/heat_indicators.csv`: 행정동 150개 상세 지표와 점수
- `data/processed/heat_vulnerability_district_summary.csv`: 구·군 9개 요약
- `data/processed/heat_temporal_context.csv`: 2017~2026년 시간 맥락
- `data/processed/heat_vulnerability.json`: 지도 API가 직접 읽는 결과
- `data/processed/heat_data_assessment.json`: 자료별 사용 판단과 한계
- `data/processed/heat_data_validation.json`: 자동 품질 검증 결과
- `data/processed/source_profile.json`: 수집 CSV 구조·결측 프로파일

`data/raw`는 용량과 원본 보존을 위해 Git에서 제외합니다. 지도 실행과
분석 재현에 필요한 `data/processed` 결과만 버전 관리 대상으로
예외 처리했습니다.

## 자료 사용 기준

| 자료 | 공간·시점 | 사용 |
|---|---|---|
| 2024 토지피복 | 행정동 150개 | 녹지 부족·불투수면 위험, 면적 추정 |
| 무더위쉼터 | 행정동 150개 | 면적당 운영 쉼터와 개방성 |
| 고령인구 | 구·군 9개 평균 | 같은 구·군의 행정동에 민감도 값 적용 |
| 그늘막 728개 | 구·군 8개 | 구·군 면적당 공급 수준 |
| 자외선 단일 예보 | 행정동 150개, 2026-07-28 | 지도 참고값, 점수 제외 |
| 인구이동량 | 구·군 9개, 2024~2025 여름 | 노출 참고값, 점수 제외 |
| 기온·특보·질환 | 대구 전체 또는 연도별 | 시간 추세와 결과 해석, 점수 제외 |
| 기상청 API 코드·격자 | 전국 코드/격자 | 향후 실시간 연동용 |

공간 단위가 맞지 않는 자료를 행정동 점수에 억지로 넣지 않는 것이 핵심
원칙입니다.

## 구조적 취약도 산정

행정동 150개 사이에서 각 원지표를 최소–최대 정규화해 0~1로 변환한
뒤, 별도 가중치 없이 동일하게 합산합니다. 값이 클수록 더 취약합니다.

- 불투수면 위험
- 녹지 부족
- 고령인구 민감도
- 무더위쉼터 밀도 부족
- 무더위쉼터 접근 부족
- 그늘막 공급 부족

표시 점수는 `정규화값 합계 / 사용 가능한 구성요소 수 × 100`입니다.
그늘막 원본에 군위군이 없으므로 0개라고 가정하지 않으며, 군위군 8개
행정동은 나머지 5개 구성요소의 평균과 자료 충족률을 함께 표시합니다.
불투수면 위험과 녹지 부족의 상관계수는 0.9693이므로 두 값을 별도로
합산한 결과는 해석 시 중복 영향 가능성을 고려해야 합니다.

등급은 절대 위험 기준이 아니라 대구 행정동 사이의 **상대 취약도
사분위수**입니다.

- 낮음: P25 미만
- 보통: P25 이상 P50 미만
- 높음: P50 이상 P75 미만
- 매우 높음: P75 이상

현재 경계값은 P25 52.84, P50 60.70, P75 64.82입니다. 자료가 바뀌면
파이프라인이 경계값을 다시 계산합니다.

자료별 설명, 전처리와 점수 포함 여부, 수식과 한계는
[`docs/data_catalog_and_methodology.md`](docs/data_catalog_and_methodology.md)에
정리했습니다.

## 가공과 검증 재실행

원본 복사 폴더가 준비된 상태에서 다음을 실행합니다.

```powershell
uv run python scripts/profile_collected_csv.py
uv run python scripts/prepare_collected_heat_data.py
uv run python scripts/validate_heat_outputs.py
```

검증 스크립트는 다음을 실패 즉시 검사합니다.

- GeoJSON·CSV·지도 JSON의 150개 행정동 코드 완전 일치
- 행정동 코드 중복, 점수 0~100 범위, 상대등급 경계
- 공개된 0~1 구성요소의 동일기여 평균으로 점수 재계산
- 구·군 9개와 행정동 합계 150개
- 군위군 8개 동 외 핵심 조인 누락 없음
- 신규 기상자료의 2026년 90일 관측 시작·종료일 확인

## 지도 데이터 계약

`main.py`는 `data/processed/heat_vulnerability.json`을 읽어 API로
전달합니다.

```json
{
  "base_date": "2024",
  "method": {
    "name": "0~1 정규화 동일기여 합산 상대 취약도"
  },
  "records": [
    {
      "adm_cd": "22010540",
      "score": 47.26,
      "risk_level": "low",
      "indicators": {
        "impervious_risk": 0.8868,
        "green_deficit": 0.9428,
        "elderly_sensitivity": 0.1416,
        "cooling_shelter_density_deficit": 0.4891,
        "cooling_shelter_access_deficit": 0.375,
        "shade_shelter_density_deficit": 0.0
      }
    }
  ]
}
```

`adm_cd`는 GeoJSON의 `ADM_CD`와 일치해야 하며 `risk_level`은 `low`,
`moderate`, `high`, `critical` 중 하나입니다. 분석 파일이 없거나
잘못된 경우 API는 임의 점수를 만들지 않고 데이터 없음 상태를
반환합니다.

## 현재 지도 기능

- 군위군을 포함한 대구광역시 행정동 150개 표시
- 대구 외부 마스크와 전체 외곽선
- 행정동 검색, 자동 확대, 클릭 선택, 호버 정보창
- 구·군 및 상대 취약도 단계 필터
- 분석 지역 수·평균 점수·매우 높은 지역·기준연도 요약
- 선택 행정동의 6개 정규화 취약 요인 막대
- 구·군 선택 시 오른쪽 패널의 구·군 평균·상하위 동·시설 정보
- 취약지역 상위 5곳과 하위 5곳 순위 및 지도 바로가기
- 첫 화면을 행정동을 구분할 수 있는 도심 확대 수준으로 표시
- 행정동 경계 표시 전환, 지도 초기화, 반응형 레이아웃

## 분석 한계

- 고령인구는 행정동 자료가 아니라 구·군 평균을 적용했습니다.
- 그늘막은 주소 지오코딩 없이 구·군 합계를 면적으로 보정했습니다.
- 쉼터 밀도의 분모는 인구가 아니라 행정동 면적입니다.
- 자외선은 단일 예보라 구조적 취약도 점수에서 제외했습니다.
- 동일기여도 하나의 모형 선택이며 상관된 지표가 중복 반영될 수 있습니다.
- 현재 점수는 정책 확정 지수가 아닌 상대 비교용 탐색 모형입니다. 정책
  활용 전 행정동 인구·독거노인·기초생활수급·표면온도 자료 보강과
  현장 검증이 필요합니다.

## 주요 코드

- `main.py`: FastAPI 앱과 폭염 취약도 API
- `templates/map.html`: 지도 화면
- `static/js/map.js`: 네이버 지도와 GeoJSON·분석 데이터 결합
- `scripts/prepare_collected_heat_data.py`: 수집 원본 결합과 점수 산정
- `scripts/validate_heat_outputs.py`: 결과 품질 자동 검증
- `scripts/profile_collected_csv.py`: 수집 CSV 구조·결측 프로파일
