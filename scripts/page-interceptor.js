// 页面拦截脚本 - 需要在页面上下文中执行以拦截原生请求
(function() {
    'use strict';
    
    // 存储拦截到的pot参数
    const potStorage = {};
    
    // 向content script发送消息的辅助函数
    function sendToContentScript(data) {
        window.postMessage({
            type: 'FISHERAI_POT_INTERCEPTED',
            source: 'page-interceptor',
            data: data
        }, '*');
    }
    
    // 拦截 fetch 方法
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : input.url;
        
        if (url && (url.includes('/api/timedtext') || url.includes('timedtext'))) {
            try {
                const urlObj = new URL(url, location.href);
                const pot = urlObj.searchParams.get('pot');
                const videoId = urlObj.searchParams.get('v');
                
                if (pot && videoId) {
                    potStorage[videoId] = pot;
                    
                    // 发送给content script
                    sendToContentScript({
                        type: 'pot_parameter',
                        videoId: videoId,
                        pot: pot,
                        url: url
                    });
                } else if (pot) {
                    // 如果有pot但没有videoId，尝试从当前页面URL获取视频ID
                    const currentVideoId = getCurrentVideoId();
                    if (currentVideoId) {
                        potStorage[currentVideoId] = pot;
                        
                        sendToContentScript({
                            type: 'pot_parameter',
                            videoId: currentVideoId,
                            pot: pot,
                            url: url
                        });
                    }
                }
            } catch(e) { 
                console.error('[FisherAI] 解析字幕URL出错', e); 
            }
        }
        
        return originalFetch.apply(this, arguments);
    };
    
    // 拦截 XMLHttpRequest 方法
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string' && (url.includes('/api/timedtext') || url.includes('timedtext'))) {
            try {
                const urlObj = new URL(url, location.href);
                const pot = urlObj.searchParams.get('pot');
                const videoId = urlObj.searchParams.get('v');
                
                if (pot && videoId) {
                    potStorage[videoId] = pot;
                    
                    // 发送给content script
                    sendToContentScript({
                        type: 'pot_parameter',
                        videoId: videoId,
                        pot: pot,
                        url: url
                    });
                } else if (pot) {
                    // 如果有pot但没有videoId，尝试从当前页面URL获取视频ID
                    const currentVideoId = getCurrentVideoId();
                    if (currentVideoId) {
                        potStorage[currentVideoId] = pot;
                        
                        sendToContentScript({
                            type: 'pot_parameter',
                            videoId: currentVideoId,
                            pot: pot,
                            url: url
                        });
                    }
                }
            } catch(e) { 
                console.error('[FisherAI] 解析字幕URL出错', e); 
            }
        }
        
        return originalOpen.apply(this, arguments);
    };
    
    // 从当前页面URL获取视频ID的辅助函数
    function getCurrentVideoId() {
        try {
            const url = new URL(window.location.href);
            return url.searchParams.get('v');
        } catch(e) {
            return null;
        }
    }
    
    // 提供获取pot参数的全局函数
    window.FisherAI_getPotParameter = function(videoId) {
        return potStorage[videoId] || null;
    };
        
    // 监听页面URL变化以清理过期的pot参数
    let currentVideoId = getCurrentVideoId();
    const observer = new MutationObserver(function(mutations) {
        const newVideoId = getCurrentVideoId();
        if (newVideoId && newVideoId !== currentVideoId) {
            currentVideoId = newVideoId;
            // 可以选择清理旧的pot参数，但为了兼容性，我们保留它们
        }
    });
    
    // 开始观察DOM变化以检测页面导航
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        // 如果body还没有加载，等待DOM加载完成
        document.addEventListener('DOMContentLoaded', function() {
            if (document.body) {
                observer.observe(document.body, { childList: true, subtree: true });
            }
        });
    }
})(); 