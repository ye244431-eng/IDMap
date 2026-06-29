import { ChinaMapDisplay } from './core/china-map-display.js';
import { PersonalInfo } from './core/parser.js';
import { SPECIAL_REGION_CODES, SPECIAL_REGION_MESSAGES } from './data/region-data.js';
import { getExtendedLocation, getExtendedLocationGroup } from './data/extended-location-data.js';

// 简单防抖：避免主题按钮在动画过程中被高频点击导致渲染抖动
function debounce(fn, delay) {
    let timer = null;
    return function debounced(...args) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fn.apply(this, args), delay);
    };
}

// 页面应用入口：负责绑定 DOM 事件、协调身份证解析和地图显示，并维护 UI 状态
class App {
    constructor() {
        this.mapDisplay = null;
        this.currentPerson = null;
        this.currentResolvedLocation = null;
        this._mapTitleObserver = null;

        this.idInput = document.getElementById('idInput');
        this.btnQuery = document.getElementById('btnQuery');
        this.btnDemo = document.getElementById('btnDemo');
        this.btnReset = document.getElementById('btnReset');
        this.btnTheme = document.getElementById('btnTheme');
        this.easterMode = document.getElementById('easterMode');
        this.extendedMode = document.getElementById('extendedMode');
        this.extendedLocation = document.getElementById('extendedLocation');
        this.regionNote = document.getElementById('regionNote');
        this.mapBreadcrumb = document.getElementById('mapBreadcrumb');
        this.mapTitle = document.getElementById('mapTitle');
        this.statusMsg = document.getElementById('statusMsg');
        this.mapLoading = document.getElementById('mapLoading');
        this.btnBackNational = document.getElementById('btnBackNational');

        this.valAncestral = document.getElementById('valAncestral');
        this.valZodiac = document.getElementById('valZodiac');
        this.valGender = document.getElementById('valGender');
        this.valChineseZodiac = document.getElementById('valChineseZodiac');
        this.infoCards = document.querySelectorAll('.info-card');

        this._themeIconMoon = document.getElementById('iconMoon');
        this._themeIconSun = document.getElementById('iconSun');

        this._observeMapTitle();
        this._bindEvents();
        this._updateExtendedControls();
        this._setBreadcrumb(['全国']);
        this._initTheme();
        this._initMap();
    }

    setStatus(message, type = 'default') {
        this.statusMsg.textContent = message;
        this.statusMsg.className = type === 'info' ? 'status-msg info' : 'status-msg';
    }

    clearStatus() {
        this.setStatus('');
    }

    setQueryLoading(isLoading) {
        this.btnQuery.disabled = isLoading;
        this.btnQuery.textContent = isLoading ? '查询中...' : '查询';
    }

    _setBreadcrumb(parts = ['全国']) {
        if (!this.mapBreadcrumb) return;

        this.mapBreadcrumb.innerHTML = '';

        parts.forEach((part, index) => {
            const isLast = index === parts.length - 1;
            const element = document.createElement(isLast ? 'span' : 'button');
            element.textContent = part;

            if (!isLast && part === '全国') {
                element.type = 'button';
                element.addEventListener('click', () => this.handleBackToNational());
            }

            this.mapBreadcrumb.appendChild(element);
        });
    }

    _syncBreadcrumbFromTitle() {
        const title = this.mapTitle?.textContent?.trim();
        if (!title || title === '中国行政区划图') {
            this._setBreadcrumb(['全国']);
            return;
        }
        this._setBreadcrumb(['全国', ...title.split(' · ').filter(Boolean)]);
    }

    _getCleanId() {
        return this.idInput.value.replace(/\s/g, '').toUpperCase();
    }

    // 输入框格式化：去掉非法字符 + 自动按 6/8/4 分组（地址码 / 出生日 / 顺序+校验），便于人眼核对
    _formatIdInput(value) {
        const clean = value.replace(/\s/g, '').toUpperCase().replace(/[^0-9X]/g, '').slice(0, 18);
        return [clean.slice(0, 6), clean.slice(6, 14), clean.slice(14)].filter(Boolean).join(' ');
    }

    // "彩蛋模式"：勾选后输入完整身份证号会触发跳转（互联网经典 rickroll 段子）
    _triggerEasterEgg() {
        if (!this.easterMode.checked || this._getCleanId().length !== 18) return false;

        window.confirm('验证身份失败');
        window.location.href = `https://www.bilibili.com/video/BV1GJ411x7h7/?t=0&spm_id_from=333.337.search-card.all.click&vd_source=f74cd92ff31e6051640e6324df86fc89&_=${Date.now()}`;
        return true;
    }

    // 港澳台需要在信息面板显示提示语，说明位置精度限制（仅省级，或用户手选的代表性中心点）
    _updateRegionNote(person = this.currentPerson, extendedLocation = null) {
        if (!this.regionNote) return;
        if (!person || !SPECIAL_REGION_CODES.includes(person.getProvinceCode())) {
            this.regionNote.hidden = true;
            this.regionNote.textContent = '';
            return;
        }

        if (extendedLocation) {
            this.regionNote.textContent = `港澳台扩展定位：当前点位为“${extendedLocation.name}”，来自用户选择，不代表身份证号码自动解析到具体区县。`;
        } else {
            this.regionNote.textContent = '港澳台身份证地址码只能定位到省级区域；地图点位为代表性中心点，不代表自动解析到具体区县。';
        }
        this.regionNote.hidden = false;
    }

    // 监听地图标题变化，自动同步面包屑：地图模块在内部更新标题时面包屑随之更新
    _observeMapTitle() {
        if (!this.mapTitle) return;

        // 重复调用时先断开旧 observer，避免重复订阅
        if (this._mapTitleObserver) {
            this._mapTitleObserver.disconnect();
        }

        this._mapTitleObserver = new MutationObserver(() => this._syncBreadcrumbFromTitle());
        this._mapTitleObserver.observe(this.mapTitle, {
            childList: true,
            characterData: true,
            subtree: true,
        });
    }

    _bindEvents() {
        this.btnQuery.addEventListener('click', () => this.handleQuery());
        this.btnDemo.addEventListener('click', () => this.handleDemo());
        this.btnReset.addEventListener('click', () => this.handleReset());
        this.btnTheme.addEventListener('click', debounce(() => this.toggleTheme(), 200));
        this.idInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') this.handleQuery();
        });
        this.idInput.addEventListener('input', () => {
            this.idInput.value = this._formatIdInput(this.idInput.value);
            this.clearStatus();
            this._updateExtendedControls();
        });
        this.extendedMode.addEventListener('change', () => {
            this._updateExtendedControls();
            this._updateRegionNote();
        });
        this.extendedLocation.addEventListener('change', () => this._updateRegionNote());
        this.btnBackNational.addEventListener('click', () => this.handleBackToNational());
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.mapDisplay?.isInProvinceView()) {
                this.handleBackToNational();
            }
        });
    }

    async _initMap() {
        this.mapDisplay = new ChinaMapDisplay('chinaMap', undefined, {
            onTitleChange: (text) => {
                if (this.mapTitle) this.mapTitle.textContent = text;
            },
            onBackButtonChange: (visible) => {
                const button = document.getElementById('btnBackNational');
                if (!button) return;
                if (visible) {
                    button.classList.add('visible');
                    window.setTimeout(() => button.focus(), 100);
                } else {
                    button.classList.remove('visible');
                }
            },
        });
        const ok = await this.mapDisplay.init();

        if (this.mapLoading) {
            this.mapLoading.style.display = 'none';
        }

        if (!ok) {
            this.setStatus('地图数据加载失败，请刷新页面重试');

            this.btnQuery.disabled = true;
            this.btnDemo.disabled = true;
        }
    }

    _readThemePreference() {
        try {
            return localStorage.getItem('idmap-theme');
        } catch {
            return null;
        }
    }

    _saveThemePreference(theme) {
        try {
            localStorage.setItem('idmap-theme', theme);
        } catch {
            // 存储不可用时静默降级
        }
    }

    // 主题持久化：localStorage 中的偏好优先于默认值，刷新后保持用户选择
    _initTheme() {
        const savedTheme = this._readThemePreference() || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        this._updateThemeButton(savedTheme);
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        this._saveThemePreference(next);
        this._updateThemeButton(next);
        // 主题色由 CSS 变量驱动，但 ECharts 配置已经定型，需要触发地图重渲染让新颜色生效
        this.mapDisplay?.refreshTheme();
    }

    _updateThemeButton(theme) {
        if (!this._themeIconMoon || !this._themeIconSun) return;

        if (theme === 'dark') {
            this._themeIconMoon.style.display = 'none';
            this._themeIconSun.style.display = '';
            this.btnTheme.title = '切换亮色主题';
        } else {
            this._themeIconMoon.style.display = '';
            this._themeIconSun.style.display = 'none';
            this.btnTheme.title = '切换暗色主题';
        }
    }

    // 主查询入口：解析身份证 → 在信息面板填充结果 → 触发地图定位流程
    async handleQuery() {
        if (this._triggerEasterEgg()) return;

        const rawId = this._getCleanId();
        if (!rawId) {
            this.setStatus('请输入身份证号码');
            return;
        }

        const person = new PersonalInfo(rawId);
        if (!person.isValid()) {
            this.setStatus(person.getError());
            this._clearInfo();
            this.mapDisplay?.reset();
            this._setBreadcrumb(['全国']);
            return;
        }

        this.currentPerson = person;
        // 第一步：先用省级数据填充，保证用户立即看到反馈，区县名待地图异步解析后再补
        const initialSummary = person.getSummary({ provinceOnly: true });
        this._updateInfoPanel(initialSummary);
        this._setBreadcrumb(['全国', initialSummary.provinceName]);
        this.setQueryLoading(true);
        this.setStatus('正在定位...', 'info');

        // beginQuery 必须早于地图调用，旧请求会因 token 失效而被取消
        const queryContext = this.mapDisplay?.beginQuery();
        const extendedLocation = this._getSelectedExtendedLocation(person.getProvinceCode());
        this._updateRegionNote(person, extendedLocation);
        try {
            await this.mapDisplay?.highlightProvince(
                initialSummary.provinceName,
                initialSummary,
                // 地图模块在解析到具体区县后通过这个回调把更详细的地址回填到信息面板
                (location) => {
                    this._handleResolvedLocation(person, location);
                },
                queryContext,
                { extendedLocation }
            );
            this._syncBreadcrumbFromTitle();
            // 仅当状态消息仍是初始 "正在定位..." 时才清空，避免覆盖回调里设置的港澳台提示
            if (this.statusMsg.textContent === '正在定位...') {
                this.clearStatus();
            }
        } catch (error) {
            // AbortError 来自上一次查询被新查询打断，属正常流程，不应提示用户
            if (error.name !== 'AbortError') {
                console.error('[ErrorBoundary] 地图定位失败', error);
                this.setStatus('身份证信息已解析，但地图数据加载失败，请检查网络后重试');
            }
        } finally {
            this.setQueryLoading(false);
        }
    }

    // 地图模块解析完成的回调：根据返回的 location 类型决定状态提示与籍贯刷新
    _handleResolvedLocation(person, location = {}) {
        if (location.isSpecialRegion) {
            this._updateRegionNote(person);
            this.setStatus(SPECIAL_REGION_MESSAGES[person.getProvinceCode()] || '该地区暂不支持精确定点', 'info');
            return;
        }

        this.currentResolvedLocation = {
            cityName: location.cityName,
            countyName: location.countyName,
        };
        const summary = person.getSummary(this.currentResolvedLocation);
        this._animateAncestral(summary.ancestralHome);
        if (location.isExtendedLocation) {
            this._updateRegionNote(person, location);
            this.setStatus('扩展定位使用用户选择的地区中心点，不代表身份证号自动解析结果', 'info');
            return;
        }
        this.clearStatus();
    }

    // 籍贯卡片高亮闪烁：用户能立刻感知到地址精度从省级提升到了市/区县
    _animateAncestral(text) {
        const card = this.infoCards[0];
        this.valAncestral.textContent = text;
        card.classList.add('highlight');
        window.setTimeout(() => card.classList.remove('highlight'), 600);
    }

    // 演示按钮：从内置测试身份证号中随机选一个填入并查询，避免用户在隐私敏感场景下手输真号
    async handleDemo() {
        const demoIds = [
            '110101199003077512',
            '310115198807104118',
            '500103199805201234',
            '510104199506150041',
            '440305199208124514',
            '650102198903154218',
            '540102199107085310',
            '21010219851206351X',
            '330106199411224529',
            '410101199203184567',
        ];

        this.idInput.value = this._formatIdInput(demoIds[Math.floor(Math.random() * demoIds.length)]);
        this._updateExtendedControls();
        await this.handleQuery();
    }

    handleReset() {
        this.idInput.value = '';
        this.extendedMode.checked = false;
        this._updateExtendedControls();
        this._setBreadcrumb(['全国']);
        this._updateRegionNote(null);
        this.clearStatus();
        this._clearInfo();
        this.mapDisplay?.reset();
        this.idInput.focus();
    }

    // 从区县级返回时分两步：先停留在省级视图（带籍贯展示），再退到全国
    async handleBackToNational() {
        await this.mapDisplay?.returnToNational(() => {
            if (!this.currentPerson) return;
            this._animateAncestral(this.currentPerson.getSummary({ provinceOnly: true }).ancestralHome);
            this._setBreadcrumb(['全国', this.currentPerson.getProvinceName()]);
        });
        this._setBreadcrumb(['全国']);
    }

    // 错峰显示：4 张信息卡依次高亮，整体过渡 0~300ms，避免一次性出现造成视觉冲击
    _updateInfoPanel(summary) {
        const animate = (card, element, text, delay) => {
            window.setTimeout(() => {
                element.textContent = text;
                card.classList.add('highlight');
                window.setTimeout(() => card.classList.remove('highlight'), 600);
            }, delay);
        };

        animate(this.infoCards[0], this.valAncestral, summary.ancestralHome, 0);
        animate(this.infoCards[1], this.valZodiac, summary.zodiacSign, 100);
        animate(this.infoCards[2], this.valGender, summary.gender, 200);
        animate(this.infoCards[3], this.valChineseZodiac, summary.chineseZodiac, 300);
    }

    _clearInfo() {
        this.valAncestral.textContent = '——';
        this.valZodiac.textContent = '——';
        this.valGender.textContent = '——';
        this.valChineseZodiac.textContent = '——';
        this.infoCards.forEach((card) => card.classList.remove('highlight'));
        this.currentPerson = null;
        this.currentResolvedLocation = null;
    }

    // 输入框内容变化时同步更新扩展定位控件：仅港澳台号码可启用并选择具体区县
    _updateExtendedControls() {
        const provinceCode = this._getCleanId().substring(0, 2);
        const group = getExtendedLocationGroup(provinceCode);
        const enabled = Boolean(group && this.extendedMode.checked);

        this.extendedLocation.innerHTML = '';
        const placeholder = new Option(group ? group.label : '港澳台号码可用', '');
        this.extendedLocation.appendChild(placeholder);

        if (group) {
            group.locations.forEach((location) => {
                this.extendedLocation.appendChild(new Option(location.name, location.id));
            });
            this.extendedLocation.value = group.defaultId;
        }

        this.extendedMode.disabled = !group;
        this.extendedLocation.disabled = !enabled;
        // 切换到非港澳台号码时强制取消勾选，避免遗留状态影响后续查询
        if (!group) {
            this.extendedMode.checked = false;
        }
    }

    // 把扩展定位项规范成与普通解析结果同构的对象，便于地图模块统一处理
    _getSelectedExtendedLocation(provinceCode) {
        if (!this.extendedMode.checked) return null;
        const location = getExtendedLocation(provinceCode, this.extendedLocation.value);
        if (!location) return null;
        return {
            ...location,
            cityName: location.name,
            countyName: location.name,
        };
    }

    // 资源回收：beforeunload 触发，确保事件监听器与 ECharts 实例不会泄漏
    dispose() {
        if (this._mapTitleObserver) {
            this._mapTitleObserver.disconnect();
            this._mapTitleObserver = null;
        }

        if (this.mapDisplay) {
            this.mapDisplay.dispose();
            this.mapDisplay = null;
        }

        this.currentPerson = null;
        this.currentResolvedLocation = null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.__app = new App();

    // 全局错误兜底：避免单点未捕获的异常让用户卡在无反馈状态
    window.addEventListener('error', (event) => {
        console.error('[全局错误]', event.error);
        const app = window.__app;
        if (app) {
            app.setStatus('系统错误，请刷新页面重试');
        }
        // 阻止浏览器默认错误处理，避免控制台重复输出
        event.preventDefault();
    });

    window.addEventListener('unhandledrejection', (event) => {
        console.error('[未处理的 Promise 拒绝]', event.reason);
        const app = window.__app;

        // AbortError 是查询取消的正常路径，不应弹出错误提示
        if (app && event.reason?.name !== 'AbortError') {
            app.setStatus('操作失败，请重试');
        }

        event.preventDefault();
    });

    // 页面卸载时主动 dispose，避免离开后地图资源驻留
    window.addEventListener('beforeunload', () => {
        if (window.__app) {
            window.__app.dispose();
        }
    });
});
