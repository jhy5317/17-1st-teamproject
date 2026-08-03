# app구현

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates


BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env")

app = FastAPI(
    title="대구광역시 폭염 취약지역 분석"
)

app.mount(
    "/static",
    StaticFiles(directory=BASE_DIR / "static"),
    name="static",
)

templates = Jinja2Templates(
    directory=BASE_DIR / "templates"
)

HEAT_DATA_FILE = BASE_DIR / "data" / "processed" / "heat_vulnerability.json"


@app.get("/")
def root(request: Request):
    client_id = os.getenv("NAVER_MAP_CLIENT_ID", "")

    return templates.TemplateResponse(
        request=request,
        name="map.html",
        context={
            "naver_map_client_id": client_id,
            "map_api_configured": bool(client_id),
        },
    )


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "map_api_configured": bool(
            os.getenv("NAVER_MAP_CLIENT_ID")
        ),
    }


@app.get("/api/heat-vulnerability")
def heat_vulnerability():
    """행정동별 폭염 취약도 분석 결과를 반환한다."""
    if not HEAT_DATA_FILE.exists():
        return {
            "status": "pending",
            "base_date": None,
            "method": None,
            "records": [],
            "districts": [],
            "temporal_context": [],
            "message": "가공된 폭염 취약도 데이터가 아직 없습니다.",
        }

    try:
        payload = json.loads(HEAT_DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "method": None,
                "records": [],
                "districts": [],
                "temporal_context": [],
                "message": "폭염 취약도 데이터 파일을 읽을 수 없습니다.",
            },
        )

    if not isinstance(payload, dict):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "method": None,
                "records": [],
                "districts": [],
                "temporal_context": [],
                "message": "폭염 취약도 데이터의 최상위 값은 객체여야 합니다.",
            },
        )

    records = payload.get("records")

    if not isinstance(records, list):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "method": None,
                "records": [],
                "districts": [],
                "temporal_context": [],
                "message": "폭염 취약도 데이터의 records는 배열이어야 합니다.",
            },
        )

    return {
        "status": "ready",
        "base_date": payload.get("base_date"),
        "method": payload.get("method"),
        "records": records,
        "districts": payload.get("districts", []),
        "temporal_context": payload.get("temporal_context", []),
        "message": None,
    }
