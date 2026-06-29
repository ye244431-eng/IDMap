# IDMapcon

静态网页应用，用于解析中国居民身份证号码，并在 ECharts 地图上定位对应的行政区划。

## 运行

```bash
npm run serve
```

打开 `http://127.0.0.1:8787/idmap.html`。

## 检查与测试

```bash
npm run check
npm test
```

`npm run check` 对 JavaScript 模块进行语法检查。`npm test` 覆盖身份证解析、港澳台扩展位置回退以及纯地图位置匹配逻辑。

## 项目结构

- `idmap.html`：主入口页。
- `styles/idmap.css`：布局、主题、地图和表单样式。
- `scripts/app.js`：页面编排、事件处理、查询流程。
- `scripts/core/parser.js`：身份证校验与个人信息解析。
- `scripts/core/china-map-display.js`：地图交互流程。
- `scripts/core/map-data-service.js`：GeoJSON 加载与缓存。
- `scripts/core/map-locator.js`：纯地图要素匹配与中心点计算。
- `scripts/core/map-renderer.js`：ECharts 配置项渲染。
- `scripts/data`：地区、日历及扩展位置数据。
- `assets/maps/china.json`：本地全国地图备用文件。
- `vendor/echarts/echarts-loader.js`：当完整 vendor 文件不可用时，用于加载固定版本 ECharts 5.5.0 CDN 脚本的本地加载器。

## 第三方资源

ECharts 固定使用 5.5.0 版本。推荐使用本地 `vendor/echarts/echarts.min.js` 文件；由于当前环境无法下载 CDN 文件，本项目目前使用 `vendor/echarts/echarts-loader.js`。

## 隐私说明

身份证号码仅在浏览器本地解析，应用不会上传、持久化或将输入值放入 URL。请勿在日志、截图、Issue 或公开演示中使用真实身份证号码；内置演示按钮使用测试号码。

## 当前限制

- 已补齐的全国图、常用省份和部分常见城市可走本地 GeoJSON；未补齐的省/市/区县仍依赖远程 DataV GeoJSON 响应。
- 香港、澳门和台湾的身份证地区码不包含精确的区县坐标，因此扩展位置模式使用用户选择的代表性中心点。
- 农历数据为静态数据，支持更晚年份时需手动维护。
