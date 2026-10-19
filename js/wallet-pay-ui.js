// ============================================================
// wallet-pay-ui.js — 钱包里的支付密码 / 免密支付设置
// ============================================================
(function () {
    'use strict';

    var btn = document.getElementById('paySettingsBtn');
    var statusEl = document.getElementById('paySettingsStatus');
    var modal = document.getElementById('paySettingsModal');
    var freeToggle = document.getElementById('freePayToggle');
    var pwdInput = document.getElementById('payPasswordInput');
    var pwdConfirm = document.getElementById('payPasswordConfirm');
    var cancelBtn = document.getElementById('paySettingsCancel');
    var saveBtn = document.getElementById('paySettingsSave');
    var clearBtn = document.getElementById('payPasswordClear');
    var toastEl = document.getElementById('toast');
    if (!btn || !modal || !window.NanoPay) return;

    function toast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastEl._t);
        toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
    }

    function updateStatus(s) {
        if (!statusEl) return;
        if (s.hasPassword && s.freePay) statusEl.textContent = '免密支付已开启';
        else if (s.hasPassword) statusEl.textContent = '已设置支付密码';
        else if (s.freePay) statusEl.textContent = '免密支付已开启';
        else statusEl.textContent = '未设置支付密码';
    }

    function refresh() {
        NanoPay.getSettings().then(updateStatus).catch(function () {});
    }

    function open() {
        NanoPay.getSettings().then(function (s) {
            freeToggle.checked = !!s.freePay;
            pwdInput.value = '';
            pwdConfirm.value = '';
            pwdInput.placeholder = s.hasPassword ? '已设置，留空不修改' : '6 位数字';
            modal.classList.add('active');
            setTimeout(function () { pwdInput.focus(); }, 120);
        });
    }

    function close() { modal.classList.remove('active'); }

    btn.addEventListener('click', open);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

    if (saveBtn) saveBtn.addEventListener('click', function () {
        var pwd = pwdInput.value.trim();
        var confirm = pwdConfirm.value.trim();
        if (pwd && !/^\d{6}$/.test(pwd)) { toast('支付密码必须是 6 位数字'); return; }
        if (pwd !== confirm) { toast('两次输入的密码不一致'); return; }
        NanoPay.updateSettings({ password: pwd, freePay: !!freeToggle.checked }).then(function (wd) {
            updateStatus({ hasPassword: !!wd.payPasswordHash, freePay: !!wd.freePay });
            close();
            toast('支付设置已保存');
        }).catch(function (e) {
            toast((e && e.message) || '保存失败');
        });
    });

    if (clearBtn) clearBtn.addEventListener('click', function () {
        NanoPay.updateSettings({ clearPassword: true, freePay: !!freeToggle.checked }).then(function (wd) {
            updateStatus({ hasPassword: !!wd.payPasswordHash, freePay: !!wd.freePay });
            pwdInput.value = '';
            pwdConfirm.value = '';
            pwdInput.placeholder = '6 位数字';
            toast('支付密码已清除');
        }).catch(function () { toast('操作失败'); });
    });

    refresh();
})();
