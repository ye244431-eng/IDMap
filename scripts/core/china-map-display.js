import { MapDataService } from './map-data-service.js';
import { MapLocator } from './map-locator.js';
import { MapRenderer } from './map-renderer.js';
import { getExtendedLocation } from '../data/extended-location-data.js';
import { getProvinceCodeByName, MUNICIPALITY_CODES, SPECIAL_REGION_CODES } from '../data/region-data.js';

function createAbortError(message = 'Request aborted') {
    return new DOMException(message, 'AbortError');
}

export class ChinaMapDisplay {
    constructor(domId, dataService = new MapDataService()) {
        this._dom = document.getElementById(domId);
        this._dataService = dataService;
        this._locator = new MapLocator();
        this._renderer = new MapRenderer();
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
        this._handleResize = () => this._chart?.resize();
        this._handleMapClick = (params) => this._handleMapClickEvent(params);
    }

    async init() {
        if (!this._dom) return false;

        // 检查 ECharts 是否已加载
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

    async highlightProvince(provinceName, summary, onLocationResolved, queryContext, options = {}) {
        if (!this._chart) return;

        const token = queryContext?.token ?? this._requestToken;
        const signal = queryContext?.signal;
        this._cachedSummary = summary;
        this._onLocationResolved = onLocationResolved;
        this._lastHighlightOptions = options;

        if (SPECIAL_REGION_CODES.includes(summary.provinceCode)) {
            if (options.extendedLocation) {
                this._renderExtendedRegionPoint(provinceName, summary, options.extendedLocation);
                onLocationResolved?.({
                    ...options.extendedLocation,
                    isExtendedLocation: true,
                });
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
            return;
        }

        const theme = this._getTheme();
        const mapTitle = document.getElementById('mapTitle');
        const provinceCenter = this._locator.getProvinceCenter(this._geoJson, provinceName);

        this._ensureActive(token);
        this._chart.setOption({
            geo: {
                map: 'china',
                roam: true,
                zoom: 1.15,
                center: [104.5, 36],
                animationDurationUpdate: 0,
                scaleLimit: { min: 0.8, max: 18 },
                label: { show: true, color: theme.label, fontSize: 10, distance: 0 },
                emphasis: {
                    label: { show: true, color: theme.emphasisBorder, fontSize: 14, fontWeight: 'bold' },
                    itemStyle: {
                        areaColor: theme.emphasisArea,
                        borderColor: theme.emphasisBorder,
                        borderWidth: 2,
                        shadowBlur: 20,
                        shadowColor: theme.highlightShadow,
                    },
                },
                itemStyle: { areaColor: theme.area, borderColor: theme.border, borderWidth: 1 },
                regions: [{
                    name: provinceName,
                    itemStyle: {
                        areaColor: theme.highlightArea,
                        borderColor: theme.highlightBorder,
                        borderWidth: 2.5,
                        shadowBlur: 30,
                        shadowColor: theme.highlightShadow,
                    },
                    label: {
                        show: true,
                        color: '#fff',
                        fontSize: 13,
                        fontWeight: 'bold',
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
            },
            series: [],
        }, { replaceMerge: ['geo', 'series'] });

        if (mapTitle) mapTitle.textContent = provinceName;
        if (provinceCenter) {
            this._chart.setOption({
                geo: {
                    center: provinceCenter,
                    zoom: 3.5,
                    animationDurationUpdate: 1000,
                    animationEasingUpdate: 'cubicInOut',
                },
            });
        }

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
                resolvedLocation = this._locator.resolveLocationFromDistrict(summary, districtGeoJson, resolvedLocation);
            } catch (error) {
                if (error.name === 'AbortError') throw error;
            }
            this._ensureActive(token);
        }

        this._cachedResolvedLocation = resolvedLocation;
        this._cachedSummary = {
            ...this._cachedSummary,
            cityName: resolvedLocation.cityName || this._cachedSummary.cityName,
            countyName: resolvedLocation.countyName || this._cachedSummary.countyName,
        };

        if (!provinceGeoJson || !provinceCenter) {
            onLocationResolved?.(resolvedLocation);
            if (mapTitle) mapTitle.textContent = summary.ancestralHome;
            return;
        }

        this._provinceGeoJson = provinceGeoJson;
        this._loadedProvCode = provinceAdcode;
        this._districtGeoJson = districtGeoJson;
        this._loadedCityCode = districtGeoJson ? `${summary.cityCode}00` : null;
        this._currentBrowseProvince = {
            name: provinceName,
            code: summary.provinceCode,
            isQueryProvince: true,
        };

        await this._delay(500, token);

        const mapRegName = `prov_${summary.provinceCode}`;
        this._mapRegName = mapRegName;
        echarts.registerMap(mapRegName, provinceGeoJson);

        const provinceGeoCenter = this._locator.computeGeoJSONCenter(provinceGeoJson);
        const matchedFeature = this._locator.matchProvinceFeature(summary, provinceGeoJson, resolvedLocation);
        const resolvedCityName = matchedFeature?.properties?.name || resolvedLocation.cityName || summary.cityName || '';
        const matchedCity = resolvedCityName || summary.provinceName;
        if (resolvedCityName) this._cachedSummary.cityName = resolvedCityName;
        const cityCenter = this._locator.getFeatureCenter(matchedFeature);

        this._cachedCityName = matchedCity;
        this._cachedCityCenter = cityCenter;
        this._cachedDistrictCenter = null;
        this._cachedDistrictSeriesData = null;
        this._cachedDistrictName = null;
        this._selectedRegionName = matchedCity;

        this._chart.setOption({
            geo: {
                map: mapRegName,
                center: provinceGeoCenter || provinceCenter,
                zoom: 1.5,
                animationDurationUpdate: 0,
                scaleLimit: { min: 0.8, max: 18 },
                roam: true,
                label: { show: true, color: theme.label, fontSize: 10, distance: 0 },
                emphasis: {
                    label: { show: true, color: theme.emphasisBorder, fontSize: 14, fontWeight: 'bold' },
                    itemStyle: {
                        areaColor: theme.emphasisArea,
                        borderColor: theme.emphasisBorder,
                        borderWidth: 2,
                        shadowBlur: 20,
                        shadowColor: theme.highlightShadow,
                    },
                },
                itemStyle: { areaColor: theme.area, borderColor: theme.border, borderWidth: 1 },
                regions: [{
                    name: matchedCity,
                    itemStyle: {
                        areaColor: theme.highlightArea,
                        borderColor: theme.highlightBorder,
                        borderWidth: 2.5,
                        shadowBlur: 25,
                        shadowColor: theme.highlightShadow,
                    },
                    label: {
                        show: true,
                        color: '#fff',
                        fontSize: 14,
                        fontWeight: 'bold',
                        formatter: `{t|${matchedCity}}`,
                        rich: { t: { fontSize: 16, fontWeight: 'bold', color: '#fff', padding: [0, 0, 4, 0] } },
                    },
                }],
            },
            series: [],
        }, { replaceMerge: ['geo', 'series'] });

        this._currentView = 'province';
        this._showBackButton();

        this._chart.setOption({
            geo: {
                center: cityCenter || provinceGeoCenter || provinceCenter,
                zoom: 4.0,
                animationDurationUpdate: 1200,
                animationEasingUpdate: 'cubicInOut',
            },
        });
        if (resolvedCityName) {
            onLocationResolved?.({ ...resolvedLocation, cityName: resolvedCityName });
        }

        if (mapTitle) mapTitle.textContent = `${provinceName} · ${matchedCity}`;

        if (districtGeoJson && resolvedLocation.countyName) {
            await this._delay(1000, token);

            const districtMatch = this._locator.matchDistrictFeature(summary, districtGeoJson);
            if (districtMatch) {
                const cityMapRegName = `city_${summary.cityCode}`;
                this._cityMapRegName = cityMapRegName;
                echarts.registerMap(cityMapRegName, districtGeoJson);

                const districtCenter = this._locator.getFeatureCenter(districtMatch);
                const districtName = districtMatch.properties.name;
                const districtSeriesData = (districtGeoJson.features || []).map((feature) => {
                    const isTarget = feature === districtMatch;
                    return {
                        name: feature.properties.name,
                        itemStyle: isTarget ? {
                            areaColor: theme.highlightArea,
                            borderColor: theme.highlightBorder,
                            borderWidth: 2.5,
                            shadowBlur: 25,
                            shadowColor: theme.highlightShadow,
                        } : {
                            areaColor: 'transparent',
                            borderColor: theme.border,
                            borderWidth: 0.8,
                        },
                        label: isTarget ? {
                            show: true,
                            color: '#fff',
                            fontSize: 14,
                            fontWeight: 'bold',
                            formatter: `{t|${districtName}}`,
                            rich: { t: { fontSize: 16, fontWeight: 'bold', color: '#fff', padding: [0, 0, 4, 0] } },
                        } : { show: false },
                        emphasis: isTarget ? {
                            label: { show: true, color: '#fff', fontSize: 15, fontWeight: 'bold' },
                            itemStyle: {
                                areaColor: theme.highlightArea,
                                borderColor: theme.highlightBorder,
                                borderWidth: 3,
                                shadowBlur: 30,
                                shadowColor: theme.highlightShadow,
                            },
                        } : {
                            label: { show: true, color: theme.emphasisBorder, fontSize: 11 },
                            itemStyle: {
                                areaColor: theme.emphasisArea,
                                borderColor: theme.emphasisBorder,
                                borderWidth: 1.5,
                            },
                        },
                    };
                });

                this._cachedDistrictSeriesData = districtSeriesData;
                this._cachedDistrictCenter = districtCenter;
                this._cachedDistrictName = districtName;
                this._cachedSummary.countyName = districtName;

                this._chart.setOption({
                    geo: {
                        center: districtCenter,
                        zoom: 8.0,
                        animationDurationUpdate: 1500,
                        animationEasingUpdate: 'cubicInOut',
                    },
                    series: [{
                        type: 'map',
                        map: cityMapRegName,
                        geoIndex: 0,
                        roam: false,
                        silent: false,
                        data: districtSeriesData,
                    }],
                });

                if (mapTitle) mapTitle.textContent = summary.ancestralHome;
            }
        }
    }

    refreshTheme() {
        if (!this._chart || !this._geoJson) return;

        if (this._cachedSummary && SPECIAL_REGION_CODES.includes(this._cachedSummary.provinceCode)) {
            if (this._cachedResolvedLocation) {
                this._renderExtendedRegionPoint(
                    this._cachedSummary.provinceName,
                    this._cachedSummary,
                    this._cachedResolvedLocation
                );
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
        const geoCenter = this._locator.computeGeoJSONCenter(this._provinceGeoJson) || [104.5, 36];
        const geoRegions = [];
        if (this._cachedCityName) {
            geoRegions.push({
                name: this._cachedCityName,
                itemStyle: {
                    areaColor: theme.highlightArea,
                    borderColor: theme.highlightBorder,
                    borderWidth: 2.5,
                    shadowBlur: 25,
                    shadowColor: theme.highlightShadow,
                },
                label: {
                    show: true,
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 'bold',
                    formatter: `{t|${this._cachedCityName}}`,
                    rich: { t: { fontSize: 16, fontWeight: 'bold', color: '#fff', padding: [0, 0, 4, 0] } },
                },
            });
        }

        const seriesConfig = [];
        if (this._cachedDistrictSeriesData && this._cityMapRegName) {
            seriesConfig.push({
                type: 'map',
                map: this._cityMapRegName,
                geoIndex: 0,
                roam: false,
                silent: false,
                data: this._cachedDistrictSeriesData,
            });
        }

        let zoom = 1.5;
        let center = geoCenter;
        if (this._cachedDistrictCenter) {
            zoom = 8.0;
            center = this._cachedDistrictCenter;
        } else if (this._cachedCityCenter) {
            zoom = 4.0;
            center = this._cachedCityCenter;
        }

        this._chart.setOption({
            geo: {
                map: this._mapRegName,
                center,
                zoom,
                animationDurationUpdate: 0,
                scaleLimit: { min: 0.8, max: 18 },
                roam: true,
                label: { show: true, color: theme.label, fontSize: 10, distance: 0 },
                emphasis: {
                    label: { show: true, color: theme.emphasisBorder, fontSize: 14, fontWeight: 'bold' },
                    itemStyle: {
                        areaColor: theme.emphasisArea,
                        borderColor: theme.emphasisBorder,
                        borderWidth: 2,
                        shadowBlur: 20,
                        shadowColor: theme.highlightShadow,
                    },
                },
                itemStyle: { areaColor: theme.area, borderColor: theme.border, borderWidth: 1 },
                regions: geoRegions,
            },
            series: seriesConfig,
        }, { replaceMerge: ['geo', 'series'] });
    }

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
        this._mapRegName = null;
        this._cityMapRegName = null;
        this._currentView = 'national';
        this._hideBackButton();
        const mapTitle = document.getElementById('mapTitle');
        if (mapTitle) mapTitle.textContent = '中国行政区划图';
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
        const mapTitle = document.getElementById('mapTitle');
        const provinceName = this._cachedSummary?.provinceName || this._currentBrowseProvince?.name || '';
        const provinceCenter = this._locator.getProvinceCenter(this._geoJson, provinceName);

        this._hideBackButton();
        this._currentView = 'national';
        this._selectedRegionName = '';
        onReturnedToProvince?.({ name: provinceName, level: 'province', provinceName });

        echarts.registerMap('china', this._geoJson);
        this._chart.setOption({
            geo: {
                map: 'china',
                center: provinceCenter || [104.5, 36],
                zoom: 3.5,
                animationDurationUpdate: 600,
                animationEasingUpdate: 'cubicInOut',
                scaleLimit: { min: 0.8, max: 18 },
                roam: true,
                label: { show: true, color: theme.label, fontSize: 10, distance: 0 },
                emphasis: {
                    label: { show: true, color: theme.emphasisBorder, fontSize: 14, fontWeight: 'bold' },
                    itemStyle: {
                        areaColor: theme.emphasisArea,
                        borderColor: theme.emphasisBorder,
                        borderWidth: 2,
                        shadowBlur: 20,
                        shadowColor: theme.highlightShadow,
                    },
                },
                itemStyle: { areaColor: theme.area, borderColor: theme.border, borderWidth: 1 },
                regions: provinceName ? [{
                    name: provinceName,
                    itemStyle: {
                        areaColor: theme.highlightArea,
                        borderColor: theme.highlightBorder,
                        borderWidth: 2,
                        shadowBlur: 15,
                        shadowColor: theme.highlightShadow,
                    },
                    label: { show: true, color: theme.label, fontSize: 11, fontWeight: 'bold' },
                }] : [],
            },
            series: [],
        }, { replaceMerge: ['series'] });

        if (mapTitle) mapTitle.textContent = provinceName || '中国行政区划图';

        await this._delay(800, token);
        this._chart.setOption({
            geo: {
                center: [104.5, 36],
                zoom: 1.15,
                animationDurationUpdate: 1200,
                animationEasingUpdate: 'cubicInOut',
            },
        });

        await this._delay(1300, token);
        if (mapTitle) mapTitle.textContent = '中国行政区划图';
    }

    dispose() {
        this._abortPendingFetch();
        window.removeEventListener('resize', this._handleResize);
        this._chart?.off('click', this._handleMapClick);
        this._chart?.dispose();
        this._chart = null;
    }

    async _handleMapClickEvent(params) {
        if (!params?.name) return;
        if (this._currentView === 'national') {
            await this._handleNationalMapClick(params);
            return;
        }
    }

    async _handleNationalMapClick(params) {
        if (this._currentView !== 'national') return;
        if (this._cachedSummary && params.name === this._cachedSummary.provinceName) {
            const queryContext = this.beginQuery();
            try {
                await this.highlightProvince(
                    this._cachedSummary.provinceName,
                    this._cachedSummary,
                    this._onLocationResolved,
                    queryContext,
                    this._lastHighlightOptions || {}
                );
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('[ErrorBoundary] 地图重新定位失败', error);
                }
            }
            return;
        }
        await this.browseProvince(params.name);
    }

    async browseProvince(provinceName) {
        const provinceCode = getProvinceCodeByName(provinceName);
        if (!provinceCode || SPECIAL_REGION_CODES.includes(provinceCode)) return;

        const queryContext = this.beginQuery();
        const token = queryContext.token;
        const signal = queryContext.signal;
        const theme = this._getTheme();
        const mapTitle = document.getElementById('mapTitle');
        const provinceCenter = this._locator.getProvinceCenter(this._geoJson, provinceName);

        if (mapTitle) mapTitle.textContent = provinceName;
        if (provinceCenter) {
            this._chart.setOption({
                geo: {
                    map: 'china',
                    center: provinceCenter,
                    zoom: 3.5,
                    animationDurationUpdate: 800,
                    animationEasingUpdate: 'cubicInOut',
                    regions: [{
                        name: provinceName,
                        itemStyle: {
                            areaColor: theme.highlightArea,
                            borderColor: theme.highlightBorder,
                            borderWidth: 2.5,
                            shadowBlur: 24,
                            shadowColor: theme.highlightShadow,
                        },
                        label: { show: true, color: '#fff', fontSize: 14, fontWeight: 'bold' },
                    }],
                },
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

        await this._delay(350, token);
        echarts.registerMap(this._mapRegName, provinceGeoJson);
        const provinceGeoCenter = this._locator.computeGeoJSONCenter(provinceGeoJson);
        this._chart.setOption({
            geo: {
                map: this._mapRegName,
                center: provinceGeoCenter || provinceCenter || [104.5, 36],
                zoom: 1.5,
                animationDurationUpdate: 0,
                scaleLimit: { min: 0.8, max: 18 },
                roam: true,
                label: { show: true, color: theme.label, fontSize: 10, distance: 0 },
                emphasis: {
                    label: { show: true, color: theme.emphasisBorder, fontSize: 14, fontWeight: 'bold' },
                    itemStyle: {
                        areaColor: theme.emphasisArea,
                        borderColor: theme.emphasisBorder,
                        borderWidth: 2,
                        shadowBlur: 20,
                        shadowColor: theme.highlightShadow,
                    },
                },
                itemStyle: { areaColor: theme.area, borderColor: theme.border, borderWidth: 1 },
                regions: [],
            },
            series: [],
        }, { replaceMerge: ['geo', 'series'] });
        this._currentView = 'province';
        this._showBackButton();
    }


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
                try {
                    this._ensureActive(token);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            }, ms);
        });
    }

    _renderDefault() {
        this._renderer.renderDefault(this._chart);
    }

    _renderSpecialRegionHighlight(provinceName, summary) {
        const mapTitle = document.getElementById('mapTitle');
        const provinceCenter = this._locator.getProvinceCenter(this._geoJson, provinceName);
        this._cachedSummary = summary;

        this._renderer.renderSpecialRegionHighlight(this._chart, this._geoJson, provinceName, provinceCenter);
        this._currentView = 'province';
        this._currentBrowseProvince = { name: provinceName, code: summary.provinceCode, isQueryProvince: true };
        this._showBackButton();
        if (mapTitle) mapTitle.textContent = provinceName;
    }

    _renderExtendedRegionPoint(provinceName, summary, extendedLocation) {
        const mapTitle = document.getElementById('mapTitle');
        this._cachedSummary = summary;
        this._cachedResolvedLocation = extendedLocation;
        this._currentView = 'province';
        this._currentBrowseProvince = { name: provinceName, code: summary.provinceCode, isQueryProvince: true };
        this._showBackButton();

        this._renderer.renderExtendedRegionPoint(this._chart, this._geoJson, provinceName, extendedLocation);
        if (mapTitle) mapTitle.textContent = `${provinceName} · ${extendedLocation.name}`;
    }

    _getTheme() {
        return this._renderer.getTheme();
    }

    _showBackButton() {
        const button = document.getElementById('btnBackNational');
        if (button) {
            button.classList.add('visible');
            window.setTimeout(() => button.focus(), 100);
        }
    }

    _hideBackButton() {
        const button = document.getElementById('btnBackNational');
        button?.classList.remove('visible');
    }
}
