// api.js - API配置页面逻辑（Tab + IndexedDB + 功能分配）
(function () {
    // ===== IndexedDB =====
    var DB_NAME = 'nano_api_db';
    var DB_VERSION = 2;
    var STORE_NAME = 'api_data';

    function openDB() {
        return new Promise(function (resolve, reject) {
            try {
                var request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                    }
                    if (!db.objectStoreNames.contains('emoji_data')) {
                        db.createObjectStore('emoji_data', { keyPath: 'key' });
                    }
                };
                request.onsuccess = function (e) { resolve(e.target.result); };
                request.onerror = function (e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
    }

    function idbSet(key, value) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).put({ key: key, value: value });
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    function idbGet(key) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var request = tx.objectStore(STORE_NAME).get(key);
                request.onsuccess = function () { resolve(request.result ? request.result.value : null); };
                request.onerror = function (e) { reject(e.target.error); };
                tx.oncomplete = function () { db.close(); };
            });
        });
    }

    async function getData(key, defaultVal) {
        try {
            var val = await idbGet(key);
            if (val !== null) return val;
        } catch (e) { console.warn('IDB 读取失败:', e); }
        try {
            var lv = localStorage.getItem(key);
            if (lv) {
                var parsed = JSON.parse(lv);
                try { await idbSet(key, parsed); } catch (e) {}
                return parsed;
            }
        } catch (e) {}
        return defaultVal;
    }

    async function setData(key, value) {
        try { await idbSet(key, value); }
        catch (e) {
            console.warn('IDB 保存失败，降级 localStorage:', e);
            try { localStorage.setItem(key, JSON.stringify(value)); } catch (e2) {}
        }
    }

    // ===== 常量 =====
    var PRESET_DATA_KEY = 'nano_api_presets_data';
    var MODEL_LIST_KEY = 'nano_api_model_lists';
    var FULL_MODELS_KEY = 'nano_api_full_models';
    var CONFIG_KEY = 'nano_api_config';
    var PRESET_LIST_KEY = 'nano_api_preset_list';
    var PROMPTS_KEY = 'nano_api_prompts';

    // Tab 定义：tabId -> 前缀（用于预设名去重）
    var TAB_PREFIX = { main: 'main_', sub: 'sub_', img: 'img_', tts: 'tts_', prompt: 'prompt_' };

    // ===== 工具 =====
    function cleanKey(k) {
        return String(k || '').replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '').replace(/['"“”‘’]/g, '').replace(/\s/g, '').trim();
    }
    function cleanUrl(u) { return String(u || '').trim().replace(/\s/g, ''); }

    // ===== 模型列表 =====
    async function saveFullModelList(selectId, models) {
        var all = await getData(FULL_MODELS_KEY, {});
        all[selectId] = models.slice(0, 500);
        await setData(FULL_MODELS_KEY, all);
    }
    async function getFullModelList(selectId) {
        var all = await getData(FULL_MODELS_KEY, {});
        return all[selectId] || [];
    }
    async function saveModelList(selectId) {
        var select = document.getElementById(selectId);
        if (!select) return;
        var models = [];
        for (var i = 0; i < select.options.length; i++) {
            var opt = select.options[i];
            if (opt.value && ['请先拉取...', '加载中...', '拉取失败', '选择模型...', '没有匹配的模型', '搜索无结果'].indexOf(opt.value) === -1) {
                models.push({ value: opt.value, text: opt.text });
            }
        }
        if (models.length) {
            var all = await getData(MODEL_LIST_KEY, {});
            all[selectId] = models.slice(0, 500);
            await setData(MODEL_LIST_KEY, all);
        }
    }
    async function loadModelList(selectId) {
        var all = await getData(MODEL_LIST_KEY, {});
        var models = all[selectId] || [];
        if (!models.length) return false;
        var select = document.getElementById(selectId);
        if (!select) return false;
        select.innerHTML = '<option value="">选择模型...</option>';
        for (var i = 0; i < models.length; i++) {
            var opt = document.createElement('option');
            opt.value = models[i].value;
            opt.textContent = models[i].text;
            select.appendChild(opt);
        }
        select.disabled = false;
        return true;
    }
    function getWrapId(selectId) {
        return { mainModelSelect: 'mainModelWrap', imgModelSelect: 'imgModelWrap', subModelSelect: 'subModelWrap', ttsModelSelect: 'ttsModelWrap' }[selectId];
    }
    function getSearchId(selectId) {
        return { mainModelSelect: 'mainModelSearch', imgModelSelect: 'imgModelSearch', subModelSelect: 'subModelSearch', ttsModelSelect: 'ttsModelSearch' }[selectId];
    }
    async function initModelLists() {
        var ids = ['mainModelSelect', 'imgModelSelect', 'subModelSelect', 'ttsModelSelect'];
        for (var i = 0; i < ids.length; i++) {
            var loaded = await loadModelList(ids[i]);
            if (loaded) {
                var wrap = document.getElementById(getWrapId(ids[i]));
                if (wrap) wrap.classList.add('show');
            }
        }
    }

    // ===== 连接状态 =====
    var statusIdMap = { mainModelSelect: 'mainStatus', imgModelSelect: 'imgStatus', subModelSelect: 'subStatus', ttsModelSelect: 'ttsStatus' };
    var urlMap = { mainModelSelect: 'mainUrl', imgModelSelect: 'imgUrl', subModelSelect: 'subUrl', ttsModelSelect: 'ttsUrl' };
    var keyMap = { mainModelSelect: 'mainKey', imgModelSelect: 'imgKey', subModelSelect: 'subKey', ttsModelSelect: 'ttsKey' };

    function updateConnectionStatus(statusId, urlId, keyId, modelId) {
        var statusEl = document.getElementById(statusId);
        if (!statusEl) return;
        var url = (document.getElementById(urlId) || {}).value || '';
        var key = (document.getElementById(keyId) || {}).value || '';
        var model = (document.getElementById(modelId) || {}).value || '';
        if (url || key || model) {
            statusEl.innerHTML =
                '<div><span class="label">地址：</span><span class="value">' + (url || '未配置') + '</span></div>' +
                '<div><span class="label">Key：</span><span class="value">' + (key ? '••••••' : '未配置') + '</span></div>' +
                '<div><span class="label">模型：</span><span class="value">' + (model || '未选择') + '</span></div>';
            statusEl.classList.add('show');
        } else {
            statusEl.classList.remove('show');
        }
    }

    // ===== 预设存储（预设名带 tab 前缀） =====
    function presetKey(prefix, name) { return prefix + name; }

    async function savePresetConfig(prefix, name, config) {
        var all = await getData(PRESET_DATA_KEY, {});
        all[presetKey(prefix, name)] = config;
        await setData(PRESET_DATA_KEY, all);
    }
    async function getPresetConfig(prefix, name) {
        var all = await getData(PRESET_DATA_KEY, {});
        return all[presetKey(prefix, name)] || null;
    }
    async function deletePresetConfig(prefix, name) {
        var all = await getData(PRESET_DATA_KEY, {});
        delete all[presetKey(prefix, name)];
        await setData(PRESET_DATA_KEY, all);
    }

    // ===== 预设列表（按 tab 保存） =====
    async function savePresetListToStorage() {
        var presets = { main: [], sub: [], img: [], tts: [], prompt: [] };
        document.querySelectorAll('#mainPreset option').forEach(function (o) { if (o.value) presets.main.push(o.value); });
        document.querySelectorAll('#subPreset option').forEach(function (o) { if (o.value) presets.sub.push(o.value); });
        document.querySelectorAll('#imgPreset option').forEach(function (o) { if (o.value) presets.img.push(o.value); });
        document.querySelectorAll('#ttsPreset option').forEach(function (o) { if (o.value) presets.tts.push(o.value); });
        document.querySelectorAll('#promptPresetSelect option').forEach(function (o) { if (o.value) presets.prompt.push(o.value); });
        await setData(PRESET_LIST_KEY, presets);
    }

    async function loadPresetListFromStorage() {
        var presets = await getData(PRESET_LIST_KEY, null);
        if (!presets) presets = { main: [], sub: [], img: [], tts: [], prompt: [] };
        [['mainPreset', 'main'], ['subPreset', 'sub'], ['imgPreset', 'img'], ['ttsPreset', 'tts'], ['promptPresetSelect', 'prompt']]
            .forEach(function (pair) {
                var select = document.getElementById(pair[0]);
                if (!select) return;
                var key = pair[1];
                var current = select.value;
                select.innerHTML = '<option value="">选择预设...</option>';
                (presets[key] || []).forEach(function (name) {
                    var opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    select.appendChild(opt);
                });
                if (current && (presets[key] || []).indexOf(current) !== -1) select.value = current;
            });
    }

    // ===== 配置存取（按 tab 存） =====
    function normUrl(v) { return String(v || '').trim().replace(/\/+$/, ''); }

    async function saveAllToStorage() {
        var data = {
            mainUrl: normUrl((document.getElementById('mainUrl') || {}).value),
            mainKey: (document.getElementById('mainKey') || {}).value || '',
            mainPreset: (document.getElementById('mainPreset') || {}).value || '',
            mainModel: (document.getElementById('mainModelSelect') || {}).value || '',
            mainTemp: parseFloat((document.getElementById('mainTemp') || {}).value) || 0.7,
            subUrl: normUrl((document.getElementById('subUrl') || {}).value),
            subKey: (document.getElementById('subKey') || {}).value || '',
            subPreset: (document.getElementById('subPreset') || {}).value || '',
            subModel: (document.getElementById('subModelSelect') || {}).value || '',
            subTemp: parseFloat((document.getElementById('subTemp') || {}).value) || 0.7,
            subToggle: document.getElementById('subToggle') && document.getElementById('subToggle').classList.contains('active'),
            imgUrl: normUrl((document.getElementById('imgUrl') || {}).value),
            imgKey: (document.getElementById('imgKey') || {}).value || '',
            imgPreset: (document.getElementById('imgPreset') || {}).value || '',
            imgModel: (document.getElementById('imgModelSelect') || {}).value || '',
            imgTemp: parseFloat((document.getElementById('imgTemp') || {}).value) || 0.7,
            ttsUrl: normUrl((document.getElementById('ttsUrl') || {}).value),
            ttsKey: (document.getElementById('ttsKey') || {}).value || '',
            ttsGroupId: (document.getElementById('ttsGroupId') || {}).value || '',
            ttsMinimaxRegion: (document.getElementById('ttsMinimaxRegion') || {}).value || 'auto',
            ttsVoice: (document.getElementById('ttsVoice') || {}).value || '',
            ttsType: (document.getElementById('ttsType') || {}).value || 'openai',
            ttsPreset: (document.getElementById('ttsPreset') || {}).value || '',
            ttsModel: (document.getElementById('ttsModelSelect') || {}).value || '',
            activeTab: (document.querySelector('.tab-item.active') || {}).dataset ? document.querySelector('.tab-item.active').dataset.tab : 'chat'
        };
        await setData(CONFIG_KEY, data);
        await savePresetListToStorage();
        await saveModelList('mainModelSelect');
        await saveModelList('imgModelSelect');
        await saveModelList('subModelSelect');
        await saveModelList('ttsModelSelect');
    }

    // TTS：按接口类型切换默认地址 / 显隐 GroupId / 拉取按钮文案
    function applyTtsTypeUI(type, forceUrl) {
        type = type || 'openai';
        var urlEl = document.getElementById('ttsUrl');
        var groupWrap = document.getElementById('ttsGroupWrap');
        var regionWrap = document.getElementById('ttsMinimaxRegionWrap');
        var regionEl = document.getElementById('ttsMinimaxRegion');
        var fetchBtn = document.getElementById('ttsFetch');
        var region = regionEl ? (regionEl.value || 'auto') : 'auto';
        var mmCn = 'https://api.minimax.chat/v1';
        var mmGlobal = 'https://api.minimaxi.com/v1';
        var mmUrl = region === 'global' ? mmGlobal : mmCn;
        if (region === 'auto' && urlEl) {
            mmUrl = /minimaxi\.com/i.test(urlEl.value || '') ? mmGlobal : mmCn;
        }
        var defUrl = {
            openai: 'https://api.openai.com/v1',
            minimax: mmUrl,
            fishaudio: 'https://api.fish.audio',
            elevenlabs: 'https://api.elevenlabs.io',
            custom: ''
        }[type] || '';
        var ph = {
            openai: 'https://api.openai.com/v1',
            minimax: mmUrl,
            fishaudio: 'https://api.fish.audio',
            elevenlabs: 'https://api.elevenlabs.io',
            custom: 'https://api.example.com/v1'
        }[type] || 'https://api.example.com/v1';
        if (urlEl) {
            var cur = (urlEl.value || '').trim();
            var isDefault = /^https?:\/\/(api\.openai\.com|api\.fish\.audio|api\.minimax\.chat|api\.minimaxi\.com|api\.elevenlabs\.io)/i.test(cur);
            urlEl.placeholder = ph;
            if (defUrl && (forceUrl || !cur || isDefault)) urlEl.value = defUrl;
        }
        if (groupWrap) groupWrap.style.display = (type === 'minimax') ? '' : 'none';
        if (regionWrap) regionWrap.style.display = (type === 'minimax') ? '' : 'none';
        if (fetchBtn) {
            fetchBtn.innerHTML = '<i class="fas fa-cloud-download-alt"></i> 拉取模型';
        }
    }

    async function loadAllFromStorage() {
        var data = await getData(CONFIG_KEY, null);
        if (!data) {
            var tsel0 = document.getElementById('ttsType');
            applyTtsTypeUI(tsel0 ? tsel0.value : 'openai', false);
            return;
        }

        function setVal(id, val) { var el = document.getElementById(id); if (el && val !== undefined && val !== null) el.value = val; }
        setVal('mainUrl', data.mainUrl); setVal('mainKey', data.mainKey); setVal('mainPreset', data.mainPreset); setVal('mainModelSelect', data.mainModel);
        setVal('subUrl', data.subUrl); setVal('subKey', data.subKey); setVal('subPreset', data.subPreset); setVal('subModelSelect', data.subModel);
        setVal('imgUrl', data.imgUrl); setVal('imgKey', data.imgKey); setVal('imgPreset', data.imgPreset); setVal('imgModelSelect', data.imgModel);
        setVal('ttsUrl', data.ttsUrl); setVal('ttsKey', data.ttsKey); setVal('ttsGroupId', data.ttsGroupId);
        setVal('ttsMinimaxRegion', data.ttsMinimaxRegion || 'auto');
        setVal('ttsVoice', data.ttsVoice);
        setVal('ttsType', data.ttsType); setVal('ttsPreset', data.ttsPreset); setVal('ttsModelSelect', data.ttsModel);

        // 按接口类型应用默认地址 / 显隐 GroupId / 拉取按钮文案
        applyTtsTypeUI(data.ttsType || 'openai', false);

        ['main', 'sub', 'img'].forEach(function (p) {
            var t = data[p + 'Temp'];
            if (t !== undefined) {
                var el = document.getElementById(p + 'Temp');
                if (el) el.value = t;
                var valEl = document.getElementById(p + 'TempVal');
                if (valEl) valEl.textContent = parseFloat(t).toFixed(1);
            }
        });

        var subToggle = document.getElementById('subToggle');
        var subContent = document.getElementById('subApiContent');
        if (data.subToggle) { subToggle.classList.add('active'); subContent.style.display = 'block'; }
        else { subToggle.classList.remove('active'); subContent.style.display = 'none'; }

        // 恢复 Tab
        if (data.activeTab) {
            switchTab(data.activeTab);
        }
    }

    // ===== Tab 切换 =====
    function switchTab(tabId) {
        var tabs = ['chat', 'image', 'tts'];
        if (tabs.indexOf(tabId) === -1) tabId = 'chat';
        var idx = tabs.indexOf(tabId);

        document.querySelectorAll('.tab-item').forEach(function (b) {
            b.classList.toggle('active', b.dataset.tab === tabId);
        });
        document.querySelectorAll('.tab-panel').forEach(function (p) {
            p.classList.toggle('active', p.id === 'panel-' + tabId);
        });

        // 指示条滑动
        var indicator = document.getElementById('tabIndicator');
        var bar = document.getElementById('tabBar');
        if (indicator && bar) {
            var barWidth = bar.clientWidth - 8; // 减去左右 padding
            var itemWidth = barWidth / tabs.length;
            indicator.style.width = itemWidth + 'px';
            indicator.style.transform = 'translateX(' + (idx * itemWidth) + 'px)';
        }
    }

    // ===== 预设加载 =====
    async function loadPreset(prefix, presetSelectId, urlId, keyId, modelSelectId) {
        var presetName = document.getElementById(presetSelectId).value;
        if (!presetName) return;

        var config = await getPresetConfig(prefix, presetName);
        if (!config) { showModal('预设 "' + presetName + '" 配置数据丢失'); return; }

        if (config.url) document.getElementById(urlId).value = config.url;
        if (config.key) document.getElementById(keyId).value = config.key;

        var modelSelect = document.getElementById(modelSelectId);
        var searchInput = document.getElementById(getSearchId(modelSelectId));
        if (searchInput) searchInput.value = '';

        var targetModelValue = config.modelValue;
        var targetModelText = config.modelText;

        if (!targetModelValue && !targetModelText) {
            modelSelect.value = '';
            updateConnectionStatus(statusIdMap[modelSelectId], urlId, keyId, modelSelectId);
            await saveAllToStorage();
            return;
        }

        var found = false;
        for (var i = 0; i < modelSelect.options.length; i++) {
            if (modelSelect.options[i].value === targetModelValue) { modelSelect.selectedIndex = i; found = true; break; }
        }
        if (!found && targetModelText) {
            for (var j = 0; j < modelSelect.options.length; j++) {
                if (modelSelect.options[j].text === targetModelText) { modelSelect.selectedIndex = j; found = true; break; }
            }
        }
        if (!found) {
            var opt = document.createElement('option');
            opt.value = targetModelValue || targetModelText;
            opt.textContent = targetModelText || targetModelValue;
            modelSelect.appendChild(opt);
            modelSelect.value = opt.value;
            await saveModelList(modelSelectId);
        }

        updateConnectionStatus(statusIdMap[modelSelectId], urlId, keyId, modelSelectId);
        await saveAllToStorage();

        if (searchInput) {
            setTimeout(function () { searchInput.dispatchEvent(new Event('input')); }, 50);
        }
        modelSelect.dispatchEvent(new Event('change'));
    }

    // ===== 删除预设 =====
    async function deletePreset(prefix, presetSelectId) {
        var presetName = document.getElementById(presetSelectId).value;
        if (!presetName) { showModal('请先选择一个预设'); return; }
        if (!confirm('确定要删除预设 "' + presetName + '" 吗？')) return;

        await deletePresetConfig(prefix, presetName);

        var preset = document.getElementById(presetSelectId);
        for (var i = 0; i < preset.options.length; i++) {
            if (preset.options[i].value === presetName) { preset.remove(i); break; }
        }
        preset.value = '';
        await savePresetListToStorage();
        await saveAllToStorage();
        showModal('预设 "' + presetName + '" 已删除');
    }

    // ===== 修改预设 =====
    function setupEditPreset(prefix, btnId, nameId, presetId, urlId, keyId, modelSelectId, extraGetter) {
        document.getElementById(btnId).addEventListener('click', function () {
            var presetName = document.getElementById(presetId).value;
            if (!presetName) { showModal('请先选择一个要修改的预设'); return; }
            var newName = document.getElementById(nameId).value.trim();
            if (!newName) { showModal('请输入新的预设名称'); return; }

            var modelSelect = document.getElementById(modelSelectId);
            var selectedOption = modelSelect.options[modelSelect.selectedIndex];
            var config = {
                url: document.getElementById(urlId).value,
                key: document.getElementById(keyId).value,
                modelValue: modelSelect.value || '',
                modelText: selectedOption ? selectedOption.text : ''
            };
            if (!config.modelValue && config.modelText) config.modelValue = config.modelText;
            if (extraGetter) Object.assign(config, extraGetter());

            if (newName !== presetName) {
                var preset = document.getElementById(presetId);
                var existing = Array.from(preset.options).some(function (opt) { return opt.value === newName && opt.value !== presetName; });
                if (existing) { showModal('预设 "' + newName + '" 已存在'); return; }

                getData(PRESET_DATA_KEY, {}).then(function (all) {
                    delete all[presetKey(prefix, presetName)];
                    all[presetKey(prefix, newName)] = config;
                    setData(PRESET_DATA_KEY, all);
                    for (var i = 0; i < preset.options.length; i++) {
                        if (preset.options[i].value === presetName) {
                            preset.options[i].value = newName;
                            preset.options[i].textContent = newName;
                            break;
                        }
                    }
                    preset.value = newName;
                    document.getElementById(nameId).value = '';
                    savePresetListToStorage(); saveAllToStorage();
                    showModal('预设已修改为 "' + newName + '"');
                });
            } else {
                savePresetConfig(prefix, presetName, config);
                document.getElementById(nameId).value = '';
                savePresetListToStorage(); saveAllToStorage();
                showModal('预设 "' + presetName + '" 已更新');
            }
        });
    }

    // ===== 提示词 =====
    var positiveBox, negativeBox, positiveInput, negativeInput;
    var positivePrompts = [], negativePrompts = [];

    function renderPromptBox(box, prompts, emptyText) {
        if (!prompts.length) { box.innerHTML = '<span class="empty-hint">' + emptyText + '</span>'; return; }
        box.innerHTML = prompts.map(function (p) { return '<span class="tag">' + p + '</span>'; }).join('');
    }
    async function savePromptsToStorage() {
        await setData(PROMPTS_KEY, { positive: positivePrompts, negative: negativePrompts });
    }
    async function loadPromptsFromStorage() {
        var data = await getData(PROMPTS_KEY, null);
        if (data) {
            positivePrompts = data.positive || [];
            negativePrompts = data.negative || [];
            renderPromptBox(positiveBox, positivePrompts, '暂无正面提示词');
            renderPromptBox(negativeBox, negativePrompts, '暂无反面提示词');
        }
    }
    function addPrompt(input, prompts, box, emptyText) {
        var val = input.value.trim();
        if (!val) return;
        prompts.push(val);
        renderPromptBox(box, prompts, emptyText);
        input.value = '';
        savePromptsToStorage();
    }
    function clearPrompts(prompts, box, emptyText) {
        if (!prompts.length) return;
        prompts.length = 0;
        renderPromptBox(box, prompts, emptyText);
        savePromptsToStorage();
    }

    // ===== 弹窗 =====
    var modal = document.getElementById('apiModal');
    function showModal(msg) {
        document.getElementById('modalTitle').textContent = msg;
        document.getElementById('modalMessage').style.display = 'none';
        var confirmBtn = document.getElementById('modalConfirm');
        confirmBtn.className = 'ios-modal-btn confirm-btn';
        confirmBtn.textContent = '确认';
        modal.classList.add('active');
    }
    document.getElementById('modalConfirm').addEventListener('click', function () { modal.classList.remove('active'); });
    document.getElementById('modalCancel').addEventListener('click', function () { modal.classList.remove('active'); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.remove('active'); });

    // ===== 模型搜索 =====
    function setupModelSearch(selectId, searchId, btnId, clearBtnId) {
        var select = document.getElementById(selectId);
        var searchInput = document.getElementById(searchId);
        var searchBtn = document.getElementById(btnId);
        var clearBtn = document.getElementById(clearBtnId);
        if (!select || !searchInput) return;

        var fullOptions = [];
        function saveFullOptions() {
            fullOptions = [];
            for (var i = 0; i < select.options.length; i++) {
                var opt = select.options[i];
                if (opt.value && ['请先拉取...', '加载中...', '拉取失败', '选择模型...', '没有匹配的模型', '搜索无结果'].indexOf(opt.value) === -1) {
                    fullOptions.push({ value: opt.value, text: opt.text });
                }
            }
        }
        function renderOptions(options) {
            var currentValue = select.value;
            select.innerHTML = '';
            var firstOpt = document.createElement('option');
            firstOpt.value = ''; firstOpt.textContent = '选择模型...';
            select.appendChild(firstOpt);
            if (!options || !options.length) {
                var emptyOpt = document.createElement('option');
                emptyOpt.value = ''; emptyOpt.textContent = '没有匹配的模型';
                select.appendChild(emptyOpt);
                select.disabled = true;
                return;
            }
            options.forEach(function (o) {
                var opt = document.createElement('option');
                opt.value = o.value; opt.textContent = o.text;
                select.appendChild(opt);
            });
            select.disabled = false;
            if (currentValue) select.value = currentValue;
        }
        function filterModels(keyword) {
            var t = keyword.trim().toLowerCase();
            if (!t) { renderOptions(fullOptions); return; }
            var matched = fullOptions.filter(function (o) {
                return o.text.toLowerCase().indexOf(t) !== -1 || o.value.toLowerCase().indexOf(t) !== -1;
            });
            if (!matched.length) {
                select.innerHTML = '';
                var f = document.createElement('option'); f.value = ''; f.textContent = '选择模型...'; select.appendChild(f);
                var e = document.createElement('option'); e.value = ''; e.textContent = '搜索无结果'; select.appendChild(e);
                select.disabled = true;
            } else {
                renderOptions(matched);
            }
        }
        if (searchBtn) searchBtn.addEventListener('click', function () { saveFullOptions(); filterModels(searchInput.value); });
        searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveFullOptions(); filterModels(this.value); } });
        var timer = null;
        searchInput.addEventListener('input', function () {
            clearTimeout(timer);
            timer = setTimeout(function () { saveFullOptions(); filterModels(searchInput.value); }, 200);
        });
        if (clearBtn) clearBtn.addEventListener('click', function () {
            searchInput.value = ''; saveFullOptions(); renderOptions(fullOptions); searchInput.focus();
        });
        setTimeout(function () { saveFullOptions(); renderOptions(fullOptions); }, 100);
        select._saveFullOptions = saveFullOptions;
    }

    // ===== TTS 语音模型（拉取的是「模型」，音色 ID 由用户自己填写） =====
    var TTS_BUILTIN_MODELS = {
        fishaudio: [
            { id: 's2.1-pro-free', name: 'S2.1 Pro Free（免费）' },
            { id: 's2.1-pro', name: 'S2.1 Pro' },
            { id: 's2-pro', name: 'S2 Pro' },
            { id: 's1', name: 'S1' }
        ],
        minimax: [
            { id: 'speech-2.6-hd', name: 'Speech 2.6 HD' },
            { id: 'speech-2.6-turbo', name: 'Speech 2.6 Turbo' },
            { id: 'speech-2.5-hd-preview', name: 'Speech 2.5 HD Preview' },
            { id: 'speech-2.5-turbo-preview', name: 'Speech 2.5 Turbo Preview' },
            { id: 'speech-02-hd', name: 'Speech 02 HD' },
            { id: 'speech-02-turbo', name: 'Speech 02 Turbo' },
            { id: 'speech-01-hd', name: 'Speech 01 HD' },
            { id: 'speech-01-turbo', name: 'Speech 01 Turbo' }
        ],
        elevenlabs: [
            { id: 'eleven_multilingual_v2', name: 'Multilingual v2（多语言，推荐）' },
            { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5（低延迟）' },
            { id: 'eleven_flash_v2_5', name: 'Flash v2.5（最快）' },
            { id: 'eleven_v3', name: 'Eleven v3（最新）' }
        ]
    };
    function builtinTtsModels(type) {
        return (TTS_BUILTIN_MODELS[type] || []).map(function (m) { return { id: m.id, name: m.name }; });
    }

    // ===== 拉取 =====
    async function fetchModels(url, key, modelSelectId, statusId, wrapId, extra) {
        extra = extra || {};
        var status = document.getElementById(statusId);
        var wrap = document.getElementById(wrapId);
        var select = document.getElementById(modelSelectId);
        var cleanUrlStr = cleanUrl(url);
        var cleanKeyStr = cleanKey(key);

        select.innerHTML = '<option value="">加载中...</option>';
        select.disabled = true;
        wrap.classList.add('show');
        status.className = 'status-msg loading';
        status.textContent = '正在拉取...';

        try {
            var baseUrl = cleanUrlStr;
            if (!baseUrl.endsWith('/v1')) {
                baseUrl = baseUrl.endsWith('/') ? baseUrl + 'v1' : baseUrl + '/v1';
            }

            var models = [];

            if (extra.type === 'minimax' || extra.type === 'fishaudio' || extra.type === 'elevenlabs') {
                // TTS：拉取的是语音模型（不是用户音色）；音色 ID 在下面手动填写
                models = builtinTtsModels(extra.type);
            } else {
                // 通用 /models
                var response = await fetch(baseUrl + '/models', {
                    method: 'GET',
                    headers: { 'Authorization': 'Bearer ' + cleanKeyStr, 'Content-Type': 'application/json' }
                });
                if (!response.ok) {
                    var errorMsg = 'HTTP ' + response.status;
                    try { var errData = await response.json(); errorMsg = (errData.error && errData.error.message) || errData.message || errorMsg; } catch (e) {}
                    throw new Error(errorMsg);
                }
                var data = await response.json();
                var raw = data.data || data.models || [];
                models = raw.map(function (m) {
                    var name = m.id || m.name || m;
                    return { id: name, name: name };
                });
            }

            if (!models.length) throw new Error('未找到可用列表');

            select.innerHTML = '<option value="">选择模型...</option>';
            var modelList = [];
            models.forEach(function (m) {
                var opt = document.createElement('option');
                opt.value = m.id; opt.textContent = m.name;
                select.appendChild(opt);
                modelList.push({ value: m.id, text: m.name });
            });
            // 语音模型直接默认选中第一个（例如 Fish Audio S2.1 Pro Free），避免拉取后仍是空模型
            if ((extra.type === 'minimax' || extra.type === 'fishaudio' || extra.type === 'elevenlabs') && models.length) {
                select.value = models[0].id;
            }
            select.disabled = false;
            await saveFullModelList(modelSelectId, modelList);
            await saveModelList(modelSelectId);
            status.className = 'status-msg success';
            status.textContent = (extra.type === 'minimax' || extra.type === 'fishaudio' || extra.type === 'elevenlabs')
                ? ('拉取成功！共 ' + models.length + ' 个语音模型（音色 ID 请手动填写）')
                : ('拉取成功！共 ' + models.length + ' 项');
            await saveAllToStorage();
            updateConnectionStatus(statusIdMap[modelSelectId], urlMap[modelSelectId], keyMap[modelSelectId], modelSelectId);

            var searchInput = document.getElementById(getSearchId(modelSelectId));
            if (searchInput) {
                searchInput.value = '';
                setTimeout(function () { searchInput.dispatchEvent(new Event('input')); }, 50);
            }
        } catch (error) {
            select.innerHTML = '<option value="">拉取失败</option>';
            select.disabled = true;
            status.className = 'status-msg error';
            status.textContent = '拉取失败: ' + error.message;
            console.error('[API] 拉取错误:', error);
        }
    }

    function setupFetch(btnId, urlId, keyId, modelSelectId, statusId, wrapId, extraFn) {
        document.getElementById(btnId).addEventListener('click', function () {
            var url = document.getElementById(urlId).value;
            var key = document.getElementById(keyId).value;
            var status = document.getElementById(statusId);

            if (!cleanUrl(url)) {
                status.className = 'status-msg error';
                status.textContent = '请先输入中转地址';
                status.style.display = 'block';
                setTimeout(function () { status.style.display = 'none'; }, 3000);
                return;
            }
            if (!cleanKey(key)) {
                status.className = 'status-msg error';
                status.textContent = '请先输入 API Key';
                status.style.display = 'block';
                setTimeout(function () { status.style.display = 'none'; }, 3000);
                return;
            }
            fetchModels(cleanUrl(url), cleanKey(key), modelSelectId, statusId, wrapId, extraFn ? extraFn() : {});
        });
    }

    // ===== 保存预设 =====
    function setupSavePreset(prefix, btnId, nameId, presetId, urlId, keyId, modelSelectId, extraGetter) {
        document.getElementById(btnId).addEventListener('click', function () {
            var name = document.getElementById(nameId).value.trim();
            if (!name) { showModal('请输入预设名称'); return; }
            var preset = document.getElementById(presetId);
            var existing = Array.from(preset.options).some(function (o) { return o.value === name; });
            if (existing) { showModal('预设 "' + name + '" 已存在'); return; }

            var modelSelect = document.getElementById(modelSelectId);
            var selectedOption = modelSelect.options[modelSelect.selectedIndex];
            var config = {
                url: document.getElementById(urlId).value,
                key: document.getElementById(keyId).value,
                modelValue: modelSelect.value || '',
                modelText: selectedOption ? selectedOption.text : ''
            };
            if (!config.modelValue && config.modelText) config.modelValue = config.modelText;
            if (extraGetter) Object.assign(config, extraGetter());

            savePresetConfig(prefix, name, config);

            var option = document.createElement('option');
            option.value = name; option.textContent = name;
            preset.appendChild(option);
            preset.value = name;
            document.getElementById(nameId).value = '';

            savePresetListToStorage();
            saveAllToStorage();
            showModal('预设 "' + name + '" 已保存');
        });
    }

    // ===== 保存配置按钮 =====
    function setupSave(btnId, prefix, presetId, urlId, keyId, modelSelectId, extraGetter) {
        document.getElementById(btnId).addEventListener('click', function () {
            var preset = document.getElementById(presetId);
            if (preset && preset.value) {
                var modelSelect = document.getElementById(modelSelectId);
                var selectedOption = modelSelect ? modelSelect.options[modelSelect.selectedIndex] : null;
                var config = {
                    url: document.getElementById(urlId) ? document.getElementById(urlId).value : '',
                    key: document.getElementById(keyId) ? document.getElementById(keyId).value : '',
                    modelValue: modelSelect ? modelSelect.value : '',
                    modelText: selectedOption ? selectedOption.text : ''
                };
                if (extraGetter) Object.assign(config, extraGetter());
                savePresetConfig(prefix, preset.value, config);
            }
            saveAllToStorage();
            var statusId = statusIdMap[modelSelectId];
            var status = document.getElementById(statusId);
            if (status) {
                status.className = 'status-msg success';
                status.textContent = '已保存';
                status.style.display = 'block';
                setTimeout(function () { status.style.display = 'none'; }, 1500);
            }
        });
    }

    // ===== 温度 =====
    function updateTempFill(id) {
        var slider = document.getElementById(id);
        if (!slider) return;
        var min = parseFloat(slider.min) || 0;
        var max = parseFloat(slider.max) || 2;
        var val = parseFloat(slider.value) || 0;
        var pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
        slider.style.background = 'linear-gradient(to right, #007aff ' + pct + '%, rgba(120,120,128,0.20) ' + pct + '%)';
        var valEl = document.getElementById(id + 'Val');
        if (valEl) valEl.textContent = val.toFixed(1);
    }
    function setupTemp(id) {
        var slider = document.getElementById(id);
        if (!slider) return;
        updateTempFill(id);
        slider.addEventListener('input', function () { updateTempFill(id); saveAllToStorage(); });
    }

    // ===== 初始化 =====
    (async function init() {
        positiveBox = document.getElementById('positiveBox');
        negativeBox = document.getElementById('negativeBox');
        positiveInput = document.getElementById('positivePrompt');
        negativeInput = document.getElementById('negativePrompt');

        await loadPromptsFromStorage();
        await initModelLists();
        await loadPresetListFromStorage();
        await loadAllFromStorage();

        updateConnectionStatus('mainStatus', 'mainUrl', 'mainKey', 'mainModelSelect');
        updateConnectionStatus('imgStatus', 'imgUrl', 'imgKey', 'imgModelSelect');
        updateConnectionStatus('subStatus', 'subUrl', 'subKey', 'subModelSelect');
        updateConnectionStatus('ttsStatus', 'ttsUrl', 'ttsKey', 'ttsModelSelect');

        // Tab 切换
        document.getElementById('tabBar').addEventListener('click', function (e) {
            var btn = e.target.closest('.tab-item');
            if (!btn) return;
            switchTab(btn.dataset.tab);
            saveAllToStorage();
        });

        // 眼睛
        document.querySelectorAll('.eye-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var input = document.getElementById(this.dataset.target);
                if (!input) return;
                // 用 type=text + CSS 假装圆点：不触发系统安全键盘，同时保留显示/隐藏
                var isMasked = input.getAttribute('data-masked-key') === '1';
                if (isMasked) { input.setAttribute('data-masked-key', '0'); this.innerHTML = '<i class="fas fa-eye-slash"></i>'; }
                else { input.setAttribute('data-masked-key', '1'); this.innerHTML = '<i class="fas fa-eye"></i>'; }
            });
        });

        // 卡片折叠
        document.querySelectorAll('.api-card-toggle').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var target = document.getElementById(this.dataset.target);
                var icon = this.querySelector('i');
                if (target.classList.contains('collapsed')) {
                    target.classList.remove('collapsed');
                    icon.className = 'fas fa-chevron-up';
                } else {
                    target.classList.add('collapsed');
                    icon.className = 'fas fa-chevron-down';
                }
            });
        });

        // 温度
        setupTemp('mainTemp'); setupTemp('imgTemp'); setupTemp('subTemp');

        // 提示词折叠
        var promptToggle = document.getElementById('promptToggle');
        var promptContent = document.getElementById('promptContent');
        var promptArrow = document.getElementById('promptArrow');
        if (promptToggle) {
            promptToggle.addEventListener('click', function () {
                promptContent.classList.toggle('open');
                promptArrow.classList.toggle('fa-chevron-right');
                promptArrow.classList.toggle('fa-chevron-down');
            });
        }

        // 提示词增删
        document.getElementById('addPositive').addEventListener('click', function () { addPrompt(positiveInput, positivePrompts, positiveBox, '暂无正面提示词'); });
        positiveInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addPrompt(this, positivePrompts, positiveBox, '暂无正面提示词'); } });
        document.getElementById('addNegative').addEventListener('click', function () { addPrompt(negativeInput, negativePrompts, negativeBox, '暂无反面提示词'); });
        negativeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addPrompt(this, negativePrompts, negativeBox, '暂无反面提示词'); } });
        document.getElementById('clearPositive').addEventListener('click', function () { clearPrompts(positivePrompts, positiveBox, '暂无正面提示词'); });
        document.getElementById('clearNegative').addEventListener('click', function () { clearPrompts(negativePrompts, negativeBox, '暂无反面提示词'); });

        // 预设切换
        document.getElementById('mainPreset').addEventListener('change', function () { loadPreset('main_', 'mainPreset', 'mainUrl', 'mainKey', 'mainModelSelect'); });
        document.getElementById('subPreset').addEventListener('change', function () { loadPreset('sub_', 'subPreset', 'subUrl', 'subKey', 'subModelSelect'); });
        document.getElementById('imgPreset').addEventListener('change', function () { loadPreset('img_', 'imgPreset', 'imgUrl', 'imgKey', 'imgModelSelect'); });
        document.getElementById('ttsPreset').addEventListener('change', async function () {
            await loadPreset('tts_', 'ttsPreset', 'ttsUrl', 'ttsKey', 'ttsModelSelect');
            // TTS 额外字段
            var cfg = await getPresetConfig('tts_', this.value);
            if (cfg) {
                if (cfg.groupId !== undefined) document.getElementById('ttsGroupId').value = cfg.groupId;
                if (cfg.type) document.getElementById('ttsType').value = cfg.type;
                if (cfg.region !== undefined) document.getElementById('ttsMinimaxRegion').value = cfg.region;
                if (cfg.voice !== undefined) document.getElementById('ttsVoice').value = cfg.voice;
                await saveAllToStorage();
            }
        });

        // 切换接口类型：自动切换默认地址、显隐 GroupId、更新拉取按钮文案
        var ttsTypeSel = document.getElementById('ttsType');
        if (ttsTypeSel) {
            ttsTypeSel.addEventListener('change', function () {
                applyTtsTypeUI(this.value, true);
                saveAllToStorage();
            });
        }
        var ttsRegionSel = document.getElementById('ttsMinimaxRegion');
        if (ttsRegionSel) {
            ttsRegionSel.addEventListener('change', function () {
                applyTtsTypeUI(document.getElementById('ttsType').value, true);
                saveAllToStorage();
            });
        }

        // 状态更新
        ['main', 'img', 'sub', 'tts'].forEach(function (p) {
            var urlId = p + 'Url', keyId = p + 'Key', modelId = p + 'ModelSelect', statusId = p + 'Status';
            [urlId, keyId, modelId].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.addEventListener('change', function () { updateConnectionStatus(statusId, urlId, keyId, modelId); });
            });
        });

        // 副 API 开关
        var subToggle = document.getElementById('subToggle');
        var subContent = document.getElementById('subApiContent');
        subToggle.addEventListener('click', function () {
            this.classList.toggle('active');
            subContent.style.display = this.classList.contains('active') ? 'block' : 'none';
            saveAllToStorage();
        });

        // 拉取
        setupFetch('mainFetch', 'mainUrl', 'mainKey', 'mainModelSelect', 'mainStatus', 'mainModelWrap');
        setupFetch('subFetch', 'subUrl', 'subKey', 'subModelSelect', 'subStatus', 'subModelWrap');
        setupFetch('imgFetch', 'imgUrl', 'imgKey', 'imgModelSelect', 'imgStatus', 'imgModelWrap');
        setupFetch('ttsFetch', 'ttsUrl', 'ttsKey', 'ttsModelSelect', 'ttsStatus', 'ttsModelWrap', function () {
            return { type: document.getElementById('ttsType').value, groupId: document.getElementById('ttsGroupId').value };
        });

        // TTS 音色：ElevenLabs 可以直接从账号拉取 voice 列表；Fish Audio 拉取公开模型/音色。
        // 旧版本「拉取模型」只填了模型名，用户以为音色也拉到了，结果 TTS 请求里 voice 为空。
        function currentTtsConfig() {
            return {
                ttsUrl: (document.getElementById('ttsUrl') || {}).value || '',
                ttsKey: (document.getElementById('ttsKey') || {}).value || '',
                ttsModel: (document.getElementById('ttsModelSelect') || {}).value || '',
                ttsType: (document.getElementById('ttsType') || {}).value || 'openai',
                ttsGroupId: (document.getElementById('ttsGroupId') || {}).value || '',
                ttsVoice: (document.getElementById('ttsVoice') || {}).value || ''
            };
        }
        async function fetchTtsVoices() {
            var cfg = currentTtsConfig();
            var st = document.getElementById('ttsStatus');
            var list = document.getElementById('ttsVoiceList');
            var type = String(cfg.ttsType || 'openai').toLowerCase();
            var pasted = String(cfg.ttsVoice || '').trim();
            if (list) list.innerHTML = '';
            if (st) { st.className = 'status-msg loading'; st.textContent = '正在按当前粘贴的 ID / Key 拉取音色…'; }
            var root = cleanUrl(cfg.ttsUrl);
            try {
                if (!root || !cfg.ttsKey) throw new Error('请先填写 TTS 地址和 API Key');
                var items = [];
                var cleanTtsKey = String(cfg.ttsKey || '').trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '');
                var auth = { 'Authorization': 'Bearer ' + cleanTtsKey };
                function addItem(id, name) {
                    id = String(id || '').trim();
                    if (!id) return;
                    if (items.some(function (x) { return x.id === id; })) return;
                    items.push({ id: id, name: String(name || id) });
                }
                // 粘贴的音色 ID 永远排在第一项，且不会被账号列表里的第一项覆盖
                if (pasted) addItem(pasted, pasted + '（当前粘贴的 ID）');

                if (type === 'elevenlabs' || type === 'eleven') {
                    var elOrigin = new URL(root).origin;
                    var elHeaders = { 'xi-api-key': cfg.ttsKey };
                    if (pasted) {
                        try {
                            var vr = await fetch(elOrigin + '/v1/voices/' + encodeURIComponent(pasted), { headers: elHeaders });
                            if (vr.ok) {
                                var vd = await vr.json();
                                addItem((vd && (vd.voice_id || vd.id)) || pasted, (vd && vd.name) || pasted);
                            }
                        } catch (e1) {}
                    }
                    try {
                        var lr = await fetch(elOrigin + '/v1/voices?page_size=100', { headers: elHeaders });
                        if (lr.ok) {
                            var ld = await lr.json();
                            (ld && ld.voices || []).forEach(function (v) { addItem(v.voice_id, v.name || v.voice_id); });
                        } else if (!items.length) {
                            throw new Error('HTTP ' + lr.status);
                        }
                    } catch (e2) {
                        if (!items.length) throw e2;
                    }
                } else if (type.indexOf('fish') === 0) {
                    var fishOrigin = new URL(root).origin;
                    var fishProxyBase = '';
                    try {
                        fishProxyBase = String(localStorage.getItem('nano_push_endpoint') || '').trim().replace(/\/+$/, '') || 'https://nanopush.nano315.online';
                    } catch (e0) { fishProxyBase = 'https://nanopush.nano315.online'; }
                    var fishAuth = { 'Authorization': 'Bearer ' + String(cfg.ttsKey || '').trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '') };
                    async function fishJson(paths) {
                        var lastErr = null;
                        for (var xi = 0; xi < paths.length; xi++) {
                            var ctrl = null, timer = null;
                            try {
                                ctrl = new AbortController();
                                timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 12000);
                                var xr = await fetch(paths[xi], { headers: fishAuth, cache: 'no-store', signal: ctrl.signal });
                                clearTimeout(timer);
                                if (xr.status === 401) throw new Error('Invalid Token：Fish 后台的 API Key 无效或已过期');
                                if (!xr.ok) { lastErr = new Error('HTTP ' + xr.status); continue; }
                                return await xr.json();
                            } catch (xe) {
                                if (timer) clearTimeout(timer);
                                lastErr = xe;
                            }
                        }
                        throw lastErr || new Error('Fish 接口不可用');
                    }
                    if (pasted) {
                        try {
                            var fd = await fishJson([
                                fishProxyBase + '/fish-model?id=' + encodeURIComponent(pasted),
                                fishOrigin + '/model/' + encodeURIComponent(pasted)
                            ]);
                            addItem((fd && (fd._id || fd.id)) || pasted, (fd && (fd.title || fd.name)) || pasted);
                        } catch (e3) {}
                    }
                    try {
                        var md = await fishJson([
                            fishProxyBase + '/fish-models',
                            fishOrigin + '/model?page_size=100'
                        ]);
                        ((md && (md.items || md.data)) || []).forEach(function (m) { addItem(m._id || m.id, m.title || m.name); });
                    } catch (e4) {
                        if (!items.length) throw e4;
                    }
                } else if (type === 'minimax') {
                    // MiniMax 没有音色列表接口：拉取=使用你粘贴的音色 ID
                    if (!pasted) throw new Error('MiniMax 没有音色列表接口，请先粘贴音色 ID（例如 male-qn-qingse）');
                } else {
                    // OpenAI / 自定义中转：有的中转支持 /audio/voices 或 /voices，没有就回退到常用音色名
                    var trimmed = root.replace(/\/+$/, '');
                    var base = /\/v1$/i.test(trimmed) ? trimmed : (trimmed + '/v1');
                    var eps = [base + '/audio/voices', base + '/voices'];
                    for (var i = 0; i < eps.length; i++) {
                        try {
                            var rr = await fetch(eps[i], { headers: auth });
                            if (!rr.ok) continue;
                            var rd = await rr.json();
                            var arr = (rd && (rd.data || rd.voices || rd.models)) || rd;
                            if (Array.isArray(arr)) {
                                arr.forEach(function (v) {
                                    if (typeof v === 'string') addItem(v, v);
                                    else addItem(v.id || v.voice_id || v.name, v.name || v.title || v.id || v.voice_id);
                                });
                            }
                            if (items.length > (pasted ? 1 : 0)) break;
                        } catch (e5) {}
                    }
                    if (items.length <= (pasted ? 1 : 0)) {
                        ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'].forEach(function (n) { addItem(n, n); });
                    }
                }

                if (!items.length) throw new Error('没有返回可用音色');
                if (list) {
                    items.forEach(function (m) {
                        var op = document.createElement('option');
                        op.value = m.id;
                        op.label = m.name + ' · ' + m.id;
                        list.appendChild(op);
                    });
                }
                // 粘贴了 ID 就保持不变；没粘贴时才用列表第一项补位
                if (!pasted && items[0]) {
                    var voiceEl = document.getElementById('ttsVoice');
                    if (voiceEl) voiceEl.value = items[0].id;
                }
                if (st) {
                    st.className = 'status-msg success';
                    st.textContent = pasted
                        ? ('已使用当前粘贴的音色 ID：' + pasted + '（共 ' + items.length + ' 项，点「试听」验证）')
                        : ('拉取成功！共 ' + items.length + ' 个音色；也可以直接粘贴 ID，优先级最高');
                }
                await saveAllToStorage();
            } catch (e) {
                if (st) { st.className = 'status-msg error'; st.textContent = '拉取音色失败：' + ((e && e.message) || e) + '（Fish Audio 可从网页复制 reference_id 粘贴到音色 ID）'; }
            }
        }
        async function testTtsVoice() {
            var st = document.getElementById('ttsStatus');
            if (!window.NanoTTS || !NanoTTS.preview) { if (st) st.textContent = 'TTS 模块未加载'; return; }
            var cfg = currentTtsConfig();
            if (st) { st.className = 'status-msg loading'; st.textContent = '正在试听…'; }
            try {
                await NanoTTS.preview('这是一段语音测试。', { config: cfg });
                if (st) { st.className = 'status-msg success'; st.textContent = '试听成功，TTS 配置可用 ✓'; }
            } catch (e) {
                if (st) { st.className = 'status-msg error'; st.textContent = '试听失败：' + ((e && e.message) || e); }
            }
        }
        var ttsVoiceBtn = document.getElementById('ttsFetchVoices');
        if (ttsVoiceBtn) ttsVoiceBtn.addEventListener('click', fetchTtsVoices);
        var ttsTestBtn = document.getElementById('ttsTestVoice');
        if (ttsTestBtn) ttsTestBtn.addEventListener('click', testTtsVoice);

        // 保存预设
        setupSavePreset('main_', 'mainSavePreset', 'mainPresetName', 'mainPreset', 'mainUrl', 'mainKey', 'mainModelSelect');
        setupSavePreset('sub_', 'subSavePreset', 'subPresetName', 'subPreset', 'subUrl', 'subKey', 'subModelSelect');
        setupSavePreset('img_', 'imgSavePreset', 'imgPresetName', 'imgPreset', 'imgUrl', 'imgKey', 'imgModelSelect');
        setupSavePreset('tts_', 'ttsSavePreset', 'ttsPresetName', 'ttsPreset', 'ttsUrl', 'ttsKey', 'ttsModelSelect', function () {
            return {
                groupId: document.getElementById('ttsGroupId').value,
                type: document.getElementById('ttsType').value,
                region: document.getElementById('ttsMinimaxRegion').value,
                voice: document.getElementById('ttsVoice').value
            };
        });

        // 修改预设
        setupEditPreset('main_', 'mainEditPreset', 'mainPresetName', 'mainPreset', 'mainUrl', 'mainKey', 'mainModelSelect');
        setupEditPreset('sub_', 'subEditPreset', 'subPresetName', 'subPreset', 'subUrl', 'subKey', 'subModelSelect');
        setupEditPreset('img_', 'imgEditPreset', 'imgPresetName', 'imgPreset', 'imgUrl', 'imgKey', 'imgModelSelect');
        setupEditPreset('tts_', 'ttsEditPreset', 'ttsPresetName', 'ttsPreset', 'ttsUrl', 'ttsKey', 'ttsModelSelect', function () {
            return {
                groupId: document.getElementById('ttsGroupId').value,
                type: document.getElementById('ttsType').value,
                region: document.getElementById('ttsMinimaxRegion').value,
                voice: document.getElementById('ttsVoice').value
            };
        });

        // 删除预设
        document.getElementById('mainDeletePreset').addEventListener('click', function () { deletePreset('main_', 'mainPreset'); });
        document.getElementById('subDeletePreset').addEventListener('click', function () { deletePreset('sub_', 'subPreset'); });
        document.getElementById('imgDeletePreset').addEventListener('click', function () { deletePreset('img_', 'imgPreset'); });
        document.getElementById('ttsDeletePreset').addEventListener('click', function () { deletePreset('tts_', 'ttsPreset'); });

        // 保存配置
        setupSave('mainSave', 'main_', 'mainPreset', 'mainUrl', 'mainKey', 'mainModelSelect');
        setupSave('subSave', 'sub_', 'subPreset', 'subUrl', 'subKey', 'subModelSelect');
        setupSave('imgSave', 'img_', 'imgPreset', 'imgUrl', 'imgKey', 'imgModelSelect');
        setupSave('ttsSave', 'tts_', 'ttsPreset', 'ttsUrl', 'ttsKey', 'ttsModelSelect', function () {
            return {
                groupId: document.getElementById('ttsGroupId').value,
                type: document.getElementById('ttsType').value,
                region: document.getElementById('ttsMinimaxRegion').value,
                voice: document.getElementById('ttsVoice').value
            };
        });

        // 提示词预设
        document.getElementById('savePromptPreset').addEventListener('click', function () {
            var name = document.getElementById('promptPresetName').value.trim();
            if (!name) { showModal('请输入预设名称'); return; }
            var select = document.getElementById('promptPresetSelect');
            var existing = Array.from(select.options).some(function (o) { return o.value === name; });
            if (existing) { showModal('预设 "' + name + '" 已存在'); return; }
            savePresetConfig('prompt_', name, { positive: positivePrompts, negative: negativePrompts });
            var option = document.createElement('option');
            option.value = name; option.textContent = name;
            select.appendChild(option);
            select.value = name;
            document.getElementById('promptPresetName').value = '';
            savePresetListToStorage();
            showModal('提示词预设 "' + name + '" 已保存');
        });

        // 删除提示词预设
        var promptDelBtn = document.getElementById('promptDeletePreset');
        if (promptDelBtn) {
            promptDelBtn.addEventListener('click', function () {
                var name = document.getElementById('promptPresetSelect').value;
                if (!name) { showModal('请先选择一个要删除的预设'); return; }
                if (!confirm('确定要删除提示词预设 "' + name + '" 吗？')) return;
                deletePresetConfig('prompt_', name).then(function () {
                    var select = document.getElementById('promptPresetSelect');
                    for (var i = 0; i < select.options.length; i++) {
                        if (select.options[i].value === name) { select.remove(i); break; }
                    }
                    select.value = '';
                    savePresetListToStorage();
                    showModal('提示词预设 "' + name + '" 已删除');
                });
            });
        }

        // 修改 / 更新提示词预设
        var promptEditBtn = document.getElementById('editPromptPreset');
        if (promptEditBtn) {
            promptEditBtn.addEventListener('click', function () {
                var select = document.getElementById('promptPresetSelect');
                var oldName = select.value;
                if (!oldName) { showModal('请先选择一个要修改的预设'); return; }
                var newName = document.getElementById('promptPresetName').value.trim();
                if (newName && newName !== oldName) {
                    var dup = Array.from(select.options).some(function (o) { return o.value === newName; });
                    if (dup) { showModal('预设 "' + newName + '" 已存在'); return; }
                    deletePresetConfig('prompt_', oldName).then(function () {
                        return savePresetConfig('prompt_', newName, { positive: positivePrompts, negative: negativePrompts });
                    }).then(function () {
                        for (var i = 0; i < select.options.length; i++) {
                            if (select.options[i].value === oldName) { select.options[i].value = newName; select.options[i].textContent = newName; break; }
                        }
                        select.value = newName;
                        document.getElementById('promptPresetName').value = '';
                        savePresetListToStorage();
                        showModal('预设已修改为 "' + newName + '"');
                    });
                } else {
                    savePresetConfig('prompt_', oldName, { positive: positivePrompts, negative: negativePrompts }).then(function () {
                        document.getElementById('promptPresetName').value = '';
                        savePresetListToStorage();
                        showModal('预设 "' + oldName + '" 已更新');
                    });
                }
            });
        }

        document.getElementById('promptPresetSelect').addEventListener('change', function () {
            var name = this.value;
            if (!name) return;
            getPresetConfig('prompt_', name).then(function (config) {
                if (config) {
                    positivePrompts = config.positive || [];
                    negativePrompts = config.negative || [];
                    renderPromptBox(positiveBox, positivePrompts, '暂无正面提示词');
                    renderPromptBox(negativeBox, negativePrompts, '暂无反面提示词');
                    savePromptsToStorage();
                }
            });
        });

        document.getElementById('savePrompts').addEventListener('click', function () {
            var presetSelect = document.getElementById('promptPresetSelect');
            if (presetSelect && presetSelect.value) {
                savePresetConfig('prompt_', presetSelect.value, { positive: positivePrompts, negative: negativePrompts });
            }
            savePromptsToStorage();
            var status = document.getElementById('imgStatus');
            if (status) {
                status.className = 'status-msg success';
                status.textContent = '提示词已保存';
                status.style.display = 'block';
                setTimeout(function () { status.style.display = 'none'; }, 1500);
            }
        });

        // 模型搜索
        setupModelSearch('mainModelSelect', 'mainModelSearch', 'mainModelSearchBtn', 'mainModelClearBtn');
        setupModelSearch('imgModelSelect', 'imgModelSearch', 'imgModelSearchBtn', 'imgModelClearBtn');
        setupModelSearch('subModelSelect', 'subModelSearch', 'subModelSearchBtn', 'subModelClearBtn');
        setupModelSearch('ttsModelSelect', 'ttsModelSearch', 'ttsModelSearchBtn', 'ttsModelClearBtn');

        // 自动保存
        document.querySelectorAll('.form-control').forEach(function (input) {
            input.addEventListener('change', function () { saveAllToStorage(); });
            input.addEventListener('input', function () {
                clearTimeout(this._saveTimer);
                this._saveTimer = setTimeout(function () { saveAllToStorage(); }, 1000);
            });
        });

        // 悬浮球切换预设/模型后通知本页重新读取配置
        window.addEventListener('message', function (e) {
            var d = e.data;
            if (!d || d.type !== 'nanoApiReload') return;
            loadPresetListFromStorage().then(function () {
                return loadAllFromStorage();
            }).then(function () {
                updateConnectionStatus('mainStatus', 'mainUrl', 'mainKey', 'mainModelSelect');
                updateConnectionStatus('imgStatus', 'imgUrl', 'imgKey', 'imgModelSelect');
                updateConnectionStatus('subStatus', 'subUrl', 'subKey', 'subModelSelect');
                updateConnectionStatus('ttsStatus', 'ttsUrl', 'ttsKey', 'ttsModelSelect');
            });
        });

        // 窗口尺寸变化时重算指示条
        window.addEventListener('resize', function () {
            var active = document.querySelector('.tab-item.active');
            if (active) switchTab(active.dataset.tab);
        });

        if (window.parent !== window) {
            window.parent.postMessage({ type: 'pageLoaded', page: 'api' }, { targetOrigin: '*' });
        }
    })();

})();