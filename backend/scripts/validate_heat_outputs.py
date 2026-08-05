"""가공된 폭염 취약도 산출물의 결합·범위·일관성을 검증한다."""

import argparse
import csv
import json
import math
from collections import Counter
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PROCESSED_DIR = BASE_DIR / "data" / "processed"
DEFAULT_REPORT_PATH = DEFAULT_PROCESSED_DIR / "heat_data_validation.json"
GEOJSON_PATH = (
    BASE_DIR / "static" / "data" / "daegu_administrative_dong.geojson"
)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as csv_file:
        return list(csv.DictReader(csv_file))


def quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def expected_risk(score: float, thresholds: dict[str, float]) -> str:
    if score >= thresholds["p75"]:
        return "critical"
    if score >= thresholds["p50"]:
        return "high"
    if score >= thresholds["p25"]:
        return "moderate"
    return "low"


def require(condition: bool, message: str, checks: list[dict]) -> None:
    checks.append({"check": message, "passed": bool(condition)})
    if not condition:
        raise ValueError(f"검증 실패: {message}")


def validate(processed_dir: Path, report_path: Path) -> dict:
    main_rows = read_csv(processed_dir / "heat_indicators.csv")
    district_rows = read_csv(
        processed_dir / "heat_vulnerability_district_summary.csv"
    )
    temporal_rows = read_csv(processed_dir / "heat_temporal_context.csv")
    vulnerability = json.loads(
        (processed_dir / "heat_vulnerability.json").read_text(
            encoding="utf-8"
        )
    )
    assessment = json.loads(
        (processed_dir / "heat_data_assessment.json").read_text(
            encoding="utf-8"
        )
    )
    geojson = json.loads(GEOJSON_PATH.read_text(encoding="utf-8"))

    checks: list[dict] = []
    geo_codes = [
        str(feature["properties"]["ADM_CD"])
        for feature in geojson["features"]
    ]
    csv_codes = [row["adm_cd"] for row in main_rows]
    json_codes = [str(row["adm_cd"]) for row in vulnerability["records"]]

    require(len(geo_codes) == 150, "GeoJSON 행정동이 150개다", checks)
    require(len(set(geo_codes)) == 150, "GeoJSON 행정동 코드가 고유하다", checks)
    require(len(main_rows) == 150, "행정동 결과가 150행이다", checks)
    require(len(set(csv_codes)) == 150, "행정동 결과 코드가 고유하다", checks)
    require(
        set(csv_codes) == set(geo_codes),
        "행정동 결과 코드가 GeoJSON과 정확히 일치한다",
        checks,
    )
    require(
        len(json_codes) == 150 and set(json_codes) == set(csv_codes),
        "지도 JSON이 CSV의 150개 행정동과 정확히 일치한다",
        checks,
    )

    scores = [float(row["score"]) for row in main_rows]
    require(
        all(0 <= score <= 100 for score in scores),
        "모든 취약도 점수가 0~100 범위다",
        checks,
    )
    component_columns = {
        "impervious_risk": "component_impervious_risk",
        "green_deficit": "component_green_deficit",
        "elderly_sensitivity": "component_elderly_sensitivity",
        "cooling_shelter_density_deficit": (
            "component_cooling_shelter_density_deficit"
        ),
        "cooling_shelter_access_deficit": (
            "component_cooling_shelter_access_deficit"
        ),
        "shade_shelter_density_deficit": (
            "component_shade_shelter_density_deficit"
        ),
    }
    score_recalculation_differences = []
    for row in main_rows:
        available_values = []
        for component in assessment["components"]:
            value = row[component_columns[component]]
            if value != "":
                available_values.append(float(value))
                require(
                    0 <= float(value) <= 1,
                    f"{row['district']} {row['dong']}의 {component}가 0~1 범위다",
                    checks,
                )
        recalculated_sum = sum(available_values)
        recalculated = recalculated_sum / len(available_values) * 100
        require(
            int(row["normalized_component_count"]) == len(available_values),
            f"{row['district']} {row['dong']}의 구성요소 수가 일치한다",
            checks,
        )
        require(
            math.isclose(
                float(row["normalized_score_sum"]),
                recalculated_sum,
                abs_tol=0.0001,
            ),
            f"{row['district']} {row['dong']}의 정규화 합계가 재현된다",
            checks,
        )
        score_recalculation_differences.append(
            abs(float(row["score"]) - recalculated)
        )
    max_score_recalculation_difference = max(
        score_recalculation_differences
    )
    require(
        max_score_recalculation_difference <= 0.01,
        "공개된 0~1 구성요소의 동일기여 평균으로 점수가 0.01 이내 재현된다",
        checks,
    )
    thresholds = {
        "p25": round(quantile(scores, 0.25), 2),
        "p50": round(quantile(scores, 0.50), 2),
        "p75": round(quantile(scores, 0.75), 2),
    }
    require(
        thresholds == assessment["risk_thresholds"],
        "등급 사분위 경계값이 점수에서 재현된다",
        checks,
    )
    require(
        all(
            row["risk_level"]
            == expected_risk(float(row["score"]), thresholds)
            for row in main_rows
        ),
        "모든 상대 취약등급이 사분위 경계와 일치한다",
        checks,
    )

    json_by_code = {
        str(record["adm_cd"]): record
        for record in vulnerability["records"]
    }
    require(
        all(
            math.isclose(
                float(row["score"]),
                float(json_by_code[row["adm_cd"]]["score"]),
                abs_tol=1e-9,
            )
            and row["risk_level"]
            == json_by_code[row["adm_cd"]]["risk_level"]
            for row in main_rows
        ),
        "지도 JSON의 점수·등급이 CSV와 일치한다",
        checks,
    )

    complete_rows = [
        row for row in main_rows if row["core_data_complete"] == "True"
    ]
    incomplete_rows = [
        row for row in main_rows if row["core_data_complete"] == "False"
    ]
    require(len(complete_rows) == 142, "핵심 자료 완전 행정동이 142개다", checks)
    require(
        len(incomplete_rows) == 8
        and {row["district"] for row in incomplete_rows} == {"군위군"},
        "자료 미완전 8개 행정동은 모두 군위군이다",
        checks,
    )
    require(
        all(
            math.isclose(float(row["score_component_coverage"]), 1.0)
            and int(row["normalized_component_count"]) == 6
            for row in complete_rows
        )
        and all(
            math.isclose(
                float(row["score_component_coverage"]),
                5 / 6,
                abs_tol=0.0001,
            )
            and int(row["normalized_component_count"]) == 5
            and row["component_shade_shelter_density_deficit"] == ""
            for row in incomplete_rows
        ),
        "군위군만 그늘막을 제외한 5개 구성요소 평균을 사용한다",
        checks,
    )

    require(len(district_rows) == 9, "구·군 요약이 9행이다", checks)
    require(
        sum(int(row["dong_count"]) for row in district_rows) == 150,
        "구·군별 행정동 수 합계가 150이다",
        checks,
    )
    require(
        len(vulnerability["districts"]) == 9,
        "지도 JSON에 선택 가능한 구·군 요약 9개가 있다",
        checks,
    )
    require(
        all(
            row["top_vulnerable_dong"] and row["bottom_vulnerable_dong"]
            for row in district_rows
        ),
        "모든 구·군 요약에 상·하위 행정동이 있다",
        checks,
    )
    require(
        {int(row["year"]) for row in temporal_rows}
        == set(range(2017, 2027)),
        "시간맥락은 2017~2026년을 포괄한다",
        checks,
    )
    require(
        temporal_rows[-1]["year"] == "2026"
        and temporal_rows[-1]["monitoring_observation_days"] == "90"
        and temporal_rows[-1]["monitoring_period_start"] == "2026-05-01"
        and temporal_rows[-1]["monitoring_period_end"] == "2026-07-29",
        "2026년 신규 기상 관측 90일의 시작·종료일이 일치한다",
        checks,
    )
    require(
        all(
            not assessment["join_missing"][source]
            for source in ("landcover", "shelter", "elderly", "uv", "mobility")
        ),
        "핵심 결합 자료는 그늘막 외 누락이 없다",
        checks,
    )
    require(
        len(assessment["join_missing"]["shade"]) == 8,
        "그늘막 누락은 군위군 8개 행정동뿐이다",
        checks,
    )

    risk_counts = Counter(row["risk_level"] for row in main_rows)
    report = {
        "status": "passed",
        "check_count": len(checks),
        "checks": checks,
        "summary": {
            "record_count": len(main_rows),
            "district_count": len(district_rows),
            "score_min": min(scores),
            "score_max": max(scores),
            "score_average": round(sum(scores) / len(scores), 2),
            "max_score_recalculation_difference": round(
                max_score_recalculation_difference,
                6,
            ),
            "risk_counts": dict(sorted(risk_counts.items())),
            "risk_thresholds": thresholds,
            "complete_record_count": len(complete_rows),
            "incomplete_record_count": len(incomplete_rows),
        },
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--processed-dir",
        type=Path,
        default=DEFAULT_PROCESSED_DIR,
    )
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH)
    args = parser.parse_args()
    report = validate(args.processed_dir, args.report)
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
