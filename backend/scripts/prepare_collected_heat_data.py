"""수집 자료를 행정동별 폭염 구조적 취약도 데이터로 가공한다."""

import argparse
import csv
import json
import math
import re
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_RAW_ROOT = BASE_DIR / "data" / "raw" / "collected_2026-07-30"
DEFAULT_OUTPUT_DIR = BASE_DIR / "data" / "processed"
GEOJSON_FILE = BASE_DIR / "static" / "data" / "daegu_administrative_dong.geojson"

ENCODINGS = ("utf-8-sig", "utf-8", "cp949", "euc-kr")

DISTRICT_BY_ADM_PREFIX = {
    "22010": "중구",
    "22020": "동구",
    "22030": "서구",
    "22040": "남구",
    "22050": "북구",
    "22060": "수성구",
    "22070": "달서구",
    "22510": "달성군",
    "22520": "군위군",
}

DISTRICT_BY_LEGAL_PREFIX = {
    "27110": "중구",
    "27140": "동구",
    "27170": "서구",
    "27200": "남구",
    "27230": "북구",
    "27260": "수성구",
    "27290": "달서구",
    "27710": "달성군",
    "27720": "군위군",
}

SCORE_COMPONENTS = (
    "impervious_risk",
    "green_deficit",
    "elderly_sensitivity",
    "cooling_shelter_density_deficit",
    "cooling_shelter_access_deficit",
    "shade_shelter_density_deficit",
)


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    raw = path.read_bytes()
    for encoding in ENCODINGS:
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError(f"CSV 인코딩을 읽을 수 없습니다: {path}")

    return list(csv.DictReader(text.splitlines()))


def normalize_name(value: str | None) -> str:
    text = unicodedata.normalize("NFKC", value or "").strip()
    return re.sub(r"[\s.\-·ㆍ]", "", text)


def normalize_district(value: str | None) -> str:
    text = unicodedata.normalize("NFKC", value or "").strip()
    text = text.replace("대구광역시", "").strip()
    return text.split()[-1] if text else ""


def to_float(value: str | float | int | None, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} 값이 숫자가 아닙니다: {value!r}") from error
    if not math.isfinite(number):
        raise ValueError(f"{label} 값이 유한한 숫자가 아닙니다: {value!r}")
    return number


def to_int(value: str | float | int | None, label: str) -> int:
    return int(round(to_float(value, label)))


def min_max_normalize(values: list[float]) -> list[float]:
    minimum = min(values)
    maximum = max(values)
    if minimum == maximum:
        return [0.5] * len(values)
    return [(value - minimum) / (maximum - minimum) for value in values]


def pearson_correlation(left: list[float], right: list[float]) -> float:
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    numerator = sum(
        (left_value - left_mean) * (right_value - right_mean)
        for left_value, right_value in zip(left, right, strict=True)
    )
    left_sum_squares = sum((value - left_mean) ** 2 for value in left)
    right_sum_squares = sum((value - right_mean) ** 2 for value in right)
    denominator = math.sqrt(left_sum_squares * right_sum_squares)
    return numerator / denominator if denominator else 0.0


def quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower_index = math.floor(position)
    upper_index = math.ceil(position)
    if lower_index == upper_index:
        return ordered[lower_index]
    fraction = position - lower_index
    return (
        ordered[lower_index] * (1 - fraction)
        + ordered[upper_index] * fraction
    )


def classify_relative_risk(score: float, thresholds: dict[str, float]) -> str:
    if score >= thresholds["p75"]:
        return "critical"
    if score >= thresholds["p50"]:
        return "high"
    if score >= thresholds["p25"]:
        return "moderate"
    return "low"


def load_canonical_dongs() -> list[dict]:
    payload = json.loads(GEOJSON_FILE.read_text(encoding="utf-8"))
    dongs = []
    for feature in payload["features"]:
        properties = feature["properties"]
        adm_cd = str(properties["ADM_CD"])
        district = DISTRICT_BY_ADM_PREFIX.get(adm_cd[:5])
        if district is None:
            raise ValueError(f"알 수 없는 행정동 코드 접두사: {adm_cd}")
        dong = str(properties["ADM_NM"])
        dongs.append(
            {
                "adm_cd": adm_cd,
                "district": district,
                "dong": dong,
                "join_key": (normalize_name(district), normalize_name(dong)),
            }
        )
    if len(dongs) != 150:
        raise ValueError(f"GeoJSON 행정동 수가 150개가 아닙니다: {len(dongs)}")
    return sorted(dongs, key=lambda row: row["adm_cd"])


def keyed_rows(
    rows: list[dict[str, str]],
    district_column: str,
    dong_column: str,
) -> dict[tuple[str, str], dict[str, str]]:
    result = {}
    for row in rows:
        district = normalize_district(row.get(district_column))
        dong = normalize_name(row.get(dong_column))
        if not district or not dong or "불일치" in dong:
            continue
        key = (normalize_name(district), dong)
        if key in result:
            raise ValueError(f"중복 행정구역 행이 있습니다: {district} {dong}")
        result[key] = row
    return result


def derive_area_km2(landcover_row: dict[str, str]) -> float:
    estimates = []
    green_pct = to_float(landcover_row["녹지비율_pct"], "녹지비율_pct")
    impervious_pct = to_float(
        landcover_row["불투수면비율_pct"],
        "불투수면비율_pct",
    )
    if green_pct > 0:
        estimates.append(
            to_float(landcover_row["녹지면적_m2"], "녹지면적_m2")
            / (green_pct / 100)
        )
    if impervious_pct > 0:
        estimates.append(
            to_float(landcover_row["불투수면적_m2"], "불투수면적_m2")
            / (impervious_pct / 100)
        )
    if not estimates:
        raise ValueError("행정동 면적을 추정할 수 없습니다.")
    return sum(estimates) / len(estimates) / 1_000_000


def load_elderly_by_district(raw_root: Path) -> dict[str, dict]:
    path = raw_root / "대구시_행정구역별_노인인구_평균통계.csv"
    result = {}
    for row in read_csv_rows(path):
        district = normalize_district(row["행정구역"])
        if district not in DISTRICT_BY_ADM_PREFIX.values():
            continue
        result[district] = {
            "population": to_float(row["총인구수_평균"], "총인구수_평균"),
            "elderly_population": to_float(
                row["노인인구수_평균"],
                "노인인구수_평균",
            ),
            "elderly_ratio_pct": to_float(
                row["노인인구비율_평균(%)"],
                "노인인구비율_평균(%)",
            ),
        }
    return result


def load_uv_by_dong(raw_root: Path) -> dict[tuple[str, str], dict]:
    path = (
        raw_root
        / "extracted"
        / "기상청_자외선지수_api"
        / "기상청_자외선지수_api"
        / "대구광역시_자외선지수_읍면동.csv"
    )
    result = {}
    for row in read_csv_rows(path):
        legal_code = str(row["행정구역코드(areaNo)"])
        district = DISTRICT_BY_LEGAL_PREFIX.get(legal_code[:5])
        if district is None:
            raise ValueError(f"알 수 없는 법정동 코드 접두사: {legal_code}")
        key = (normalize_name(district), normalize_name(row["동이름"]))
        result[key] = {
            "published_at": row["발표시간(date)"],
            "uv_h3": to_float(row["3시간후_자외선(h3)"], "3시간후 자외선"),
            "uv_h6": to_float(row["6시간후_자외선(h6)"], "6시간후 자외선"),
            "uv_h24": to_float(row["24시간후_자외선(h24)"], "24시간후 자외선"),
        }
    return result


def load_shade_counts(raw_root: Path) -> dict[str, int]:
    path = raw_root / "daegu_shade_shelters_merged.csv"
    counts: dict[str, int] = defaultdict(int)
    for row in read_csv_rows(path):
        district = normalize_district(row["시군구명"])
        if district:
            counts[district] += 1
    return dict(counts)


def load_summer_mobility(raw_root: Path) -> dict[str, float]:
    path = (
        raw_root
        / "extracted"
        / "인구이동량_시군구"
        / "인구이동량_시군구"
        / "24.6-26.7_인구이동량_시군구.csv"
    )
    values: dict[str, list[float]] = defaultdict(list)
    for row in read_csv_rows(path):
        match = re.match(r"(\d{4})\.(\d{2})", row["주차구분"])
        if not match:
            continue
        year, month = int(match.group(1)), int(match.group(2))
        if year in (2024, 2025) and month in (6, 7, 8):
            values[normalize_district(row["시군구"])].append(
                to_float(row["합계"], "인구이동량 합계")
            )
    return {
        district: sum(district_values) / len(district_values)
        for district, district_values in values.items()
        if district_values
    }


def load_temporal_context(raw_root: Path) -> list[dict]:
    context: dict[int, dict] = defaultdict(dict)

    # 기존 2017~2025 일 최고기온 자료는 여름철 장기 추세를 유지한다.
    temperature_path = (
        raw_root
        / "extracted"
        / "최고기온_변화"
        / "최고기온_변화"
        / "data"
        / "대구_최고기온_1725.csv"
    )
    summer_temperatures: dict[int, list[float]] = defaultdict(list)
    for row in read_csv_rows(temperature_path):
        observation_date = date.fromisoformat(row["일시"])
        if observation_date.month in (6, 7, 8):
            summer_temperatures[observation_date.year].append(
                to_float(row["최고기온(°C)"], "일 최고기온")
            )
    for year, values in summer_temperatures.items():
        context[year].update(
            {
                "summer_observation_days": len(values),
                "summer_mean_daily_max_c": round(sum(values) / len(values), 2),
                "summer_peak_max_c": round(max(values), 2),
                "days_ge_33c": sum(value >= 33 for value in values),
                "days_ge_35c": sum(value >= 35 for value in values),
            }
        )

    # 추가된 2020~2026 자료는 5~9월 감시기간의 체감온도·습도·플래그를
    # 함께 제공한다. 2026년은 수집 완료일까지의 부분 기간으로 보존한다.
    monitoring_root = raw_root / "extracted" / "temp_daegu_2020-2026"
    monitoring_values: dict[int, dict[str, list]] = defaultdict(
        lambda: defaultdict(list)
    )
    for monitoring_path in sorted(monitoring_root.glob("temp_daegu_*.csv")):
        for row in read_csv_rows(monitoring_path):
            observation_date = date.fromisoformat(row["일시"])
            year = observation_date.year
            values = monitoring_values[year]
            values["dates"].append(observation_date)
            values["max_apparent"].append(
                to_float(row["최고체감온도(°C)"], "최고체감온도")
            )
            values["max_temperature"].append(
                to_float(row["최고기온(°C)"], "최고기온")
            )
            values["relative_humidity"].append(
                to_float(row["평균상대습도(%)"], "평균상대습도")
            )
            values["heatwave_flags"].append(
                row["폭염여부(O/X)"].strip().upper() == "O"
            )
            values["warning_flags"].append(
                row["폭염특보(O/X)"].strip().upper() == "O"
            )
            values["tropical_night_flags"].append(
                row["열대야(O/X)"].strip().upper() == "O"
            )
            values["uv_high_flags"].append(
                row["자외선지수(단계)"].strip()
                in {"높음", "매우높음", "위험"}
            )

    for year, values in monitoring_values.items():
        dates = values["dates"]
        context[year].update(
            {
                "monitoring_period_start": min(dates).isoformat(),
                "monitoring_period_end": max(dates).isoformat(),
                "monitoring_observation_days": len(dates),
                "monitoring_mean_max_apparent_c": round(
                    sum(values["max_apparent"]) / len(dates),
                    2,
                ),
                "monitoring_peak_max_apparent_c": round(
                    max(values["max_apparent"]),
                    2,
                ),
                "monitoring_mean_daily_max_c": round(
                    sum(values["max_temperature"]) / len(dates),
                    2,
                ),
                "monitoring_peak_daily_max_c": round(
                    max(values["max_temperature"]),
                    2,
                ),
                "monitoring_mean_relative_humidity_pct": round(
                    sum(values["relative_humidity"]) / len(dates),
                    2,
                ),
                "monitoring_heatwave_days": sum(values["heatwave_flags"]),
                "monitoring_warning_flag_days": sum(
                    values["warning_flags"]
                ),
                "monitoring_tropical_night_days": sum(
                    values["tropical_night_flags"]
                ),
                "monitoring_uv_high_or_above_days": sum(
                    values["uv_high_flags"]
                ),
            }
        )

    # 추가된 특보 자료를 우선 사용한다. 주의보와 경보를 분리해 집계한다.
    warning_root = (
        raw_root
        / "extracted"
        / "대구_폭염특보_2020-2026"
    )
    for row in read_csv_rows(warning_root / "03_연도별_신규발표_횟수.csv"):
        year = int(row["연도"])
        column = (
            "heatwave_warning_new_announcements"
            if row["특보종류"] == "폭염경보"
            else "heatwave_advisory_new_announcements"
        )
        context[year][column] = to_int(
            row["발표횟수"],
            f"{row['특보종류']} 신규 발표횟수",
        )

    for row in read_csv_rows(warning_root / "05_연도별_유지시간_요약.csv"):
        year = int(row["연도"])
        column = (
            "heatwave_warning_duration_hours"
            if row["특보종류"] == "폭염경보"
            else "heatwave_advisory_duration_hours"
        )
        context[year][column] = round(
            to_float(row["총유지시간_시간"], "폭염특보 유지시간"),
            2,
        )

    tropical_path = (
        raw_root
        / "extracted"
        / "열대야특보"
        / "daegu_tropical_night_output"
        / "02_대구_열대야주의보_연도별요약.csv"
    )
    for row in read_csv_rows(tropical_path):
        if row["조치"] != "발표":
            continue
        context[int(row["연도"])]["tropical_night_announcements"] = to_int(
            row["횟수"],
            "열대야특보 발표횟수",
        )

    for row in read_csv_rows(raw_root / "대구시_온열질환_연도별_통계.csv"):
        if not row["연도"].isdigit():
            continue
        year = int(row["연도"])
        context[year]["heat_illness_patients"] = to_int(
            row["대구시_전체_환자수"],
            "온열질환 환자수",
        )
        context[year]["heat_illness_deaths"] = to_int(
            row["대구시_전체_추정사망자수"],
            "온열질환 추정사망자수",
        )

    for row in read_csv_rows(
        raw_root / "대구시_연도별_노인인구_통계_및_평균.csv"
    ):
        if not row["연도"].isdigit():
            continue
        year = int(row["연도"])
        context[year]["daegu_population"] = to_int(
            row["총인구수"],
            "대구 총인구수",
        )
        context[year]["daegu_elderly_population"] = to_int(
            row["노인인구수"],
            "대구 노인인구수",
        )
        context[year]["daegu_elderly_ratio_pct"] = to_float(
            row["노인인구비율(%)"],
            "대구 노인인구비율",
        )

    columns = [
        "year",
        "summer_observation_days",
        "summer_mean_daily_max_c",
        "summer_peak_max_c",
        "days_ge_33c",
        "days_ge_35c",
        "monitoring_period_start",
        "monitoring_period_end",
        "monitoring_observation_days",
        "monitoring_mean_max_apparent_c",
        "monitoring_peak_max_apparent_c",
        "monitoring_mean_daily_max_c",
        "monitoring_peak_daily_max_c",
        "monitoring_mean_relative_humidity_pct",
        "monitoring_heatwave_days",
        "monitoring_warning_flag_days",
        "monitoring_tropical_night_days",
        "monitoring_uv_high_or_above_days",
        "heatwave_advisory_new_announcements",
        "heatwave_warning_new_announcements",
        "heatwave_advisory_duration_hours",
        "heatwave_warning_duration_hours",
        "tropical_night_announcements",
        "heat_illness_patients",
        "heat_illness_deaths",
        "daegu_population",
        "daegu_elderly_population",
        "daegu_elderly_ratio_pct",
    ]
    return [
        {"year": year, **{column: context[year].get(column) for column in columns[1:]}}
        for year in sorted(context)
    ]


def source_assessment() -> list[dict]:
    return [
        {
            "source": "daegu_landcover_eupmyeondong_2024.csv",
            "spatial_unit": "행정동 150개",
            "time": "기준연도 2024",
            "role": "구조적 취약도 핵심",
            "use": "녹지비율, 불투수면비율, 행정동 면적 추정",
        },
        {
            "source": "shelter/03_대구_무더위쉼터_행정동요약.csv",
            "spatial_unit": "행정동 150개 + 불일치 1행",
            "time": "수집 시점 현황",
            "role": "구조적 취약도 핵심",
            "use": "운영 쉼터 밀도와 누구나 이용 가능한 쉼터 비율",
        },
        {
            "source": "대구시_행정구역별_노인인구_평균통계.csv",
            "spatial_unit": "구·군 9개",
            "time": "원본 평균 기간",
            "role": "구조적 취약도 핵심",
            "use": "고령인구 민감도; 같은 구·군 행정동에 동일 값 적용",
        },
        {
            "source": "daegu_shade_shelters_merged.csv",
            "spatial_unit": "구·군 8개(군위군 없음), 시설 728건",
            "time": "수집 시점 현황",
            "role": "구조적 취약도 핵심",
            "use": "구·군 면적당 그늘막 공급 수준",
        },
        {
            "source": "대구광역시_자외선지수_읍면동.csv",
            "spatial_unit": "행정동 150개",
            "time": "2026-07-28 06시 발표 단일 예보",
            "role": "현재 위험 참고",
            "use": "장기 취약도 점수에는 미포함; 지도 참고값으로 보존",
        },
        {
            "source": "24.6-26.7_인구이동량_시군구.csv",
            "spatial_unit": "구·군 9개",
            "time": "2024~2025년 6~8월 평균",
            "role": "노출 참고",
            "use": "주간 평균 이동량과 주민 1명당 이동량; 점수에는 미포함",
        },
        {
            "source": "대구_최고기온_1725.csv",
            "spatial_unit": "대구 관측지점 1개",
            "time": "2017~2025",
            "role": "시간 추세 참고",
            "use": "공간 차이가 없어 행정동 점수에는 미포함",
        },
        {
            "source": "temp_daegu_2020-2026.zip",
            "spatial_unit": "대구 관측지점 143",
            "time": "2020-05-01~2026-07-29",
            "role": "시간별 폭염 기상 맥락",
            "use": (
                "연도별 체감·최고기온, 습도, 폭염일, 열대야, "
                "자외선 고위험일 집계. 공간 점수에는 미포함"
            ),
        },
        {
            "source": "대구_폭염특보_2020-2026.zip",
            "spatial_unit": "대구광역시",
            "time": "2020~2026",
            "role": "폭염특보 시간 맥락",
            "use": (
                "폭염주의보·경보 신규 발표 횟수와 지속시간 집계. "
                "공간 점수에는 미포함"
            ),
        },
        {
            "source": "폭염특보·열대야특보·온열질환 연도별 자료",
            "spatial_unit": "대구 전체 또는 일부 권역",
            "time": "연도별",
            "role": "결과 검증·배경",
            "use": "공간 단위 불일치로 행정동 점수에는 미포함",
        },
        {
            "source": "기상청 단기예보/자외선 API 코드·격자 파일",
            "spatial_unit": "전국 행정구역 코드 및 격자",
            "time": "2026-07-01 업데이트",
            "role": "향후 실시간 연동",
            "use": "관측 결과가 아니라 API 호출·격자 매핑 자료",
        },
    ]


def write_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def prepare(raw_root: Path, output_dir: Path) -> dict:
    canonical_dongs = load_canonical_dongs()

    landcover_path = raw_root / "daegu_landcover_eupmyeondong_2024.csv"
    landcover = keyed_rows(
        read_csv_rows(landcover_path),
        "시군구",
        "읍면동",
    )

    shelter_path = raw_root / "shelter" / "03_대구_무더위쉼터_행정동요약.csv"
    shelters = keyed_rows(
        read_csv_rows(shelter_path),
        "시군구",
        "행정동",
    )

    elderly = load_elderly_by_district(raw_root)
    uv = load_uv_by_dong(raw_root)
    shade_counts = load_shade_counts(raw_root)
    mobility = load_summer_mobility(raw_root)

    missing = {
        "landcover": [],
        "shelter": [],
        "elderly": [],
        "uv": [],
        "shade": [],
        "mobility": [],
    }
    rows = []

    for dong in canonical_dongs:
        key = dong["join_key"]
        district = dong["district"]
        for label, source, source_key in (
            ("landcover", landcover, key),
            ("shelter", shelters, key),
            ("elderly", elderly, district),
            ("uv", uv, key),
            ("shade", shade_counts, district),
            ("mobility", mobility, district),
        ):
            if source_key not in source:
                missing[label].append(f"{district} {dong['dong']}")

        if key not in landcover or key not in shelters or district not in elderly:
            continue

        landcover_row = landcover[key]
        shelter_row = shelters[key]
        elderly_row = elderly[district]
        area_km2 = derive_area_km2(landcover_row)
        operating_shelters = to_int(shelter_row["운영중"], "운영중 쉼터")
        anyone_shelters = to_int(
            shelter_row["누구나이용가능"],
            "누구나 이용 가능한 쉼터",
        )
        shelter_density = operating_shelters / area_km2 * 10
        shelter_access_ratio = (
            anyone_shelters / operating_shelters * 100
            if operating_shelters > 0
            else 0.0
        )
        district_mobility = mobility.get(district)
        uv_row = uv.get(key, {})

        rows.append(
            {
                "adm_cd": dong["adm_cd"],
                "district": district,
                "dong": dong["dong"],
                "area_km2": area_km2,
                "green_ratio_pct": to_float(
                    landcover_row["녹지비율_pct"],
                    "녹지비율_pct",
                ),
                "impervious_ratio_pct": to_float(
                    landcover_row["불투수면비율_pct"],
                    "불투수면비율_pct",
                ),
                "elderly_ratio_pct_district": elderly_row["elderly_ratio_pct"],
                "cooling_shelter_total": to_int(
                    shelter_row["전체쉼터수"],
                    "전체 쉼터",
                ),
                "cooling_shelter_operating": operating_shelters,
                "cooling_shelter_anyone": anyone_shelters,
                "cooling_shelter_capacity": to_float(
                    shelter_row["총수용인원"],
                    "쉼터 총수용인원",
                ),
                "cooling_shelter_density_per_10km2": shelter_density,
                "cooling_shelter_accessible_ratio_pct": shelter_access_ratio,
                "shade_shelter_count_district": shade_counts.get(district),
                "summer_mobility_weekly_avg_district": district_mobility,
                "summer_mobility_per_resident_district": (
                    district_mobility / elderly_row["population"]
                    if district_mobility is not None
                    else None
                ),
                "uv_published_at": uv_row.get("published_at"),
                "uv_h3": uv_row.get("uv_h3"),
                "uv_h6": uv_row.get("uv_h6"),
                "uv_h24": uv_row.get("uv_h24"),
            }
        )

    if len(rows) != 150:
        raise ValueError(f"핵심 자료 결합 행정동 수가 150개가 아닙니다: {len(rows)}")

    district_area = defaultdict(float)
    for row in rows:
        district_area[row["district"]] += row["area_km2"]

    for row in rows:
        district = row["district"]
        shade_count = row["shade_shelter_count_district"]
        row["shade_shelter_density_per_10km2_district"] = (
            shade_count / district_area[district] * 10
            if shade_count is not None
            else None
        )

    component_values = {
        "impervious_risk": min_max_normalize(
            [row["impervious_ratio_pct"] for row in rows]
        ),
        "green_deficit": min_max_normalize(
            [100 - row["green_ratio_pct"] for row in rows]
        ),
        "elderly_sensitivity": min_max_normalize(
            [row["elderly_ratio_pct_district"] for row in rows]
        ),
        "cooling_shelter_density_deficit": [
            1 - value
            for value in min_max_normalize(
                [row["cooling_shelter_density_per_10km2"] for row in rows]
            )
        ],
        "cooling_shelter_access_deficit": [
            1 - value
            for value in min_max_normalize(
                [row["cooling_shelter_accessible_ratio_pct"] for row in rows]
            )
        ],
    }
    known_shade_densities = [
        row["shade_shelter_density_per_10km2_district"]
        for row in rows
        if row["shade_shelter_density_per_10km2_district"] is not None
    ]
    known_shade_deficits = [
        1 - value for value in min_max_normalize(known_shade_densities)
    ]
    shade_deficit_iterator = iter(known_shade_deficits)
    component_values["shade_shelter_density_deficit"] = [
        next(shade_deficit_iterator)
        if row["shade_shelter_density_per_10km2_district"] is not None
        else None
        for row in rows
    ]
    landcover_correlation = pearson_correlation(
        component_values["impervious_risk"],
        component_values["green_deficit"],
    )

    for index, row in enumerate(rows):
        for component_name, values in component_values.items():
            value = values[index]
            row[f"component_{component_name}"] = (
                round(value, 4) if value is not None else None
            )
        available_components = [
            component_name
            for component_name in SCORE_COMPONENTS
            if row[f"component_{component_name}"] is not None
        ]
        normalized_score_sum = sum(
            row[f"component_{component_name}"]
            for component_name in available_components
        )
        normalized_score_mean = (
            normalized_score_sum / len(available_components)
        )
        row["normalized_component_count"] = len(available_components)
        row["normalized_score_sum"] = round(normalized_score_sum, 4)
        row["normalized_score_mean"] = round(normalized_score_mean, 4)
        row["score_component_coverage"] = round(
            len(available_components) / len(SCORE_COMPONENTS),
            4,
        )
        row["score"] = round(normalized_score_mean * 100, 2)
        row["core_data_complete"] = (
            len(available_components) == len(SCORE_COMPONENTS)
        )

    score_values = [row["score"] for row in rows]
    risk_thresholds = {
        "p25": round(quantile(score_values, 0.25), 2),
        "p50": round(quantile(score_values, 0.50), 2),
        "p75": round(quantile(score_values, 0.75), 2),
    }
    for row in rows:
        row["risk_level"] = classify_relative_risk(
            row["score"],
            risk_thresholds,
        )

    numeric_precision = {
        "area_km2": 4,
        "green_ratio_pct": 4,
        "impervious_ratio_pct": 4,
        "elderly_ratio_pct_district": 2,
        "cooling_shelter_capacity": 1,
        "cooling_shelter_density_per_10km2": 4,
        "cooling_shelter_accessible_ratio_pct": 2,
        "shade_shelter_density_per_10km2_district": 4,
        "summer_mobility_weekly_avg_district": 2,
        "summer_mobility_per_resident_district": 4,
        "normalized_score_sum": 4,
        "normalized_score_mean": 4,
        "score_component_coverage": 4,
        "uv_h3": 1,
        "uv_h6": 1,
        "uv_h24": 1,
    }
    for row in rows:
        for column, digits in numeric_precision.items():
            if row[column] is not None:
                row[column] = round(row[column], digits)
    columns = [
        "adm_cd",
        "district",
        "dong",
        "area_km2",
        "green_ratio_pct",
        "impervious_ratio_pct",
        "elderly_ratio_pct_district",
        "cooling_shelter_total",
        "cooling_shelter_operating",
        "cooling_shelter_anyone",
        "cooling_shelter_capacity",
        "cooling_shelter_density_per_10km2",
        "cooling_shelter_accessible_ratio_pct",
        "shade_shelter_count_district",
        "shade_shelter_density_per_10km2_district",
        "summer_mobility_weekly_avg_district",
        "summer_mobility_per_resident_district",
        "uv_published_at",
        "uv_h3",
        "uv_h6",
        "uv_h24",
        *[f"component_{name}" for name in SCORE_COMPONENTS],
        "normalized_component_count",
        "normalized_score_sum",
        "normalized_score_mean",
        "score_component_coverage",
        "score",
        "risk_level",
        "core_data_complete",
    ]

    csv_path = output_dir / "heat_indicators.csv"
    write_csv(csv_path, rows, columns)

    district_summary_rows = []
    for district in sorted(DISTRICT_BY_ADM_PREFIX.values()):
        district_rows = [row for row in rows if row["district"] == district]
        top_row = max(district_rows, key=lambda row: row["score"])
        bottom_row = min(district_rows, key=lambda row: row["score"])
        component_averages = {
            f"component_{component_name}_average": round(
                sum(
                    row[f"component_{component_name}"]
                    for row in district_rows
                    if row[f"component_{component_name}"] is not None
                )
                / sum(
                    row[f"component_{component_name}"] is not None
                    for row in district_rows
                ),
                4,
            )
            if any(
                row[f"component_{component_name}"] is not None
                for row in district_rows
            )
            else None
            for component_name in SCORE_COMPONENTS
        }
        district_summary_rows.append(
            {
                "district": district,
                "dong_count": len(district_rows),
                "score_average": round(
                    sum(row["score"] for row in district_rows)
                    / len(district_rows),
                    2,
                ),
                "score_min": min(row["score"] for row in district_rows),
                "score_max": max(row["score"] for row in district_rows),
                "critical_count": sum(
                    row["risk_level"] == "critical" for row in district_rows
                ),
                "high_count": sum(
                    row["risk_level"] == "high" for row in district_rows
                ),
                "moderate_count": sum(
                    row["risk_level"] == "moderate" for row in district_rows
                ),
                "low_count": sum(
                    row["risk_level"] == "low" for row in district_rows
                ),
                "top_vulnerable_dong": top_row["dong"],
                "top_vulnerable_score": top_row["score"],
                "bottom_vulnerable_dong": bottom_row["dong"],
                "bottom_vulnerable_score": bottom_row["score"],
                "normalized_score_sum_average": round(
                    sum(row["normalized_score_sum"] for row in district_rows)
                    / len(district_rows),
                    4,
                ),
                "component_coverage_average": round(
                    sum(
                        row["score_component_coverage"]
                        for row in district_rows
                    )
                    / len(district_rows),
                    4,
                ),
                "elderly_ratio_pct": district_rows[0][
                    "elderly_ratio_pct_district"
                ],
                "cooling_shelter_operating": sum(
                    row["cooling_shelter_operating"] for row in district_rows
                ),
                "shade_shelter_count": district_rows[0][
                    "shade_shelter_count_district"
                ],
                "core_data_complete": all(
                    row["core_data_complete"] for row in district_rows
                ),
                **component_averages,
            }
        )

    district_summary_columns = list(district_summary_rows[0])
    district_summary_path = (
        output_dir / "heat_vulnerability_district_summary.csv"
    )
    write_csv(
        district_summary_path,
        district_summary_rows,
        district_summary_columns,
    )

    temporal_rows = load_temporal_context(raw_root)
    temporal_columns = list(temporal_rows[0])
    temporal_path = output_dir / "heat_temporal_context.csv"
    write_csv(temporal_path, temporal_rows, temporal_columns)

    json_records = [
        {
            "adm_cd": row["adm_cd"],
            "district": row["district"],
            "dong": row["dong"],
            "score": row["score"],
            "risk_level": row["risk_level"],
            "normalized_score_sum": row["normalized_score_sum"],
            "normalized_component_count": row[
                "normalized_component_count"
            ],
            "component_coverage": row["score_component_coverage"],
            "indicators": {
                component_name: row[f"component_{component_name}"]
                for component_name in SCORE_COMPONENTS
            },
            "context": {
                "uv_published_at": row["uv_published_at"],
                "uv_h3": row["uv_h3"],
                "uv_h6": row["uv_h6"],
                "uv_h24": row["uv_h24"],
                "summer_mobility_per_resident": row[
                    "summer_mobility_per_resident_district"
                ],
            },
        }
        for row in rows
    ]
    json_districts = [
        {
            "district": row["district"],
            "dong_count": row["dong_count"],
            "score_average": row["score_average"],
            "score_min": row["score_min"],
            "score_max": row["score_max"],
            "critical_count": row["critical_count"],
            "high_count": row["high_count"],
            "moderate_count": row["moderate_count"],
            "low_count": row["low_count"],
            "top_vulnerable_dong": row["top_vulnerable_dong"],
            "top_vulnerable_score": row["top_vulnerable_score"],
            "bottom_vulnerable_dong": row["bottom_vulnerable_dong"],
            "bottom_vulnerable_score": row["bottom_vulnerable_score"],
            "elderly_ratio_pct": row["elderly_ratio_pct"],
            "cooling_shelter_operating": row[
                "cooling_shelter_operating"
            ],
            "shade_shelter_count": row["shade_shelter_count"],
            "component_coverage_average": row[
                "component_coverage_average"
            ],
            "core_data_complete": row["core_data_complete"],
            "indicators": {
                component_name: row[
                    f"component_{component_name}_average"
                ]
                for component_name in SCORE_COMPONENTS
            },
        }
        for row in district_summary_rows
    ]

    current_context_date = max(
        (row["uv_published_at"] for row in rows if row["uv_published_at"]),
        default=None,
    )
    vulnerability_payload = {
        "base_date": "2024",
        "method": {
            "name": "0~1 정규화 동일기여 합산 상대 취약도",
            "normalization": "행정동 150개 최소-최대 정규화(0~1)",
            "aggregation": (
                "사용 가능한 각 구성요소의 정규화값을 동일 비중으로 "
                "합산하고, 합계/구성요소 수×100으로 표시"
            ),
            "components": list(SCORE_COMPONENTS),
            "component_weighting": "별도 가중치 없음(각 구성요소 동일 1개 단위)",
            "risk_classification": {
                "method": "대구 행정동 점수 사분위수 기반 상대 취약도",
                "thresholds": risk_thresholds,
            },
            "current_context_date": (
                f"{current_context_date[:4]}-{current_context_date[4:6]}-"
                f"{current_context_date[6:8]}"
                if current_context_date
                else None
            ),
            "excluded_from_score": [
                "자외선 단일 예보",
                "구·군 인구이동량",
                "대구 전체 기온·특보·온열질환 시계열",
            ],
        },
        "records": json_records,
        "districts": json_districts,
        "temporal_context": temporal_rows,
    }
    json_path = output_dir / "heat_vulnerability.json"
    json_path.write_text(
        json.dumps(vulnerability_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    report = {
        "record_count": len(rows),
        "score_min": min(score_values),
        "score_max": max(score_values),
        "score_average": round(sum(score_values) / len(score_values), 2),
        "risk_counts": {
            level: sum(1 for row in rows if row["risk_level"] == level)
            for level in ("low", "moderate", "high", "critical")
        },
        "risk_thresholds": risk_thresholds,
        "indicator_correlation": {
            "impervious_vs_green_deficit": round(landcover_correlation, 4),
            "handling": (
                "요청에 따라 각각 독립 구성요소로 유지했습니다. "
                "두 지표의 높은 상관성은 해석 시 주의가 필요합니다."
            ),
        },
        "join_missing": missing,
        "components": list(SCORE_COMPONENTS),
        "aggregation": (
            "0~1 정규화 구성요소 합계/사용 가능한 구성요소 수×100"
        ),
        "source_assessment": source_assessment(),
        "limitations": [
            "고령인구 비율은 구·군 평균을 같은 구·군의 모든 행정동에 적용했습니다.",
            "그늘막은 주소 지오코딩 없이 구·군 합계를 면적으로 보정했습니다.",
            "군위군 그늘막 자료는 미수집으로 처리하고 나머지 5개 정규화값의 평균을 사용했습니다.",
            "불투수면과 녹지부족은 상관성이 높지만 요청에 따라 각각 독립 구성요소로 유지했습니다.",
            "무더위쉼터 밀도는 인구가 아니라 행정동 면적을 분모로 사용했습니다.",
            "자외선은 단일 예보이므로 구조적 취약도 점수에서 제외했습니다.",
            "대구 전체 단위 기온·특보·온열질환은 행정동 간 차이를 만들 수 없어 시간 맥락으로만 사용했습니다.",
            "동일기여도 하나의 모형 선택이며, 상관된 지표가 사실상 중복 반영될 수 있습니다.",
            "이 결과는 상대 비교용 탐색 모형이며 정책 의사결정 전 원자료와 현장 검증이 필요합니다.",
        ],
    }
    report_path = output_dir / "heat_data_assessment.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return {
        "csv": str(csv_path),
        "district_summary_csv": str(district_summary_path),
        "temporal_context_csv": str(temporal_path),
        "json": str(json_path),
        "assessment": str(report_path),
        "report": report,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-root", type=Path, default=DEFAULT_RAW_ROOT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()
    result = prepare(args.raw_root, args.output_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
