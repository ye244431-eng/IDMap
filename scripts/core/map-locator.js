import { MUNICIPALITY_CODES } from '../data/region-data.js';

export class MapLocator {
    resolveLocationFromProvince(summary, provinceGeoJson) {
        if (!provinceGeoJson?.features) {
            return { cityName: '', countyName: '' };
        }

        const cityFeature = provinceGeoJson.features.find((feature) => {
            const adcode = this.getAdcode(feature);
            return adcode.startsWith(summary.cityCode);
        });

        return {
            cityName: cityFeature?.properties?.name || '',
            countyName: '',
        };
    }

    resolveLocationFromDistrict(summary, districtGeoJson, fallbackLocation) {
        const districtFeature = this.matchDistrictFeature(summary, districtGeoJson);
        return {
            cityName: fallbackLocation.cityName || districtFeature?.properties?.name || '',
            countyName: districtFeature?.properties?.name || '',
        };
    }

    matchProvinceFeature(summary, provinceGeoJson, resolvedLocation) {
        const features = provinceGeoJson?.features || [];
        return features.find((feature) => {
            const adcode = this.getAdcode(feature);
            if (MUNICIPALITY_CODES.includes(summary.provinceCode)) {
                return feature.properties.name === (resolvedLocation.countyName || resolvedLocation.cityName);
            }
            return adcode.startsWith(summary.cityCode) || feature.properties.name === resolvedLocation.cityName;
        }) || null;
    }

    matchDistrictFeature(summary, districtGeoJson) {
        const features = districtGeoJson?.features || [];
        return features.find((feature) => {
            const adcode = this.getAdcode(feature);
            if (adcode === summary.countyCode || adcode.substring(0, 6) === summary.countyCode) {
                return true;
            }
            const districtKey = summary.provinceCode + summary.countyCode.substring(4, 6);
            return adcode === districtKey;
        }) || null;
    }

    getProvinceCenter(geoJson, name) {
        if (!geoJson?.features) return null;
        const feature = geoJson.features.find((item) => item.properties.name === name);
        return this.getFeatureCenter(feature);
    }

    getFeatureCenter(feature) {
        if (!feature?.geometry) return null;
        const props = feature.properties || {};
        if (Array.isArray(props.centroid) && props.centroid.length === 2) return props.centroid;
        if (Array.isArray(props.center) && props.center.length === 2) return props.center;

        const points = this.collectGeometryPoints(feature.geometry);
        if (points.length === 0) return null;
        return this.averagePoints(points);
    }

    computeGeoJSONCenter(geoJson) {
        if (!geoJson?.features) return null;
        const points = [];
        geoJson.features.forEach((feature) => {
            if (feature.geometry) points.push(...this.collectGeometryPoints(feature.geometry));
        });
        if (points.length === 0) return null;
        return this.averagePoints(points);
    }

    getAdcode(feature) {
        return String(feature?.properties?.adcode || feature?.properties?.ADCODE || '');
    }

    collectGeometryPoints(geometry) {
        const points = [];
        if (!Array.isArray(geometry?.coordinates)) return points;

        const walk = (coords) => {
            if (!Array.isArray(coords)) return;
            if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
                points.push([coords[0], coords[1]]);
                return;
            }
            coords.forEach(walk);
        };
        walk(geometry.coordinates);
        return points;
    }

    averagePoints(points) {
        let sumX = 0;
        let sumY = 0;
        points.forEach(([x, y]) => {
            sumX += x;
            sumY += y;
        });
        return [sumX / points.length, sumY / points.length];
    }
}
