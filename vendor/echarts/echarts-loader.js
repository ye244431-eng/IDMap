(function() {
    'use strict';

    const CDN_URL = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
    const LOCAL_URL = './vendor/echarts/echarts.min.js';
    const LOAD_TIMEOUT = 5000;

    let loadAttempted = false;

    function loadECharts(url, isCdn = false) {
        if (loadAttempted && window.echarts) return;

        const script = document.createElement('script');
        script.src = url;
        script.async = false;

        script.onload = () => {
            console.log(`ECharts 加载成功: ${isCdn ? 'CDN' : '本地'}`);
        };

        script.onerror = () => {
            console.error(`ECharts 加载失败: ${url}`);
            if (!isCdn) {
                console.warn('本地文件不可用，尝试 CDN...');
                loadECharts(CDN_URL, true);
            } else {
                showFatalError();
            }
        };

        document.head.appendChild(script);
        loadAttempted = true;
    }

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

    // 超时后若仍未加载，尝试 CDN
    setTimeout(() => {
        if (!window.echarts) {
            console.warn('本地 ECharts 加载超时，尝试 CDN');
            loadECharts(CDN_URL, true);
        }
    }, LOAD_TIMEOUT);
})();
