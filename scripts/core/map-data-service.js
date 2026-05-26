export class MapDataService {
    constructor() {
        this._nationalCache = null;
        this._provinceCache = new Map();
        this._districtCache = new Map();
    }

    async loadNational(signal) {
        if (this._nationalCache) return this._nationalCache;

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

        const localGeoJson = await this._fetchJSON('./assets/maps/china.json', signal);
        this._nationalCache = localGeoJson;
        return localGeoJson;
    }

    async loadProvince(provinceAdcode, signal) {
        if (this._provinceCache.has(provinceAdcode)) {
            return this._provinceCache.get(provinceAdcode);
        }

        const localUrl = `./assets/maps/prov_${provinceAdcode}.json`;
        const remoteUrls = [
            `https://geo.datav.aliyun.com/areas_v3/bound/${provinceAdcode}_full.json`,
            `https://geo.datav.aliyun.com/areas_v3/bound/geojson?code=${provinceAdcode}`,
        ];

        try {
            const geoJson = await this._fetchJSON(localUrl, signal);
            this._provinceCache.set(provinceAdcode, geoJson);
            return geoJson;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
        }

        for (const url of remoteUrls) {
            try {
                const geoJson = await this._fetchJSON(url, signal);
                this._provinceCache.set(provinceAdcode, geoJson);
                return geoJson;
            } catch (error) {
                if (error.name === 'AbortError') throw error;
            }
        }

        throw new Error(`Failed to load province geojson: ${provinceAdcode}`);
    }

    async loadDistrict(cityAdcode, signal) {
        if (this._districtCache.has(cityAdcode)) {
            return this._districtCache.get(cityAdcode);
        }

        const localUrl = `./assets/maps/city_${cityAdcode}.json`;
        const remoteUrls = [
            `https://geo.datav.aliyun.com/areas_v3/bound/${cityAdcode}_full.json`,
            `https://geo.datav.aliyun.com/areas_v3/bound/geojson?code=${cityAdcode}`,
        ];

        try {
            const geoJson = await this._fetchJSON(localUrl, signal);
            this._districtCache.set(cityAdcode, geoJson);
            return geoJson;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
        }

        for (const url of remoteUrls) {
            try {
                const geoJson = await this._fetchJSON(url, signal);
                this._districtCache.set(cityAdcode, geoJson);
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
