// ===== 图片 / 视频功能 =====
(function() {
    const imagePopup = document.getElementById('imagePopup');
    const imageFileInput = document.getElementById('imageFileInput');
    const imagePreview = document.getElementById('imagePreview');
    const imagePreviewBox = document.getElementById('imagePreviewBox');
    const imageTextInput = document.getElementById('imageTextInput');
    const imageCancel = document.getElementById('imageCancel');
    const imageConfirm = document.getElementById('imageConfirm');
    const imgTabText = document.getElementById('imgTabText');
    const imgTabFile = document.getElementById('imgTabFile');
    const imgPaneText = document.getElementById('imgPaneText');
    const imgPaneFile = document.getElementById('imgPaneFile');
    const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
    const MAX_VIDEO_SECONDS = 60;
    let selectedMedia = [];
    let imgTab = 'text';

    function isVideoFile(file) {
        return /^video\//i.test(file.type || '') || /\.(mp4|mov|m4v|webm|ogv|avi|mkv|3gp)$/i.test(file.name || '');
    }
    function isImageFile(file) {
        return /^image\//i.test(file.type || '') || /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp|avif)$/i.test(file.name || '');
    }
    function readAsDataURL(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function (e) { resolve(e.target.result); };
            reader.onerror = function () { reject(new Error('读取文件失败')); };
            reader.readAsDataURL(file);
        });
    }

    // 从视频里截取第一帧当封面：聊天气泡显示封面，模型也只看这一帧
    function readVideoMeta(file) {
        return new Promise(function (resolve) {
            const url = URL.createObjectURL(file);
            const video = document.createElement('video');
            let finished = false;
            let timer = null;
            try {
                video.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
                document.body.appendChild(video);
            } catch (e) {}
            function cleanup() {
                try { video.removeAttribute('src'); video.load(); } catch (e) {}
                try { if (video.parentNode) video.parentNode.removeChild(video); } catch (e) {}
                try { URL.revokeObjectURL(url); } catch (e) {}
            }
            function done(poster, duration) {
                if (finished) return;
                finished = true;
                if (timer) clearTimeout(timer);
                cleanup();
                resolve({ poster: poster || '', duration: duration || 0 });
            }
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.onloadedmetadata = function () {
                const dur = isFinite(video.duration) ? video.duration : 0;
                if (dur > MAX_VIDEO_SECONDS + 1) { done('', dur); return; }
                try { video.currentTime = Math.min(0.3, Math.max(0, dur / 2)); }
                catch (e) { done('', dur); }
            };
            video.onseeked = function () {
                try {
                    const w = video.videoWidth || 320;
                    const h = video.videoHeight || 240;
                    const scale = Math.min(1, 640 / Math.max(w, h));
                    const cv = document.createElement('canvas');
                    cv.width = Math.max(1, Math.round(w * scale));
                    cv.height = Math.max(1, Math.round(h * scale));
                    cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
                    done(cv.toDataURL('image/jpeg', 0.82), isFinite(video.duration) ? video.duration : 0);
                } catch (e) {
                    done('', isFinite(video.duration) ? video.duration : 0);
                }
            };
            video.onerror = function () { done('', 0); };
            timer = setTimeout(function () { done('', isFinite(video.duration) ? video.duration : 0); }, 4500);
            video.src = url;
            try { video.load(); } catch (e) {}
        });
    }

    function renderThumbs() {
        const box = document.getElementById('imageThumbs');
        if (box) {
            box.innerHTML = '';
            selectedMedia.forEach(function (m) {
                const cell = document.createElement('div');
                cell.className = 'ios-img-thumb' + (m.kind === 'video' ? ' video' : '');
                const im = document.createElement('img');
                im.src = m.kind === 'video' ? (m.poster || '') : m.url;
                im.alt = '预览';
                cell.appendChild(im);
                if (m.kind === 'video') {
                    const play = document.createElement('span');
                    play.className = 'ios-img-thumb-play';
                    play.textContent = '▶';
                    cell.appendChild(play);
                }
                box.appendChild(cell);
            });
        }
        if (imagePreviewBox) {
            const first = selectedMedia[0];
            imagePreviewBox.style.display = selectedMedia.length ? 'block' : 'none';
            imagePreviewBox.classList.toggle('is-video', !!(first && first.kind === 'video'));
        }
        if (imagePreview) {
            const first = selectedMedia[0];
            imagePreview.src = first ? (first.kind === 'video' ? (first.poster || '') : first.url) : '';
            imagePreview.alt = first && first.kind === 'video' ? '视频封面' : '预览';
        }
    }

    function resetMedia() {
        selectedMedia = [];
        if (imageFileInput) imageFileInput.value = '';
        if (imagePreviewBox) {
            imagePreviewBox.style.display = 'none';
            imagePreviewBox.classList.remove('is-video');
        }
        if (imagePreview) imagePreview.src = '';
        renderThumbs();
    }

    function setImgTab(t) {
        imgTab = t;
        if (imgTabText) imgTabText.classList.toggle('active', t === 'text');
        if (imgTabFile) imgTabFile.classList.toggle('active', t === 'file');
        if (imgPaneText) imgPaneText.style.display = (t === 'text') ? '' : 'none';
        if (imgPaneFile) imgPaneFile.style.display = (t === 'file') ? '' : 'none';
    }
    if (imgTabText) imgTabText.addEventListener('click', function () { setImgTab('text'); });
    if (imgTabFile) imgTabFile.addEventListener('click', function () { setImgTab('file'); });
    setImgTab('text');

    imageFileInput.addEventListener('change', async function(e) {
        const files = Array.prototype.slice.call(e.target.files || []);
        if (!files.length) return;
        const picked = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                if (isVideoFile(file)) {
                    if (file.size > MAX_VIDEO_BYTES) {
                        window.__chat.showAlert('视频太大', '单个视频请控制在 25MB 以内，可以先裁剪或压缩后再发。');
                        continue;
                    }
                    const meta = await readVideoMeta(file);
                    if (meta.duration > MAX_VIDEO_SECONDS + 1) {
                        window.__chat.showAlert('视频太长', '视频请控制在 ' + MAX_VIDEO_SECONDS + ' 秒以内。');
                        continue;
                    }
                    const url = await readAsDataURL(file);
                    picked.push({ kind: 'video', url: url, poster: meta.poster || '', duration: meta.duration || 0 });
                } else if (isImageFile(file)) {
                    if (file.size > 20 * 1024 * 1024) {
                        window.__chat.showAlert('图片太大', '单张图片请控制在 20MB 以内。');
                        continue;
                    }
                    const url = await readAsDataURL(file);
                    picked.push({ kind: 'image', url: url });
                }
            } catch (err) {
                console.warn('[图片] 读取失败', err);
            }
        }
        selectedMedia = picked;
        renderThumbs();
        try { imageFileInput.value = ''; } catch (e) {}
    });

    imageCancel.addEventListener('click', function() {
        resetMedia();
        imagePopup.classList.remove('active');
    });

    imageConfirm.addEventListener('click', function() {
        const textContent = imageTextInput.value.trim();
        if (imgTab === 'file') {
            if (!selectedMedia.length) { window.__chat.showAlert('提示', '请选择照片或视频'); return; }
        } else if (!textContent) {
            window.__chat.showAlert('提示', '请输入要生成的文字');
            return;
        }
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const timeStr = h + ':' + m;

        if (imgTab === 'file') {
            const images = selectedMedia.filter(function (x) { return x.kind === 'image'; });
            const videos = selectedMedia.filter(function (x) { return x.kind === 'video'; });
            if (images.length > 1) {
                // 多张一起发：一条消息里横向滑动查看（类似微信），点「展开」逐张放大
                window.__chat.addMessage('right', '', timeStr, null, false, false, null, null, null,
                    null, false, null, true, { urls: images.map(function (x) { return x.url; }), desc: '图片' });
            } else if (images.length === 1) {
                window.__chat.addMessage('right', '', timeStr, null, false, false, null, null, null,
                    null, false, null, true, { url: images[0].url, desc: '图片' });
            }
            videos.forEach(function (v) {
                window.__chat.addMessage('right', '', timeStr, null, false, false, null, null, null,
                    null, false, null, true, {
                        url: v.url,
                        poster: v.poster || '',
                        video: true,
                        duration: v.duration || 0,
                        desc: '视频'
                    });
            });
        } else {
            window.__chat.addMessage('right', textContent, timeStr, null, false, false, null, null, null, null, false, null, true, { textImage: true });
        }
        window.__chat.saveMessages();
        resetMedia();
        imagePopup.classList.remove('active');
    });

    imagePopup.addEventListener('click', function(e) {
        if (e.target === this) {
            resetMedia();
            imagePopup.classList.remove('active');
        }
    });
})();
