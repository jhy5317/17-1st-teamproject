# app구현

import json
import os
import re
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request
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

NAVER_LOCAL_SEARCH_URL = (
    "https://naverapihub.apigw.ntruss.com/search/v1/local"
)


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

@app.get("/api/place-search")
async def place_search(
    query: str = Query(
        ...,
        min_length=1,
        max_length=100,
    ),
):
    """네이버 지역 검색 API를 이용해 대구 장소를 검색한다."""

    client_id = os.getenv("NAVER_SEARCH_CLIENT_ID", "").strip()
    client_secret = os.getenv("NAVER_SEARCH_CLIENT_SECRET", "").strip()

    if not client_id or not client_secret:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "items": [],
                "message": "네이버 장소 검색 API 키가 설정되지 않았습니다.",
            },
        )

    search_query = query.strip()

    # 검색 결과를 대구 지역 중심으로 제한하기 위해 검색어에 대구를 붙임
    if "대구" not in search_query:
        search_query = f"대구 {search_query}"

    headers = {
        "X-NCP-APIGW-API-KEY-ID": client_id,
        "X-NCP-APIGW-API-KEY": client_secret,
    }

    params = {
        "query": search_query,
        "display": 5,
        "start": 1,
        "sort": "random",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                NAVER_LOCAL_SEARCH_URL,
                headers=headers,
                params=params,
            )

            response.raise_for_status()
            payload = response.json()

    except httpx.TimeoutException:
        return JSONResponse(
            status_code=504,
            content={
                "status": "error",
                "items": [],
                "message": "네이버 장소 검색 요청 시간이 초과되었습니다.",
            },
        )

    except httpx.HTTPStatusError as error:
        return JSONResponse(
            status_code=502,
            content={
                "status": "error",
                "items": [],
                "message": (
                    "네이버 장소 검색 API 호출에 실패했습니다. "
                    f"응답 상태: {error.response.status_code}"
                ),
            },
        )

    except (httpx.RequestError, ValueError):
        return JSONResponse(
            status_code=502,
            content={
                "status": "error",
                "items": [],
                "message": "네이버 장소 검색 결과를 불러올 수 없습니다.",
            },
        )

    raw_items = payload.get("items", [])
    items = []

    for item in raw_items:
        title = re.sub(
            r"<[^>]+>",
            "",
            str(item.get("title", "")),
        ).strip()

        address = str(item.get("address", "")).strip()
        road_address = str(item.get("roadAddress", "")).strip()

        # 대구가 아닌 검색 결과 제외
        combined_address = f"{address} {road_address}"

        if "대구" not in combined_address:
            continue

        items.append(
            {
                "title": title,
                "category": str(item.get("category", "")).strip(),
                "address": address,
                "road_address": road_address,
                "mapx": str(item.get("mapx", "")).strip(),
                "mapy": str(item.get("mapy", "")).strip(),
            }
        )

    return {
        "status": "ready",
        "items": items,
        "message": None,
    }