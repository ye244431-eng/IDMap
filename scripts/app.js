import { ChinaMapDisplay } from './core/china-map-display.js';
import { PersonalInfo } from './core/parser.js';
import { SPECIAL_REGION_CODES, SPECIAL_REGION_MESSAGES } from './data/region-data.js';
import { getExtendedLocation, getExtendedLocationGroup } from './data/extended-location-data.js';

function debounce(fn, delay) {
    let timer = null;
    return function debounced(...args) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fn.apply(this, args), delay);
    };
}

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

        // 清理旧按钮的事件监听器
        // 使用 cloneNode(true) 复制节点但不复制事件监听器
        const oldButtons = this.mapBreadcrumb.querySelectorAll('button');
        oldButtons.forEach(btn => {
            const clone = btn.cloneNode(true);
            btn.parentNode.replaceChild(clone, btn);
        });

        // 清空并重建
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

    _formatIdInput(value) {
        const clean = value.replace(/\s/g, '').toUpperCase().replace(/[^0-9X]/g, '').slice(0, 18);
        return [clean.slice(0, 6), clean.slice(6, 14), clean.slice(14)].filter(Boolean).join(' ');
    }

    _triggerEasterEgg() {
        if (!this.easterMode.checked || this._getCleanId().length !== 18) return false;

        window.confirm('验证身份失败');
        window.location.href = 'https://www.bilibili.com/video/BV1GJ411x7h7/?t=0&spm_id_from=333.337.search-card.all.click&vd_source=f74cd92ff31e6051640e6324df86fc89';
        return true;
    }

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

    _observeMapTitle() {
        if (!this.mapTitle) return;

        // 如果已有 observer，先断开
        if (this._mapTitleObserver) {
            this._mapTitleObserver.disconnect();
        }

        this._mapTitleObserver = new MutationObserver(() => this._syncBreadcrumbFromTitle());
        this._mapTitleObserver.observe(this.mapTitle, {
            childList: true,
            characterData: true,
            subtree: true
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
        this.mapDisplay = new ChinaMapDisplay('chinaMap');
        const ok = await this.mapDisplay.init();

        if (this.mapLoading) {
            this.mapLoading.style.display = 'none';
        }

        if (!ok) {
            this.setStatus('地图数据加载失败，请检查网络连接后刷新页面');

            // 禁用查询按钮，避免用户在地图未初始化时查询
            this.btnQuery.disabled = true;
            this.btnDemo.disabled = true;
        }
    }

    _initTheme() {
        const savedTheme = localStorage.getItem('idmap-theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        this._updateThemeButton(savedTheme);
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('idmap-theme', next);
        this._updateThemeButton(next);
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
        const initialSummary = person.getSummary({ provinceOnly: true });
        this._updateInfoPanel(initialSummary);
        this._setBreadcrumb(['全国', initialSummary.provinceName]);
        this.setQueryLoading(true);
        this.setStatus('正在定位...', 'info');

        const queryContext = this.mapDisplay?.beginQuery();
        const extendedLocation = this._getSelectedExtendedLocation(person.getProvinceCode());
        this._updateRegionNote(person, extendedLocation);
        try {
            await this.mapDisplay?.highlightProvince(
                initialSummary.provinceName,
                initialSummary,
                (location) => {
                    this._handleResolvedLocation(person, location);
                },
                queryContext,
                { extendedLocation }
            );
            this._syncBreadcrumbFromTitle();
            if (this.statusMsg.textContent === '正在定位...') {
                this.clearStatus();
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('[ErrorBoundary] 地图定位失败', error);
                this.setStatus('身份证信息已解析，但地图数据加载失败，请检查网络后重试');
            }
        } finally {
            this.setQueryLoading(false);
        }
    }

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

    _animateAncestral(text) {
        const card = this.infoCards[0];
        this.valAncestral.textContent = text;
        card.classList.add('highlight');
        window.setTimeout(() => card.classList.remove('highlight'), 600);
    }

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

    async handleBackToNational() {
        await this.mapDisplay?.returnToNational(() => {
            if (!this.currentPerson) return;
            this._animateAncestral(this.currentPerson.getSummary({ provinceOnly: true }).ancestralHome);
            this._setBreadcrumb(['全国', this.currentPerson.getProvinceName()]);
        });
        this._setBreadcrumb(['全国']);
    }

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
        if (!group) {
            this.extendedMode.checked = false;
        }
    }

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

    dispose() {
        // 断开 MutationObserver
        if (this._mapTitleObserver) {
            this._mapTitleObserver.disconnect();
            this._mapTitleObserver = null;
        }

        // 清理地图显示实例
        if (this.mapDisplay) {
            this.mapDisplay.dispose();
            this.mapDisplay = null;
        }

        // 清空引用
        this.currentPerson = null;
        this.currentResolvedLocation = null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.__app = new App();

    // 全局错误处理
    window.addEventListener('error', (event) => {
        console.error('[全局错误]', event.error);
        const app = window.__app;
        if (app) {
            app.setStatus('系统错误，请刷新页面重试');
        }
        // 阻止默认行为，避免在控制台显示两次
        event.preventDefault();
    });

    // 未处理的 Promise rejection
    window.addEventListener('unhandledrejection', (event) => {
        console.error('[未处理的 Promise 拒绝]', event.reason);
        const app = window.__app;

        // AbortError 是正常的取消操作，不需要提示用户
        if (app && event.reason?.name !== 'AbortError') {
            app.setStatus('操作失败，请重试');
        }

        // 阻止默认行为
        event.preventDefault();
    });

    // 页面卸载时清理资源
    window.addEventListener('beforeunload', () => {
        if (window.__app) {
            window.__app.dispose();
        }
    });
});
