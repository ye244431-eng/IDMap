# IDMapcon 开发文档

> 中国身份证地图查询系统 — 静态网页应用，解析 18 位居民身份证号码并在 ECharts 地图上分级定位行政区划。

文档版本：2026-06-16
适用代码版本：基于当前 `main` 分支工作树（含未提交的本地 GeoJSON 与脚本调整）

---

## 1. 项目定位与目标

- **形态**：纯前端静态站点。无需后端，单页应用，资源由静态服务器（如 `python -m http.server`）直接提供。
- **核心能力**：
  1. 在浏览器本地校验并解析 18 位身份证号码（GB 11643-1999 / ISO 7064:1983 MOD 11-2）。
  2. 提取出生日期、性别、星座、生肖、籍贯（省/市/区县）。
  3. 在 ECharts 地图上完成 **全国 → 省级 → 市级 → 区县** 的分层缩放与高亮，并把信息卡片绘制到地图上。
  4. 处理港澳台特殊地区：DataV 无精确区县 GeoJSON，提供"扩展定位"让用户手选代表点，使用 effectScatter 涟漪点位标记。
- **隐私约束**：身份证号码仅在浏览器本地解析，不上传、不写入 URL、不持久化到 storage（仅主题偏好存 localStorage）。

---

## 2. 技术栈与运行环境

| 层级 | 选型 | 备注 |
| --- | --- | --- |
| 运行时 | 现代浏览器（支持 ES2020 模块、`fetch`、`AbortController`、`MutationObserver`、`requestAnimationFrame`） | 入口 `idmap.html` 通过 `<script type="module">` 加载 `scripts/app.js` |
| 可视化 | ECharts 5.5.0（固定版本） | 通过 `vendor/echarts/echarts-loader.js` 本地优先 + CDN 兜底加载 |
| 地图数据 | 本地 `assets/maps/*.json` + DataV GeoAtlas 兜底 | 命名约定：`china.json` / `prov_<6位adcode>.json` / `city_<6位adcode>.json` |
| 模块系统 | 原生 ES Module（`package.json` 设 `"type": "module"`） | 不引入打包器，无构建步骤 |
| 脚本工具 | Node.js（仅用于本地静态服务器、语法检查、单元测试） | 见 `package.json` 的 `scripts` 字段 |
| 测试 | `node --test` 替代品：`tests/run-tests.mjs` 使用 `node:assert/strict` | 不依赖第三方测试框架 |
| 语法检查 | `node --check`（在 `scripts/check-syntax.mjs` 中递归执行） | 排除 `.git` 与 `node_modules` |

启动与校验命令（见 `package.json`）：

```bash
npm run serve     # 启动本地静态服务于 http://127.0.0.1:8787
npm run check     # 对全部 JS 文件做 node --check 语法检查
npm test          # 运行解析器、扩展定位、地图定位逻辑的断言测试
```

---

## 3. 目录结构

```
IDMapcon/
├── idmap.html                          # 单页入口（页面骨架、DOM 元素、ECharts 加载位置）
├── package.json                        # 仅声明本地脚本，不依赖任何 npm 包
├── styles/
│   └── idmap.css                       # 主题变量、地图与表单布局、暗/亮色切换样式
├── scripts/
│   ├── app.js                          # 应用入口：DOM 绑定、查询编排、UI 状态机
│   ├── check-syntax.mjs                # 递归 node --check 自检脚本
│   ├── core/
│   │   ├── parser.js                   # IDCardParser + PersonalInfo（校验、出生日期、性别、星座、生肖、籍贯）
│   │   ├── china-map-display.js        # ChinaMapDisplay：地图状态机与分级缩放编排
│   │   ├── map-data-service.js         # GeoJSON 加载（本地优先 + DataV 兜底 + LRU 缓存）
│   │   ├── map-locator.js              # 纯函数：feature 匹配、几何中心计算
│   │   └── map-renderer.js             # ECharts 配置渲染：默认/特别地区/扩展点位
│   ├── data/
│   │   ├── region-data.js              # PROVINCE_MAP / CITY_MAP / 直辖市 / 港澳台编码与提示
│   │   ├── calendar-data.js            # 12 星座区间、生肖、农历春节查询表（1920-2030）
│   │   └── extended-location-data.js   # 港澳台扩展定位：代表性中心点
│   └── utils/
│       └── format-ancestral-home.js    # 籍贯字符串拼接（共享逻辑，避免直辖市重复）
├── assets/
│   └── maps/
│       ├── china.json                  # 全国 GeoJSON（备用本地文件）
│       ├── prov_<adcode>.json          # 已补齐的省级 GeoJSON（北京、上海、广东等）
│       └── city_<adcode>.json          # 已补齐的城市级 GeoJSON（深圳、成都、杭州等）
├── vendor/
│   └── echarts/
│       └── echarts-loader.js           # 本地 + CDN 兜底加载器（IIFE，同步注入 <script>）
├── tests/
│   └── run-tests.mjs                   # 解析器、扩展定位、定位器、籍贯格式化的断言测试
└── docs/
    └── data-sources.md                 # 数据来源与限制说明（用户可读文档）
```

`src/` 目录目前为空，预留给后续模块。

---

## 4. 整体架构

### 4.1 模块职责图

```
┌──────────────────────────────────────────────────────────┐
│                    idmap.html (UI 骨架)                   │
└────────────────┬─────────────────────────────────────────┘
                 │ DOMContentLoaded
                 ▼
┌──────────────────────────────────────────────────────────┐
│                   scripts/app.js                          │
│   App 类：DOM 绑定、查询编排、UI 状态机                   │
└─────┬─────────────────────────┬──────────────────────────┘
      │                         │
      ▼                         ▼
┌─────────────┐         ┌──────────────────────────────────┐
│  parser.js  │         │     china-map-display.js         │
│             │         │   状态机 + 多级缩放编排           │
│ IDCardParser│         └─┬────────────┬──────────────┬────┘
│ PersonalInfo│           │            │              │
└──────┬──────┘           ▼            ▼              ▼
       │           ┌────────────┐ ┌─────────┐ ┌─────────────┐
       │           │ map-data-  │ │ map-    │ │ map-        │
       │           │ service.js │ │ locator │ │ renderer.js │
       │           │ (GeoJSON)  │ │ (匹配)  │ │ (ECharts)   │
       │           └────────────┘ └─────────┘ └─────────────┘
       ▼
┌──────────────────────────────────────────┐
│  data/  (region-data, calendar-data,     │
│         extended-location-data)          │
└──────────────────────────────────────────┘
```

### 4.2 关键运行时对象

- `window.__app`：`App` 单例。`DOMContentLoaded` 时构造，`beforeunload` 时调用 `dispose()` 释放观察者与 ECharts 实例。
- `App.mapDisplay`：`ChinaMapDisplay` 实例，承载地图所有状态（当前层级、已注册地图名、缓存的 feature 数据等）。
- `App.currentPerson`：当前查询的 `PersonalInfo` 实例，用于"返回省级"等操作复用解析结果。
- 全局错误兜底：`window.error` 与 `unhandledrejection` 由 `App` 转换为状态栏提示。`AbortError` 是查询取消的正常路径，不展示给用户。

---

## 5. UI 与 DOM 约定

入口模板 `idmap.html` 暴露下列稳定 ID（`scripts/app.js` 在构造函数中按 ID 抓取）：

| ID | 元素 | 用途 |
| --- | --- | --- |
| `idInput` | `<input>` | 身份证号输入框（自动按 6/8/4 分组、限 18 位、`X` 自动大写） |
| `btnQuery` / `btnDemo` / `btnReset` / `btnTheme` | `<button>` | 主操作按钮 |
| `btnBackNational` | `<button>` | 仅在省级视图显示，返回全国 |
| `easterMode` / `extendedMode` / `extendedLocation` | 表单控件 | 彩蛋模式开关、扩展定位开关与选择器 |
| `regionNote` | `<div>` | 港澳台位置精度提示 |
| `mapBreadcrumb` / `mapTitle` | 地图层级面包屑与标题 | 标题变化由 `MutationObserver` 监听并自动更新面包屑 |
| `chinaMap` | 地图容器 | `echarts.init(this._dom)` 绑定该 DOM |
| `mapLoading` | 地图加载遮罩 | 初始化完成后 `display:none` |
| `valAncestral` / `valZodiac` / `valGender` / `valChineseZodiac` | 信息卡内文本节点 | 解析结果展示 |
| `statusMsg` | 状态条 | 设置 `aria-live="polite"`，承载查询/错误信息 |

**主题**：根元素 `<html data-theme="light|dark">`，CSS 变量驱动。`App._initTheme` 读取 `localStorage['idmap-theme']`，切换时调用 `mapDisplay.refreshTheme()` 强制 ECharts 用新颜色重绘缓存视图。

---

## 6. 模块详解

### 6.1 `scripts/app.js` — 应用编排

`App` 类是页面控制器，负责：

- **输入处理**：`_formatIdInput` 仅保留 `0-9X`，强制大写，按 6/8/4 分组（地址码 / 出生 / 顺序+校验），便于人眼比对。
- **查询主流程** `handleQuery`：
  1. 拦截"彩蛋模式"。
  2. `new PersonalInfo(rawId)` 解析 + 校验，无效则填错并 `mapDisplay.reset()`。
  3. **先用省级 summary 立即填充信息卡**，让用户感知反馈，区县稍后由地图回调补齐。
  4. 通过 `mapDisplay.beginQuery()` 申请新 token（取消上一次未完成请求）。
  5. 调用 `mapDisplay.highlightProvince(...)`，在异步流程中通过 `onLocationResolved` 回调把更精细的城市/区县回填给 `_handleResolvedLocation`，再触发籍贯卡片高亮动画。
  6. 状态消息处理：仅当文案仍为初始 "正在定位..." 时才清空，避免覆盖港澳台提示。
  7. `AbortError` 不提示用户。
- **扩展定位控件** `_updateExtendedControls`：仅当输入前 2 位是港澳台编码时启用 `extendedMode`，列表项来自 `getExtendedLocationGroup`。切到非港澳台时强制取消勾选。
- **面包屑同步** `_observeMapTitle` + `_syncBreadcrumbFromTitle`：地图模块以"省 · 市 · 区"为分隔符更新 `mapTitle`，应用层通过 MutationObserver 解析为面包屑数组。
- **键盘**：回车触发查询；省级视图下 Esc 触发返回全国。
- **生命周期**：`beforeunload` → `App.dispose()` → 解绑 MutationObserver、释放 ECharts 实例。

防抖：主题切换按钮 200ms 防抖，避免高频点击导致渲染抖动。

### 6.2 `scripts/core/parser.js` — 身份证解析

两个类，继承关系 `PersonalInfo extends IDCardParser`。

#### IDCardParser

- 静态常量：
  - `CHECK_WEIGHTS = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]` —— 17 位加权因子。
  - `CHECK_CODES = ['1','0','X','9','8','7','6','5','4','3','2']` —— 模 11 查表得到的校验位。
- 校验流程（顺序很重要）：
  1. 长度等于 18。
  2. 正则 `^\d{17}[\dX]$`。
  3. 加权和 `% 11` → `CHECK_CODES` → 与第 18 位比对。
  4. 出生日期合法（`new Date` 反向校验拦截 2/30 等非法日期）。
  5. 年份 1900 – 当前年。
  6. 地址码：`PROVINCE_MAP` 命中 OR 在 `SPECIAL_REGION_CODES` 中（71 / 81 / 82 / 83）。
- 字段切片：`provinceCode = id[0..2]`、`cityCode = id[0..4]`、`countyCode = id[0..6]`、第 17 位作为性别码（奇男偶女）。
- `getFullAncestralHome` 委托 `formatAncestralHome` 处理直辖市的"省=市"重复。

#### PersonalInfo

在解析器之上派生：

- **星座** `getZodiacSign`：把月日合成 `MM*100+DD`，按 `ZODIAC_RANGES` 匹配；摩羯座（12/22 - 1/19）拆成两段判断。
- **性别** `getGender`：第 17 位奇偶。
- **生肖** `getChineseZodiac`：
  - 查 `LUNAR_NEW_YEAR[year]`，若出生早于该年春节则归入上一年。
  - 表外年份（>2030）用 2/4 立春近似；同时 `console.warn` 提示精度有限。
  - `index = ((zodiacYear - 4) % 12 + 12) % 12`，用 `ZODIAC_ANIMALS` 取名（公元 4 年为甲子鼠年）。
- `getSummary({ cityName, countyName, provinceOnly })` 返回信息卡所需聚合对象。

### 6.3 `scripts/core/china-map-display.js` — 地图状态机

最复杂的模块。以下按职责切分。

#### 关键常量

| 常量 | 含义 |
| --- | --- |
| `ZOOM` | 各层级缩放级别：NATIONAL 1.15 / PROVINCE_OVERVIEW 1.5 / PROVINCE_FOCUS 3.5 / CITY 4.0 / DISTRICT 8.0 |
| `SCALE_LIMIT` | ECharts roam 缩放上下限（0.8 – 18） |
| `CENTER` | 全国视图默认中心 `[104.5, 36]`，使大陆轮廓居中且南海诸岛可见 |
| `ANIM_MS` | 各阶段动画时长与延迟（含两次 `setOption` 之间的 delay，确保过渡触发） |
| `INFO_CARD` | 地图上叠加的信息标签缩放与字宽参数 |

#### 状态字段

| 字段 | 用途 |
| --- | --- |
| `_chart` / `_geoJson` | ECharts 实例与全国 GeoJSON |
| `_provinceGeoJson` / `_districtGeoJson` | 当前已注册的省级/市级 GeoJSON |
| `_loadedProvCode` / `_loadedCityCode` | 已加载的 adcode（避免重复 register） |
| `_currentView` | `'national' \| 'province'` |
| `_cachedSummary` / `_cachedResolvedLocation` | 当前查询的解析结果（用于 `refreshTheme` 重绘） |
| `_cachedCityName` / `_cachedCityCenter` / `_cachedDistrictSeriesData` / `_cachedDistrictCenter` / `_cachedDistrictName` | 各层级已计算好的视觉数据 |
| `_mapRegName` / `_cityMapRegName` | ECharts 注册的地图名（`prov_<code>` / `city_<code>`） |
| `_abortController` / `_requestToken` | 取消上一次查询；token 失配时 `_ensureActive` 抛 `AbortError` |
| `_lastHighlightOptions` | 让用户在全国视图重新点击当前省份时复现完整流程 |
| `_activeInfoLabel` / `_infoLabelTimers` / `_roamFrameId` | 信息卡渐进式动画状态 |

#### 主流程：`highlightProvince(provinceName, summary, onLocationResolved, queryContext, options)`

1. 港澳台分支 `_handleSpecialRegion`：
   - 若用户提供 `extendedLocation`：渲染 effectScatter 点位；回调 `{ ...location, isExtendedLocation: true }`。
   - 否则取该省默认扩展点（如有）；无则只在全国图高亮该省。回调 `{ isSpecialRegion: true }`。
2. 普通省份 `_highlightNormalProvince`：
   - **阶段 1**：在全国图上高亮目标省份（`_renderNationalHighlight`），同时配合 ECharts rich label 把"省 / 星座 / 生肖 / 性别"竖排到省份上。立即 `setOption` 把相机推到 `PROVINCE_FOCUS`（动画 1000ms）。
   - **阶段 2** `_loadProvinceData`：
     - 加载 `prov_<adcode>0000.json`。
     - `MapLocator.resolveLocationFromProvince` 推断 cityName。
     - 直辖市（`MUNICIPALITY_CODES = ['11','12','31','50']`）：再加载 `city_<cityCode>00.json`；若 DataV 没有，则用省级 GeoJSON 当作区县级（直辖市的省级 GeoJSON 实际就是区县轮廓）。`resolveLocationFromDistrict` 修正 countyName。
     - 透传 `signal`，`AbortError` 冒泡。
   - **阶段 3** `_showProvinceLevel`：
     - `echarts.registerMap('prov_<code>', provinceGeoJson)`。
     - 用 `MapLocator.matchProvinceFeature` 匹配城市 feature。直辖市按已解析的区县/城市名做字符串匹配；普通省份按 cityCode 前缀匹配，回退到 cityName。
     - 写入 `_cachedSummary`（更新 cityName 与 ancestralHome）。
     - 第一次 `setOption`：以 `PROVINCE_OVERVIEW` 缩放展示省级；第二次 `setOption` 推到 `CITY` 缩放并播 1200ms 过渡。**两次拆分写入是必须的**，一次性写入会让 ECharts 跳过过渡。
     - 调用 `_callbacks.onTitleChange(`${province} · ${city}`)`。
   - **阶段 4** `_drillDownToDistrict`（仅在拿到 districtGeoJson 与 countyName 时）：
     - `matchDistrictFeature` 在市级 GeoJSON 中找到目标区县。
     - `_buildDistrictSeriesData` 生成所有 feature 的样式数据：目标区县高亮 + 显标，其它区县透明仅显边界。
     - `setOption` 推到 `DISTRICT` 缩放（1500ms 过渡）。
     - 通过 `_scheduleInfoGraphic` 在区县中心绘制三段式信息卡（"籍贯" / "星座 性别 生肖" / 区县名），按 `CARD_PROGRESSIVE_STEP=170ms` 逐段揭示。
   - 任意阶段 token 失配（`_ensureActive`）会抛 `AbortError`，由调用方静默吞掉。

#### 信息卡渲染 `_buildInfoGraphic` / `_renderActiveInfoLabel`

- 地图上的信息卡复用 ECharts 的 `regions[].label` rich text，避免新增 series。
- 监听 `georoam` 与 `resize`：用 `requestAnimationFrame` 节流，仅根据当前 `zoom` 重算字号 / 内边距。
- 每次重绘前通过 `_readGeoCamera` 抓取 ECharts 当前 `center` / `zoom`，避免 `setOption` 把相机重置回高亮区中心。

#### 主题刷新 `refreshTheme`

- 根据 `_currentView` + 缓存数据，按当前层级重建 `geoOption` 并 `setOption`。
- 港澳台特殊地区：根据是否有 `_cachedResolvedLocation` 选择 effectScatter 或简单高亮分支。
- 触发 `_renderer.invalidateTheme()` 让 `getComputedStyle` 缓存按 data-theme 失效。

#### 浏览模式 `browseProvince`

- 用户在全国视图点击其他省份时（非当前查询省）：加载该省 GeoJSON 后展示其内部，但不绘制高亮（区分"查询"与"浏览"）。
- 通过 `_currentBrowseProvince.isQueryProvince` 区分两种模式。

#### 返回 `returnToNational(onReturnedToProvince)`

两步式回退：先把镜头从区县/市级回到省级（600ms），暂留高亮；再过渡到全国视图（1200ms），最后清空标题（1300ms）。在中间回调里给 `App` 一次"在省级视图刷新籍贯卡"的机会。

#### 资源管理

- `dispose()`：取消 fetch、清空 timers、解除 `resize` / `click` / `georoam` 事件、销毁 ECharts。
- `reset()`：清空所有缓存与状态，回到默认全国视图。

### 6.4 `scripts/core/map-data-service.js` — GeoJSON 数据层

- 统一加载策略：**本地优先 → DataV 兜底**。每个层级两个备用 URL：
  - 全国：`100000_full.json` / `geojson/china.json`
  - 省/市级：`<adcode>_full.json` / `geojson?code=<adcode>`
- 缓存使用 ES `Map`，利用插入顺序实现 LRU（`PROVINCE_CACHE_LIMIT = 16`、`DISTRICT_CACHE_LIMIT = 16`）。命中时 `delete + set` 把条目挪到尾部；写超限时 `keys().next().value` 淘汰最久未用项。
- 所有 `fetch` 透传 `AbortSignal`，由调用方在新查询发起时 `abort()`。
- 命名约定（务必遵守）：
  - 全国：`./assets/maps/china.json`
  - 省级：`./assets/maps/prov_<6位adcode>.json`，例如 `prov_440000.json` = 广东省
  - 市级：`./assets/maps/city_<6位adcode>.json`，例如 `city_440300.json` = 深圳市

### 6.5 `scripts/core/map-locator.js` — 纯函数定位器

- 无副作用、无依赖，便于单元测试。
- `resolveLocationFromProvince`：在省级 features 中按 cityCode 前缀匹配。
- `resolveLocationFromDistrict`：直辖市没有"市"层级，城市名沿用上一步 fallback。
- `matchProvinceFeature`：按 cityCode 前缀，回退到 cityName 字符串匹配（兼容 GeoJSON 命名差异）。
- `matchDistrictFeature`：按 countyCode 完整匹配，再兼容"省 + 区县后两位"6 位拼接形式（部分数据源差异）。
- `getFeatureCenter`：优先读 `properties.centroid` / `properties.center`，缺失时遍历几何顶点求平均。
- `computeGeoJSONCenter`：聚合整张 GeoJSON 顶点求平均，用于聚焦省级整体视图。
- `getAdcode`：兼容大小写（`adcode` vs `ADCODE`）。

### 6.6 `scripts/core/map-renderer.js` — ECharts 渲染

封装三种视觉形态：

1. `renderDefault`：默认全国视图。`setOption(..., true)` 走 notMerge 模式彻底替换上一次配置，避免残留。
2. `renderSpecialRegionHighlight`：港澳台兜底，全国图上把整个特别行政区高亮。两次 `setOption` 拆分（先定基线、再触发缩放过渡）。
3. `renderExtendedRegionPoint`：港澳台扩展定位。使用 `effectScatter` 涟漪点，`zlevel: 3` 确保绘制在 geo 图层之上不被遮挡。

主题来自根元素的 CSS 变量（`--map-area`、`--map-emphasis-area` 等），`getTheme()` 按 `data-theme` 缓存，`invalidateTheme()` 显式失效。

### 6.7 `scripts/utils/format-ancestral-home.js` — 籍贯格式化

共享逻辑，处理两种边界：

- 直辖市（`MUNICIPALITY_CODES`）：当 `cityName === provinceName` 时省略重复，例如"上海市"而非"上海市 上海市"。有区县时输出"省名 区县"。
- 普通省份：拼接"省 市"，缺市但有区县时输出"省 区县"。

被 `parser.PersonalInfo.getFullAncestralHome` 与 `china-map-display` 中的多处缓存更新调用，保证字符串一致。

### 6.8 `scripts/data/region-data.js`

- `PROVINCE_MAP`：身份证前 2 位 → 区划名。包含港澳台（71 / 83 同为台湾省，81 香港，82 澳门）。
- `CITY_MAP`：身份证前 4 位 → 城市名。覆盖大陆全部地级市/自治州/盟。
- `MUNICIPALITY_CODES = ['11','12','31','50']`：直辖市，地图模块按此分支处理。
- `SPECIAL_REGION_CODES = ['71','81','82','83']`：港澳台，DataV 不提供精确区县。
- `SPECIAL_REGION_MESSAGES`：港澳台位置精度受限的提示文案。
- `getProvinceCodeByName(name)`：反查（线性扫描，列表小，性能足够）。

### 6.9 `scripts/data/calendar-data.js`

- `ZODIAC_RANGES`：12 星座公历区间，摩羯座跨年。
- `ZODIAC_ANIMALS`：12 生肖（鼠开始）。
- `LUNAR_NEW_YEAR`：1920–2030 春节公历日期。**2030 之后需要手工补充**（解析器会 `console.warn` 提示）。

### 6.10 `scripts/data/extended-location-data.js`

- 港澳台扩展定位组：`{ label, defaultId, locations: [{id, name, center:[lng,lat]}] }`。
- 71 与 83 共用同一台湾组（提取常量复用）。
- `getExtendedLocation(provinceCode, locationId)` 多重 fallback：locationId → defaultId → 第一个。

### 6.11 `vendor/echarts/echarts-loader.js`

- IIFE 形式（不是 ES module），同步注入 `<script>`，确保 `app.js` 模块脚本执行前 `echarts` 全局已就绪。
- 加载策略：本地 `./vendor/echarts/echarts.min.js` 优先；超时 5s 或 onerror 后切到 `cdn.jsdelivr.net/npm/echarts@5.5.0`。
- 双保险：本地脚本可能 `200` 但内容异常（不会触发 onerror），用 setTimeout 再次尝试 CDN。
- CDN 也失败时插入醒目红色 fatal banner（不依赖外部 CSS）。

---

## 7. 数据流与关键时序

以查询 `440305199208124514`（广东省深圳市南山区）为例：

```
用户输入 → handleQuery
  ├─ new PersonalInfo(id) → 校验 + 解析
  │     summary = { provinceCode:'44', cityCode:'4403', countyCode:'440305', ... }
  ├─ _updateInfoPanel(provinceOnly summary)         // 立即填省级
  ├─ mapDisplay.beginQuery() → token=N, AbortController
  └─ mapDisplay.highlightProvince('广东省', summary, onResolved, ctx)
        ├─ _renderNationalHighlight + setOption to PROVINCE_FOCUS (1000ms)
        ├─ delay 500ms
        ├─ _dataService.loadProvince('440000')      // 命中本地 prov_440000.json
        ├─ matchProvinceFeature → 深圳市 feature
        ├─ registerMap('prov_44', provinceGeoJson)
        ├─ setOption (PROVINCE_OVERVIEW) → setOption (CITY, 1200ms)
        ├─ onLocationResolved({ cityName:'深圳市', countyName:'' })
        │     → app._handleResolvedLocation 触发籍贯卡片高亮
        ├─ delay 1000ms
        ├─ _dataService.loadDistrict('440300')      // 命中本地 city_440300.json
        ├─ matchDistrictFeature → 南山区 feature
        ├─ registerMap('city_4403', districtGeoJson)
        ├─ setOption (DISTRICT, 1500ms)
        └─ _scheduleInfoGraphic at districtCenter (1550ms 后渐进揭示)
```

并发安全：用户在动画中再次点击查询时，`beginQuery` 会 `abort` 上一次 fetch 并 `_requestToken += 1`；后续每个 `_ensureActive(token)` 检查点都会抛 `AbortError`，让旧流程及早退出。

---

## 8. 校验与测试

### 8.1 语法检查 `scripts/check-syntax.mjs`

- 递归收集 `.js` / `.mjs`，跳过 `.git` 与 `node_modules`。
- 对每个文件执行 `node --check`，stdio 直通，方便定位语法错误。
- 用 `npm run check` 调用。

### 8.2 单元测试 `tests/run-tests.mjs`

依赖 `node:assert/strict`，无第三方测试框架。覆盖：

| 测试函数 | 内容 |
| --- | --- |
| `testParser` | 校验和、非法日期、广东 / 北京籍贯展示 |
| `testInvalidProvinceCode` | 非法地址码（99 / 00）应被拒绝 |
| `testSpecialRegions` | 71 / 81 / 82 / 83 通过校验，名称正确 |
| `testMunicipalityFormatting` | 直辖市籍贯（北京/上海/重庆）省=市去重 |
| `testExtendedLocations` | 香港扩展定位、id fallback 行为、71/83 同源 |
| `testRegionData` | `getProvinceCodeByName` 全表反查 |
| `testMapLocator` | feature 匹配、几何中心、computeGeoJSONCenter |
| `testLocatorEdgeCases` | null / 空集 / centroid 优先 / multiPolygon |
| `testParserEdgeCases` | 空串、长度不足 |
| `testFormatAncestralHome` | 普通省份、直辖市去重、新疆等 |

辅助函数 `buildId(area, date, seq)` 用 17 位 + 计算校验位生成合法身份证号，避免在测试用例里硬编码。

### 8.3 手动验证（前端）

由于地图层依赖浏览器 ECharts 运行时，自动化覆盖到 `parser` / `map-locator` / `format-ancestral-home`。地图相关变更建议：

1. `npm run serve` → 打开 `http://127.0.0.1:8787/idmap.html`
2. 测试 10 个内置 demo 身份证号（覆盖 4 个直辖市、华南、华东、西部、港澳台）。
3. 切换暗/亮主题，验证 `refreshTheme()` 后地图配色正确。
4. 在区县视图缩放、平移地图，确认信息卡跟随并不闪烁。
5. 港澳台号码：勾选/不勾选扩展定位，确认 effectScatter 与提示文案正确。

---

## 9. 添加新数据 / 扩展指南

### 9.1 补齐一个省 / 市级 GeoJSON

1. 从 DataV 取得对应 adcode 的 `_full.json`。
2. 放到 `assets/maps/`，命名严格遵循 `prov_<adcode>.json` 或 `city_<adcode>.json`。
3. 无需改代码。`MapDataService` 默认本地优先。

### 9.2 维护农历春节表

当应用需要支持 2031 年及以后出生的人时：

- 在 `scripts/data/calendar-data.js` 的 `LUNAR_NEW_YEAR` 中追加 `[年份]: [月, 日]`。
- 解析器内的 `console.warn` 临界值（`year > 2030`）也需要相应更新。

### 9.3 新增港澳台扩展点位

- 在 `scripts/data/extended-location-data.js` 对应组的 `locations` 中追加 `{ id, name, center: [lng, lat] }`。
- `id` 全英文小写连字符；`center` 用 `[经度, 纬度]`。

### 9.4 新增省级地区码

- `region-data.js` 的 `PROVINCE_MAP` 增加映射；同时检查是否需要进入 `MUNICIPALITY_CODES` 或 `SPECIAL_REGION_CODES`。
- `parser.js` 的校验逻辑会自动放行新映射。

---

## 10. 已知限制与改进方向

来自 `README.md` 与 `docs/data-sources.md`：

1. 未补齐的省/市/区县仍依赖远程 DataV；离线或断网时退化为只显示已加载层级。
2. 港澳台无精确区县坐标，仅省级或用户手选代表点。
3. 农历数据仅覆盖到 2030 年。

可能的改进路径（**未实现**，仅记录）：

- 把 GeoJSON 加载与解析迁移到 Web Worker，避免在主线程阻塞渲染。
- 引入字段级 PII 红色屏蔽（出生年/性别码模糊化），用于内嵌到面向公众的演示场景。
- 用 vite / esbuild 增加构建产物，便于开启 minify 与浏览器兼容补丁。
- 把 `CITY_MAP` 拆分为按省份延迟加载的小文件，减少首屏 JS。
- 给地图模块编写 jsdom + 头浏览器测试，把当前手动验证步骤自动化。

---

## 11. 编码与协作规范

- **不要修改 ECharts 版本号**：所有 geo / effectScatter / rich label 配置基于 5.5.0 验证，升级需要回归测试整套地图流程。
- **新增 GeoJSON 必须遵守命名约定**，否则数据服务不会命中本地。
- **任何对 `china-map-display.js` 的改动**，都要重新跑通"全国 → 省 → 市 → 区"的完整动画，确认没有相机回弹、没有信息卡闪烁。
- **不要把真实身份证号写进测试或 demo**：`tests/run-tests.mjs` 用 `buildId` 合成，`app.js` 内置的 demo 列表均为非真实数据。
- **AbortError 是正常路径**：抛出与吞掉都不要打印告警，仅在 `console` 用 `[ErrorBoundary]` 前缀对真正失败做日志。
- **主题色统一走 CSS 变量**：不要在 JS 中硬编码颜色，新增视觉元素请扩展 `idmap.css` 的 `:root[data-theme]` 块和 `MapRenderer.getTheme()`。

---

## 12. 故障排查速查

| 症状 | 可能原因 | 排查路径 |
| --- | --- | --- |
| 页面打开后地图始终空白 | ECharts 加载失败 | 控制台搜 "ECharts 加载"；`vendor/echarts/echarts.min.js` 缺失会触发 CDN 兜底，CDN 也失败会出红色 fatal banner |
| 状态条提示"地图数据加载失败" | 全国 GeoJSON 都加载失败 | 检查网络与 `assets/maps/china.json` 是否存在 |
| 查询某省后只停在全国视图 | 该省 `prov_<code>.json` 既无本地也未拿到远程 | F12 → Network 看 `prov_*` 请求；按需补本地文件 |
| 区县无法定位 | `city_<code>00.json` 缺失或 cityCode 与 GeoJSON adcode 不符 | 检查 `MapLocator.matchDistrictFeature` 兼容分支是否需要新增 |
| 切换主题后地图颜色没变 | 缓存未失效 | 确认调用栈中触发了 `mapDisplay.refreshTheme()` 与 `MapRenderer.invalidateTheme()` |
| 港澳台号码点击查询后没反应 | 扩展定位下拉没选项 | 确认 `extendedMode` 勾选 + `getExtendedLocationGroup(provinceCode)` 返回非空 |
| 控制台出现 `AbortError` | 用户连续触发查询 | 正常现象；只关心非 AbortError 的栈 |

---

## 13. 附录：测试身份证号（仅用于演示）

`scripts/app.js` 内置的 demo 列表：

| 号码 | 含义 |
| --- | --- |
| `110101199003077512` | 北京市 东城区 |
| `310115198807104118` | 上海市 浦东新区 |
| `500103199805201234` | 重庆市 渝中区 |
| `510104199506150041` | 四川 成都市 |
| `440305199208124514` | 广东 深圳市 南山区 |
| `650102198903154218` | 新疆 乌鲁木齐市 |
| `540102199107085310` | 西藏 拉萨市 |
| `21010219851206351X` | 辽宁 沈阳市（含 X 校验位） |
| `330106199411224529` | 浙江 杭州市 |
| `410101199203184567` | 河南 郑州市 |

> 这些号码均为合规校验位的非真实数据，仅用于功能演示。请勿在 issue、截图、日志中使用任何真实身份证号。
