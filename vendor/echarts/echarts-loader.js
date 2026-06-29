// ECharts 加载器：本地优先、CDN 兜底的 5.5.0 版本加载策略。
// 之所以独立成 IIFE 而非通过 ES module，是为了在主入口 idmap.html 中能用普通 <script> 同步加载，
// 确保 echarts 全局对象在 app.js 模块脚本执行前已就绪。
(function() {
    'use strict';

    // ECharts 版本固定为 5.5.0：项目代码中的 geo / effectScatter / rich label 配置基于此版本验证
    const CDN_URL = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
    const LOCAL_URL = './vendor/echarts/echarts.min.js';
    // 本地加载的最长等待：超过 5s 仍无 echarts 全局对象就主动切到 CDN
    const LOAD_TIMEOUT = 5000;

    let loadAttempted = false;

    function loadECharts(url, isCdn = false) {
        // 已经成功加载就不重复注入 script，避免双倍下载
        if (loadAttempted && window.echarts) return;

        const script = document.createElement('script');
        script.src = url;
        // async=false 保留 script 顺序执行语义，让后续 module 脚本可靠拿到 echarts
        script.async = false;

        script.onload = () => {
            console.log(`ECharts 加载成功: ${isCdn ? 'CDN' : '本地'}`);
        };

        script.onerror = () => {
            console.error(`ECharts 加载失败: ${url}`);
            if (!isCdn) {
                // 本地失败 → 自动切到 CDN；CDN 还失败才认定为致命错误
                console.warn('本地文件不可用，尝试 CDN...');
                loadECharts(CDN_URL, true);
            } else {
                showFatalError();
            }
        };

        document.head.appendChild(script);
        loadAttempted = true;
    }

    // 致命错误时插入醒目红色提示框（不依赖 CSS，确保即使样式表也加载失败仍能显示）
    function showFatalError() {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
            'padding:20px 40px;background:#C41E3A;color:#fff;border-radius:4px;' +
            'font-family:sans-serif;text-align:center;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
        errorDiv.innerHTML = '<strong>地图组件加载失败</strong><br><small>请检查网络连接后刷新页面</small>';
        document.body.appendChild(errorDiv);
    }

    // 本地优先，CDN 兜底
    loadECharts(LOCAL_URL);

    // 双保险：本地脚本可能不会触发 onerror（例如 200 但内容异常），用超时再次尝试 CDN
    setTimeout(() => {
        if (!window.echarts) {
            console.warn('本地 ECharts 加载超时，尝试 CDN');
            loadECharts(CDN_URL, true);
        }
    }, LOAD_TIMEOUT);
})();
