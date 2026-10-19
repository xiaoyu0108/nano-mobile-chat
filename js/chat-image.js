// ===== 图片功能 =====
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
    let selectedImageData = '';
    let selectedImages = [];
    let imgTab = 'text';

    function renderThumbs() {
        const box = document.getElementById('imageThumbs');
        if (box) {
            box.innerHTML = '';
            selectedImages.forEach(function (u) {
                const im = document.createElement('img');
                im.src = u; im.alt = '预览';
                box.appendChild(im);
            });
        }
        if (imagePreviewBox) imagePreviewBox.style.display = selectedImages.length ? 'block' : 'none';
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

    imageFileInput.addEventListener('change', function(e) {
        const files = Array.prototype.slice.call(e.target.files || []);
        if (!files.length) return;
        selectedImages = [];
        let pending = files.length;
        files.forEach(function (file, idx) {
            const reader = new FileReader();
            reader.onload = function(evt) {
                selectedImages[idx] = evt.target.result;
                pending--;
                if (pending === 0) {
                    selectedImages = selectedImages.filter(Boolean);
                    selectedImageData = selectedImages[0] || '';
                    if (imagePreview) imagePreview.src = selectedImageData;
                    renderThumbs();
                }
            };
            reader.readAsDataURL(file);
        });
    });

    imageCancel.addEventListener('click', function() {
        imagePopup.classList.remove('active');
    });

    imageConfirm.addEventListener('click', function() {
        const textContent = imageTextInput.value.trim();
        if (imgTab === 'file') {
            if (!selectedImages.length) { window.__chat.showAlert('提示', '请选择照片'); return; }
        } else if (!textContent) {
            window.__chat.showAlert('提示', '请输入要生成的文字');
            return;
        }
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const timeStr = h + ':' + m;

        if (imgTab === 'file') {
            if (selectedImages.length > 1) {
                // 多张一起发：一条消息里横向滑动查看（类似微信），点「展开」逐张放大
                window.__chat.addMessage('right', '', timeStr, null, false, false, null, null, null,
                    null, false, null, true, { urls: selectedImages.slice(), desc: '图片' });
            } else {
                window.__chat.addMessage('right', '', timeStr, null, false, false, null, null, null,
                    null, false, null, true, { url: selectedImages[0], desc: '图片' });
            }
        } else {
            window.__chat.addMessage('right', textContent, timeStr, null, false, false, null, null, null, null, false, null, true, { textImage: true });
        }
        window.__chat.saveMessages();
        selectedImages = [];
        selectedImageData = '';
        renderThumbs();
        imagePopup.classList.remove('active');
    });

    imagePopup.addEventListener('click', function(e) {
        if (e.target === this) imagePopup.classList.remove('active');
    });
})();