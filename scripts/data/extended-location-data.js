// 港澳台扩展定位数据：DataV 没有这些地区的区县级 GeoJSON，
// 在身份证号无法解析到具体区县时，由用户在 UI 上手选一个代表点，
// 地图会用 effectScatter 在对应坐标处展示涟漪标记。
// 数据中的 center 是 [经度, 纬度]，与 ECharts geo 坐标系一致。

// 台湾扩展定位组：直辖市 + 部分县。71 与 83 共用同一组数据，因此提取成常量复用。
const TAIWAN_EXTENDED_GROUP = {
    label: '台湾扩展定位',
    defaultId: 'taipei',
    locations: [
        { id: 'taipei', name: '台北市', center: [121.5654, 25.0330] },
        { id: 'new-taipei', name: '新北市', center: [121.4657, 25.0120] },
        { id: 'taoyuan', name: '桃园市', center: [121.3009, 24.9936] },
        { id: 'taichung', name: '台中市', center: [120.6736, 24.1477] },
        { id: 'tainan', name: '台南市', center: [120.2270, 22.9999] },
        { id: 'kaohsiung', name: '高雄市', center: [120.3014, 22.6273] },
        { id: 'hualien', name: '花莲县', center: [121.6015, 23.9872] },
    ],
};

// 按身份证省级编码（前 2 位）组织的扩展定位数据
export const EXTENDED_LOCATION_GROUPS = {
    '71': TAIWAN_EXTENDED_GROUP,
    '83': TAIWAN_EXTENDED_GROUP,
    '81': {
        label: '香港扩展定位',
        defaultId: 'central-western',
        locations: [
            { id: 'central-western', name: '中西区', center: [114.1544, 22.2819] },
            { id: 'wan-chai', name: '湾仔区', center: [114.1820, 22.2760] },
            { id: 'eastern', name: '东区', center: [114.2250, 22.2790] },
            { id: 'southern', name: '南区', center: [114.1600, 22.2450] },
            { id: 'yau-tsim-mong', name: '油尖旺区', center: [114.1700, 22.3110] },
            { id: 'kowloon-city', name: '九龙城区', center: [114.1890, 22.3280] },
            { id: 'sha-tin', name: '沙田区', center: [114.1950, 22.3790] },
            { id: 'islands', name: '离岛区', center: [113.9460, 22.2860] },
        ],
    },
    '82': {
        label: '澳门扩展定位',
        defaultId: 'macau-peninsula',
        locations: [
            { id: 'macau-peninsula', name: '澳门半岛', center: [113.5491, 22.1987] },
            { id: 'our-lady-fatima', name: '花地玛堂区', center: [113.5480, 22.2110] },
            { id: 'st-anthony', name: '圣安多尼堂区', center: [113.5430, 22.2000] },
            { id: 'cathedral', name: '大堂区', center: [113.5480, 22.1910] },
            { id: 'st-lawrence', name: '风顺堂区', center: [113.5360, 22.1870] },
            { id: 'taipa', name: '氹仔', center: [113.5600, 22.1550] },
            { id: 'coloane', name: '路环', center: [113.5650, 22.1160] },
        ],
    },
};

export function getExtendedLocationGroup(provinceCode) {
    return EXTENDED_LOCATION_GROUPS[provinceCode] || null;
}

// 获取具体扩展点位：locationId 优先 → 该组 defaultId → 列表第一项。
// 多重 fallback 让调用方在传空字符串或非法 id 时也能拿到合理结果。
export function getExtendedLocation(provinceCode, locationId) {
    const group = getExtendedLocationGroup(provinceCode);
    if (!group) return null;
    return group.locations.find((location) => location.id === locationId)
        || group.locations.find((location) => location.id === group.defaultId)
        || group.locations[0]
        || null;
}
