// 读取角色人设 / 世界书 / 记忆库，用于独立页面（亲属卡刷新等）的上下文生成
(function () {
    function readUserProfile() {
        for (const k of ['nano_mask_data', 'nano_home_data']) {
            try {
                const d = JSON.parse(localStorage.getItem(k) || 'null');
                if (d && Array.isArray(d.masks)) {
                    const cur = d.masks.find(m => m.id === d.currentMaskId) || d.masks[0] || null;
                    if (cur) return cur;
                }
            } catch (e) {}
        }
        return null;
    }
    function charSetting(c) { return (c && (c.setting || c.desc || '')) || ''; }

    function openWorldbookDB() {
        return new Promise(resolve => {
            try {
                const req = indexedDB.open('nano_worldbook_db', 1);
                req.onupgradeneeded = e => {
                    try {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains('worldbook_data'))
                            db.createObjectStore('worldbook_data', { keyPath: 'key' });
                    } catch (e2) {}
                };
                req.onsuccess = e => resolve(e.target.result);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
    async function readWorldbookRaw() {
        try {
            const raw = localStorage.getItem('nano_worldbook_data_v5');
            if (raw) {
                const d = JSON.parse(raw);
                if (d && Array.isArray(d.files)) return d;
            }
        } catch (e) {}
        const db = await openWorldbookDB();
        if (!db) return null;
        return new Promise(resolve => {
            try {
                const r = db.transaction('worldbook_data', 'readonly').objectStore('worldbook_data').get('data');
                r.onsuccess = () => resolve(r.result ? r.result.value : null);
                r.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
    async function readWorldbookForChar(char) {
        const wb = await readWorldbookRaw();
        if (!wb || !Array.isArray(wb.files)) return [];
        const charId = char && char.id;
        const bindIds = new Set(((char && char.worldbookBindings) || []).map(w => w.id));
        const out = [];
        wb.files.forEach(f => {
            const isGlobal = (f.scope || 'global') === 'global';
            const isLocalBound = (f.scope === 'local') && (
                (Array.isArray(f.boundCharacters) && f.boundCharacters.includes(charId)) || bindIds.has(f.id)
            );
            if (!isGlobal && !isLocalBound) return;
            (f.entries || []).forEach(en => {
                if (!en || en.enabled === false) return;
                if (!en.content || !String(en.content).trim()) return;
                const kw = String(en.keywords || '').trim();
                const always = en.permanent === true || en.keywordEnabled === false || !kw;
                if (!always) return;
                out.push({ book: f.name, title: en.title || '', content: en.content });
            });
        });
        return out;
    }

    function openMemoryDB() {
        return new Promise(resolve => {
            try {
                const req = indexedDB.open('nano_vector_memory_db', 5);
                req.onupgradeneeded = e => {
                    try {
                        const d = e.target.result, tx = e.target.transaction;
                        if (!d.objectStoreNames.contains('memories')) {
                            const s = d.createObjectStore('memories', { keyPath: 'id' });
                            s.createIndex('chatId', 'chatId', { unique: false });
                            s.createIndex('type', 'type', { unique: false });
                            s.createIndex('hasVector', 'hasVector', { unique: false });
                        }
                        if (!d.objectStoreNames.contains('config')) d.createObjectStore('config', { keyPath: 'key' });
                        if (!d.objectStoreNames.contains('chat_state')) d.createObjectStore('chat_state', { keyPath: 'chatId' });
                        if (!d.objectStoreNames.contains('chat_messages')) d.createObjectStore('chat_messages', { keyPath: 'chatId' });
                    } catch (e2) {}
                };
                req.onsuccess = e => resolve(e.target.result);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
    async function readMemoryForChar(char) {
        const id = char && char.id;
        if (!id) return [];
        let mergedList = null;
        if (window.NanoMemLink && window.NanoMemLink.readList) {
            try { mergedList = await window.NanoMemLink.readList(id); } catch (e) { mergedList = null; }
        }
        const db = await openMemoryDB();
        if (!db) return (mergedList || []).map(it => String(it && (it.content || it.text) || '').trim()).filter(Boolean).slice(-16);
        return new Promise(resolve => {
            const out = [];
            const push = t => { t = String(t || '').trim(); if (t && out.indexOf(t) < 0) out.push(t); };
            try {
                const tx = db.transaction(['config', 'memories'], 'readonly');
                const rc = tx.objectStore('config').get('memlist_' + id);
                rc.onsuccess = () => {
                    const list = (mergedList != null) ? mergedList : ((rc.result && Array.isArray(rc.result.value)) ? rc.result.value : []);
                    list.forEach(it => push(it && (it.content || it.text)));
                };
                try {
                    const rm = tx.objectStore('memories').index('chatId').getAll(id);
                    rm.onsuccess = () => (rm.result || []).forEach(it => push(it && (it.content || it.text)));
                } catch (e) {}
                tx.oncomplete = () => { try { db.close(); } catch (e) {} resolve(out.slice(-16)); };
                tx.onerror = () => { try { db.close(); } catch (e) {} resolve(out.slice(-16)); };
            } catch (e) { try { db.close(); } catch (e2) {} resolve([]); }
        });
    }

    async function buildCharContext(char) {
        const user = readUserProfile();
        const parts = [];
        if (user && user.name) parts.push('【用户姓名】' + user.name);
        if (user && user.setting) parts.push('【用户设定】\n' + user.setting);
        parts.push('【角色姓名】' + ((char && char.name) || ''));
        const st = charSetting(char);
        if (char && char.desc && char.desc !== st) parts.push('【角色简介】\n' + char.desc);
        if (st) parts.push('【角色设定】\n' + st);
        const wb = await readWorldbookForChar(char);
        if (wb.length) parts.push('【世界书设定】\n' + wb.map(w => (w.title ? '· ' + w.title + '：' : '· ') + w.content).join('\n'));
        const mem = await readMemoryForChar(char);
        if (mem.length) parts.push('【记忆库（你与用户共同经历 / 已知的事）】\n' + mem.map(m => '· ' + m).join('\n'));
        return parts.join('\n\n');
    }

    window.NanoCharContext = { build: buildCharContext, readWorldbook: readWorldbookForChar, readMemory: readMemoryForChar };
})();
