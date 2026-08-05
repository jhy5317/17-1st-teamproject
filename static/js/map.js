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
  const searchResults = document.getElementById("dong-search-results");
  const searchButton = document.getElementById("search-button");
  const resetButton = document.getElementById("reset-button");
  const districtFilter = document.getElementById("district-filter");
  const riskFilter = document.getElementById("risk-filter");
  const boundaryToggle = document.getElementById("boundary-toggle");
  const openSearchButton = document.getElementById("open-search-btn");
  const closeSearchButton = document.getElementById("close-search-btn");
  const searchPopupPanel = document.getElementById("search-popup-panel");
  const headerMenuButton = document.getElementById("header-menu-button");
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
  const riskRankingList = document.getElementById("risk-ranking-list");
  const lowRiskRankingList = document.getElementById("low-risk-ranking-list");
  const districtChartPanel = document.getElementById("district-chart-panel");
  const districtChartBackdrop = document.getElementById(
    "district-chart-backdrop",
  );
  const districtChartClose = document.getElementById("district-chart-close");
  const districtAverageChart = document.getElementById(
    "district-average-chart",
  );
  const districtChartReset = document.getElementById("district-chart-reset");

  //jisu_03_추가 / 팝업 / HTML 요소 참조 추가
  const dongPanel = document.getElementById("dong-panel");

  const selectedHeatAlert = document.getElementById("selected-heat-alert");
  const selectedHeatAlertTitle = document.getElementById(
    "selected-heat-alert-title",
  );
  const selectedHeatAlertMessage = document.getElementById(
    "selected-heat-alert-message",
  );

  const weatherSource = document.getElementById("weather-source");
  const weatherMessage = document.getElementById("weather-message");
  const weatherCondition = document.getElementById("weather-condition");
  const weatherTemperature = document.getElementById("weather-temperature");
  const weatherHumidity = document.getElementById("weather-humidity");
  const weatherFeelsLike = document.getElementById("weather-feels-like");
  const weatherWind = document.getElementById("weather-wind");
  const weatherRainfall = document.getElementById("weather-rainfall");

  const regionPopup = document.getElementById("region-popup");
  const regionPopupClose = document.getElementById("region-popup-close");
  const regionPopupLocation = document.getElementById("region-popup-location");
  const regionPopupTitle = document.getElementById("region-popup-title");
  const regionPopupRisk = document.getElementById("region-popup-risk");
  const regionPopupScore = document.getElementById("region-popup-score");
  // jisu_03_추가수정 / 팝업 /
  const regionPopupMapElement = document.getElementById("region-popup-map");
  //

  const regionPopupWeatherSource = document.getElementById(
    "region-popup-weather-source",
  );
  //jisu_07_추가수정 / 현재 시간 및 기준
  const regionPopupWeatherTitle = document.getElementById(
    "region-popup-weather-title",
  );
  //
  const regionPopupWeatherCondition = document.getElementById(
    "region-popup-weather-condition",
  );
  const regionPopupWeatherTemperature = document.getElementById(
    "region-popup-weather-temperature",
  );
  const regionPopupWeatherHumidity = document.getElementById(
    "region-popup-weather-humidity",
  );
  const regionPopupWeatherFeelsLike = document.getElementById(
    "region-popup-weather-feels-like",
  );

  const regionPopupShelterCount = document.getElementById(
    "region-popup-shelter-count",
  );
  const regionPopupShelterMessage = document.getElementById(
    "region-popup-shelter-message",
  );
  const regionPopupShelterList = document.getElementById(
    "region-popup-shelter-list",
  );
  //
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
    low: { label: "낮음", color: "#ffedc7" },
    moderate: { label: "보통", color: "#ffa6a6" },
    high: { label: "높음", color: "#ff7070" },
    critical: { label: "매우 높음", color: "#e73f3f" },
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
  let searchRenderTimer = null;
  let latestSearchRequestToken = 0;

  // jisu_03_추가 / 팝업 / 상태값 추가
  // 팝업에서 현재 선택한 행정동과 비동기 요청 순서를 관리한다.
  let regionPopupDongCode = null;
  let selectedRegionRequestId = 0;

  // 팝업 전용 네이버 지도와 행정동 경계 도형을 보관한다.
  let regionPopupMap = null;
  const regionPopupBoundaryPolygons = [];
  //

  // jisu_08_추가 / 팝업 쉼터 데이터와 지도 마커
  let regionPopupShelterRecords = [];
  const regionPopupShelterMarkers = [];

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
      throw new Error(
        `${response.status} ${response.statusText}: ${HEAT_DATA_URL}`,
      );
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
      .slice(0, 3);

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

  function getDistrictRiskLevel(score) {
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

  function renderDistrictAverageChart() {
    if (!districtAverageChart) {
      return;
    }

    const districts = [...heatDataByDistrict.entries()]
      .map(([districtName, district]) => ({
        name: districtName,
        score: Number(district.score_average),
      }))
      .filter((district) => Number.isFinite(district.score))
      .sort((left, right) => right.score - left.score);

    districtAverageChart.replaceChildren();

    if (districts.length === 0) {
      const empty = document.createElement("p");
      empty.className = "district-chart-empty";
      empty.textContent = "표시할 구·군 평균 취약도 데이터가 없습니다.";
      districtAverageChart.append(empty);
      return;
    }

    districts.forEach((district, index) => {
      const riskLevel = getDistrictRiskLevel(district.score);
      const riskStyle = RISK_STYLES[riskLevel];
      const button = document.createElement("button");
      const header = document.createElement("span");
      const rank = document.createElement("span");
      const name = document.createElement("strong");
      const score = document.createElement("span");
      const track = document.createElement("span");
      const bar = document.createElement("span");

      button.type = "button";
      button.className = "district-chart-row";
      button.dataset.district = district.name;
      button.setAttribute("role", "listitem");
      button.setAttribute(
        "aria-label",
        `${district.name}, 평균 취약도 ${district.score.toFixed(1)}점`,
      );

      header.className = "district-chart-row-header";
      rank.className = "district-chart-rank";
      rank.textContent = String(index + 1);
      name.className = "district-chart-name";
      name.textContent = district.name;
      score.className = "district-chart-score";
      score.textContent = `${district.score.toFixed(1)}점`;
      score.style.color = riskStyle.color;

      track.className = "district-chart-track";
      bar.className = "district-chart-bar";
      bar.style.width = `${Math.max(0, Math.min(100, district.score))}%`;
      bar.style.backgroundColor = riskStyle.color;

      header.append(rank, name, score);
      track.append(bar);
      button.append(header, track);
      districtAverageChart.append(button);
    });
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
      selectedDistrict === "all" ||
      getDistrictName(feature) === selectedDistrict;
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
    districtDetailElements.averageScore.textContent = `${Number(district.score_average).toFixed(1)}점`;
    districtDetailElements.highCount.textContent = `${Number(district.critical_count) + Number(district.high_count)}개`;
    districtDetailElements.topDong.textContent = `${district.top_vulnerable_dong} · ${Number(
      district.top_vulnerable_score,
    ).toFixed(1)}점`;
    districtDetailElements.bottomDong.textContent = `${district.bottom_vulnerable_dong} · ${Number(
      district.bottom_vulnerable_score,
    ).toFixed(1)}점`;
    districtDetailElements.coolingShelters.textContent = `${district.cooling_shelter_operating}개`;
    districtDetailElements.shadeShelters.textContent =
      district.shade_shelter_count === null
        ? "자료 없음"
        : `${district.shade_shelter_count}개`;
    districtDetailElements.dataStatus.textContent = district.core_data_complete
      ? "6개 지표 완전"
      : `평균 자료 충족률 ${(
          Number(district.component_coverage_average) * 100
        ).toFixed(1)}%`;
    updateIndicatorBreakdown(district.indicators);
  }
  /**/
  // API 숫자값만 단위와 함께 표시하고 누락·비정상 값은 하이픈으로 통일한다.
  function formatMetric(value, suffix = "") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? `${numericValue}${suffix}` : "-";
  }

  // 새 지역을 조회하기 전 패널과 팝업의 이전 날씨 값을 초기 상태로 되돌린다.
  function resetWeatherPanel(message = "행정동을 선택하면 조회합니다.") {
    weatherSource.textContent = "지역 선택 후 조회";
    weatherMessage.textContent = message;
    weatherCondition.textContent = "-";
    weatherTemperature.textContent = "-";
    weatherHumidity.textContent = "-";
    weatherFeelsLike.textContent = "-";
    weatherWind.textContent = "-";
    weatherRainfall.textContent = "-";
    if (regionPopupWeatherSource) {
      regionPopupWeatherSource.textContent = "조회 중";
      // jisu_07_추가수정 / 현재 시간 및 기준
      regionPopupWeatherTitle.textContent = message;
      //
      regionPopupWeatherCondition.textContent = "-";
      regionPopupWeatherTemperature.textContent = "-";
      regionPopupWeatherHumidity.textContent = "-";
      regionPopupWeatherFeelsLike.textContent = "-";
    }
  }

  // 서버에서 정규화한 날씨를 패널과 상세 팝업에 함께 채운다.
  async function updateWeatherPanel(dongCode, requestId) {
    resetWeatherPanel("실시간 날씨를 조회하고 있습니다.");
    try {
      const response = await fetch(
        `/api/weather/${encodeURIComponent(dongCode)}`,
      );
      if (!response.ok) {
        throw new Error(`날씨 API HTTP ${response.status}`);
      }
      const weather = await response.json();
      if (!weather || typeof weather !== "object" || Array.isArray(weather)) {
        throw new Error("날씨 API 응답 형식이 올바르지 않습니다.");
      }

      if (requestId !== selectedRegionRequestId) {
        return;
      }

      weatherSource.textContent = weather.source ?? "날씨 정보";

      // jisu_07_추가수정 / 현재 시간 및 기준
      //
      // DB의 최신 정시 자료가 없어서 이전 자료를 반환한 경우 관측시각과
      // 지연 안내를 함께 표시해 사용자가 현재값으로 오해하지 않게 한다.
      // 관측시각을 오늘(화) 15:00 형식으로 표시한다.
      function formatWeatherObservedAt(value) {
        if (!value) {
          return "현재";
        }

        const observedDate = new Date(value);

        if (Number.isNaN(observedDate.getTime())) {
          return "현재";
        }

        const getDateParts = (date) => {
          const parts = new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).formatToParts(date);

          return Object.fromEntries(
            parts
              .filter((part) => part.type !== "literal")
              .map((part) => [part.type, part.value]),
          );
        };

        const observed = getDateParts(observedDate);
        const today = getDateParts(new Date());

        const isToday =
          observed.year === today.year &&
          observed.month === today.month &&
          observed.day === today.day;

        const dateText = isToday
          ? `오늘(${observed.weekday})`
          : `${observed.month}/${observed.day}(${observed.weekday})`;

        return `${dateText} ${observed.hour}:${observed.minute}`;
      }

      const observedAtText = formatWeatherObservedAt(weather.observedAt);

      const weatherTimeMessage =
        weather.status === "ready"
          ? `${observedAtText} 기준${
              weather.isStale && weather.message ? ` · ${weather.message}` : ""
            }`
          : weather.message;
      weatherMessage.textContent = weatherTimeMessage;
      weatherCondition.textContent = weather.condition ?? "-";
      weatherTemperature.textContent = formatMetric(weather.temperature, "℃");
      weatherHumidity.textContent = formatMetric(weather.humidity, "%");
      weatherFeelsLike.textContent = formatMetric(weather.feelsLike, "℃");
      weatherWind.textContent = formatMetric(weather.windSpeed, "m/s");
      weatherRainfall.textContent = formatMetric(weather.precipitation1h, "mm");
      if (regionPopupWeatherSource) {
        regionPopupWeatherSource.textContent = weather.source ?? "날씨 정보";
        // jisu_07_추가수정 / 현재 시간 및 기준
        regionPopupWeatherTitle.textContent =
          weather.status === "ready"
            ? `${observedAtText} 기준`
            : (weather.message ?? "날씨 정보 없음");
        //
        regionPopupWeatherCondition.textContent = weather.condition ?? "-";
        regionPopupWeatherTemperature.textContent = formatMetric(
          weather.temperature,
          "℃",
        );
        regionPopupWeatherHumidity.textContent = formatMetric(
          weather.humidity,
          "%",
        );
        regionPopupWeatherFeelsLike.textContent = formatMetric(
          weather.feelsLike,
          "℃",
        );
      }
    } catch (error) {
      console.error("날씨 조회 실패:", error);
      if (requestId === selectedRegionRequestId) {
        resetWeatherPanel("날씨 정보를 불러오지 못했습니다.");
      }
    }
  }

  /*jisu_03_추가 / 팝업 / 같은 위치에 실제 지도 함수 추가 */
  /*
   * 팝업 내부에 별도의 네이버 지도를 만들고,
   * 선택한 행정동 경계가 지도 영역에 맞게 보이도록 확대한다.
   */
  function renderRegionPopupMap(dongCode) {
    if (!regionPopupMapElement) {
      return;
    }

    const geometry = dongGeometryByCode.get(dongCode);
    const bounds = dongBoundsByCode.get(dongCode);

    if (!geometry || !bounds) {
      return;
    }

    // 팝업 지도는 최초 한 번만 생성하고 이후에는 재사용한다.
    if (!regionPopupMap) {
      regionPopupMap = new naver.maps.Map(regionPopupMapElement, {
        center: bounds.getCenter(),
        zoom: 14,
        minZoom: 10,
        maxZoom: 18,

        draggable: true,
        scrollWheel: true,
        pinchZoom: true,
        keyboardShortcuts: false,

        zoomControl: true,
        mapTypeControl: false,
        mapDataControl: false,
        scaleControl: false,
      });
    }

    // 이전에 선택했던 행정동 경계를 제거한다.
    regionPopupBoundaryPolygons
      .splice(0)
      .forEach((polygon) => polygon.setMap(null));

    // 선택한 행정동의 Polygon 또는 MultiPolygon만 표시한다.
    getPolygonCoordinateGroups(geometry).forEach((polygonCoordinates) => {
      const polygon = new naver.maps.Polygon({
        map: regionPopupMap,
        paths: polygonCoordinatesToPaths(polygonCoordinates),
        // jisu_10_추가수정 / 팝업 지도 속 행정동 색상만 낮음 색상으로 통일//
        // 팝업 지도 경계는 실제 위험도와 관계없이 '낮음' 색상으로 표시한다.
        fillColor: RISK_STYLES.low.color,
        fillOpacity: 0.48,
        strokeColor: "#1e3a8a",
        strokeOpacity: 1,
        strokeWeight: 3,
        clickable: false,
        zIndex: 10,
      });

      regionPopupBoundaryPolygons.push(polygon);
    });

    // jisu_08_추가 / 무더위 쉼터
    // 선택 행정동 경계 안의 쉼터를 팝업 지도에 표시한다.
    renderRegionPopupShelterMarkers(regionPopupShelterRecords);

    // 팝업이 열린 후 지도 크기를 다시 계산하고 행정동 경계에 맞춘다.
    window.requestAnimationFrame(() => {
      naver.maps.Event.trigger(regionPopupMap, "resize");
      regionPopupMap.fitBounds(bounds, 32);
    });
  }

  // 03 -> jisu_08_추가수정 / 무더위 쉼터-----------------------------------------//
  // 외부 쉼터 문자열이 HTML 태그로 실행되지 않도록 변환한다.
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // 이전에 표시한 팝업 쉼터 마커를 제거한다.
  function clearRegionPopupShelterMarkers() {
    regionPopupShelterMarkers
      .splice(0)
      .forEach((marker) => marker.setMap(null));
  }

  // tg 추가 / 마커를 클릭했을 때 같은 순번의 무더위쉼터 목록 항목으로 이동하고 강조한다.
  function focusPopupShelterListItem(shelterIndex) {
    if (!regionPopupShelterList) {
      return;
    }

    const shelterItems = regionPopupShelterList.querySelectorAll(
      ".region-popup-shelter-item",
    );
    const targetItem = shelterItems[shelterIndex];

    if (!targetItem) {
      return;
    }

    shelterItems.forEach((item) =>
      item.classList.remove("region-popup-shelter-item-selected"),
    );
    targetItem.classList.add("region-popup-shelter-item-selected");
    targetItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // 선택 행정동의 쉼터를 팝업 네이버 지도에 표시한다.
  function renderRegionPopupShelterMarkers(shelters) {
    clearRegionPopupShelterMarkers();

    if (!regionPopupMap) {
      return;
    }

    // tg 수정 / 마커와 목록 항목을 같은 배열 순번으로 연결하기 위해 index를 함께 사용한다.
    shelters.forEach((shelter, shelterIndex) => {
      const latitude = Number(shelter.latitude);
      const longitude = Number(shelter.longitude);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return;
      }

      const marker = new naver.maps.Marker({
        map: regionPopupMap,
        position: new naver.maps.LatLng(latitude, longitude),
        title: shelter.name ?? "무더위쉼터",
        icon: {
          content: '<div class="region-popup-shelter-marker"></div>',
          anchor: new naver.maps.Point(9, 9),
        },
        zIndex: 30,
      });

      // tg 추가 / 파란 마커 클릭 시 해당 무더위쉼터 목록 항목을 표시한다.
      naver.maps.Event.addListener(marker, "click", () => {
        focusPopupShelterListItem(shelterIndex);
      });

      regionPopupShelterMarkers.push(marker);
    });
  }

  // 팝업의 쉼터 개수와 목록을 초기 상태로 되돌린다.
  function resetPopupShelters() {
    regionPopupShelterRecords = [];
    clearRegionPopupShelterMarkers();

    if (regionPopupShelterCount) {
      regionPopupShelterCount.textContent = "조회 중";
    }

    if (regionPopupShelterMessage) {
      regionPopupShelterMessage.textContent =
        "선택 경계 내부 쉼터를 조회하고 있습니다.";
    }

    if (regionPopupShelterList) {
      regionPopupShelterList.innerHTML = "";
    }
  }

  // jisu_09_추가 / 쉼터 운영요일을 짧게 표시한다.----------------//
  function formatShelterOperationDays(value) {
    const days = String(value ?? "").replaceAll(" ", "");

    if (days === "월,화,수,목,금,토,일") {
      return "매일";
    }

    if (days === "월,화,수,목,금") {
      return "평일";
    }

    return days ? days.replaceAll(",", "·") : "요일 정보 없음";
  }
  //----------------------------------------------------------//

  // 선택 행정동의 쉼터 이름과 주소를 팝업에 표시한다.
  function renderPopupShelterList(shelters) {
    if (!regionPopupShelterList) {
      return;
    }

    if (shelters.length === 0) {
      regionPopupShelterList.innerHTML =
        '<li class="region-popup-shelter-empty">표시할 무더위쉼터가 없습니다.</li>';
      return;
    }

    /*jisu_09_추가 / 쉼터 / 목록에 운영요일·시간 추가 */
    // tg 수정 / 기존 8개 제한(.slice(0, 8))을 제거해 조회된 쉼터를 모두 표시한다.
    // tg 추가 / 마커와 연결할 수 있도록 각 목록 항목에 동일한 순번과 전용 클래스를 부여한다.
    regionPopupShelterList.innerHTML = shelters
      .map(
        (shelter, shelterIndex) => `
        <li class="region-popup-shelter-item" data-shelter-index="${shelterIndex}">
          <strong>${escapeHtml(shelter.name ?? "무더위쉼터")}</strong>
          <span>${escapeHtml(shelter.address ?? "주소 정보 없음")}</span>
          <span class="region-popup-shelter-schedule">
            ${escapeHtml(formatShelterOperationDays(shelter.operationDays))}
            · ${escapeHtml(shelter.openTime ?? "시간 정보 없음")}
          </span>
        </li>
      `,
      )
      .join("");
  }

  // 선택 행정동 경계 안의 무더위쉼터를 서버에서 조회한다.
  async function updateShelters(dongCode, requestId) {
    if (
      !regionPopup ||
      regionPopup.hidden ||
      regionPopupDongCode !== dongCode
    ) {
      return;
    }

    resetPopupShelters();

    try {
      const response = await fetch(
        `/api/shelters?regionCode=${encodeURIComponent(dongCode)}`,
      );

      if (!response.ok) {
        throw new Error(`쉼터 API HTTP ${response.status}`);
      }

      const payload = await response.json();

      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("쉼터 API 응답 형식이 올바르지 않습니다.");
      }

      if (
        requestId !== selectedRegionRequestId ||
        regionPopupDongCode !== dongCode
      ) {
        return;
      }

      const shelters = Array.isArray(payload.shelters) ? payload.shelters : [];

      regionPopupShelterRecords = shelters;

      regionPopupShelterCount.textContent = `${shelters.length}곳`;
      regionPopupShelterMessage.textContent =
        payload.message ?? "선택 행정동 안의 무더위쉼터 정보입니다.";

      renderPopupShelterList(shelters);

      // 쉼터 응답이 도착한 뒤 경계와 마커를 함께 다시 표시한다.
      renderRegionPopupMap(dongCode);
    } catch (error) {
      console.error("쉼터 조회 실패:", error);

      if (requestId === selectedRegionRequestId) {
        regionPopupShelterCount.textContent = "조회 실패";
        regionPopupShelterMessage.textContent =
          "쉼터 정보를 불러오지 못했습니다.";
        renderPopupShelterList([]);
        clearRegionPopupShelterMarkers();
      }
    }
  }
  //--------------------------------------------------------------------------------//

  // jisu_03_추가 / 팝업 / 폭염특보 함수
  // 지역 변경·특보 없음·팝업 종료 시 이전 특보를 숨긴다.
  function hideSelectedHeatAlert() {
    if (selectedHeatAlert) {
      selectedHeatAlert.hidden = true;
      selectedHeatAlert.dataset.level = "normal";
    }
  }

  // 선택 행정동의 기상청 폭염·열대야 특보를 조회한다.
  async function updateHeatAlert(dongCode, requestId) {
    hideSelectedHeatAlert();

    try {
      const response = await fetch(
        `/api/heat-alerts?regionCode=${encodeURIComponent(dongCode)}`,
      );

      if (!response.ok) {
        throw new Error(`특보 API HTTP ${response.status}`);
      }

      const payload = await response.json();

      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("특보 API 응답 형식이 올바르지 않습니다.");
      }

      // 이전에 선택한 행정동의 늦은 응답은 화면에 표시하지 않는다.
      if (requestId !== selectedRegionRequestId) {
        return;
      }

      const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];

      const isActiveOfficialAlert =
        payload.status === "active" &&
        payload.source === "기상청 기상특보 조회서비스" &&
        alerts.length > 0;

      if (!isActiveOfficialAlert) {
        hideSelectedHeatAlert();
        return;
      }

      const isTestMode = payload.testMode === true;
      // jisu_12_추가수정 / 폭염, 열대야 경보
      /*
      긴급 폭염주의보 · 열대야주의보 둘 다면
      -> 선택 지역에 폭염주의보와 열대야주의보가 동시에 발표 중입니다.

      긴급 폭염주의보
      -> 대구 ○○동 지역에 폭염주의보가 발표 중입니다.

      긴급 열대야경보
      -> 대구 ○○동 지역에 열대야경보가 발표 중입니다.
      */
      const alertTitles = [
        ...new Set(alerts.map((alert) => alert.title).filter(Boolean)),
      ];
      const alertMessages = alerts
        .map((alert) => alert.message)
        .filter(Boolean);

      // 배너 제목은 여러 특보가 있으면 가운데 점으로 구분한다.
      const alertTitle = alertTitles.join(" · ") || "기상특보";

      // jisu_12_추가수정 / 폭염, 열대야 주의보
      // 여러 특보가 동시에 있으면 하나의 자연스러운 문장으로 합친다.
      const combinedAlertNames =
        alertTitles.length <= 1
          ? alertTitles[0]
          : `${alertTitles.slice(0, -1).join(", ")}와 ${
              alertTitles[alertTitles.length - 1]
            }`;

      // 서버가 전달한 실제 구·군과 행정동 이름을 사용한다.
      const selectedRegionName =
        typeof payload.regionName === "string" && payload.regionName.trim()
          ? payload.regionName.trim()
          : "선택 지역";

      // 특보가 여러 개면 실제 지역명과 특보명을 하나의 문장으로 합친다.
      const alertMessage =
        alertTitles.length > 1
          ? `${selectedRegionName} 지역에 ${combinedAlertNames}가 동시에 발표 중입니다.`
          : (alertMessages[0] ??
            `${selectedRegionName} 지역에 기상특보가 발표 중입니다.`);

      const alertLevel = alerts.some((alert) => alert.level === "critical")
        ? "critical"
        : "warning";

      const hasHeatwaveAlert = alerts.some(
        (alert) => alert.category === "heatwave",
      );
      const hasTropicalNightAlert = alerts.some(
        (alert) => alert.category === "tropical-night",
      );

      const safetyMessage =
        hasHeatwaveAlert && hasTropicalNightAlert
          ? "낮에는 야외활동을 줄이고, 밤사이 실내 온도를 낮추며 충분한 수분을 섭취하세요."
          : hasTropicalNightAlert
            ? "밤사이 실내 온도를 낮추고 충분한 수분을 섭취하세요."
            : "충분한 수분 섭취와 한낮 야외활동 자제가 필요합니다.";

      if (selectedHeatAlertTitle) {
        selectedHeatAlertTitle.textContent = isTestMode
          ? `테스트 ${alertTitle}`
          : `긴급 ${alertTitle}`;
      }

      if (selectedHeatAlertMessage) {
        selectedHeatAlertMessage.textContent =
          // `${isTestMode ? "화면 테스트" : "기상청 발표"} · ` +
          `${alertMessage} · ${safetyMessage}`;
      }

      if (selectedHeatAlert) {
        selectedHeatAlert.dataset.level = alertLevel;
        selectedHeatAlert.hidden = false;
      }
    } catch (error) {
      console.error("폭염 안전 안내 조회 실패:", error);
      hideSelectedHeatAlert();
    }
  }
  /* 03*/

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
        heatData ? (heatDataBaseDate ?? dongInfo.baseDate) : dongInfo.baseDate,
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

  // jisu_03_추가 / 팝업 / 팝업 열기·닫기 함수
  // 클릭한 행정동의 기본 정보로 상세 팝업을 연다.
  function openRegionPopup(feature) {
    if (!regionPopup) {
      return;
    }

    const dongInfo = getDongInfo(feature);
    const heatData = heatDataByDongCode.get(dongInfo.code);
    const riskStyle = RISK_STYLES[heatData?.riskLevel ?? "none"];

    regionPopupLocation.textContent = `${getDistrictName(feature)} · 선택 행정구역`;
    regionPopupTitle.textContent = dongInfo.name;
    regionPopupRisk.textContent = riskStyle.label;
    regionPopupScore.textContent = heatData
      ? `${Number(heatData.score).toFixed(1)}점`
      : "-";

    regionPopupDongCode = dongInfo.code;

    resetPopupShelters();
    hideSelectedHeatAlert();

    regionPopup.hidden = false;
    document.body.classList.add("has-region-popup");

    // 팝업이 화면에 표시된 후 지도를 생성해야 크기를 정상 계산할 수 있다.
    window.setTimeout(() => {
      renderRegionPopupMap(dongInfo.code);
      regionPopupClose?.focus();
    }, 0);
  }

  // 상세 팝업과 팝업 전용 상태를 초기화한다.
  function closeRegionPopup() {
    if (!regionPopup || regionPopup.hidden) {
      return;
    }

    regionPopup.hidden = true;
    regionPopupDongCode = null;
    // jisu_08_추가 / 무더위 쉼터 -------------------------//
    regionPopupShelterRecords = [];
    clearRegionPopupShelterMarkers();
    //--------------------------------------------------//
    document.body.classList.remove("has-region-popup");
    hideSelectedHeatAlert();
  }
  //

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
      (polygonCoordinates) => polygonCoordinatesToPaths(polygonCoordinates)[0],
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

  // jisu_03_추가수정 / 팝업 / selectDong() 교체
  function selectDong(feature, shouldFocus = true) {
    if (selectedFeature && selectedFeature !== feature) {
      applyDongPolygonStyle(selectedFeature);
    }

    selectedFeature = feature;
    hideSelectedHeatAlert();

    // master에 원래 있던 지도 선택 효과는 유지한다.
    showSelectionEffects(feature);
    animateSelectedFeature(feature);

    const dongInfo = getDongInfo(feature);
    const requestId = ++selectedRegionRequestId;

    updateDongPanel(feature);

    // 날씨와 특보를 서로 기다리지 않고 동시에 조회한다.
    Promise.allSettled([
      updateWeatherPanel(dongInfo.code, requestId),
      updateShelters(dongInfo.code, requestId), //jisu_08_추가 / 무더위 쉼터
      updateHeatAlert(dongInfo.code, requestId),
    ]);

    if (shouldFocus) {
      focusFeature(feature);
    }

    setStatus(`${dongInfo.name}을 선택했습니다.`);
  }
  // 03

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

  // jisu_03_추가 / 팝업 / 초기화 시 팝업·날씨 정리
  function clearSelection() {
    // 이전 날씨·특보 요청이 늦게 도착해도 반영되지 않게 한다.
    selectedRegionRequestId += 1;

    closeRegionPopup();
    hideSelectedHeatAlert();
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
    resetWeatherPanel(); // jisu_03_추가 / 팝업 / 초기화 시 팝업·날씨 정리
  }

  function normalizePlaceCoordinate(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return null;
    }

    return Math.abs(numericValue) > 1000
      ? numericValue / 10000000
      : numericValue;
  }

  function findDongFeatureByCoordinates(longitude, latitude) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return null;
    }

    return findDongFeatureAtCoordinate(
      new naver.maps.LatLng(latitude, longitude),
    );
  }

  function getDongSearchCandidates(query) {
    const normalizedQuery = query.replaceAll(" ", "");

    return dongFeatures
      .filter((feature) => {
        const dongName = getDongInfo(feature)
          .name
          .toLocaleLowerCase("ko-KR")
          .replaceAll(" ", "");

        return featureMatchesFilters(feature) && dongName.includes(normalizedQuery);
      })
      .sort((left, right) =>
        getDongInfo(left).name.localeCompare(getDongInfo(right).name, "ko-KR"),
      )
      .slice(0, 10)
      .map((feature) => {
        const dongInfo = getDongInfo(feature);
        return {
          type: "dong",
          feature,
          title: dongInfo.name,
          subtitle: `행정동 · ${getDistrictName(feature)}`,
          keyword: dongInfo.name,
        };
      });
  }

  async function getPlaceSearchCandidates(rawQuery) {
    const response = await fetch(
      `/api/place-search?query=${encodeURIComponent(rawQuery)}`,
      { method: "GET", cache: "no-cache" },
    );

    if (!response.ok) {
      throw new Error(`장소 검색 실패: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];

    return items
      .map((item) => {
        const longitude = normalizePlaceCoordinate(item.mapx);
        const latitude = normalizePlaceCoordinate(item.mapy);
        const feature = findDongFeatureByCoordinates(longitude, latitude);

        if (!feature || !featureMatchesFilters(feature)) {
          return null;
        }

        const dongInfo = getDongInfo(feature);
        const districtName = getDistrictName(feature);
        return {
          type: "place",
          feature,
          placeTitle: item.title,
          title: item.title,
          subtitle: `${districtName} ${dongInfo.name}`,
          keyword: item.title,
        };
      })
      .filter(Boolean);
  }

  async function getSearchCandidates(rawQuery) {
    const query = rawQuery.trim().toLocaleLowerCase("ko-KR");

    if (!query) {
      return [];
    }

    const dongCandidates = getDongSearchCandidates(query);
    let placeCandidates = [];

    if (query.length >= 2) {
      try {
        placeCandidates = await getPlaceSearchCandidates(rawQuery);
      } catch (error) {
        console.warn("장소 검색 결과를 불러오지 못했습니다.", error);
      }
    }

    return [...dongCandidates, ...placeCandidates].slice(0, 12);
  }

  function closeSearchResults() {
    if (searchRenderTimer !== null) {
      window.clearTimeout(searchRenderTimer);
      searchRenderTimer = null;
    }

    latestSearchRequestToken += 1;
    searchResults?.replaceChildren();

    if (searchResults) {
      searchResults.hidden = true;
    }

    searchInput?.setAttribute("aria-expanded", "false");
  }

  function createSearchResultButton(candidate) {
    const listItem = document.createElement("li");
    const resultButton = document.createElement("button");
    const iconElement = document.createElement("span");
    const textGroup = document.createElement("span");
    const titleElement = document.createElement("strong");
    const subtitleElement = document.createElement("span");
    const typeBadge = document.createElement("span");

    listItem.className = "search-result-item";
    listItem.setAttribute("role", "none");
    resultButton.type = "button";
    resultButton.className = "dong-search-result-button";
    resultButton.setAttribute("role", "option");
    iconElement.className = `search-result-icon search-result-icon-${candidate.type}`;
    iconElement.setAttribute("aria-hidden", "true");
    iconElement.textContent = candidate.type === "place" ? "⌖" : "동";
    textGroup.className = "search-result-text";
    titleElement.className = "search-result-title";
    titleElement.textContent = candidate.title;
    subtitleElement.className = "search-result-subtitle";
    subtitleElement.textContent = candidate.subtitle;
    typeBadge.className = `search-result-badge search-result-badge-${candidate.type}`;
    typeBadge.textContent = candidate.type === "place" ? "장소" : "행정동";

    textGroup.append(titleElement, subtitleElement);
    resultButton.append(iconElement, textGroup, typeBadge);
    resultButton.addEventListener("click", () => {
      searchInput.value = candidate.keyword;
      closeSearchResults();
      setSearchPopupOpen(false);
      selectDong(candidate.feature);

      if (candidate.type === "place") {
        setStatus(`${candidate.placeTitle}은(는) ${candidate.subtitle}에 있습니다.`);
      }
    });
    listItem.append(resultButton);
    return listItem;
  }

  async function renderSearchResults() {
    if (!searchInput || !searchResults) {
      return;
    }

    const rawQuery = searchInput.value.trim();
    const requestToken = ++latestSearchRequestToken;
    searchResults.replaceChildren();

    if (!rawQuery) {
      closeSearchResults();
      return;
    }

    const candidates = await getSearchCandidates(rawQuery);
    if (requestToken !== latestSearchRequestToken) {
      return;
    }

    searchResults.replaceChildren();
    if (candidates.length === 0) {
      const emptyItem = document.createElement("li");
      emptyItem.className = "dong-search-empty";
      emptyItem.textContent = `"${rawQuery}" 검색 결과가 없습니다.`;
      searchResults.append(emptyItem);
    } else {
      candidates.forEach((candidate) => {
        searchResults.append(createSearchResultButton(candidate));
      });
    }

    searchResults.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  async function searchDong() {
    const rawQuery = searchInput?.value.trim() ?? "";

    if (!rawQuery) {
      closeSearchResults();
      setStatus("검색할 행정동 또는 장소 이름을 입력해주세요.");
      searchInput?.focus();
      return;
    }

    const candidates = await getSearchCandidates(rawQuery);
    if (candidates.length === 0) {
      await renderSearchResults();
      setStatus(`"${rawQuery}"에 해당하는 검색 결과가 없습니다.`);
      return;
    }

    if (candidates.length === 1) {
      const candidate = candidates[0];
      searchInput.value = candidate.keyword;
      closeSearchResults();
      setSearchPopupOpen(false);
      selectDong(candidate.feature);

      if (candidate.type === "place") {
        setStatus(`${candidate.placeTitle}은(는) ${candidate.subtitle}에 있습니다.`);
      }
      return;
    }

    await renderSearchResults();
    setStatus(`${candidates.length}개의 검색 결과를 찾았습니다.`);
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
    // jisu_03_추가 / 팝업 / 지도 클릭 시 팝업 열기
    openRegionPopup(feature);
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
      hoveredDongFeature ?? findDongFeatureAtCoordinate(event.coord);

    if (feature) {
      handleDongClick(feature);
    }
  });

  mapElement.addEventListener("mouseleave", scheduleDongHoverClear);

  // jisu_03_추가 / 팝업 / 팝업 닫기 이벤트
  // 닫기 버튼
  regionPopupClose?.addEventListener("click", closeRegionPopup);

  // 팝업 카드 바깥 영역 클릭
  regionPopup?.addEventListener("click", (event) => {
    if (event.target === regionPopup) {
      closeRegionPopup();
    }
  });

  // Esc 키
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeRegionPopup();
      closeSearchResults();
      if (searchPopupPanel && !searchPopupPanel.hidden) {
        setSearchPopupOpen(false);
      }
      if (districtChartPanel && !districtChartPanel.hidden) {
        setDistrictChartPanelOpen(false);
      }
    }
  });
  //

  function setSearchPopupOpen(isOpen) {
    if (!searchPopupPanel) {
      return;
    }

    searchPopupPanel.hidden = !isOpen;
    openSearchButton?.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
      searchInput?.focus();
    } else {
      closeSearchResults();
      openSearchButton?.focus();
    }
  }

  function setDistrictChartPanelOpen(isOpen) {
    if (!districtChartPanel || !districtChartBackdrop) {
      return;
    }

    if (isOpen && searchPopupPanel && !searchPopupPanel.hidden) {
      setSearchPopupOpen(false);
    }

    districtChartPanel.hidden = !isOpen;
    districtChartBackdrop.hidden = !isOpen;
    districtChartPanel.setAttribute("aria-hidden", String(!isOpen));
    headerMenuButton?.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("district-chart-open", isOpen);

    if (isOpen) {
      window.requestAnimationFrame(() => districtChartClose?.focus());
    } else {
      headerMenuButton?.focus();
    }
  }

  openSearchButton?.addEventListener("click", () => {
    setSearchPopupOpen(true);
  });

  closeSearchButton?.addEventListener("click", () => {
    setSearchPopupOpen(false);
  });

  headerMenuButton?.addEventListener("click", () => {
    setDistrictChartPanelOpen(districtChartPanel?.hidden ?? true);
  });

  districtChartClose?.addEventListener("click", () => {
    setDistrictChartPanelOpen(false);
  });

  districtChartBackdrop?.addEventListener("click", () => {
    setDistrictChartPanelOpen(false);
  });

  searchInput?.addEventListener("input", () => {
    if (searchRenderTimer !== null) {
      window.clearTimeout(searchRenderTimer);
    }

    searchRenderTimer = window.setTimeout(() => {
      renderSearchResults();
      searchRenderTimer = null;
    }, 250);
  });

  searchButton?.addEventListener("click", searchDong);

  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchDong();
    } else if (event.key === "ArrowDown" && !searchResults?.hidden) {
      event.preventDefault();
      searchResults.querySelector("button")?.focus();
    }
  });

  searchResults?.addEventListener("keydown", (event) => {
    const resultButtons = [...searchResults.querySelectorAll("button")];
    const currentIndex = resultButtons.indexOf(document.activeElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      resultButtons[(currentIndex + 1) % resultButtons.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (currentIndex <= 0) {
        searchInput?.focus();
      } else {
        resultButtons[currentIndex - 1]?.focus();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearchResults();
      searchInput?.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-autocomplete-container")) {
      closeSearchResults();
    }
  });

  resetButton?.addEventListener("click", () => {
    clearDongHover();
    clearSelection();

    if (searchInput) {
      searchInput.value = "";
    }
    closeSearchResults();

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

  districtAverageChart?.addEventListener("click", (event) => {
    const chartButton = event.target.closest("button[data-district]");

    if (!chartButton || !districtAverageChart.contains(chartButton)) {
      return;
    }

    selectedRiskLevel = "all";
    if (riskFilter) {
      riskFilter.value = "all";
    }

    selectDistrict(chartButton.dataset.district);
    setDistrictChartPanelOpen(false);
  });

  districtChartReset?.addEventListener("click", () => {
    clearDongHover();
    clearSelection();
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
    setStatus("대구 전체 행정동을 표시합니다.");
    setDistrictChartPanelOpen(false);
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
      renderRiskRankings();
      renderDistrictAverageChart();

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
