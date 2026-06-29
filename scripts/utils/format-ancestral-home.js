import { MUNICIPALITY_CODES } from '../data/region-data.js';

// 共享籍贯格式化：拼接 省/市/区县，处理直辖市与港澳台的显示逻辑
export function formatAncestralHome({ provinceCode, provinceName, cityName, countyName }) {
    if (MUNICIPALITY_CODES.includes(provinceCode)) {
        if (countyName) return `${provinceName} ${countyName}`;
        return cityName && cityName !== provinceName ? `${provinceName} ${cityName}` : provinceName;
    }
    if (cityName) return `${provinceName} ${cityName}`;
    if (countyName) return `${provinceName} ${countyName}`;
    return provinceName;
}
