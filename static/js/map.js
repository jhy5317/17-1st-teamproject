(() => {
  "use strict";

  /*
   * 대구광역시 지도 핵심 구현
   *
   * 1. 군위군을 포함한 대구 지도 표시
   * 2. 지도 이동 및 확대·축소 범위 제한
   * 3. 대구 외부 회색 마스크
   * 4. 대구광역시 외곽선 굵게 표시
   * 5. 행정동 경계선 표시
   * 6. 행정동 마우스 오버 음영 처리
   * 7. GeoJSON 오류 처리
   * 8. 확대·축소 시 외부 마스크 깜빡임 최소화
   */

  if (
    typeof window.naver === "undefined" ||
    typeof window.naver.maps === "undefined"
  ) {
    console.error(
      "NAVER Maps API를 불러오지 못했습니다. Client ID와 Web Service URL을 확인하세요.",
    );
    return;
  }

  const mapElement = document.getElementById("map");
  const searchInput = document.getElementById("dong-search");
  const searchButton = document.getElementById("search-button");
  const resetButton = document.getElementById("reset-button");
  const districtFilter = document.getElementById("district-filter");
  const riskFilter = document.getElementById("risk-filter");
  const boundaryToggle = document.getElementById("boundary-toggle");
  // jisu_02_추가 / 취약도 색상 토글
  const vulnerabilityToggle = document.getElementById("vulnerability-toggle");
  //
  const mapStatus = document.getElementById("map-status");
  const panelEyebrow = document.getElementById("panel-eyebrow");
  const dongNameElement = document.getElementById("dong-name");
  const dongDetails = document.getElementById("dong-details");
  const districtDetails = document.getElementById("district-details");
  const dongDistrictElement = document.getElementById("dong-district");
  const dongCodeElement = document.getElementById("dong-code");
  const dongBaseDateElement = document.getElementById("dong-base-date");
  const dongRiskLevelElement = document.getElementById("dong-risk-level");
  const dongRiskScoreElement = document.getElementById("dong-risk-score");
  const analysisPlaceholder = document.getElementById("analysis-placeholder");
  const summaryAnalyzed = document.getElementById("summary-analyzed");
  const summaryAverage = document.getElementById("summary-average");
  const summaryHighRisk = document.getElementById("summary-high-risk");
  const summaryBaseDate = document.getElementById("summary-base-date");
  const summaryDataStatus = document.getElementById("summary-data-status");
  const riskRankingList = document.getElementById("risk-ranking-list");
  const lowRiskRankingList = document.getElementById("low-risk-ranking-list");
  const districtDetailElements = {
    dongCount: document.getElementById("district-dong-count"),
    averageScore: document.getElementById("district-average-score"),
    highCount: document.getElementById("district-high-count"),
    topDong: document.getElementById("district-top-dong"),
    bottomDong: document.getElementById("district-bottom-dong"),
    coolingShelters: document.getElementById("district-cooling-shelters"),
    shadeShelters: document.getElementById("district-shade-shelters"),
    dataStatus: document.getElementById("district-data-status"),
  };
  const indicatorElements = {
    impervious_risk: {
      progress: document.getElementById("indicator-impervious"),
      value: document.getElementById("indicator-impervious-value"),
    },
    green_deficit: {
      progress: document.getElementById("indicator-green"),
      value: document.getElementById("indicator-green-value"),
    },
    elderly_sensitivity: {
      progress: document.getElementById("indicator-elderly"),
      value: document.getElementById("indicator-elderly-value"),
    },
    cooling_shelter_density_deficit: {
      progress: document.getElementById("indicator-cooling-density"),
      value: document.getElementById("indicator-cooling-density-value"),
    },
    cooling_shelter_access_deficit: {
      progress: document.getElementById("indicator-cooling-access"),
      value: document.getElementById("indicator-cooling-access-value"),
    },
    shade_shelter_density_deficit: {
      progress: document.getElementById("indicator-shade"),
      value: document.getElementById("indicator-shade-value"),
    },
  };

  if (!mapElement) {
    console.error("id가 map인 HTML 요소를 찾을 수 없습니다.");
    return;
  }

  const GEOJSON_BASE_URL = "/static/data";

  const GEOJSON_FILES = {
    administrativeDong: `${GEOJSON_BASE_URL}/daegu_administrative_dong.geojson`,
    boundary: `${GEOJSON_BASE_URL}/daegu_boundary.geojson`,
    outsideMask: `${GEOJSON_BASE_URL}/daegu_outside_mask.geojson`,
  };
  const HEAT_DATA_URL = "/api/heat-vulnerability";

  const RISK_STYLES = {
    low: { label: "낮음", color: "#fef3c7" },
    moderate: { label: "보통", color: "#fdba74" },
    high: { label: "높음", color: "#f97316" },
    critical: { label: "매우 높음", color: "#b91c1c" },
    none: { label: "데이터 없음", color: "#e2e8f0" },
  };

  const DISTRICT_BY_CODE_PREFIX = {
    22010: "중구",
    22020: "동구",
    22030: "서구",
    22040: "남구",
    22050: "북구",
    22060: "수성구",
    22070: "달서구",
    22510: "달성군",
    22520: "군위군",
  };

  /*
   * 지도 기본 설정
   */

  const DAEGU_CENTER = new naver.maps.LatLng(35.8714, 128.6014);
  const INITIAL_ZOOM = 12;
  const MIN_SELECTION_ZOOM = 13;

  // 군위군을 포함하는 대구광역시 주변 이동 제한 범위
  const DAEGU_LIMIT_BOUNDS = new naver.maps.LatLngBounds(
    new naver.maps.LatLng(35.45, 128.25),
    new naver.maps.LatLng(36.35, 129.05),
  );

  const map = new naver.maps.Map(mapElement, {
    center: DAEGU_CENTER,
    zoom: INITIAL_ZOOM,

    minZoom: 9,
    maxZoom: 18,
    maxBounds: DAEGU_LIMIT_BOUNDS,

    scrollWheel: false,
    draggable: true,
    disableKineticPan: true,
    pinchZoom: true,
    keyboardShortcuts: false,

    // 확대·축소 시 기본지도 타일 전환 효과 제거
    tileTransition: false,
    overlayZoomEffect: "all",
    tileSpare: 1,

    zoomControl: false,

    mapDataControl: false,
    scaleControl: true,
  });

  const hoverInfoWindow = new naver.maps.InfoWindow({
    maxWidth: 240,
    pixelOffset: new naver.maps.Point(0, -8),
    disableAutoPan: true,
    zIndex: 100,
  });

  const instantZoomControl = document.createElement("div");
  const zoomInButton = document.createElement("button");
  const zoomOutButton = document.createElement("button");
  instantZoomControl.className = "instant-zoom-control";
  instantZoomControl.setAttribute("aria-label", "지도 확대 및 축소");
  zoomInButton.type = "button";
  zoomInButton.className = "instant-zoom-button";
  zoomInButton.setAttribute("aria-label", "지도 확대");
  zoomInButton.title = "지도 확대";
  zoomInButton.textContent = "+";
  zoomOutButton.type = "button";
  zoomOutButton.className = "instant-zoom-button";
  zoomOutButton.setAttribute("aria-label", "지도 축소");
  zoomOutButton.title = "지도 축소";
  zoomOutButton.textContent = "−";
  instantZoomControl.append(zoomInButton, zoomOutButton);
  mapElement.append(instantZoomControl);

  /*
   * 생성된 오버레이 보관
   */

  const maskPolygons = [];
  const boundaryPolygons = [];
  const selectionMaskPolygons = [];
  const selectionHaloPolygons = [];
  const dongFeatures = [];
  const dongFeatureByCode = new Map();
  const dongPolygonsByCode = new Map();
  const heatDataByDongCode = new Map();
  const heatDataByDistrict = new Map();
  const districtBoundsByName = new Map();
  const dongBoundsByCode = new Map();
  const dongGeometryByCode = new Map();
  let selectedFeature = null;
  let administrativeBoundaryVisible = true;
  // jisu_02_추가 / 취약도 단계별 채움색을 지도에 표시할지 저장
  let vulnerabilityLayerVisible = true;
  //

  let selectedDistrict = "all";
  let selectedRiskLevel = "all";
  let heatDataBaseDate = null;
  let hoveredDongFeature = null;
  let dongHoverLeaveTimer = null;
  let selectionAnimationFrame = null;
  let lastHandledDongClickCode = null;
  let lastHandledDongClickAt = 0;

  /*
   * GeoJSON 요청
   */

  async function loadGeoJson(url) {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-cache",
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }

    const geoJson = await response.json();

    if (!geoJson || !geoJson.type) {
      throw new Error(`올바르지 않은 GeoJSON 파일입니다: ${url}`);
    }

    return geoJson;
  }

  async function loadHeatData() {
    const response = await fetch(HEAT_DATA_URL, {
      method: "GET",
      cache: "no-cache",
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${HEAT_DATA_URL}`);
    }

    const payload = await response.json();
    const records = Array.isArray(payload.records) ? payload.records : [];
    const districts = Array.isArray(payload.districts) ? payload.districts : [];
    heatDataBaseDate =
      payload.base_date === undefined || payload.base_date === null
        ? null
        : String(payload.base_date);

    records.forEach((record) => {
      const dongCode = String(record.adm_cd ?? "").trim();
      const score = Number(record.score);

      if (!dongCode || !Number.isFinite(score)) {
        return;
      }

      heatDataByDongCode.set(dongCode, {
        score: Math.max(0, Math.min(100, score)),
        riskLevel: normalizeRiskLevel(record.risk_level, score),
        indicators: normalizeIndicators(record.indicators),
      });
    });
    districts.forEach((district) => {
      const districtName = String(district.district ?? "").trim();

      if (districtName) {
        heatDataByDistrict.set(districtName, {
          ...district,
          indicators: normalizeIndicators(district.indicators),
        });
      }
    });

    return payload;
  }

  function normalizeRiskLevel(riskLevel, score) {
    if (Object.hasOwn(RISK_STYLES, riskLevel) && riskLevel !== "none") {
      return riskLevel;
    }

    if (score >= 75) {
      return "critical";
    }

    if (score >= 50) {
      return "high";
    }

    if (score >= 25) {
      return "moderate";
    }

    return "low";
  }

  function normalizeIndicators(indicators) {
    if (!indicators || typeof indicators !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.keys(indicatorElements).flatMap((indicatorName) => {
        const value = Number(indicators[indicatorName]);

        return Number.isFinite(value)
          ? [[indicatorName, Math.max(0, Math.min(1, value))]]
          : [];
      }),
    );
  }

  function updateIndicatorBreakdown(indicators = {}) {
    Object.entries(indicatorElements).forEach(([indicatorName, elements]) => {
      const score = indicators[indicatorName];
      const hasScore = Number.isFinite(score);

      if (elements.progress) {
        elements.progress.value = hasScore ? score : 0;
      }

      if (elements.value) {
        elements.value.textContent = hasScore ? score.toFixed(3) : "-";
      }
    });
  }

  function createHoverTooltip(feature) {
    const dongInfo = getDongInfo(feature);
    const heatData = heatDataByDongCode.get(dongInfo.code);
    const riskStyle = RISK_STYLES[heatData?.riskLevel ?? "none"];
    const container = document.createElement("div");
    const location = document.createElement("strong");
    const district = document.createElement("span");
    const risk = document.createElement("span");

    container.className = "map-tooltip";
    location.className = "map-tooltip-name";
    district.className = "map-tooltip-district";
    risk.className = "map-tooltip-risk";

    location.textContent = dongInfo.name;
    district.textContent = getDistrictName(feature);
    risk.textContent = heatData
      ? `${riskStyle.label} · ${heatData.score.toFixed(1)}점`
      : riskStyle.label;
    risk.style.borderColor = riskStyle.color;

    container.append(location, district, risk);
    return container;
  }

  function clearDongHover() {
    if (hoveredDongFeature && hoveredDongFeature !== selectedFeature) {
      applyDongPolygonStyle(hoveredDongFeature);
    }

    hoveredDongFeature = null;
    hoverInfoWindow.close();
    mapElement.style.cursor = "";
  }

  function highlightDong(feature) {
    if (hoveredDongFeature === feature) {
      return;
    }

    clearDongHover();
    hoveredDongFeature = feature;
    const dongCode = getFeatureValue(feature, ["ADM_CD", "adm_cd", "code"]);
    const heatData = heatDataByDongCode.get(dongCode);
    const riskStyle = RISK_STYLES[heatData?.riskLevel ?? "none"];

    setDongPolygonOptions(dongCode, {
      visible: true,
      // jisu_02_추가수정 / fillColor, fillOpacity 수정
      // 색상을 꺼도 마우스를 올린 행정동은 흰색 반투명 효과와 파란 테두리로 구분
      fillColor: vulnerabilityLayerVisible ? riskStyle.color : "#ffffff",
      fillOpacity: vulnerabilityLayerVisible ? (heatData ? 0.94 : 0.5) : 0.16,
      //
      strokeColor: "#1e3a8a",
      strokeOpacity: 1,
      strokeWeight: 2.8,
      clickable: true,
      zIndex: 26,
    });
  }

  function showHoverTooltip(event) {
    if (!event.coord) {
      return;
    }

    hoverInfoWindow.setContent(createHoverTooltip(event.feature));
    hoverInfoWindow.open(map, event.coord);
  }

  function updateAnalysisSummary(payload) {
    const records = [...heatDataByDongCode.values()];
    const analyzedCount = records.length;
    const averageScore =
      analyzedCount > 0
        ? records.reduce((sum, record) => sum + record.score, 0) / analyzedCount
        : null;
    const highRiskCount = records.filter(
      (record) =>
        record.riskLevel === "high" || record.riskLevel === "critical",
    ).length;

    if (summaryAnalyzed) {
      summaryAnalyzed.textContent =
        analyzedCount > 0 ? `${analyzedCount}개` : "-";
    }

    if (summaryAverage) {
      summaryAverage.textContent =
        averageScore === null ? "-" : `${averageScore.toFixed(1)}점`;
    }

    if (summaryHighRisk) {
      summaryHighRisk.textContent =
        analyzedCount > 0 ? `${highRiskCount}개` : "-";
    }

    if (summaryBaseDate) {
      summaryBaseDate.textContent = payload.base_date ?? "-";
    }

    if (summaryDataStatus) {
      summaryDataStatus.textContent =
        analyzedCount > 0
          ? `행정동 데이터 ${analyzedCount}/150`
          : payload.message ?? "데이터 준비 중";
    }
  }

  function renderRanking(listElement, descending) {
    if (!listElement) {
      return;
    }

    const ranking = [...heatDataByDongCode.entries()]
      .filter(([dongCode]) => dongFeatureByCode.has(dongCode))
      .sort((left, right) =>
        descending
          ? right[1].score - left[1].score
          : left[1].score - right[1].score,
      )
      .slice(0, 5);

    listElement.replaceChildren();

    if (ranking.length === 0) {
      const emptyItem = document.createElement("li");
      emptyItem.className = "ranking-empty";
      emptyItem.textContent = "표시할 폭염 취약도 분석 데이터가 없습니다.";
      listElement.append(emptyItem);
      return;
    }

    ranking.forEach(([dongCode, heatData]) => {
      const feature = dongFeatureByCode.get(dongCode);
      const dongInfo = getDongInfo(feature);
      const riskStyle = RISK_STYLES[heatData.riskLevel];
      const item = document.createElement("li");
      const button = document.createElement("button");
      const name = document.createElement("span");
      const meta = document.createElement("span");
      const score = document.createElement("strong");

      item.className = "ranking-item";
      button.className = "ranking-button";
      button.type = "button";
      button.dataset.dongCode = dongCode;
      button.setAttribute(
        "aria-label",
        `${dongInfo.name}, 취약도 ${heatData.score.toFixed(1)}점`,
      );

      name.className = "ranking-name";
      name.textContent = dongInfo.name;
      meta.className = "ranking-meta";
      meta.textContent = `${getDistrictName(feature)} · ${riskStyle.label}`;
      score.className = "ranking-score";
      score.textContent = `${heatData.score.toFixed(1)}점`;

      button.append(name, meta, score);
      item.append(button);
      listElement.append(item);
    });
  }

  function renderRiskRankings() {
    renderRanking(riskRankingList, true);
    renderRanking(lowRiskRankingList, false);
  }

  function getDistrictName(feature) {
    const dongCode = getFeatureValue(feature, ["ADM_CD", "adm_cd", "code"]);
    return DISTRICT_BY_CODE_PREFIX[dongCode.slice(0, 5)] ?? "기타";
  }

  function getRiskLevelForFeature(feature) {
    const dongCode = getFeatureValue(feature, ["ADM_CD", "adm_cd", "code"]);
    return heatDataByDongCode.get(dongCode)?.riskLevel ?? "none";
  }

  function featureMatchesFilters(feature) {
    const districtMatches =
      selectedDistrict === "all" || getDistrictName(feature) === selectedDistrict;
    const riskMatches =
      selectedRiskLevel === "all" ||
      getRiskLevelForFeature(feature) === selectedRiskLevel;

    return districtMatches && riskMatches;
  }

  function applyMapFilters() {
    applyAllDongPolygonStyles();

    if (selectedFeature && !featureMatchesFilters(selectedFeature)) {
      clearSelection();
    } else if (selectedFeature) {
      selectDong(selectedFeature, false);
    }

    const visibleCount = dongFeatures.filter(featureMatchesFilters).length;
    const districtLabel =
      selectedDistrict === "all" ? "대구 전체" : selectedDistrict;
    const riskLabel =
      selectedRiskLevel === "all"
        ? "전체 취약도"
        : RISK_STYLES[selectedRiskLevel].label;

    setStatus(`${districtLabel} · ${riskLabel}: ${visibleCount}개 행정동`);
  }

  /*
   * GeoJSON 좌표를 네이버 지도 좌표로 변환
   *
   * GeoJSON 좌표:
   * [경도, 위도]
   *
   * 네이버 지도 좌표:
   * LatLng(위도, 경도)
   */

  function pointInRing(longitude, latitude, ring) {
    let inside = false;

    for (
      let currentIndex = 0, previousIndex = ring.length - 1;
      currentIndex < ring.length;
      previousIndex = currentIndex, currentIndex += 1
    ) {
      const currentLongitude = Number(ring[currentIndex]?.[0]);
      const currentLatitude = Number(ring[currentIndex]?.[1]);
      const previousLongitude = Number(ring[previousIndex]?.[0]);
      const previousLatitude = Number(ring[previousIndex]?.[1]);

      if (
        !Number.isFinite(currentLongitude) ||
        !Number.isFinite(currentLatitude) ||
        !Number.isFinite(previousLongitude) ||
        !Number.isFinite(previousLatitude)
      ) {
        continue;
      }

      const crossesLatitude =
        currentLatitude > latitude !== previousLatitude > latitude;
      const intersectionLongitude =
        ((previousLongitude - currentLongitude) *
          (latitude - currentLatitude)) /
          (previousLatitude - currentLatitude) +
        currentLongitude;

      if (crossesLatitude && longitude < intersectionLongitude) {
        inside = !inside;
      }
    }

    return inside;
  }

  function pointInPolygon(longitude, latitude, polygonCoordinates) {
    if (
      !Array.isArray(polygonCoordinates) ||
      polygonCoordinates.length === 0 ||
      !pointInRing(longitude, latitude, polygonCoordinates[0])
    ) {
      return false;
    }

    return !polygonCoordinates
      .slice(1)
      .some((hole) => pointInRing(longitude, latitude, hole));
  }

  function geometryContainsPoint(geometry, longitude, latitude) {
    if (geometry?.type === "Polygon") {
      return pointInPolygon(longitude, latitude, geometry.coordinates);
    }

    if (geometry?.type === "MultiPolygon") {
      return geometry.coordinates.some((polygonCoordinates) =>
        pointInPolygon(longitude, latitude, polygonCoordinates),
      );
    }

    return false;
  }

  function findDongFeatureAtCoordinate(coordinate) {
    if (!coordinate) {
      return null;
    }

    const longitude = Number(coordinate.lng());
    const latitude = Number(coordinate.lat());

    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return null;
    }

    for (const [dongCode, geometry] of dongGeometryByCode.entries()) {
      if (geometryContainsPoint(geometry, longitude, latitude)) {
        const feature = dongFeatureByCode.get(dongCode);
        return feature && featureMatchesFilters(feature) ? feature : null;
      }
    }

    return null;
  }

  function coordinateToLatLng(coordinate) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      throw new Error("올바르지 않은 GeoJSON 좌표입니다.");
    }

    const longitude = Number(coordinate[0]);
    const latitude = Number(coordinate[1]);

    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      throw new Error("GeoJSON 좌표가 숫자가 아닙니다.");
    }

    return new naver.maps.LatLng(latitude, longitude);
  }

  function ringToPath(ring) {
    return ring.map(coordinateToLatLng);
  }

  /*
   * Polygon의 좌표 구조를 네이버 Polygon paths로 변환
   *
   * 첫 번째 path: 외곽선
   * 두 번째 이후 path: 내부 구멍
   */

  function polygonCoordinatesToPaths(coordinates) {
    return coordinates.map(ringToPath);
  }

  /*
   * FeatureCollection, Feature, GeometryCollection을 모두 처리해
   * Polygon 또는 MultiPolygon geometry만 반환
   */

  function collectPolygonGeometries(geoJson) {
    const geometries = [];

    function visit(item) {
      if (!item) {
        return;
      }

      if (item.type === "FeatureCollection") {
        item.features.forEach(visit);
        return;
      }

      if (item.type === "Feature") {
        visit(item.geometry);
        return;
      }

      if (item.type === "GeometryCollection") {
        item.geometries.forEach(visit);
        return;
      }

      if (item.type === "Polygon" || item.type === "MultiPolygon") {
        geometries.push(item);
      }
    }

    visit(geoJson);

    return geometries;
  }

  /*
   * Polygon과 MultiPolygon의 각 Polygon 좌표를 반환
   */

  function getPolygonCoordinateGroups(geometry) {
    if (geometry.type === "Polygon") {
      return [geometry.coordinates];
    }

    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates;
    }

    return [];
  }

  /*
   * 대구 외부 마스크
   *
   * map.data가 아니라 별도 Polygon으로 생성합니다.
   * 확대·축소 시 Data Layer가 다시 그려지면서 마스크가 사라지는
   * 현상을 줄이기 위한 구현입니다.
   */

  function createOutsideMask(maskGeoJson) {
    const geometries = collectPolygonGeometries(maskGeoJson);

    if (geometries.length === 0) {
      throw new Error("외부 마스크 GeoJSON에 Polygon이 없습니다.");
    }

    geometries.forEach((geometry) => {
      const polygonGroups = getPolygonCoordinateGroups(geometry);

      polygonGroups.forEach((polygonCoordinates) => {
        const polygon = new naver.maps.Polygon({
          map,
          paths: polygonCoordinatesToPaths(polygonCoordinates),

          fillColor: "#e2e8f0",
          fillOpacity: 0.92,

          strokeColor: "#e2e8f0",
          strokeOpacity: 0,
          strokeWeight: 0,

          clickable: false,
          zIndex: 10,
        });

        maskPolygons.push(polygon);
      });
    });
  }

  /*
   * 대구광역시 전체 외곽선
   */

  function createDaeguBoundary(boundaryGeoJson) {
    const geometries = collectPolygonGeometries(boundaryGeoJson);

    if (geometries.length === 0) {
      throw new Error("대구시 경계 GeoJSON에 Polygon이 없습니다.");
    }

    geometries.forEach((geometry) => {
      const polygonGroups = getPolygonCoordinateGroups(geometry);

      polygonGroups.forEach((polygonCoordinates) => {
        const polygon = new naver.maps.Polygon({
          map,
          paths: polygonCoordinatesToPaths(polygonCoordinates),

          fillColor: "#000000",
          fillOpacity: 0,

          strokeColor: "#0f172a",
          strokeOpacity: 1,
          strokeWeight: 5,

          clickable: false,
          zIndex: 30,
        });

        boundaryPolygons.push(polygon);
      });
    });
  }

  /*
   * 행정동 기본 스타일
   */

  function getAdministrativeDongStyle(feature) {
    return {
      visible: false,
      clickable: false,
    };
  }

  function getDongPolygonStyle(feature) {
    if (!featureMatchesFilters(feature)) {
      return {
        visible: false,
        clickable: false,
      };
    }

    const dongCode = getFeatureValue(feature, ["ADM_CD", "adm_cd", "code"]);
    const heatData = heatDataByDongCode.get(dongCode);
    const riskStyle = RISK_STYLES[heatData?.riskLevel ?? "none"];

    return {
      visible: true,

      fillColor: riskStyle.color,
      // jisu_02_추가수정 / 수정 fillOpacity:
      fillOpacity: vulnerabilityLayerVisible ? (heatData ? 0.72 : 0.28) : 0,
      //
      strokeColor: "#64748b",
      strokeOpacity: administrativeBoundaryVisible ? 0.8 : 0,
      strokeWeight: 1.3,

      clickable: true,
      zIndex: 20,
    };
  }

  function setDongPolygonOptions(dongCode, options) {
    (dongPolygonsByCode.get(dongCode) ?? []).forEach((polygon) => {
      if (polygon.getMap() !== map) {
        polygon.setMap(map);
      }
      polygon.setOptions(options);
    });
  }

  function applyDongPolygonStyle(feature) {
    const dongCode = getFeatureValue(feature, ["ADM_CD", "adm_cd", "code"]);
    setDongPolygonOptions(dongCode, getDongPolygonStyle(feature));
  }

  function applyAllDongPolygonStyles() {
    dongFeatures.forEach(applyDongPolygonStyle);
  }

  map.data.setStyle(getAdministrativeDongStyle);

  /*
   * 행정동 GeoJSON 추가
   */

  function createAdministrativeDongLayer(dongGeoJson) {
    const addedFeatures = map.data.addGeoJson(dongGeoJson);

    if (!Array.isArray(addedFeatures) || addedFeatures.length === 0) {
      throw new Error("행정동 GeoJSON에서 추가된 도형이 없습니다.");
    }

    dongFeatures.push(...addedFeatures);
    addedFeatures.forEach((feature) => {
      const dongCode = getFeatureValue(feature, ["ADM_CD", "adm_cd", "code"]);

      if (dongCode) {
        dongFeatureByCode.set(dongCode, feature);
      }
    });
    (dongGeoJson.features ?? []).forEach((rawFeature) => {
      const dongCode = String(rawFeature?.properties?.ADM_CD ?? "");
      const districtName = DISTRICT_BY_CODE_PREFIX[dongCode.slice(0, 5)];

      if (!districtName) {
        return;
      }

      if (rawFeature?.geometry) {
        dongGeometryByCode.set(dongCode, rawFeature.geometry);
      }

      const feature = dongFeatureByCode.get(dongCode);
      if (feature && rawFeature?.geometry) {
        const polygons = getPolygonCoordinateGroups(rawFeature.geometry).map(
          (polygonCoordinates) => {
            const polygon = new naver.maps.Polygon({
              map,
              paths: polygonCoordinatesToPaths(polygonCoordinates),
              ...getDongPolygonStyle(feature),
            });

            naver.maps.Event.addListener(polygon, "mouseover", (event) => {
              handleDongHover(feature, event.coord);
            });
            naver.maps.Event.addListener(polygon, "mouseout", () => {
              scheduleDongHoverClear();
            });
            naver.maps.Event.addListener(polygon, "click", () => {
              handleDongClick(feature);
            });

            return polygon;
          },
        );
        dongPolygonsByCode.set(dongCode, polygons);
      }

      let districtBounds = districtBoundsByName.get(districtName) ?? null;
      let dongBounds = null;
      const visitCoordinates = (coordinates) => {
        if (
          Array.isArray(coordinates) &&
          coordinates.length >= 2 &&
          Number.isFinite(Number(coordinates[0])) &&
          Number.isFinite(Number(coordinates[1]))
        ) {
          const latLng = new naver.maps.LatLng(
            Number(coordinates[1]),
            Number(coordinates[0]),
          );
          if (districtBounds === null) {
            districtBounds = new naver.maps.LatLngBounds(latLng, latLng);
          } else {
            districtBounds.extend(latLng);
          }
          if (dongBounds === null) {
            dongBounds = new naver.maps.LatLngBounds(latLng, latLng);
          } else {
            dongBounds.extend(latLng);
          }
          return;
        }

        if (Array.isArray(coordinates)) {
          coordinates.forEach(visitCoordinates);
        }
      };

      visitCoordinates(rawFeature?.geometry?.coordinates);
      if (districtBounds !== null) {
        districtBoundsByName.set(districtName, districtBounds);
      }
      if (dongBounds !== null) {
        dongBoundsByCode.set(dongCode, dongBounds);
      }
    });
    setStatus(`행정동 ${addedFeatures.length}개를 지도에 표시했습니다.`);
    console.info(`행정동 ${addedFeatures.length}개를 지도에 표시했습니다.`);
  }

  function getFeatureValue(feature, propertyNames, fallback = "") {
    for (const propertyName of propertyNames) {
      const value = feature.getProperty(propertyName);

      if (value !== undefined && value !== null && value !== "") {
        return String(value);
      }
    }

    return fallback;
  }

  function getDongInfo(feature) {
    return {
      name: getFeatureValue(
        feature,
        ["ADM_NM", "adm_nm", "name"],
        "행정동 이름 없음",
      ),
      code: getFeatureValue(feature, ["ADM_CD", "adm_cd", "code"], "-"),
      baseDate: getFeatureValue(feature, ["BASE_DATE", "base_date"], "-"),
    };
  }

  function formatBaseDate(value) {
    if (!/^\d{8}$/.test(value)) {
      return value;
    }

    return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
  }

  function setStatus(message) {
    if (mapStatus) {
      mapStatus.textContent = message;
    }
  }

  function showPanelMode(mode) {
    if (dongDetails) {
      dongDetails.hidden = mode === "district";
    }

    if (districtDetails) {
      districtDetails.hidden = mode !== "district";
    }

    if (panelEyebrow) {
      panelEyebrow.textContent =
        mode === "district" ? "선택 구·군 요약" : "선택 지역";
    }
  }

  function updateDistrictPanel(districtName) {
    const district = heatDataByDistrict.get(districtName);

    if (!district) {
      clearSelection();
      setStatus(`${districtName}의 분석 요약을 찾을 수 없습니다.`);
      return;
    }

    showPanelMode("district");
    dongNameElement.textContent = districtName;
    districtDetailElements.dongCount.textContent = `${district.dong_count}개`;
    districtDetailElements.averageScore.textContent =
      `${Number(district.score_average).toFixed(1)}점`;
    districtDetailElements.highCount.textContent =
      `${Number(district.critical_count) + Number(district.high_count)}개`;
    districtDetailElements.topDong.textContent =
      `${district.top_vulnerable_dong} · ${Number(
        district.top_vulnerable_score,
      ).toFixed(1)}점`;
    districtDetailElements.bottomDong.textContent =
      `${district.bottom_vulnerable_dong} · ${Number(
        district.bottom_vulnerable_score,
      ).toFixed(1)}점`;
    districtDetailElements.coolingShelters.textContent =
      `${district.cooling_shelter_operating}개`;
    districtDetailElements.shadeShelters.textContent =
      district.shade_shelter_count === null
        ? "자료 없음"
        : `${district.shade_shelter_count}개`;
    districtDetailElements.dataStatus.textContent =
      district.core_data_complete
        ? "6개 지표 완전"
        : `평균 자료 충족률 ${(
            Number(district.component_coverage_average) * 100
          ).toFixed(1)}%`;
    updateIndicatorBreakdown(district.indicators);
  }

  function updateDongPanel(feature) {
    const dongInfo = getDongInfo(feature);
    const heatData = heatDataByDongCode.get(dongInfo.code);
    const riskStyle = RISK_STYLES[heatData?.riskLevel ?? "none"];

    showPanelMode("dong");

    if (dongNameElement) {
      dongNameElement.textContent = dongInfo.name;
    }

    if (dongDistrictElement) {
      dongDistrictElement.textContent = getDistrictName(feature);
    }

    if (dongCodeElement) {
      dongCodeElement.textContent = dongInfo.code;
    }

    if (dongBaseDateElement) {
      dongBaseDateElement.textContent = formatBaseDate(
        heatData ? heatDataBaseDate ?? dongInfo.baseDate : dongInfo.baseDate,
      );
    }

    if (dongRiskLevelElement) {
      dongRiskLevelElement.textContent = riskStyle.label;
      dongRiskLevelElement.style.color = heatData ? riskStyle.color : "";
    }

    if (dongRiskScoreElement) {
      dongRiskScoreElement.textContent = heatData
        ? `${heatData.score.toFixed(1)}점`
        : "-";
    }

    updateIndicatorBreakdown(heatData?.indicators);
  }

  function clearSelectionEffects() {
    if (selectionAnimationFrame !== null) {
      window.cancelAnimationFrame(selectionAnimationFrame);
      selectionAnimationFrame = null;
    }

    [...selectionMaskPolygons, ...selectionHaloPolygons].forEach((polygon) => {
      polygon.setMap(null);
    });
    selectionMaskPolygons.length = 0;
    selectionHaloPolygons.length = 0;
  }

  function applySelectedFeatureStyle(feature, liftProgress = 0) {
    const dongCode = getFeatureValue(feature, ["ADM_CD", "adm_cd", "code"]);
    setDongPolygonOptions(dongCode, {
      visible: true,
      fillColor: "#f97316",
      fillOpacity: 0.5 + liftProgress * 0.18,
      strokeColor: "#7c2d12",
      strokeOpacity: 1,
      strokeWeight: 3.6 + liftProgress * 2.2,
      clickable: true,
      zIndex: 28,
    });
  }

  function animateSelectedFeature(feature) {
    if (selectionAnimationFrame !== null) {
      window.cancelAnimationFrame(selectionAnimationFrame);
    }

    const startedAt = window.performance.now();
    const duration = 520;
    const animate = (currentTime) => {
      const progress = Math.min((currentTime - startedAt) / duration, 1);
      const liftProgress = Math.sin(progress * Math.PI);
      applySelectedFeatureStyle(feature, liftProgress);

      if (progress < 1) {
        selectionAnimationFrame = window.requestAnimationFrame(animate);
      } else {
        selectionAnimationFrame = null;
        applySelectedFeatureStyle(feature);
      }
    };

    selectionAnimationFrame = window.requestAnimationFrame(animate);
  }

  function showSelectionEffects(feature) {
    clearSelectionEffects();
    const dongCode = getFeatureValue(feature, ["ADM_CD", "adm_cd", "code"]);
    const geometry = dongGeometryByCode.get(dongCode);

    if (!geometry) {
      return;
    }

    const polygonGroups = getPolygonCoordinateGroups(geometry);
    const outerPath = [
      new naver.maps.LatLng(35.35, 128.1),
      new naver.maps.LatLng(36.45, 128.1),
      new naver.maps.LatLng(36.45, 129.2),
      new naver.maps.LatLng(35.35, 129.2),
      new naver.maps.LatLng(35.35, 128.1),
    ];
    const selectedOuterPaths = polygonGroups.map(
      (polygonCoordinates) =>
        polygonCoordinatesToPaths(polygonCoordinates)[0],
    );

    const focusMask = new naver.maps.Polygon({
      map,
      paths: [outerPath, ...selectedOuterPaths],
      fillColor: "#e2e8f0",
      fillOpacity: 0.34,
      strokeOpacity: 0,
      strokeWeight: 0,
      clickable: false,
      zIndex: 25,
    });
    selectionMaskPolygons.push(focusMask);

    polygonGroups.forEach((polygonCoordinates) => {
      const halo = new naver.maps.Polygon({
        map,
        paths: polygonCoordinatesToPaths(polygonCoordinates),
        fillColor: "#ffffff",
        fillOpacity: 0.06,
        strokeColor: "#ffffff",
        strokeOpacity: 0.7,
        strokeWeight: 8,
        clickable: false,
        zIndex: 29,
      });
      selectionHaloPolygons.push(halo);
    });
  }

  function selectDong(feature, shouldFocus = true) {
    if (selectedFeature && selectedFeature !== feature) {
      applyDongPolygonStyle(selectedFeature);
    }

    selectedFeature = feature;
    showSelectionEffects(feature);
    animateSelectedFeature(feature);

    const dongInfo = getDongInfo(feature);
    updateDongPanel(feature);

    if (shouldFocus) {
      focusFeature(feature);
    }

    setStatus(`${dongInfo.name}을 선택했습니다.`);
  }

  function focusFeature(feature) {
    const dongCode = getFeatureValue(feature, ["ADM_CD", "adm_cd", "code"]);
    const bounds = dongBoundsByCode.get(dongCode);

    if (bounds) {
      const southWest = bounds.getSW();
      const northEast = bounds.getNE();
      const latitudePadding = Math.max(
        (northEast.lat() - southWest.lat()) * 0.45,
        0.004,
      );
      const longitudePadding = Math.max(
        (northEast.lng() - southWest.lng()) * 0.45,
        0.004,
      );
      const paddedBounds = new naver.maps.LatLngBounds(
        new naver.maps.LatLng(
          southWest.lat() - latitudePadding,
          southWest.lng() - longitudePadding,
        ),
        new naver.maps.LatLng(
          northEast.lat() + latitudePadding,
          northEast.lng() + longitudePadding,
        ),
      );
      const projection = map.getProjection();
      const mapSize = map.getSize();
      const southWestOffset = projection.fromCoordToOffset(
        paddedBounds.getSW(),
      );
      const northEastOffset = projection.fromCoordToOffset(
        paddedBounds.getNE(),
      );
      const boundsWidth = Math.max(
        Math.abs(northEastOffset.x - southWestOffset.x),
        1,
      );
      const boundsHeight = Math.max(
        Math.abs(northEastOffset.y - southWestOffset.y),
        1,
      );
      const availableWidth = Math.max(Number(mapSize.width) - 180, 1);
      const availableHeight = Math.max(Number(mapSize.height) - 180, 1);
      const fitRatio = Math.min(
        availableWidth / boundsWidth,
        availableHeight / boundsHeight,
      );
      const fittedZoom =
        map.getZoom() + Math.floor(Math.log2(Math.max(fitRatio, 0.001)));
      const targetZoom = Math.min(
        Number(map.getOptions("maxZoom")),
        Math.max(MIN_SELECTION_ZOOM, fittedZoom),
      );

      map.stop();
      map.setZoom(targetZoom, false);
      map.panTo(paddedBounds.getCenter(), {
        duration: 520,
        easing: "easeOutCubic",
      });
    }
  }

  function focusDistrict(districtName) {
    const bounds = districtBoundsByName.get(districtName);

    if (bounds) {
      map.fitBounds(bounds, 60);
    }
  }

  function selectDistrict(districtName) {
    clearDongHover();
    clearSelection();
    selectedDistrict = districtName;

    if (districtFilter) {
      districtFilter.value = districtName;
    }

    applyMapFilters();

    if (districtName === "all") {
      return;
    }

    updateDistrictPanel(districtName);
    focusDistrict(districtName);
    setStatus(`선택 구·군: ${districtName}`);
  }

  function clearSelection() {
    clearSelectionEffects();

    if (selectedFeature) {
      applyDongPolygonStyle(selectedFeature);
      selectedFeature = null;
    }

    showPanelMode("dong");

    if (dongNameElement) {
      dongNameElement.textContent = "행정동을 선택하세요";
    }

    if (dongDistrictElement) {
      dongDistrictElement.textContent = "-";
    }

    if (dongCodeElement) {
      dongCodeElement.textContent = "-";
    }

    if (dongBaseDateElement) {
      dongBaseDateElement.textContent = "-";
    }

    if (dongRiskLevelElement) {
      dongRiskLevelElement.textContent = "데이터 없음";
      dongRiskLevelElement.style.color = "";
    }

    if (dongRiskScoreElement) {
      dongRiskScoreElement.textContent = "-";
    }

    updateIndicatorBreakdown();
  }

  function searchDong() {
    const query = searchInput?.value.trim().toLocaleLowerCase("ko-KR") ?? "";

    if (!query) {
      setStatus("검색할 행정동 이름을 입력해주세요.");
      searchInput?.focus();
      return;
    }

    const feature = dongFeatures.find(
      (candidate) =>
        featureMatchesFilters(candidate) &&
        getDongInfo(candidate).name.toLocaleLowerCase("ko-KR").includes(query),
    );

    if (!feature) {
      setStatus(
        `"${searchInput.value.trim()}"에 해당하는 행정동이 현재 필터에 없습니다.`,
      );
      return;
    }

    selectDong(feature);
  }

  /*
   * 행정동 마우스 오버
   */

  function handleDongHover(feature, coordinate) {
    if (
      !feature ||
      feature.getProperty("layer_type") !== "administrative_dong"
    ) {
      return;
    }

    if (dongHoverLeaveTimer !== null) {
      window.clearTimeout(dongHoverLeaveTimer);
      dongHoverLeaveTimer = null;
    }

    highlightDong(feature);
    if (coordinate) {
      hoverInfoWindow.setContent(createHoverTooltip(feature));
      hoverInfoWindow.open(map, coordinate);
    }
    mapElement.style.cursor = "pointer";
  }

  function scheduleDongHoverClear() {
    if (dongHoverLeaveTimer !== null) {
      window.clearTimeout(dongHoverLeaveTimer);
    }

    dongHoverLeaveTimer = window.setTimeout(() => {
      dongHoverLeaveTimer = null;
      clearDongHover();
    }, 90);
  }

  function handleDongClick(feature) {
    if (
      !feature ||
      feature.getProperty("layer_type") !== "administrative_dong"
    ) {
      return;
    }

    const dongInfo = getDongInfo(feature);
    const handledAt = Date.now();
    if (
      dongInfo.code === lastHandledDongClickCode &&
      handledAt - lastHandledDongClickAt < 150
    ) {
      return;
    }
    lastHandledDongClickCode = dongInfo.code;
    lastHandledDongClickAt = handledAt;
    hoverInfoWindow.close();
    clearDongHover();
    selectDong(feature);
    console.info("선택한 행정동:", {
      name: dongInfo.name,
      code: dongInfo.code,
    });
  }

  map.data.addListener("mouseover", (event) => {
    handleDongHover(event.feature, event.coord);
  });

  /*
   * 행정동 마우스 아웃
   */

  map.data.addListener("mouseout", (event) => {
    const feature = event.feature;
    const layerType = feature.getProperty("layer_type");

    if (layerType !== "administrative_dong") {
      return;
    }

    scheduleDongHoverClear();
  });

  /*
   * 행정동 클릭
   *
   * 현재는 콘솔에 정보를 출력합니다.
   * 이후 폭염·침수 취약도 API와 연결할 때 사용할 수 있습니다.
   */

  map.data.addListener("click", (event) => {
    const feature = event.feature;
    const layerType = feature.getProperty("layer_type");

    if (layerType !== "administrative_dong") {
      return;
    }

    handleDongClick(feature);
  });

  /*
   * 상위 Polygon 오버레이가 Data Layer 이벤트를 가리는 환경을 위한
   * 지도 좌표 기반 hover·click 보조 처리
   */

  naver.maps.Event.addListener(map, "mousemove", (event) => {
    const feature = findDongFeatureAtCoordinate(event.coord);

    if (feature) {
      handleDongHover(feature, event.coord);
    } else {
      scheduleDongHoverClear();
    }
  });

  naver.maps.Event.addListener(map, "click", (event) => {
    if (Date.now() - lastHandledDongClickAt < 150) {
      return;
    }

    const feature =
      hoveredDongFeature ??
      findDongFeatureAtCoordinate(event.coord);

    if (feature) {
      handleDongClick(feature);
    }
  });

  mapElement.addEventListener("mouseleave", scheduleDongHoverClear);

  searchButton?.addEventListener("click", searchDong);

  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchDong();
    }
  });

  resetButton?.addEventListener("click", () => {
    clearDongHover();
    clearSelection();

    if (searchInput) {
      searchInput.value = "";
    }

    selectedDistrict = "all";
    selectedRiskLevel = "all";

    if (districtFilter) {
      districtFilter.value = "all";
    }

    if (riskFilter) {
      riskFilter.value = "all";
    }

    applyAllDongPolygonStyles();
    map.setCenter(DAEGU_CENTER);
    map.setZoom(INITIAL_ZOOM);
    setStatus("지도를 초기 상태로 되돌렸습니다.");
  });

  districtFilter?.addEventListener("change", () => {
    selectDistrict(districtFilter.value);
  });

  riskFilter?.addEventListener("change", () => {
    selectedRiskLevel = riskFilter.value;
    applyMapFilters();
  });

  function handleRankingClick(event) {
    const rankingButton = event.target.closest("button[data-dong-code]");
    const listElement = event.currentTarget;

    if (!rankingButton || !listElement.contains(rankingButton)) {
      return;
    }

    const feature = dongFeatureByCode.get(rankingButton.dataset.dongCode);

    if (!feature) {
      return;
    }

    selectedDistrict = "all";
    selectedRiskLevel = "all";

    if (districtFilter) {
      districtFilter.value = "all";
    }

    if (riskFilter) {
      riskFilter.value = "all";
    }

    applyAllDongPolygonStyles();
    selectDong(feature);
  }

  riskRankingList?.addEventListener("click", handleRankingClick);
  lowRiskRankingList?.addEventListener("click", handleRankingClick);

  boundaryToggle?.addEventListener("change", () => {
    administrativeBoundaryVisible = boundaryToggle.checked;
    applyAllDongPolygonStyles();

    if (selectedFeature) {
      showSelectionEffects(selectedFeature);
      applySelectedFeatureStyle(selectedFeature);
    }

    setStatus(
      administrativeBoundaryVisible
        ? "행정동 경계를 표시합니다."
        : "행정동 경계를 숨겼습니다.",
    );
  });

  // jisu_02_추가 / 체크박스 이벤트 추가
  vulnerabilityToggle?.addEventListener("change", () => {
    // 체크 상태를 저장하고 모든 행정동 채움색을 다시 계산한다.
    vulnerabilityLayerVisible = vulnerabilityToggle.checked;
    applyAllDongPolygonStyles();

    // 전체 스타일 갱신으로 선택 효과가 사라지지 않게 다시 적용한다.
    if (selectedFeature) {
      showSelectionEffects(selectedFeature);
      applySelectedFeatureStyle(selectedFeature);
    }

    setStatus(
      vulnerabilityLayerVisible
        ? "폭염 취약도 색상을 표시합니다."
        : "폭염 취약도 색상을 숨겼습니다.",
    );
  });

  /*
   * 확대·축소 후 오버레이 상태 보정
   */

  function restorePolygonOverlays() {
    applyAllDongPolygonStyles();

    if (selectedFeature) {
      applySelectedFeatureStyle(selectedFeature);
    }

    maskPolygons.forEach((polygon) => {
      if (polygon.getMap() !== map) {
        polygon.setMap(map);
      }

      polygon.setOptions({
        fillColor: "#e2e8f0",
        fillOpacity: 0.92,
        strokeOpacity: 0,
        zIndex: 10,
      });
    });

    boundaryPolygons.forEach((polygon) => {
      if (polygon.getMap() !== map) {
        polygon.setMap(map);
      }

      polygon.setOptions({
        fillOpacity: 0,
        strokeColor: "#0f172a",
        strokeOpacity: 1,
        strokeWeight: 5,
        zIndex: 30,
      });
    });

    selectionMaskPolygons.forEach((polygon) => {
      if (polygon.getMap() !== map) {
        polygon.setMap(map);
      }
      polygon.setOptions({
        fillColor: "#e2e8f0",
        fillOpacity: 0.34,
        strokeOpacity: 0,
        zIndex: 25,
      });
    });

    selectionHaloPolygons.forEach((polygon) => {
      if (polygon.getMap() !== map) {
        polygon.setMap(map);
      }
      polygon.setOptions({
        fillColor: "#ffffff",
        fillOpacity: 0.06,
        strokeColor: "#ffffff",
        strokeOpacity: 0.7,
        strokeWeight: 8,
        zIndex: 29,
      });
    });
  }

  let redrawFrame = null;

  function scheduleOverlayRestore() {
    if (redrawFrame !== null) {
      cancelAnimationFrame(redrawFrame);
    }

    redrawFrame = requestAnimationFrame(() => {
      redrawFrame = requestAnimationFrame(() => {
        restorePolygonOverlays();
        redrawFrame = null;
      });
    });
  }

  naver.maps.Event.addListener(map, "zoom_changed", () => {
    clearDongHover();
  });

  naver.maps.Event.addListener(map, "idle", () => {
    scheduleOverlayRestore();
  });

  naver.maps.Event.addListener(map, "dragstart", () => {
    hoverInfoWindow.close();
  });

  function setZoomWithoutTransition(nextZoom) {
    const boundedZoom = Math.min(
      Number(map.getOptions("maxZoom")),
      Math.max(Number(map.getOptions("minZoom")), nextZoom),
    );

    if (boundedZoom !== map.getZoom()) {
      map.setZoom(boundedZoom, false);
    }
  }

  zoomInButton.addEventListener("click", () => {
    setZoomWithoutTransition(map.getZoom() + 1);
  });

  zoomOutButton.addEventListener("click", () => {
    setZoomWithoutTransition(map.getZoom() - 1);
  });

  let wheelZoomLocked = false;
  mapElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      if (wheelZoomLocked || Math.abs(event.deltaY) < 2) {
        return;
      }

      wheelZoomLocked = true;
      setZoomWithoutTransition(map.getZoom() + (event.deltaY < 0 ? 1 : -1));
      window.setTimeout(() => {
        wheelZoomLocked = false;
      }, 90);
    },
    { passive: false },
  );

  /*
   * 브라우저 크기가 바뀌었을 때 지도 크기 재계산
   */

  let resizeTimer = null;

  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);

    resizeTimer = window.setTimeout(() => {
      if (window.naver?.maps?.Event) {
        window.naver.maps.Event.trigger(map, "resize");
      }
      scheduleOverlayRestore();
    }, 150);
  });

  /*
   * 전체 지도 레이어 초기화
   */

  async function initializeDaeguMap() {
    try {
      const [dongGeoJson, boundaryGeoJson, outsideMaskGeoJson, heatPayload] =
        await Promise.all([
          loadGeoJson(GEOJSON_FILES.administrativeDong),
          loadGeoJson(GEOJSON_FILES.boundary),
          loadGeoJson(GEOJSON_FILES.outsideMask),
          loadHeatData().catch((error) => {
            console.error("폭염 취약도 데이터 로딩 실패:", error);

            return {
              status: "error",
              records: [],
              message: "폭염 취약도 데이터를 불러오지 못했습니다.",
            };
          }),
        ]);

      // 외부 마스크를 가장 먼저 생성
      createOutsideMask(outsideMaskGeoJson);

      // 행정동 경계 생성
      createAdministrativeDongLayer(dongGeoJson);
      applyAllDongPolygonStyles();

      // 대구 전체 외곽선을 마지막에 생성해 가장 위에 표시
      createDaeguBoundary(boundaryGeoJson);

      restorePolygonOverlays();
      updateAnalysisSummary(heatPayload);
      renderRiskRankings();

      if (analysisPlaceholder) {
        analysisPlaceholder.textContent =
          heatPayload.status === "ready" && heatDataByDongCode.size > 0
            ? `${heatDataByDongCode.size}개 행정동의 폭염 취약도 분석 결과를 표시 중입니다.`
            : heatPayload.message ?? "폭염 취약도 데이터를 준비 중입니다.";
      }

      console.info("대구광역시 지도 레이어 초기화가 완료됐습니다.");
    } catch (error) {
      console.error("대구광역시 지도 초기화 실패:", error);

      mapElement.insertAdjacentHTML(
        "beforeend",
        `
          <div
            style="
              position:absolute;
              top:16px;
              left:50%;
              z-index:1000;
              max-width:90%;
              padding:12px 16px;
              color:#991b1b;
              background:#fee2e2;
              border:1px solid #fecaca;
              border-radius:8px;
              transform:translateX(-50%);
              box-shadow:0 4px 12px rgb(15 23 42 / 15%);
            "
          >
            지도 경계 데이터를 불러오지 못했습니다.
            브라우저 개발자 도구의 Console과 Network를 확인해주세요.
          </div>
        `,
      );
    }
  }

  initializeDaeguMap();
})();
