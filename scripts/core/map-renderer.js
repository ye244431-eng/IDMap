// ECharts 配置渲染器：把主题色与三种地图视觉形态（默认 / 港澳台高亮 / 港澳台扩展点位）
// 封装成可复用的 setOption 调用。所有颜色读自 CSS 变量，便于跟随暗色/亮色主题切换。
export class MapRenderer {
    constructor() {
        // getComputedStyle 会触发样式系统重算；缓存按 data-theme 失效，避免在每帧 georoam 中重复计算
        this._themeCache = null;
        this._themeCacheKey = null;
    }

    // 主题切换由 ChinaMapDisplay.refreshTheme 显式触发，让缓存按用户操作精确失效
    invalidateTheme() {
        this._themeCache = null;
        this._themeCacheKey = null;
    }

    // 从根元素的 CSS 变量读取主题色；同一 data-theme 下复用缓存，节省 getComputedStyle 调用
    getTheme() {
        const themeKey = document.documentElement.getAttribute('data-theme') || '';
        if (this._themeCache && this._themeCacheKey === themeKey) {
            return this._themeCache;
        }

        const style = getComputedStyle(document.documentElement);
        const theme = {
            area: style.getPropertyValue('--map-area').trim() || '#eef2f7',
            border: style.getPropertyValue('--map-border').trim() || '#c8cdd8',
            label: style.getPropertyValue('--map-label').trim() || '#8b92a0',
            emphasisArea: style.getPropertyValue('--map-emphasis-area').trim() || 'rgba(59,89,152,0.2)',
            emphasisBorder: style.getPropertyValue('--map-emphasis-border').trim() || '#3B5998',
            highlightArea: style.getPropertyValue('--map-highlight-area').trim() || '#3B5998',
            highlightBorder: style.getPropertyValue('--map-highlight-border').trim() || '#2d4373',
            highlightShadow: style.getPropertyValue('--map-highlight-shadow').trim() || 'rgba(59,89,152,0.4)',
            tooltipBg: style.getPropertyValue('--tooltip-bg').trim() || '#fff',
            tooltipBorder: style.getPropertyValue('--tooltip-border').trim() || '#d1d5db',
            tooltipText: style.getPropertyValue('--tooltip-text').trim() || '#1e1e2e',
            highlightTitle: style.getPropertyValue('--map-highlight-title').trim() || '#1e3a5f',
        };
        this._themeCache = theme;
        this._themeCacheKey = themeKey;
        return theme;
    }

    // 默认全国地图视图：未查询时展示
    renderDefault(chart) {
        const theme = this.getTheme();
        chart.setOption({
            tooltip: {
                trigger: 'item',
                backgroundColor: theme.tooltipBg,
                borderColor: theme.tooltipBorder,
                textStyle: { color: theme.tooltipText, fontSize: 14 },
                formatter: (params) => `<strong style="font-size:16px">${params.name}</strong>`,
            },
            geo: {
                map: 'china',
                roam: true,
                // zoom 1.15 + center [104.5, 36] 是经验值，使大陆轮廓在常见容器尺寸下居中且南海诸岛可见
                zoom: 1.15,
                center: [104.5, 36],
                scaleLimit: { min: 0.8, max: 18 },
                label: { show: true, color: theme.label, fontSize: 10, distance: 0 },
                emphasis: this.createGeoEmphasis(theme),
                itemStyle: { areaColor: theme.area, borderColor: theme.border, borderWidth: 1 },
                regions: [],
            },
            series: [],
            // 第三参数 true 表示 notMerge：彻底替换上一次配置，避免残留状态
        }, true);
    }

    // 港澳台无精确区县数据时的兜底视图：仅在全国地图上把整个特别行政区高亮
    renderSpecialRegionHighlight(chart, geoJson, provinceName, provinceCenter) {
        const theme = this.getTheme();
        echarts.registerMap('china', geoJson);
        chart.setOption({
            geo: {
                map: 'china',
                roam: true,
                zoom: 1.15,
                center: [104.5, 36],
                animationDurationUpdate: 0,
                scaleLimit: { min: 0.8, max: 18 },
                label: { show: true, color: theme.label, fontSize: 10, distance: 0 },
                emphasis: this.createGeoEmphasis(theme),
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
                    label: { show: true, color: '#fff', fontSize: 13, fontWeight: 'bold' },
                }],
            },
            series: [],
        }, { replaceMerge: ['geo', 'series'] });

        // 拆成两次 setOption：第一次定基线、第二次触发缩放动画。一次性写入会让 ECharts 跳过过渡。
        if (provinceCenter) {
            chart.setOption({
                geo: {
                    center: provinceCenter,
                    zoom: 4.0,
                    animationDurationUpdate: 1000,
                    animationEasingUpdate: 'cubicInOut',
                },
            });
        }
    }

    // 港澳台扩展定位：用户手动选择具体区县时，用 effectScatter 涟漪点替代多边形高亮
    renderExtendedRegionPoint(chart, geoJson, provinceName, extendedLocation) {
        const theme = this.getTheme();
        echarts.registerMap('china', geoJson);
        chart.setOption({
            geo: {
                map: 'china',
                roam: true,
                center: extendedLocation.center,
                zoom: 4.0,
                animationDurationUpdate: 1000,
                animationEasingUpdate: 'cubicInOut',
                scaleLimit: { min: 0.8, max: 18 },
                label: { show: true, color: theme.label, fontSize: 10, distance: 0 },
                emphasis: this.createGeoEmphasis(theme),
                itemStyle: { areaColor: theme.area, borderColor: theme.border, borderWidth: 1 },
                regions: [{
                    name: provinceName,
                    itemStyle: {
                        areaColor: theme.emphasisArea,
                        borderColor: theme.highlightBorder,
                        borderWidth: 2,
                        shadowBlur: 18,
                        shadowColor: theme.highlightShadow,
                    },
                }],
            },
            series: [{
                // effectScatter 自带涟漪动画，比静态 scatter 更显眼，便于在小区域内引导视觉焦点
                type: 'effectScatter',
                coordinateSystem: 'geo',
                // zlevel 3 让点位绘制在 geo 图层之上，避免被省级多边形遮挡
                zlevel: 3,
                rippleEffect: { scale: 4, brushType: 'stroke' },
                symbolSize: 16,
                data: [{
                    name: extendedLocation.name,
                    // value 第三项是占位计数，仅为满足 ECharts 数据格式需要
                    value: [...extendedLocation.center, 1],
                }],
                label: {
                    show: true,
                    formatter: `{t|${extendedLocation.name}}`,
                    position: 'right',
                    rich: {
                        t: {
                            color: theme.highlightTitle,
                            fontSize: 14,
                            fontWeight: 'bold',
                            backgroundColor: theme.tooltipBg,
                            borderColor: theme.tooltipBorder,
                            borderWidth: 1,
                            padding: [4, 8],
                        },
                    },
                },
                itemStyle: {
                    color: theme.highlightArea,
                    shadowBlur: 18,
                    shadowColor: theme.highlightShadow,
                },
            }],
        }, { replaceMerge: ['geo', 'series'] });
    }

    // emphasis（鼠标悬停）样式抽成共用方法，三种视图共用同一组高亮反馈
    createGeoEmphasis(theme) {
        return {
            label: { show: true, color: theme.emphasisBorder, fontSize: 14, fontWeight: 'bold' },
            itemStyle: {
                areaColor: theme.emphasisArea,
                borderColor: theme.emphasisBorder,
                borderWidth: 2,
                shadowBlur: 20,
                shadowColor: theme.highlightShadow,
            },
        };
    }
}
