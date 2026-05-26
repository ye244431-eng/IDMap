export class MapRenderer {
    getTheme() {
        const style = getComputedStyle(document.documentElement);
        return {
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
    }

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
                zoom: 1.15,
                center: [104.5, 36],
                scaleLimit: { min: 0.8, max: 18 },
                label: { show: true, color: theme.label, fontSize: 10, distance: 0 },
                emphasis: this.createGeoEmphasis(theme),
                itemStyle: { areaColor: theme.area, borderColor: theme.border, borderWidth: 1 },
                regions: [],
            },
            series: [],
        }, true);
    }

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
                type: 'effectScatter',
                coordinateSystem: 'geo',
                zlevel: 3,
                rippleEffect: { scale: 4, brushType: 'stroke' },
                symbolSize: 16,
                data: [{
                    name: extendedLocation.name,
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
