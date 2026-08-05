"""수집한 CSV 원본의 구조와 기본 품질을 JSON으로 기록한다."""

import argparse
import csv
import json
from pathlib import Path


ENCODINGS = ("utf-8-sig", "utf-8", "cp949", "euc-kr")
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_ROOT = BASE_DIR / "data" / "raw" / "collected_2026-07-30"
DEFAULT_OUTPUT = BASE_DIR / "data" / "processed" / "source_profile.json"


def detect_encoding(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ENCODINGS:
        try:
            raw.decode(encoding)
            return encoding
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("unknown", raw, 0, 1, f"인코딩 감지 실패: {path}")


def profile_csv(path: Path, root: Path) -> dict:
    encoding = detect_encoding(path)
    with path.open("r", encoding=encoding, newline="") as csv_file:
        sample_text = csv_file.read(8192)
        csv_file.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample_text, delimiters=",\t;|")
        except csv.Error:
            dialect = csv.excel

        reader = csv.DictReader(csv_file, dialect=dialect)
        columns = reader.fieldnames or []
        row_count = 0
        blank_counts = {column: 0 for column in columns}
        samples = []

        for row in reader:
            row_count += 1
            if len(samples) < 3:
                samples.append(row)
            for column in columns:
                if row.get(column) in (None, ""):
                    blank_counts[column] += 1

    return {
        "path": str(path.relative_to(root)).replace("\\", "/"),
        "encoding": encoding,
        "delimiter": dialect.delimiter,
        "row_count": row_count,
        "columns": columns,
        "blank_counts": blank_counts,
        "samples": samples,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    profiles = [
        profile_csv(path, args.root)
        for path in sorted(args.root.rglob("*.csv"))
    ]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"files": profiles}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"CSV {len(profiles)}개 프로파일 생성: {args.output}")


if __name__ == "__main__":
    main()
