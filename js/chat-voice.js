// ===== 发送语音气泡弹窗（文字语音 / 录音语音） =====
(function() {
    'use strict';

    function bind() {
        const overlay = document.getElementById('voiceSheetOverlay');
        if (!overlay) return;

        const tabText = document.getElementById('vsTabText');
        const tabVoice = document.getElementById('vsTabVoice');
        const input = document.getElementById('vsInput');
        const recordBtn = document.getElementById('vsRecordBtn');
        const recordText = document.getElementById('vsRecordText');
        const recordIcon = document.getElementById('vsRecordIcon');
        const status = document.getElementById('vsStatus');
        const strip = document.getElementById('vsStrip');
        const stripText = document.getElementById('vsStripText');
        const sendBtn = document.getElementById('vsSend');
        const cancelBtn = document.getElementById('vsCancel');
        const closeBtn = document.getElementById('vsClose');

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        let recognition = null;
        let recording = false;
        let finalTranscript = '';

        function stopRecording() {
            if (recognition) {
                try { recognition.stop(); } catch (e) {}
                recognition.onend = null;
            }
            recording = false;
            if (recordBtn) { recordBtn.classList.remove('recording'); recordText.textContent = '点击开始录音'; recordIcon.className = 'fas fa-microphone'; }
            if (strip) { strip.style.display = 'none'; stripText.textContent = '正在聆听…'; }
        }

        function setTab(tab) {
            const isText = tab === 'text';
            if (tabText) tabText.classList.toggle('active', isText);
            if (tabVoice) tabVoice.classList.toggle('active', !isText);
            if (recordBtn) recordBtn.style.display = isText ? 'none' : 'flex';
            if (status) status.textContent = isText ? '输入文字，点击「发送语音」即生成语音气泡' : '点击下方麦克风，说话即可实时转成文字';
            if (isText) {
                stopRecording();
                if (input) input.focus();
            }
        }

        function startRecording() {
            if (!SR) { if (status) status.textContent = '当前浏览器不支持语音识别'; return; }
            stopRecording();
            finalTranscript = '';
            if (input) input.value = '';
            try {
                recognition = new SR();
                recognition.lang = 'zh-CN';
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.onstart = function() {
                    recording = true;
                    if (recordBtn) { recordBtn.classList.add('recording'); recordText.textContent = '点击停止'; recordIcon.className = 'fas fa-stop'; }
                    if (strip) strip.style.display = 'flex';
                    if (stripText) stripText.textContent = '正在聆听…';
                    if (status) { status.textContent = '正在录音，正在实时转成文字…'; status.classList.remove('done'); }
                };
                recognition.onresult = function(e) {
                    let interim = '';
                    for (let i = e.resultIndex; i < e.results.length; i++) {
                        const t = e.results[i][0].transcript;
                        if (e.results[i].isFinal) finalTranscript += t;
                        else interim += t;
                    }
                    if (input) input.value = finalTranscript + interim;
                };
                recognition.onerror = function(e) {
                    recording = false;
                    if (recordBtn) { recordBtn.classList.remove('recording'); recordText.textContent = '点击开始录音'; recordIcon.className = 'fas fa-microphone'; }
                    if (strip) strip.style.display = 'none';
                    if (status) status.textContent = '识别出现问题：' + (e.error || '未知');
                };
                recognition.onend = function() {
                    recording = false;
                    if (recordBtn) { recordBtn.classList.remove('recording'); recordText.textContent = '点击开始录音'; recordIcon.className = 'fas fa-microphone'; }
                    if (strip) strip.style.display = 'none';
                    if (status) status.textContent = '识别结束，可点击发送';
                };
                recognition.start();
            } catch (e) { console.warn('[语音] 识别启动失败', e); }
        }

        // 暴露给 chat-core：关闭弹窗时停录 / 重置视图
        window.__voiceRecorder = {
            stop: stopRecording,
            reset: function() { stopRecording(); setTab('text'); }
        };

        if (tabText) tabText.addEventListener('click', function() { setTab('text'); });
        if (tabVoice) tabVoice.addEventListener('click', function() { setTab('voice'); });
        if (recordBtn) recordBtn.addEventListener('click', function() {
            if (recording) stopRecording(); else startRecording();
        });
        if (sendBtn) sendBtn.addEventListener('click', function() {
            const t = (input && input.value) ? input.value.trim() : '';
            if (!t) { if (status) status.textContent = '请先输入或录音生成内容'; return; }
            if (window.__sendVoiceMsg) window.__sendVoiceMsg(t);
        });
        if (cancelBtn) cancelBtn.addEventListener('click', function() { if (window.__closeVoiceSheet) window.__closeVoiceSheet(); });
        if (closeBtn) closeBtn.addEventListener('click', function() { if (window.__closeVoiceSheet) window.__closeVoiceSheet(); });
        if (overlay) overlay.addEventListener('click', function(e) { if (e.target === this && window.__closeVoiceSheet) window.__closeVoiceSheet(); });

        setTab('text');
    }

    // 弹窗 HTML 位于脚本之前；若仍为加载中则等 DOMContentLoaded 再绑定，保证任何顺序都能绑定
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
