// ===== 礼物功能 =====
(function() {
    const giftPopup = document.getElementById('giftPopup');
    const giftNameInput = document.getElementById('giftNameInput');
    const giftNoteInput = document.getElementById('giftNoteInput');
    const giftAmountInput = document.getElementById('giftAmount');
    const giftCancel = document.getElementById('giftCancel');
    const giftConfirm = document.getElementById('giftConfirm');

    giftCancel.addEventListener('click', function() {
        giftPopup.classList.remove('active');
    });

    giftConfirm.addEventListener('click', function() {
        const name = giftNameInput.value.trim();
        const note = giftNoteInput.value.trim();
        const amount = Math.max(0, Math.round((parseFloat(giftAmountInput && giftAmountInput.value) || 0) * 100) / 100);
        if (!name) {
            window.__chat.showAlert('提示', '请输入礼物名称');
            return;
        }
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const timeStr = h + ':' + m;
        const cardData = {
            cardType: 'gift',
            title: name,
            sub: '来自 ' + window.__chat.currentUserName + (amount > 0 ? ' · ¥' + amount.toFixed(2) : '') + (note ? ' · ' + note : ''),
            amount: amount > 0 ? ('¥' + amount.toFixed(2)) : '',
            footer: '点击领取',
            status: 'pending'
        };
        window.__chat.addMessage('right', '', timeStr, null, false, true, cardData);
        window.__chat.saveMessages();
        giftPopup.classList.remove('active');
    });

    giftPopup.addEventListener('click', function(e) {
        if (e.target === this) giftPopup.classList.remove('active');
    });
})();