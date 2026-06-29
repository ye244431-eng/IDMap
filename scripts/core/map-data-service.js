// GeoJSON 加载与缓存：分别按全国 / 省 / 市三级管理 GeoJSON。
// 加载策略统一为"本地优先 → DataV CDN 兜底"，减少远程依赖并应对离线场景。
// 所有 fetch 透传 AbortSignal，便于上层在用户切换查询时立即取消未完成请求。

// LRU 上限：长会话中连续查询大量身份证时，避免 GeoJSON 在内存里无限堆积
const PROVINCE_CACHE_LIMIT = 16;
const DISTRICT_CACHE_LIMIT = 16;

export class MapDataService {
    constructor() {
        this._nationalCache = null;
        // 用 Map 而非对象：插入顺序即访问顺序，先 delete 再 set 即可实现 LRU
        this._provinceCache = new Map();
        this._districtCache = new Map();
    }

    // 命中时把条目挪到尾部（最近使用）；写入超限时淘汰头部（最久未用）
    _touchCache(cache, key) {
        const value = cache.get(key);
        cache.delete(key);
        cache.set(key, value);
        return value;
    }

    _putWithLimit(cache, key, value, limit) {
        cache.set(key, value);
        while (cache.size > limit) {
            const oldest = cache.keys().next().value;
            cache.delete(oldest);
        }
    }

    async loadNational(signal) {
        if (this._nationalCache) return this._nationalCache;

        try {
            const localGeoJson = await this._fetchJSON('./assets/maps/china.json', signal);
            this._nationalCache = localGeoJson;
            return localGeoJson;
        } catch (error) {
            // AbortError 必须冒泡，让上层感知到主动取消；其他错误降级到远程兜底
            if (error.name === 'AbortError') throw error;
        }

        // DataV 提供两种 URL 形态，逐一尝试以提高可用性
        const remoteUrls = [
            'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json',
            'https://geo.datav.aliyun.com/areas_v3/bound/geojson/china.json',
        ];

        for (const url of remoteUrls) {
            try {
                const geoJson = await this._fetchJSON(url, signal);
                this._nationalCache = geoJson;
                return geoJson;
            } catch (error) {
                if (error.name === 'AbortError') throw error;
            }
        }

        throw new Error('Failed to load national geojson');
    }

    async loadProvince(provinceAdcode, signal) {
        if (this._provinceCache.has(provinceAdcode)) {
            return this._touchCache(this._provinceCache, provinceAdcode);
        }

        // 省级 GeoJSON 命名约定：prov_<6 位 adcode>.json，例如 prov_440000.json 对应广东省
        const localUrl = `./assets/maps/prov_${provinceAdcode}.json`;
        const remoteUrls = [
            `https://geo.datav.aliyun.com/areas_v3/bound/${provinceAdcode}_full.json`,
            `https://geo.datav.aliyun.com/areas_v3/bound/geojson?code=${provinceAdcode}`,
        ];

        try {
            const geoJson = await this._fetchJSON(localUrl, signal);
            this._putWithLimit(this._provinceCache, provinceAdcode, geoJson, PROVINCE_CACHE_LIMIT);
            return geoJson;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
        }

        for (const url of remoteUrls) {
            try {
                const geoJson = await this._fetchJSON(url, signal);
                this._putWithLimit(this._provinceCache, provinceAdcode, geoJson, PROVINCE_CACHE_LIMIT);
                return geoJson;
            } catch (error) {
                if (error.name === 'AbortError') throw error;
            }
        }

        throw new Error(`Failed to load province geojson: ${provinceAdcode}`);
    }

    async loadDistrict(cityAdcode, signal) {
        if (this._districtCache.has(cityAdcode)) {
            return this._touchCache(this._districtCache, cityAdcode);
        }

        // 市级（含区县）GeoJSON 命名：city_<6 位 adcode>.json，例如 city_440300.json 对应深圳市
        const localUrl = `./assets/maps/city_${cityAdcode}.json`;
        const remoteUrls = [
            `https://geo.datav.aliyun.com/areas_v3/bound/${cityAdcode}_full.json`,
            `https://geo.datav.aliyun.com/areas_v3/bound/geojson?code=${cityAdcode}`,
        ];

        try {
            const geoJson = await this._fetchJSON(localUrl, signal);
            this._putWithLimit(this._districtCache, cityAdcode, geoJson, DISTRICT_CACHE_LIMIT);
            return geoJson;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
        }

        for (const url of remoteUrls) {
            try {
                const geoJson = await this._fetchJSON(url, signal);
                this._putWithLimit(this._districtCache, cityAdcode, geoJson, DISTRICT_CACHE_LIMIT);
                return geoJson;
            } catch (error) {
                if (error.name === 'AbortError') throw error;
            }
        }

        throw new Error(`Failed to load district geojson: ${cityAdcode}`);
    }

    async _fetchJSON(url, signal) {
        const response = await fetch(url, { signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    }
}
