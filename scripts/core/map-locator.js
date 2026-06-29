import { MUNICIPALITY_CODES } from '../data/region-data.js';

// 纯地图要素匹配工具：负责把身份证地址码（adcode 前缀）对应到 GeoJSON feature，
// 并计算行政区中心点。所有方法都是无副作用的纯函数式调用。
export class MapLocator {
    // 在省级 GeoJSON 中按身份证前 4 位（市级 adcode）找到所属城市的 feature
    resolveLocationFromProvince(summary, provinceGeoJson) {
        if (!provinceGeoJson?.features) {
            return { cityName: '', countyName: '' };
        }

        // adcode 前 4 位即市级编码，因此用 startsWith 匹配能命中该市下任意区县
        const cityFeature = provinceGeoJson.features.find((feature) => {
            const adcode = this.getAdcode(feature);
            return adcode.startsWith(summary.cityCode);
        });

        return {
            cityName: cityFeature?.properties?.name || '',
            countyName: '',
        };
    }

    // 在市级 GeoJSON 中匹配区县。直辖市没有"市"这一层级，城市名沿用上一步 fallback 的省名/市名。
    resolveLocationFromDistrict(summary, districtGeoJson, fallbackLocation) {
        const districtFeature = this.matchDistrictFeature(summary, districtGeoJson);
        return {
            cityName: fallbackLocation.cityName || districtFeature?.properties?.name || '',
            countyName: districtFeature?.properties?.name || '',
        };
    }

    // 在省级 GeoJSON 中找到要高亮的 feature
    matchProvinceFeature(summary, provinceGeoJson, resolvedLocation) {
        const features = provinceGeoJson?.features || [];
        return features.find((feature) => {
            const adcode = this.getAdcode(feature);
            // 直辖市的省级 GeoJSON 实际是区县级，所以按已解析的区县/城市名进行字符串匹配
            if (MUNICIPALITY_CODES.includes(summary.provinceCode)) {
                return feature.properties.name === (resolvedLocation.countyName || resolvedLocation.cityName);
            }
            // 普通省份：优先按市级 adcode 前缀匹配；命名差异时回退到城市名匹配
            return adcode.startsWith(summary.cityCode) || feature.properties.name === resolvedLocation.cityName;
        }) || null;
    }

    // 在市级 GeoJSON 中找到目标区县 feature
    matchDistrictFeature(summary, districtGeoJson) {
        const features = districtGeoJson?.features || [];
        return features.find((feature) => {
            const adcode = this.getAdcode(feature);
            if (adcode === summary.countyCode || adcode.substring(0, 6) === summary.countyCode) {
                return true;
            }
            // 兼容拼接形式：部分数据源把直辖市区县编码写成"省 + 区县后两位"的 6 位拼接
            const districtKey = summary.provinceCode + summary.countyCode.substring(4, 6);
            return adcode === districtKey;
        }) || null;
    }

    getProvinceCenter(geoJson, name) {
        if (!geoJson?.features) return null;
        const feature = geoJson.features.find((item) => item.properties.name === name);
        return this.getFeatureCenter(feature);
    }

    // 提取 feature 的几何中心。GeoJSON 元数据中可能直接附带 centroid/center；
    // 若都缺失，则退化为遍历几何体所有顶点求平均坐标。
    getFeatureCenter(feature) {
        if (!feature?.geometry) return null;
        const props = feature.properties || {};
        if (Array.isArray(props.centroid) && props.centroid.length === 2) return props.centroid;
        if (Array.isArray(props.center) && props.center.length === 2) return props.center;

        const points = this.collectGeometryPoints(feature.geometry);
        if (points.length === 0) return null;
        return this.averagePoints(points);
    }

    // 计算整张 GeoJSON 的几何中心，用于聚焦到省级整体视图
    computeGeoJSONCenter(geoJson) {
        if (!geoJson?.features) return null;
        const points = [];
        geoJson.features.forEach((feature) => {
            if (feature.geometry) points.push(...this.collectGeometryPoints(feature.geometry));
        });
        if (points.length === 0) return null;
        return this.averagePoints(points);
    }

    // 不同数据源的属性大小写不一（adcode vs ADCODE），统一规范化为字符串
    getAdcode(feature) {
        return String(feature?.properties?.adcode || feature?.properties?.ADCODE || '');
    }

    // 递归展开 Polygon / MultiPolygon 的嵌套坐标数组，收集到最底层的 [lng, lat] 坐标对
    collectGeometryPoints(geometry) {
        const points = [];
        if (!Array.isArray(geometry?.coordinates)) return points;

        const walk = (coords) => {
            if (!Array.isArray(coords)) return;
            // 终止条件：到达 [number, number] 这一层即为单个坐标点
            if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
                points.push([coords[0], coords[1]]);
                return;
            }
            coords.forEach(walk);
        };
        walk(geometry.coordinates);
        return points;
    }

    // 顶点平均值近似几何中心；对常规省/市轮廓足够精确，且无需依赖外部几何库
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
