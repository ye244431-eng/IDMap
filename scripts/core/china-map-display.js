import { MapDataService } from './map-data-service.js';
import { MapLocator } from './map-locator.js';
import { MapRenderer } from './map-renderer.js';
import { getExtendedLocation } from '../data/extended-location-data.js';
import { getProvinceCodeByName, MUNICIPALITY_CODES, SPECIAL_REGION_CODES } from '../data/region-data.js';
import { formatAncestralHome } from '../utils/format-ancestral-home.js';

function createAbortError(message = 'Request aborted') {
    return new DOMException(message, 'AbortError');
}

const ZOOM = { NATIONAL: 1.15, PROVINCE_OVERVIEW: 1.5, PROVINCE_FOCUS: 3.5, CITY: 4.0, DISTRICT: 8.0 };
const SCALE_LIMIT = { MIN: 0.8, MAX: 18 };
const CENTER = [104.5, 36];
const ANIM_MS = {
    PROVINCE_TRANSITION: 1000,
    PROVINCE_HIGHLIGHT: 350,
    CITY_TRANSITION: 1200,
    DISTRICT_TRANSITION: 1500,
    RETURN_TO_PROVINCE: 600,
    RETURN_TO_NATIONAL: 1200,
    RETURN_TITLE_CLEAR: 1300,
    RETURN_BROWSE: 800,
    DELAY_BEFORE_PROVINCE: 500,
    DELAY_BEFORE_DISTRICT: 1000,
    CARD_CITY_REVEAL: 1250,
    CARD_DISTRICT_REVEAL: 1550,
    CARD_PROGRESSIVE_STEP: 170,
    BACK_BUTTON_FOCUS: 100,
};
const INFO_CARD = { SCALE_MIN: 0.72, SCALE_MAX: 1.8, MIN_WIDTH: 96, MAX_WIDTH: 160, CHAR_WIDTH: 13 };

function noop() {}

export class ChinaMapDisplay {
    constructor(domId, dataService, callbacks = {}) {
        this._dom = document.getElementById(domId);
        this._dataService = dataService || new MapDataService();
        this._locator = new MapLocator();
        this._renderer = new MapRenderer();
        this._callbacks = {
            onTitleChange: callbacks.onTitleChange || noop,
            onBackButtonChange: callbacks.onBackButtonChange || noop,
        };
        this._chart = null;
        this._geoJson = null;
        this._provinceGeoJson = null;
        this._districtGeoJson = null;
        this._loadedProvCode = null;
        this._loadedCityCode = null;
        this._currentView = 'national';
        this._cachedSummary = null;
        this._cachedCityName = null;
        this._cachedCityCenter = null;
        this._cachedDistrictSeriesData = null;
        this._cachedDistrictCenter = null;
        this._cachedDistrictName = null;
        this._cachedResolvedLocation = null;
        this._mapRegName = null;
        this._cityMapRegName = null;
        this._abortController = null;
        this._requestToken = 0;
        this._onLocationResolved = null;
        this._lastHighlightOptions = null;
        this._currentBrowseProvince = null;
        this._selectedRegionName = '';
        this._activeInfoLabel = null;
        this._infoLabelTimers = [];
        this._roamFrameId = null;
        this._handleResize = () => this._scheduleRoamFrame(true);
        this._handleGeoRoam = () => this._scheduleRoamFrame(false);
        this._handleMapClick = (params) => this._handleMapClickEvent(params);
    }

    async init() {
        if (!this._dom) return false;

        if (typeof echarts === 'undefined' || !window.echarts) {
            console.error('ECharts 库未加载，无法初始化地图');
            return false;
        }

        try {
            this._geoJson = await this._dataService.loadNational();
            if (!this._geoJson) {
                console.error('全国地图数据加载失败');
                return false;
            }

            echarts.registerMap('china', this._geoJson);
            this._chart = echarts.init(this._dom);
            this._chart.on('click', this._handleMapClick);
            this._chart.on('georoam', this._handleGeoRoam);
            this._renderDefault();
            window.addEventListener('resize', this._handleResize);
            return true;
        } catch (error) {
            console.error('地图初始化失败', error);
            return false;
        }
    }

    beginQuery() {
        this._abortPendingFetch();
        this._requestToken += 1;
        this._abortController = new AbortController();
        return { token: this._requestToken, signal: this._abortController.signal };
    }

    // ---- highlightProvince: 全国 → 省 → 区县多级缩放主流程 ----

    async highlightProvince(provinceName, summary, onLocationResolved, queryContext, options = {}) {
        if (!this._chart) return;

        const token = queryContext?.token ?? this._requestToken;
        const signal = queryContext?.signal;
        this._cachedSummary = summary;
        this._onLocationResolved = onLocationResolved;
        this._lastHighlightOptions = options;
        this._clearInfoLabelTimers();
        this._activeInfoLabel = null;

        if (SPECIAL_REGION_CODES.includes(summary.provinceCode)) {
            this._handleSpecialRegion(provinceName, summary, options, onLocationResolved);
            return;
        }

        await this._highlightNormalProvince(provinceName, summary, onLocationResolved, token, signal, options);
    }

    _handleSpecialRegion(provinceName, summary, options, onLocationResolved) {
        if (options.extendedLocation) {
            this._renderExtendedRegionPoint(provinceName, summary, options.extendedLocation);
            onLocationResolved?.({ ...options.extendedLocation, isExtendedLocation: true });
            return;
        }
        const defaultLocation = getExtendedLocation(summary.provinceCode, '');
        if (defaultLocation) {
            this._renderExtendedRegionPoint(provinceName, summary, defaultLocation);
        } else {
            this._renderSpecialRegionHighlight(provinceName, summary);
        }
        this._cachedResolvedLocation = defaultLocation;
        onLocationResolved?.({ isSpecialRegion: true });
    }

    async _highlightNormalProvince(provinceName, summary, onLocationResolved, token, signal) {
        const theme = this._getTheme();
        const provinceCenter = this._locator.getProvinceCenter(this._geoJson, provinceName);

        this._ensureActive(token);
        this._renderNationalHighlight(provinceName, summary, theme);
        this._callbacks.onTitleChange(provinceName);

        if (provinceCenter) {
            this._chart.setOption({
                geo: { center: provinceCenter, zoom: ZOOM.PROVINCE_FOCUS, animationDurationUpdate: ANIM_MS.PROVINCE_TRANSITION, animationEasingUpdate: 'cubicInOut' },
            });
        }

        const { provinceGeoJson, districtGeoJson, resolvedLocation } = await this._loadProvinceData(summary, signal, token);

        this._cachedResolvedLocation = resolvedLocation;
        this._cachedSummary = { ...this._cachedSummary, cityName: resolvedLocation.cityName || this._cachedSummary.cityName, countyName: resolvedLocation.countyName || this._cachedSummary.countyName };

        if (!provinceGeoJson || !provinceCenter) {
            onLocationResolved?.(resolvedLocation);
            this._callbacks.onTitleChange(summary.ancestralHome);
            return;
        }

        await this._showProvinceLevel(provinceName, summary, provinceGeoJson, provinceCenter, resolvedLocation, districtGeoJson, theme, token, onLocationResolved);

        if (districtGeoJson && resolvedLocation.countyName) {
            await this._drillDownToDistrict(summary, districtGeoJson, resolvedLocation, theme, token, provinceGeoJson, provinceCenter, provinceName);
        }
    }

    async _loadProvinceData(summary, signal, token) {
        const provinceAdcode = `${summary.provinceCode}0000`;
        let provinceGeoJson = null;
        try {
            provinceGeoJson = await this._dataService.loadProvince(provinceAdcode, signal);
        } catch (error) {
            if (error.name === 'AbortError') throw error;
        }
        this._ensureActive(token);

        let resolvedLocation = this._locator.resolveLocationFromProvince(summary, provinceGeoJson);
        let districtGeoJson = null;

        if (MUNICIPALITY_CODES.includes(summary.provinceCode)) {
            try {
                districtGeoJson = await this._dataService.loadDistrict(`${summary.cityCode}00`, signal);
            } catch (error) {
                if (error.name === 'AbortError') throw error;
            }
            if (!districtGeoJson && provinceGeoJson?.features?.length) {
                districtGeoJson = provinceGeoJson;
            }
            if (districtGeoJson) {
                resolvedLocation = this._locator.resolveLocationFromDistrict(summary, districtGeoJson, resolvedLocation);
            }
            this._ensureActive(token);
        }

        return { provinceGeoJson, districtGeoJson, resolvedLocation };
    }

    async _showProvinceLevel(provinceName, summary, provinceGeoJson, provinceCenter, resolvedLocation, districtGeoJson, theme, token, onLocationResolved) {
        const provinceAdcode = `${summary.provinceCode}0000`;
        this._provinceGeoJson = provinceGeoJson;
        this._loadedProvCode = provinceAdcode;
        this._districtGeoJson = districtGeoJson;
        this._loadedCityCode = districtGeoJson ? `${summary.cityCode}00` : null;
        this._currentBrowseProvince = { name: provinceName, code: summary.provinceCode, isQueryProvince: true };

        await this._delay(ANIM_MS.DELAY_BEFORE_PROVINCE, token);

        const mapRegName = `prov_${summary.provinceCode}`;
        this._mapRegName = mapRegName;
        echarts.registerMap(mapRegName, provinceGeoJson);

        const provinceGeoCenter = this._locator.computeGeoJSONCenter(provinceGeoJson);
        const matchedFeature = this._locator.matchProvinceFeature(summary, provinceGeoJson, resolvedLocation);
        const resolvedCityName = matchedFeature?.properties?.name || resolvedLocation.cityName || summary.cityName || '';
        const matchedCity = resolvedCityName || summary.provinceName;

        if (resolvedCityName) {
            this._cachedSummary.cityName = resolvedCityName;
        }
        if (resolvedCityName) {
            this._cachedSummary.ancestralHome = formatAncestralHome({
                provinceCode: this._cachedSummary.provinceCode,
                provinceName: this._cachedSummary.provinceName,
                cityName: resolvedCityName,
                countyName: this._cachedSummary.countyName,
            });
        }
        const cityCenter = this._locator.getFeatureCenter(matchedFeature);

        this._cachedCityName = matchedCity;
        this._cachedCityCenter = cityCenter;
        this._cachedDistrictCenter = null;
        this._cachedDistrictSeriesData = null;
        this._cachedDistrictName = null;
        this._selectedRegionName = matchedCity;

        const geoOption = this._buildGeoOption(theme, {
            map: mapRegName,
            center: provinceGeoCenter || provinceCenter,
            zoom: ZOOM.PROVINCE_OVERVIEW,
            regions: [this._buildRegionHighlight(theme, matchedCity, { fontSize: 16 })],
        });

        this._chart.setOption({ geo: geoOption, series: [] }, { replaceMerge: ['geo', 'series'] });
        this._currentView = 'province';
        this._callbacks.onBackButtonChange(true);

        this._chart.setOption({
            geo: { center: cityCenter || provinceGeoCenter || provinceCenter, zoom: ZOOM.CITY, animationDurationUpdate: ANIM_MS.CITY_TRANSITION, animationEasingUpdate: 'cubicInOut' },
        });

        const hasDistrictTarget = Boolean(districtGeoJson && resolvedLocation.countyName);
        if (!hasDistrictTarget) {
            this._scheduleInfoGraphic(cityCenter || provinceGeoCenter || provinceCenter, this._cachedSummary, token, ANIM_MS.CARD_CITY_REVEAL);
        }
        if (resolvedCityName) {
            onLocationResolved?.({ ...resolvedLocation, cityName: resolvedCityName });
        }

        this._callbacks.onTitleChange(`${provinceName} · ${matchedCity}`);
    }

    async _drillDownToDistrict(summary, districtGeoJson, resolvedLocation, theme, token, provinceGeoJson, provinceCenter, provinceName) {
        await this._delay(ANIM_MS.DELAY_BEFORE_DISTRICT, token);

        const districtMatch = this._locator.matchDistrictFeature(summary, districtGeoJson);
        if (!districtMatch) {
            const geoCenter = this._locator.computeGeoJSONCenter(provinceGeoJson) || provinceCenter;
            this._scheduleInfoGraphic(this._cachedCityCenter || geoCenter, this._cachedSummary, token, ANIM_MS.CARD_CITY_REVEAL);
            return;
        }

        const cityMapRegName = `city_${summary.cityCode}`;
        this._cityMapRegName = cityMapRegName;
        echarts.registerMap(cityMapRegName, districtGeoJson);

        const districtCenter = this._locator.getFeatureCenter(districtMatch);
        const districtName = districtMatch.properties.name;
        const districtSeriesData = this._buildDistrictSeriesData(districtGeoJson, districtMatch, theme);

        this._cachedDistrictSeriesData = districtSeriesData;
        this._cachedDistrictCenter = districtCenter;
        this._cachedDistrictName = districtName;
        this._cachedSummary.countyName = districtName;
        this._cachedSummary.ancestralHome = formatAncestralHome({
            provinceCode: this._cachedSummary.provinceCode,
            provinceName: this._cachedSummary.provinceName,
            cityName: this._cachedSummary.cityName,
            countyName: districtName,
        });

        const geoOption = this._buildGeoOption(theme, {
            map: cityMapRegName,
            center: districtCenter,
            zoom: ZOOM.DISTRICT,
            animationDurationUpdate: ANIM_MS.DISTRICT_TRANSITION,
            regions: districtSeriesData,
        });

        this._chart.setOption({ geo: geoOption, series: [] }, { replaceMerge: ['series'] });
        this._scheduleInfoGraphic(districtCenter, this._cachedSummary, token, ANIM_MS.CARD_DISTRICT_REVEAL);
        this._callbacks.onTitleChange(this._cachedSummary.ancestralHome);
    }

    _buildDistrictSeriesData(districtGeoJson, districtMatch, theme) {
        return (districtGeoJson.features || []).map((feature) => {
            const isTarget = feature === districtMatch;
            return {
                name: feature.properties.name,
                itemStyle: isTarget ? {
                    areaColor: theme.highlightArea, borderColor: theme.highlightBorder, borderWidth: 2.5, shadowBlur: 25, shadowColor: theme.highlightShadow,
                } : {
                    areaColor: 'transparent', borderColor: theme.border, borderWidth: 0.8,
                },
                label: isTarget ? { show: true, color: '#fff', fontSize: 16, fontWeight: 'bold', fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif' } : { show: false },
                emphasis: isTarget ? {
                    label: { show: true, color: '#fff', fontSize: 15, fontWeight: 'bold' },
                    itemStyle: { areaColor: theme.highlightArea, borderColor: theme.highlightBorder, borderWidth: 3, shadowBlur: 30, shadowColor: theme.highlightShadow },
                } : {
                    label: { show: true, color: theme.emphasisBorder, fontSize: 11 },
                    itemStyle: { areaColor: theme.emphasisArea, borderColor: theme.emphasisBorder, borderWidth: 1.5 },
                },
            };
        });
    }

    // ---- 共享 geo 配置构建（highlightProvince / refreshTheme / browseProvince / returnToNational 共用） ----

    _buildGeoOption(theme, overrides = {}) {
        return {
            map: overrides.map,
            roam: overrides.roam ?? true,
            center: overrides.center,
            zoom: overrides.zoom,
            animationDurationUpdate: overrides.animationDurationUpdate ?? 0,
            animationEasingUpdate: overrides.animationEasingUpdate,
            scaleLimit: overrides.scaleLimit || { min: SCALE_LIMIT.MIN, max: SCALE_LIMIT.MAX },
            label: overrides.label || { show: true, color: theme.label, fontSize: 10, distance: 0 },
            emphasis: overrides.emphasis || {
                label: { show: true, color: theme.emphasisBorder, fontSize: 14, fontWeight: 'bold' },
                itemStyle: { areaColor: theme.emphasisArea, borderColor: theme.emphasisBorder, borderWidth: 2, shadowBlur: 20, shadowColor: theme.highlightShadow },
            },
            itemStyle: overrides.itemStyle || { areaColor: theme.area, borderColor: theme.border, borderWidth: 1 },
            regions: overrides.regions || [],
        };
    }

    _buildRegionHighlight(theme, name, labelOverrides = {}) {
        return {
            name,
            itemStyle: { areaColor: theme.highlightArea, borderColor: theme.highlightBorder, borderWidth: 2.5, shadowBlur: 25, shadowColor: theme.highlightShadow },
            label: { show: true, color: '#fff', fontSize: labelOverrides.fontSize || 16, fontWeight: 'bold', fontFamily: labelOverrides.fontFamily || 'Microsoft YaHei, PingFang SC, sans-serif' },
        };
    }

    // ---- 全国视图上的省份高亮（阶段 1） ----

    _renderNationalHighlight(provinceName, summary, theme) {
        this._chart.setOption({
            geo: this._buildGeoOption(theme, {
                map: 'china',
                center: CENTER,
                zoom: ZOOM.NATIONAL,
                regions: [{
                    name: provinceName,
                    itemStyle: { areaColor: theme.highlightArea, borderColor: theme.highlightBorder, borderWidth: 2.5, shadowBlur: 30, shadowColor: theme.highlightShadow },
                    label: {
                        show: true, color: '#fff', fontSize: 13, fontWeight: 'bold',
                        formatter: () => {
                            const parts = [`{t|${provinceName}}`];
                            if (summary.zodiacSign) parts.push(`{z|${summary.zodiacSign}}`);
                            if (summary.chineseZodiac) parts.push(`{cz|${summary.chineseZodiac}}`);
                            if (summary.gender) parts.push(`{g|${summary.gender}}`);
                            return parts.join('\n');
                        },
                        rich: {
                            t: { fontSize: 16, fontWeight: 'bold', color: '#fff', padding: [0, 0, 6, 0] },
                            z: { fontSize: 12, color: '#e0e0e0', padding: [2, 0] },
                            cz: { fontSize: 12, color: '#e0e0e0', padding: [2, 0] },
                            g: { fontSize: 12, color: '#e0e0e0', padding: [2, 0] },
                        },
                    },
                }],
            }),
            series: [],
        }, { replaceMerge: ['geo', 'series'] });
    }

    // ---- refreshTheme —— 基于缓存状态重绘 ----

    refreshTheme() {
        if (!this._chart || !this._geoJson) return;

        this._renderer.invalidateTheme();

        if (this._cachedSummary && SPECIAL_REGION_CODES.includes(this._cachedSummary.provinceCode)) {
            if (this._cachedResolvedLocation) {
                this._renderExtendedRegionPoint(this._cachedSummary.provinceName, this._cachedSummary, this._cachedResolvedLocation);
            } else {
                this._renderSpecialRegionHighlight(this._cachedSummary.provinceName, this._cachedSummary);
            }
            return;
        }

        echarts.registerMap('china', this._geoJson);
        if (this._currentView !== 'province' || !this._provinceGeoJson || !this._mapRegName) {
            this._renderDefault();
            return;
        }

        echarts.registerMap(this._mapRegName, this._provinceGeoJson);
        if (this._districtGeoJson && this._cityMapRegName) {
            echarts.registerMap(this._cityMapRegName, this._districtGeoJson);
        }

        const theme = this._getTheme();
        const geoCenter = this._locator.computeGeoJSONCenter(this._provinceGeoJson) || CENTER;
        let geoMapName = this._mapRegName;
        const geoRegions = [];

        if (this._cachedDistrictSeriesData && this._cityMapRegName) {
            geoMapName = this._cityMapRegName;
            geoRegions.push(...this._cachedDistrictSeriesData);
        } else if (this._cachedCityName) {
            geoRegions.push(this._buildRegionHighlight(theme, this._cachedCityName));
        }

        let zoom = ZOOM.PROVINCE_OVERVIEW;
        let center = geoCenter;
        if (this._cachedDistrictCenter) {
            zoom = ZOOM.DISTRICT;
            center = this._cachedDistrictCenter;
        } else if (this._cachedCityCenter) {
            zoom = ZOOM.CITY;
            center = this._cachedCityCenter;
        }

        this._chart.setOption({
            geo: this._buildGeoOption(theme, { map: geoMapName, center, zoom, regions: geoRegions }),
            series: [],
        }, { replaceMerge: ['geo', 'series'] });

        this._buildInfoGraphic(center, this._cachedSummary);
    }

    // ---- 重置 / 返回 ----

    reset() {
        this._abortPendingFetch();
        this._provinceGeoJson = null;
        this._districtGeoJson = null;
        this._loadedProvCode = null;
        this._loadedCityCode = null;
        this._cachedSummary = null;
        this._cachedCityName = null;
        this._cachedCityCenter = null;
        this._cachedDistrictSeriesData = null;
        this._cachedDistrictCenter = null;
        this._cachedDistrictName = null;
        this._cachedResolvedLocation = null;
        this._onLocationResolved = null;
        this._lastHighlightOptions = null;
        this._currentBrowseProvince = null;
        this._selectedRegionName = '';
        this._clearInfoLabelTimers();
        this._activeInfoLabel = null;
        this._mapRegName = null;
        this._cityMapRegName = null;
        this._currentView = 'national';
        this._callbacks.onBackButtonChange(false);
        this._callbacks.onTitleChange('中国行政区划图');
        if (this._chart) {
            echarts.registerMap('china', this._geoJson);
            this._chart.setOption({ series: [] }, false);
            this._renderDefault();
        }
    }

    isInProvinceView() {
        return this._currentView === 'province';
    }

    async returnToNational(onReturnedToProvince) {
        if (!this._chart || this._currentView !== 'province') return;

        this._abortPendingFetch();
        this._requestToken += 1;
        const token = this._requestToken;
        const theme = this._getTheme();
        const provinceName = this._cachedSummary?.provinceName || this._currentBrowseProvince?.name || '';
        const provinceCenter = this._locator.getProvinceCenter(this._geoJson, provinceName);

        this._callbacks.onBackButtonChange(false);
        this._currentView = 'national';
        this._selectedRegionName = '';
        this._clearInfoLabelTimers();
        this._activeInfoLabel = null;
        onReturnedToProvince?.({ name: provinceName, level: 'province', provinceName });

        echarts.registerMap('china', this._geoJson);
        const regions = provinceName ? [{
            name: provinceName,
            itemStyle: { areaColor: theme.highlightArea, borderColor: theme.highlightBorder, borderWidth: 2, shadowBlur: 15, shadowColor: theme.highlightShadow },
            label: { show: true, color: theme.label, fontSize: 11, fontWeight: 'bold' },
        }] : [];

        this._chart.setOption({
            geo: this._buildGeoOption(theme, {
                map: 'china',
                center: provinceCenter || CENTER,
                zoom: ZOOM.PROVINCE_FOCUS,
                animationDurationUpdate: ANIM_MS.RETURN_TO_PROVINCE,
                animationEasingUpdate: 'cubicInOut',
                regions,
            }),
            series: [],
        }, { replaceMerge: ['series'] });

        this._callbacks.onTitleChange(provinceName || '中国行政区划图');

        await this._delay(ANIM_MS.RETURN_BROWSE, token);
        this._chart.setOption({
            geo: { center: CENTER, zoom: ZOOM.NATIONAL, animationDurationUpdate: ANIM_MS.RETURN_TO_NATIONAL, animationEasingUpdate: 'cubicInOut' },
        });

        await this._delay(ANIM_MS.RETURN_TITLE_CLEAR, token);
        this._callbacks.onTitleChange('中国行政区划图');
    }

    // ---- 浏览模式 ----

    async browseProvince(provinceName) {
        const provinceCode = getProvinceCodeByName(provinceName);
        if (!provinceCode || SPECIAL_REGION_CODES.includes(provinceCode)) return;

        const queryContext = this.beginQuery();
        const token = queryContext.token;
        const signal = queryContext.signal;
        const theme = this._getTheme();
        const provinceCenter = this._locator.getProvinceCenter(this._geoJson, provinceName);

        this._callbacks.onTitleChange(provinceName);
        if (provinceCenter) {
            this._chart.setOption({
                geo: this._buildGeoOption(theme, {
                    map: 'china',
                    center: provinceCenter,
                    zoom: ZOOM.PROVINCE_FOCUS,
                    animationDurationUpdate: ANIM_MS.RETURN_BROWSE,
                    animationEasingUpdate: 'cubicInOut',
                    regions: [this._buildRegionHighlight(theme, provinceName, { fontSize: 14 })],
                }),
                series: [],
            }, { replaceMerge: ['series'] });
        }

        let provinceGeoJson = null;
        try {
            provinceGeoJson = await this._dataService.loadProvince(`${provinceCode}0000`, signal);
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            return;
        }
        this._ensureActive(token);

        this._provinceGeoJson = provinceGeoJson;
        this._districtGeoJson = null;
        this._loadedProvCode = `${provinceCode}0000`;
        this._loadedCityCode = null;
        this._mapRegName = `prov_${provinceCode}`;
        this._cityMapRegName = null;
        this._cachedCityName = null;
        this._cachedCityCenter = null;
        this._cachedDistrictSeriesData = null;
        this._cachedDistrictCenter = null;
        this._cachedDistrictName = null;
        this._selectedRegionName = '';
        this._currentBrowseProvince = { name: provinceName, code: provinceCode, isQueryProvince: false };

        await this._delay(ANIM_MS.PROVINCE_HIGHLIGHT, token);
        echarts.registerMap(this._mapRegName, provinceGeoJson);
        const provinceGeoCenter = this._locator.computeGeoJSONCenter(provinceGeoJson);

        this._chart.setOption({
            geo: this._buildGeoOption(theme, {
                map: this._mapRegName,
                center: provinceGeoCenter || provinceCenter || CENTER,
                zoom: ZOOM.PROVINCE_OVERVIEW,
            }),
            series: [],
        }, { replaceMerge: ['geo', 'series'] });
        this._currentView = 'province';
        this._callbacks.onBackButtonChange(true);
    }

    // ---- 点击事件 ----

    async _handleMapClickEvent(params) {
        if (!params?.name || this._currentView !== 'national') return;
        await this._handleNationalMapClick(params);
    }

    async _handleNationalMapClick(params) {
        if (this._cachedSummary && params.name === this._cachedSummary.provinceName) {
            const queryContext = this.beginQuery();
            try {
                await this.highlightProvince(this._cachedSummary.provinceName, this._cachedSummary, this._onLocationResolved, queryContext, this._lastHighlightOptions || {});
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('[ErrorBoundary] 地图重新定位失败', error);
                }
            }
            return;
        }
        await this.browseProvince(params.name);
    }

    // ---- 核心工具方法 ----

    _abortPendingFetch() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    _ensureActive(token) {
        if (token !== this._requestToken) {
            throw createAbortError('Stale request');
        }
    }

    _delay(ms, token) {
        return new Promise((resolve, reject) => {
            window.setTimeout(() => {
                try { this._ensureActive(token); resolve(); } catch (error) { reject(error); }
            }, ms);
        });
    }

    _renderDefault() {
        this._renderer.renderDefault(this._chart);
    }

    _renderSpecialRegionHighlight(provinceName, summary) {
        const provinceCenter = this._locator.getProvinceCenter(this._geoJson, provinceName);
        this._cachedSummary = summary;
        this._renderer.renderSpecialRegionHighlight(this._chart, this._geoJson, provinceName, provinceCenter);
        this._currentView = 'province';
        this._currentBrowseProvince = { name: provinceName, code: summary.provinceCode, isQueryProvince: true };
        this._callbacks.onBackButtonChange(true);
        this._callbacks.onTitleChange(provinceName);
    }

    _renderExtendedRegionPoint(provinceName, summary, extendedLocation) {
        this._cachedSummary = summary;
        this._cachedResolvedLocation = extendedLocation;
        this._currentView = 'province';
        this._currentBrowseProvince = { name: provinceName, code: summary.provinceCode, isQueryProvince: true };
        this._callbacks.onBackButtonChange(true);
        this._renderer.renderExtendedRegionPoint(this._chart, this._geoJson, provinceName, extendedLocation);
        this._callbacks.onTitleChange(`${provinceName} · ${extendedLocation.name}`);
    }

    _getTheme() {
        return this._renderer.getTheme();
    }

    // ---- georoam / resize 节流 ----

    _scheduleRoamFrame(includeResize) {
        if (this._roamFrameId !== null) return;
        this._roamFrameId = window.requestAnimationFrame(() => {
            this._roamFrameId = null;
            if (includeResize) this._chart?.resize();
            this._syncInfoLabelScale();
        });
    }

    _syncInfoLabelScale() {
        if (!this._activeInfoLabel) return;
        this._renderActiveInfoLabel();
    }

    // ---- 信息卡：延时揭示 + 渐进式动画 ----

    _scheduleInfoGraphic(center, summary, token, delayMs) {
        this._clearInfoLabelTimers();
        this._activeInfoLabel = null;
        const timer = window.setTimeout(() => {
            this._removeInfoLabelTimer(timer);
            this._showInfoGraphicProgressively(center, summary, token);
        }, delayMs);
        this._infoLabelTimers.push(timer);
    }

    _showInfoGraphicProgressively(center, summary, token) {
        try { this._ensureActive(token); } catch { return; }
        this._buildInfoGraphic(center, summary, { revealStep: 0 });
        [1, 2].forEach((step, index) => {
            const timer = window.setTimeout(() => {
                this._removeInfoLabelTimer(timer);
                try {
                    this._ensureActive(token);
                    if (!this._activeInfoLabel) return;
                    this._activeInfoLabel.revealStep = step;
                    this._renderActiveInfoLabel();
                } catch { /* 任务被取消，安静退出 */ }
            }, ANIM_MS.CARD_PROGRESSIVE_STEP * (index + 1));
            this._infoLabelTimers.push(timer);
        });
    }

    _clearInfoLabelTimers() {
        this._infoLabelTimers.forEach((t) => window.clearTimeout(t));
        this._infoLabelTimers = [];
    }

    _removeInfoLabelTimer(timer) {
        this._infoLabelTimers = this._infoLabelTimers.filter((t) => t !== timer);
    }

    _buildInfoGraphic(center, summary, options = {}) {
        if (!center || !summary) return;
        const districtName = this._cachedDistrictName || summary.countyName || '';
        const cityName = this._cachedCityName || summary.cityName || summary.provinceName;
        this._activeInfoLabel = {
            level: districtName ? 'district' : 'city',
            regionName: districtName || cityName,
            summary: { ...summary },
            revealStep: options.revealStep ?? 2,
        };
        this._renderActiveInfoLabel();
    }

    _renderActiveInfoLabel() {
        if (!this._chart || !this._activeInfoLabel?.regionName) return;
        const { level, regionName, summary, revealStep } = this._activeInfoLabel;
        const theme = this._getTheme();
        const label = this._createInfoLabel(summary, regionName, level, theme, revealStep);
        // 透传当前 roam 后的 center/zoom，避免 setOption 把相机重置回高亮区域中心
        const camera = this._readGeoCamera();

        if (level === 'district' && this._cachedDistrictSeriesData && this._cityMapRegName) {
            this._cachedDistrictSeriesData = this._cachedDistrictSeriesData.map((item) => (
                item.name === regionName ? { ...item, label, emphasis: { ...item.emphasis, label } } : item
            ));
            this._chart.setOption({
                geo: { ...camera, map: this._cityMapRegName, animationDurationUpdate: 0, regions: this._cachedDistrictSeriesData },
                series: [],
            }, { replaceMerge: ['series'] });
            return;
        }

        this._chart.setOption({
            geo: {
                ...camera,
                animationDurationUpdate: 0,
                regions: [{
                    name: regionName,
                    itemStyle: this._buildRegionHighlight(theme, regionName).itemStyle,
                    label,
                }],
            },
        });
    }

    _readGeoCamera() {
        const geo = this._chart?.getOption()?.geo?.[0];
        if (!geo) return {};
        const camera = {};
        if (geo.center !== undefined) camera.center = geo.center;
        if (geo.zoom !== undefined) camera.zoom = geo.zoom;
        return camera;
    }

    _createInfoLabel(summary, regionName, level, theme, revealStep = 2) {
        const zoom = this._chart?.getOption()?.geo?.[0]?.zoom ?? 1;
        const baseZoom = level === 'district' ? ZOOM.DISTRICT : ZOOM.CITY;
        const scale = Math.max(INFO_CARD.SCALE_MIN, Math.min(INFO_CARD.SCALE_MAX, zoom / baseZoom));
        const cardWidth = Math.round(Math.max(INFO_CARD.MIN_WIDTH, Math.min(INFO_CARD.MAX_WIDTH, (summary.ancestralHome || '').length * INFO_CARD.CHAR_WIDTH)) * scale);
        const genderIcon = summary.gender === '男' ? '♂' : summary.gender === '女' ? '♀' : '—';
        const zodiacEmoji = { '摩羯座': '♑', '水瓶座': '♒', '双鱼座': '♓', '白羊座': '♈', '金牛座': '♉', '双子座': '♊', '巨蟹座': '♋', '狮子座': '♌', '处女座': '♍', '天秤座': '♎', '天蝎座': '♏', '射手座': '♐' };
        const zodiacAnimalEmoji = { '鼠': '鼠', '牛': '牛', '虎': '虎', '兔': '兔', '龙': '龙', '蛇': '蛇', '马': '马', '羊': '羊', '猴': '猴', '鸡': '鸡', '狗': '狗', '猪': '猪' };
        const meta = [
            zodiacEmoji[summary.zodiacSign] || summary.zodiacSign || '—',
            genderIcon,
            zodiacAnimalEmoji[summary.chineseZodiac] || summary.chineseZodiac || '—',
        ].join('  ');
        const homeText = revealStep >= 1 ? summary.ancestralHome || '—' : ' ';
        const metaText = revealStep >= 2 ? meta : ' ';
        const hiddenColor = 'rgba(0,0,0,0)';

        return {
            show: true, position: 'inside', align: 'center', verticalAlign: 'bottom',
            color: '#fff', fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
            formatter: () => `{home|${homeText}}\n{meta|${metaText}}\n{name|${regionName}}`,
            rich: {
                home: {
                    width: cardWidth, align: 'center',
                    color: revealStep >= 1 ? theme.highlightTitle : hiddenColor,
                    backgroundColor: theme.tooltipBg, borderColor: theme.highlightBorder,
                    borderWidth: Math.max(1, Math.round(2 * scale)), borderRadius: 2,
                    padding: [Math.round(6 * scale), Math.round(8 * scale), Math.round(3 * scale), Math.round(8 * scale)],
                    fontSize: Math.round(13 * scale), fontWeight: 'bold', lineHeight: Math.round(20 * scale),
                },
                meta: {
                    width: cardWidth, align: 'center',
                    color: revealStep >= 2 ? theme.highlightTitle : hiddenColor,
                    backgroundColor: theme.tooltipBg, borderColor: theme.highlightBorder,
                    borderWidth: Math.max(1, Math.round(2 * scale)), borderRadius: 2,
                    padding: [Math.round(2 * scale), Math.round(8 * scale), Math.round(6 * scale), Math.round(8 * scale)],
                    fontSize: Math.round(14 * scale), lineHeight: Math.round(22 * scale),
                },
                name: {
                    color: '#fff', fontSize: Math.round(16 * scale), fontWeight: 'bold',
                    lineHeight: Math.round(28 * scale), textShadowBlur: Math.round(4 * scale),
                    textShadowColor: 'rgba(0,0,0,0.35)', padding: [Math.round(5 * scale), 0, 0, 0],
                },
            },
        };
    }

    dispose() {
        this._abortPendingFetch();
        this._clearInfoLabelTimers();
        if (this._roamFrameId !== null) {
            window.cancelAnimationFrame(this._roamFrameId);
            this._roamFrameId = null;
        }
        window.removeEventListener('resize', this._handleResize);
        this._chart?.off('click', this._handleMapClick);
        this._chart?.off('georoam', this._handleGeoRoam);
        this._chart?.dispose();
        this._chart = null;
    }
}
