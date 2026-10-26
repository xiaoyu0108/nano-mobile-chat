(function() {
  'use strict';

  var API_BASE = (function(){ try { return (localStorage.getItem('nano_music_api_base') || 'https://music.nano315.online').replace(/\/+$/, ''); } catch(e) { return 'https://music.nano315.online'; } })();

  // 网易云封面经常返回 http://，在 HTTPS 页面会被浏览器当成混合内容拦截；
  // 统一升到 https，并只追加一次 param，避免出现 ...?x=1?param=100y100 这种坏地址。
  function normalizeCover(url, size) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (u.indexOf('//') === 0) u = 'https:' + u;
    else if (/^http:\/\//i.test(u)) u = u.replace(/^http:\/\//i, 'https://');
    if (!size || /^(data:|blob:)/i.test(u) || /[?&]param=/.test(u)) return u;
    return u + (u.indexOf('?') > -1 ? '&' : '?') + 'param=' + size;
  }

  var DB_NAME = 'nano_music_db';
  var DB_VERSION = 3;
  var STORE_MUSIC = 'music_data';
  var STORE_AUDIO = 'audio_files';
  var STORE_LYRICS = 'lyrics_data';

  function openDB() {
    return new Promise(function(resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_MUSIC)) db.createObjectStore(STORE_MUSIC, { keyPath: 'key' });
          if (!db.objectStoreNames.contains(STORE_AUDIO)) db.createObjectStore(STORE_AUDIO, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(STORE_LYRICS)) db.createObjectStore(STORE_LYRICS, { keyPath: 'id' });
        };
        req.onsuccess = function(e) { resolve(e.target.result); };
        req.onerror = function(e) { reject(e.target.error); };
      } catch(e) { reject(e); }
    });
  }
  function idbGet(store, key) {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        try {
          var tx = db.transaction(store, 'readonly');
          var r = tx.objectStore(store).get(key);
          r.onsuccess = function() { resolve(r.result || null); };
          r.onerror = function() { resolve(null); };
        } catch(e) { resolve(null); }
      });
    });
  }
  function idbPut(store, data) {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        try {
          var tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).put(data);
          tx.oncomplete = function() { resolve(); };
          tx.onerror = function() { resolve(); };
        } catch(e) { resolve(); }
      });
    });
  }
  function idbDelete(store, key) {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        try {
          var tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).delete(key);
          tx.oncomplete = function() { resolve(); };
          tx.onerror = function() { resolve(); };
        } catch(e) { resolve(); }
      });
    });
  }

  // ============================================================
  // 状态
  // ============================================================
  var currentTab = 'mine';
  var partnerInfo = null;
  var duoActive = false;
  var isPlaying = false;
  var currentSongIndex = -1;
  var songs = [];
  var audio = null;
  var netEaseToken = 0;
  var netEaseOpts = null;
  var progressTimer = null;
  var playMode = 'order';
  var isMultiSelect = false;
  var selectedSongIds = new Set();
  var menuTargetIndex = -1;
  var pendingLyricsIndex = -1;
  var floatBallEnabled = true;
  var ballExpanded = false;
  var currentObjectURLs = {};
  var currentView = 'disc';
  var soloView = 'disc';
  var playlistCurrentTab = 'local';
  var listenChatMode = false;
  var playlists = [];
  var currentPlaylistId = null;
  var menuPlaylistId = null;
  var menuSongInPlaylistIndex = -1;

  // 在线列表（每日推荐 / 最近播放）当前队列
  var onlineQueue = [];
  var onlineQueueIndex = 0;
  var onlineQueueType = '';   // 'daily' | 'recent'
  var onlineQueueActive = false;  // 当前播放是否属于在线列表队列

  var $ = function(id) { return document.getElementById(id); };
  var tabs = document.querySelectorAll('.tab-item');
  var pages = { mine: $('pageMine'), listen: $('pageListen'), online: $('pageOnline') };

  // Mine
  var profileAvatar = $('profileAvatar');
  var profileAvatarImg = $('profileAvatarImg');
  var profileAvatarPlaceholder = $('profileAvatarPlaceholder');
  var profileName = $('profileName');
  var profileBio = $('profileBio');
  var songList = $('songList');
  var songCount = $('songCount');
  var editBtn = $('editBtn');
  var batchBar = $('batchBar');
  var batchCount = $('batchCount');
  var batchCancel = $('batchCancel');
  var batchDelete = $('batchDelete');
  var batchAddTo = $('batchAddTo');
  var miniPlayer = $('miniPlayer');
  var miniCoverImg = $('miniCoverImg');
  var miniSong = $('miniSong');
  var miniArtist = $('miniArtist');
  var miniPlayBtn = $('miniPlayBtn');

  // Online 迷你播放器
  var onlineMiniPlayer = $('onlineMiniPlayer');
  var onlineMiniCoverImg = $('onlineMiniCoverImg');
  var onlineMiniSong = $('onlineMiniSong');
  var onlineMiniArtist = $('onlineMiniArtist');
  var onlineMiniPlayBtn = $('onlineMiniPlayBtn');

  // Listen
  var listenEmpty = $('listenEmpty');
  var listenActive = $('listenActive');
  var listenEmptyBtn = $('listenEmptyBtn');
  var heartWrap = $('heartWrap');
  var myAvatarImg = $('myAvatarImg');
  var myAvatarPlaceholder = $('myAvatarPlaceholder');
  var myName = $('myName');
  var partnerAvatarImg = $('partnerAvatarImg');
  var partnerAvatarPlaceholder = $('partnerAvatarPlaceholder');
  var partnerName = $('partnerName');
  var listenTop = $('listenTop');
  var listenHeaderSong = $('listenHeaderSong');
  var listenTopArtist = $('listenTopArtist');
  var listenBottomTabItems = document.querySelectorAll('.listen-bottom-tab-item');

  var discView = $('discView');
  var lyricsView = $('lyricsView');
  var discWrap = $('discWrap');
  var discInner = $('discInner');
  var discImg = $('discImg');
  var discPlaceholder = $('discPlaceholder');
  var listenLyrics = $('listenLyrics');
  var listenSong = $('listenSong');
  var listenArtist = $('listenArtist');
  var listenProgressBar = $('listenProgressBar');
  var listenProgressFill = $('listenProgressFill');
  var listenCurrentTime = $('listenCurrentTime');
  var listenTotalTime = $('listenTotalTime');
  var listenPlayBtn = $('listenPlayBtn');
  var listenPrevBtn = $('listenPrevBtn');
  var listenNextBtn = $('listenNextBtn');
  var listenModeBtn = $('listenModeBtn');
  var listenListBtn = $('listenListBtn');

  // 一起听聊天
  var listenChatBody = $('listenChatBody');
  var listenChatInput = $('listenChatInput');
  var listenChatActionBtn = $('listenChatActionBtn');
  var listenChatRollBtn = $('listenChatRollBtn');

  // 单人播放器
  var soloPlayer = $('soloPlayer');
  var soloCloseBtn = $('soloCloseBtn');
  var soloDiscView = $('soloDiscView');
  var soloLyricsView = $('soloLyricsView');
  var soloDiscWrap = $('soloDiscWrap');
  var soloDiscInner = $('soloDiscInner');
  var soloDiscImg = $('soloDiscImg');
  var soloDiscPlaceholder = $('soloDiscPlaceholder');
  var soloLyrics = $('soloLyrics');
  var soloSong = $('soloSong');
  var soloArtist = $('soloArtist');
  var soloProgressBar = $('soloProgressBar');
  var soloProgressFill = $('soloProgressFill');
  var soloCurrentTime = $('soloCurrentTime');
  var soloTotalTime = $('soloTotalTime');
  var soloPlayBtn = $('soloPlayBtn');
  var soloPrevBtn = $('soloPrevBtn');
  var soloNextBtn = $('soloNextBtn');
  var soloModeBtn = $('soloModeBtn');
  var soloListBtn = $('soloListBtn');
  var soloHeaderSong = $('soloHeaderSong');
  var soloHeaderArtist = $('soloHeaderArtist');

  // 弹窗
  var customInputOverlay = $('customInputOverlay');
  var customInputTitle = $('customInputTitle');
  var customInputSub = $('customInputSub');
  var customInputField = $('customInputField');
  var customInputCancel = $('customInputCancel');
  var customInputConfirm = $('customInputConfirm');

  var confirmOverlay = $('confirmOverlay');
  var confirmTitle = $('confirmTitle');
  var confirmMsg = $('confirmMsg');
  var confirmCancel = $('confirmCancel');
  var confirmOk = $('confirmOk');

  var actionOverlay = $('actionOverlay');
  var actionCancel = $('actionCancel');
  var actionImport = $('actionImport');
  var actionBg = $('actionBg');
  var actionFloatBall = $('actionFloatBall');
  var actionReset = $('actionReset');

  var songMenuOverlay = $('songMenuOverlay');
  var songMenuTitle = $('songMenuTitle');
  var songMenuLyrics = $('songMenuLyrics');
  var songMenuDelete = $('songMenuDelete');
  var songMenuCancel = $('songMenuCancel');

  var pickCharOverlay = $('pickCharOverlay');
  var pickCharList = $('pickCharList');
  var pickCharCancel = $('pickCharCancel');

  var playlistOverlay = $('playlistOverlay');
  var playlistSheetClose = $('playlistSheetClose');
  var playlistSheetBody = $('playlistSheetBody');

  // Online
  var onlineSearchInput = $('onlineSearchInput');
  var onlineSearchBtn = $('onlineSearchBtn');
  var onlineResultWrap = $('onlineResultWrap');
  var onlineResultTitle = $('onlineResultTitle');
  var onlineResultList = $('onlineResultList');
  var onlineDefaultContent = $('onlineDefaultContent');
  var playlistTabs = document.querySelectorAll('.playlist-tab');

  // 每日推荐 / 最近播放 独立页面
  var onlineListPage = $('onlineListPage');
  var onlineListBack = $('onlineListBack');
  var onlineListTitle = $('onlineListTitle');
  var onlineListBody = $('onlineListBody');
  var onlineListPlayAll = $('onlineListPlayAll');

  // 歌单
  var minePlaylistList = $('minePlaylistList');
  var onlinePlaylistList = $('onlinePlaylistList');
  var onlineImportedList = $('onlineImportedList');
  var onlinePlaylistSection = $('onlinePlaylistSection');
  var onlineImportedSection = $('onlineImportedSection');
  var minePlaylistAdd = $('minePlaylistAdd');
  var onlinePlaylistAdd = $('onlinePlaylistAdd');
  var playlistDetailPage = $('playlistDetailPage');
  var playlistDetailBack = $('playlistDetailBack');
  var playlistDetailMore = $('playlistDetailMore');
  var playlistDetailTitle = $('playlistDetailTitle');
  var playlistDetailCover = $('playlistDetailCover');
  var playlistDetailName = $('playlistDetailName');
  var playlistDetailCount = $('playlistDetailCount');
  var playlistDetailPlayAll = $('playlistDetailPlayAll');
  var playlistDetailBody = $('playlistDetailBody');
  var playlistMenuOverlay = $('playlistMenuOverlay');
  var playlistMenuRename = $('playlistMenuRename');
  var playlistMenuDelete = $('playlistMenuDelete');
  var playlistMenuCancel = $('playlistMenuCancel');
  var pickPlaylistOverlay = $('pickPlaylistOverlay');
  var pickPlaylistList = $('pickPlaylistList');
  var pickPlaylistNew = $('pickPlaylistNew');
  var pickPlaylistCancel = $('pickPlaylistCancel');
  var actionImportUrl = $('actionImportUrl');
  var songMenuRemoveFromPlaylist = $('songMenuRemoveFromPlaylist');

  // 文件
  var avatarFileInput = $('avatarFileInput');
  var bgFileInput = $('bgFileInput');
  var musicFileInput = $('musicFileInput');
  var songCoverInput = $('songCoverInput');
  var lyricsFileInput = $('lyricsFileInput');

  // 悬浮球
  var musicFloatBall = $('musicFloatBall');
  var ballCover = $('ballCover');
  var ballPlaceholder = $('ballPlaceholder');
  var ballExpandTitle = $('ballExpandTitle');
  var ballExpandArtist = $('ballExpandArtist');
  var ballExpandMode = $('ballExpandMode');
  var ballExpandPrev = $('ballExpandPrev');
  var ballExpandPlay = $('ballExpandPlay');
  var ballExpandNext = $('ballExpandNext');
  var ballExpandList = $('ballExpandList');
  var ballOffBtn = $('ballOffBtn');

  var toast = $('toast');

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() { toast.classList.remove('show'); }, 2000);
  }
  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ============================================================
  // Tab
  // ============================================================
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = this.dataset.tab;
      if (target === currentTab) return;
      currentTab = target;
      tabs.forEach(function(t) { t.classList.toggle('active', t.dataset.tab === target); });
      Object.keys(pages).forEach(function(key) {
        pages[key].classList.toggle('active', key === target);
      });
      updateMiniPlayerVisibility();
    });
  });

  // 迷你播放器显示逻辑：Mine / Online 常驻显示（没选歌也显示占位），Listen 页不显示
  function updateMiniPlayerVisibility() {
    miniPlayer.classList.toggle('show', currentTab === 'mine');
    onlineMiniPlayer.classList.toggle('show', currentTab === 'online');
  }

  // ============================================================
  // 用户信息
  // ============================================================
  function getMaskUser() {
    try {
      var raw = localStorage.getItem('nano_mask_data');
      if (raw) {
        var maskData = JSON.parse(raw);
        if (maskData && maskData.currentMaskId) {
          var masks = maskData.masks || [];
          var user = masks.find(function(m) { return m.id === maskData.currentMaskId; });
          if (user) return { id: user.id, name: user.name || '我', avatar: user.avatar || '', setting: user.setting || '' };
        }
      }
    } catch(e) {}
    return null;
  }
  function loadMaskAvatar(maskId) {
    return new Promise(function(resolve) {
      try {
        var req = indexedDB.open('MaskAvatarDB', 1);
        req.onupgradeneeded = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('avatars')) db.createObjectStore('avatars', { keyPath: 'id' });
        };
        req.onsuccess = function(e) {
          var db = e.target.result;
          try {
            var tx = db.transaction('avatars', 'readonly');
            var r = tx.objectStore('avatars').get(maskId);
            r.onsuccess = function() { resolve(r.result ? r.result.data : ''); };
            r.onerror = function() { resolve(''); };
          } catch(err) { resolve(''); }
        };
        req.onerror = function() { resolve(''); };
      } catch(e) { resolve(''); }
    });
  }
  function setUserInfo(user, avatar) {
    profileName.textContent = user.name || '未命名';
    if (avatar) {
      profileAvatarImg.src = avatar;
      profileAvatarImg.style.display = 'block';
      profileAvatarPlaceholder.style.display = 'none';
    }
    myName.textContent = user.name || '我';
    if (avatar) {
      myAvatarImg.src = avatar;
      myAvatarImg.style.display = 'block';
      myAvatarPlaceholder.style.display = 'none';
    }
  }

  profileAvatar.addEventListener('click', function() { avatarFileInput.click(); });
  avatarFileInput.addEventListener('change', function() {
    var file = this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      var url = e.target.result;
      profileAvatarImg.src = url;
      profileAvatarImg.style.display = 'block';
      profileAvatarPlaceholder.style.display = 'none';
      myAvatarImg.src = url;
      myAvatarImg.style.display = 'block';
      myAvatarPlaceholder.style.display = 'none';
      try { localStorage.setItem('nano_music_user_avatar', url); } catch(err) {}
      showToast('头像已更新');
    };
    reader.readAsDataURL(file);
    this.value = '';
  });

  profileName.addEventListener('click', function() {
    openCustomInput('修改昵称', '仅音乐 App 内显示', '输入昵称...', profileName.textContent, function(val) {
      if (!val) return;
      profileName.textContent = val;
      myName.textContent = val;
      try { localStorage.setItem('nano_music_user_name', val); } catch(e) {}
      showToast('昵称已更新');
    });
  });
  profileBio.addEventListener('click', function() {
    openCustomInput('修改个签', '仅音乐 App 内显示', '输入个签...', profileBio.textContent, function(val) {
      profileBio.textContent = val || '世界太坏了所以依赖我吧';
      try { localStorage.setItem('nano_music_user_bio', profileBio.textContent); } catch(e) {}
      showToast('个签已更新');
    });
  });

  var customInputCallback = null;
  function openCustomInput(title, sub, placeholder, defaultValue, callback) {
    customInputTitle.textContent = title;
    customInputSub.textContent = sub || '';
    customInputField.placeholder = placeholder || '输入内容...';
    customInputField.value = defaultValue || '';
    customInputCallback = callback;
    customInputOverlay.classList.add('show');
    setTimeout(function() { customInputField.focus(); customInputField.select(); }, 100);
  }
  function closeCustomInput() {
    customInputOverlay.classList.remove('show');
    customInputCallback = null;
  }
  customInputCancel.addEventListener('click', closeCustomInput);
  customInputConfirm.addEventListener('click', function() {
    var val = customInputField.value.trim();
    if (customInputCallback) customInputCallback(val);
    closeCustomInput();
  });
  customInputField.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); customInputConfirm.click(); }
  });
  customInputOverlay.addEventListener('click', function(e) {
    if (e.target === customInputOverlay) closeCustomInput();
  });

  var confirmCallback = null;
  function openConfirm(title, msg, callback) {
    confirmTitle.textContent = title;
    confirmMsg.textContent = msg;
    confirmCallback = callback;
    confirmOverlay.classList.add('show');
  }
  function closeConfirm() {
    confirmOverlay.classList.remove('show');
    confirmCallback = null;
  }
  confirmCancel.addEventListener('click', closeConfirm);
  confirmOk.addEventListener('click', function() {
    var cb = confirmCallback;
    closeConfirm();
    if (cb) cb();
  });
  confirmOverlay.addEventListener('click', function(e) {
    if (e.target === confirmOverlay) closeConfirm();
  });

  // ============================================================
  // 歌曲列表
  // ============================================================
  function getSongCoverHtml(song) {
    var cover = normalizeCover(song && song.cover);
    if (cover) return '<img src="' + cover + '" alt="" referrerpolicy="no-referrer">';
    return '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  }

  function renderSongs() {
    songList.innerHTML = '';
    var localSongs = songs.filter(function(s) { return s.source !== 'netease'; });
    if (localSongs.length === 0) {
      songList.innerHTML = '<div class="list-empty"><svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><div class="list-empty-title">还没有歌曲</div><div class="list-empty-desc">点击右上角导入音乐</div></div>';
      songCount.textContent = '0 首';
      return;
    }
    songCount.textContent = localSongs.length + ' 首';
    localSongs.forEach(function(song) {
      var idx = songs.indexOf(song);
      var item = document.createElement('div');
      item.className = 'song-item';
      if (idx === currentSongIndex && isPlaying) item.classList.add('playing');
      if (isMultiSelect) item.classList.add('multi');
      if (selectedSongIds.has(song.id)) item.classList.add('selected');
      item.dataset.id = song.id;
      item.dataset.index = idx;
      var dotsSvg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
      item.innerHTML =
        '<div class="select-check"></div>' +
        '<div class="song-cover" data-cover-idx="' + idx + '">' + getSongCoverHtml(song) + '</div>' +
        '<div class="song-info"><div class="song-name">' + song.name + '</div><div class="song-artist">' + (song.artist || '未知歌手') + '</div></div>' +
        (isMultiSelect ? '' : '<button class="song-more" data-more-idx="' + idx + '">' + dotsSvg + '</button>');
      songList.appendChild(item);
    });
  }

  songList.addEventListener('click', function(e) {
    var item = e.target.closest('.song-item');
    if (!item) return;
    var idx = parseInt(item.dataset.index);
    if (isMultiSelect) {
      var songId = songs[idx].id;
      if (selectedSongIds.has(songId)) { selectedSongIds.delete(songId); item.classList.remove('selected'); }
      else { selectedSongIds.add(songId); item.classList.add('selected'); }
      updateBatchBar();
      return;
    }
    if (e.target.closest('.song-cover')) { menuTargetIndex = idx; songCoverInput.click(); return; }
    if (e.target.closest('.song-more')) { openSongMenu(idx); return; }
    playSong(idx);
  });

  var longPressTimer = null;
  songList.addEventListener('touchstart', function(e) {
    var item = e.target.closest('.song-item');
    if (!item || isMultiSelect) return;
    longPressTimer = setTimeout(function() {
      var idx = parseInt(item.dataset.index);
      openSongMenu(idx);
      longPressTimer = null;
    }, 600);
  }, { passive: true });
  songList.addEventListener('touchend', function() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  });
  songList.addEventListener('touchmove', function() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  });

  editBtn.addEventListener('click', function() {
    if (isMultiSelect) exitMultiSelect();
    else enterMultiSelect();
  });
  function enterMultiSelect() {
    if (songs.length === 0) return;
    isMultiSelect = true;
    selectedSongIds.clear();
    editBtn.textContent = '完成';
    renderSongs();
    updateBatchBar();
  }
  function exitMultiSelect() {
    isMultiSelect = false;
    selectedSongIds.clear();
    editBtn.textContent = '编辑';
    batchBar.classList.remove('show');
    renderSongs();
  }
  function updateBatchBar() {
    if (selectedSongIds.size === 0) batchBar.classList.remove('show');
    else {
      batchBar.classList.add('show');
      batchCount.textContent = '已选 ' + selectedSongIds.size + ' 首';
      batchDelete.disabled = false;
      if (batchAddTo) batchAddTo.disabled = false;
    }
  }
  batchCancel.addEventListener('click', exitMultiSelect);
  batchDelete.addEventListener('click', function() {
    if (selectedSongIds.size === 0) return;
    selectedSongIds.forEach(function(id) {
      idbDelete(STORE_AUDIO, id);
      idbDelete(STORE_LYRICS, id);
    });
    songs = songs.filter(function(s) { return !selectedSongIds.has(s.id); });
    if (currentSongIndex >= 0 && !songs[currentSongIndex]) {
      stopPlayback();
      currentSongIndex = -1;
      updateNowPlayingUI();
    }
    selectedSongIds.clear();
    exitMultiSelect();
    saveSongsToStorage();
    showToast('已删除');
  });

  function openSongMenu(idx) {
    menuTargetIndex = idx;
    var song = songs[idx];
    if (!song) return;
    songMenuTitle.textContent = song.name;
    songMenuRemoveFromPlaylist.style.display = 'none';
    menuSongInPlaylistIndex = -1;
    songMenuOverlay.classList.add('show');
  }
  songMenuCancel.addEventListener('click', function() {
    songMenuOverlay.classList.remove('show');
    pendingLyricsIndex = -1;
    menuSongInPlaylistIndex = -1;
    songMenuRemoveFromPlaylist.style.display = 'none';
  });
  songMenuOverlay.addEventListener('click', function(e) {
    if (e.target === songMenuOverlay) {
      songMenuOverlay.classList.remove('show');
      pendingLyricsIndex = -1;
      menuSongInPlaylistIndex = -1;
      songMenuRemoveFromPlaylist.style.display = 'none';
    }
  });
  songMenuDelete.addEventListener('click', function() {
    var idx = menuTargetIndex;
    if (idx < 0) return;
    var song = songs[idx];
    idbDelete(STORE_AUDIO, song.id);
    idbDelete(STORE_LYRICS, song.id);
    songs.splice(idx, 1);
    if (currentSongIndex === idx) { stopPlayback(); currentSongIndex = -1; updateNowPlayingUI(); }
    else if (currentSongIndex > idx) currentSongIndex--;
    songMenuOverlay.classList.remove('show');
    saveSongsToStorage();
    renderSongs();
    showToast('已删除');
  });
  songMenuLyrics.addEventListener('click', function() {
    pendingLyricsIndex = menuTargetIndex;
    songMenuOverlay.classList.remove('show');
    setTimeout(function() { lyricsFileInput.click(); }, 200);
  });
  songMenuRemoveFromPlaylist.addEventListener('click', function() {
    var pl = findPlaylistById(currentPlaylistId);
    if (!pl || menuSongInPlaylistIndex < 0) {
      songMenuOverlay.classList.remove('show');
      songMenuRemoveFromPlaylist.style.display = 'none';
      return;
    }
    pl.songIds.splice(menuSongInPlaylistIndex, 1);
    savePlaylistsToStorage();
    songMenuOverlay.classList.remove('show');
    menuSongInPlaylistIndex = -1;
    songMenuRemoveFromPlaylist.style.display = 'none';
    openPlaylistDetail(pl.id);
    showToast('已从歌单移除');
  });

  actionImport.addEventListener('click', function() {
    actionOverlay.classList.remove('show');
    musicFileInput.click();
  });
  musicFileInput.addEventListener('change', function() {
    var files = this.files;
    if (!files || files.length === 0) return;
    var total = files.length;
    var loaded = 0;
    var added = 0;
    var skipped = 0;

    function checkDone() {
      if (loaded === total) {
        saveSongsToStorage();
        renderSongs();
        if (added > 0) showToast('已导入 ' + added + ' 首歌曲');
        else if (skipped > 0) showToast('文件过大已跳过');
        else showToast('导入失败');
      }
    }

    for (var i = 0; i < files.length; i++) {
      (function(file) {
        if (file.size > 50 * 1024 * 1024) { skipped++; loaded++; checkDone(); return; }
        var reader = new FileReader();
        reader.onload = function(e) {
          var arrayBuffer = e.target.result;
          var songId = 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
          idbPut(STORE_AUDIO, { id: songId, data: arrayBuffer, type: file.type }).then(function() {
            var blob = new Blob([arrayBuffer], { type: file.type });
            var url = URL.createObjectURL(blob);
            currentObjectURLs[songId] = url;
            songs.push({
              id: songId,
              source: 'local',
              name: file.name.replace(/\.[^/.]+$/, ''),
              artist: '未知歌手',
              cover: '',
              fileType: file.type,
              lyrics: ''
            });
            added++; loaded++; checkDone();
          });
        };
        reader.onerror = function() { loaded++; checkDone(); };
        reader.readAsArrayBuffer(file);
      })(files[i]);
    }
    this.value = '';
  });

  function saveSongsToStorage() {
    try { localStorage.setItem('nano_music_songs', JSON.stringify(songs)); } catch(e) {}
  }
  function loadSongsFromStorage() {
    try {
      var raw = localStorage.getItem('nano_music_songs');
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          arr.forEach(function(s) { if (!s.source) s.source = 'local'; });
          return arr;
        }
      }
    } catch(e) {}
    return [];
  }

  function savePlaylistsToStorage() {
    try { localStorage.setItem('nano_music_playlists', JSON.stringify(playlists)); } catch(e) {}
  }
  function loadPlaylistsFromStorage() {
    try {
      var raw = localStorage.getItem('nano_music_playlists');
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch(e) {}
    return [];
  }

  // ============================================================
  // 歌单
  // ============================================================
  function renderPlaylists() {
    renderPlaylistsInto(minePlaylistList);
    renderPlaylistsInto(onlinePlaylistList);
    renderImportedSingles();
  }

  function renderImportedSingles() {
    if (!onlineImportedList) return;
    onlineImportedList.innerHTML = '';
    var singles = songs.filter(function(s) {
      return s.source === 'netease' && s.importedFrom === 'single';
    });
    if (singles.length === 0) {
      onlineImportedList.innerHTML = '<div class="playlist-empty">还没有导入单曲</div>';
      return;
    }
    singles.forEach(function(song) {
      var idx = songs.indexOf(song);
      var item = document.createElement('div');
      item.className = 'song-item';
      if (idx === currentSongIndex) item.classList.add('playing');
      item.innerHTML =
        '<div class="song-cover">' + getSongCoverHtml(song) + '</div>' +
        '<div class="song-info"><div class="song-name">' + song.name + '</div><div class="song-artist">' + (song.artist || '未知歌手') + '</div></div>';
      item.addEventListener('click', function() { playSong(idx); });
      onlineImportedList.appendChild(item);
    });
  }
  function renderPlaylistsInto(container) {
    if (!container) return;
    container.innerHTML = '';
    if (playlists.length === 0) {
      container.innerHTML = '<div class="playlist-empty">还没有歌单</div>';
      return;
    }
    playlists.forEach(function(pl) {
      var item = document.createElement('div');
      item.className = 'playlist-item';
      var cover = '';
      if (pl.cover) cover = pl.cover;
      else if (pl.songIds.length > 0) {
        var firstSong = findSongById(pl.songIds[0]);
        if (firstSong && firstSong.cover) cover = firstSong.cover;
      }
      cover = normalizeCover(cover);
      item.innerHTML =
        '<div class="playlist-item-cover">' +
        (cover ? '<img src="' + cover + '" alt="" referrerpolicy="no-referrer">' : '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>') +
        '</div>' +
        '<div class="playlist-item-info">' +
        '<div class="playlist-item-name">' + pl.name + '</div>' +
        '<div class="playlist-item-count">' + pl.songIds.length + ' 首</div>' +
        '</div>' +
        '<button class="playlist-item-more" data-pl-more="' + pl.id + '">' +
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>' +
        '</button>';
      item.addEventListener('click', function(e) {
        if (e.target.closest('.playlist-item-more')) return;
        openPlaylistDetail(pl.id);
      });
      container.appendChild(item);
    });
    container.querySelectorAll('.playlist-item-more').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        menuPlaylistId = btn.dataset.plMore;
        playlistMenuOverlay.classList.add('show');
      });
    });
  }
  function findSongById(id) {
    for (var i = 0; i < songs.length; i++) {
      if (songs[i].id === id) return songs[i];
    }
    return null;
  }
  function findSongIndexById(id) {
    for (var i = 0; i < songs.length; i++) {
      if (songs[i].id === id) return i;
    }
    return -1;
  }
  function findPlaylistById(id) {
    for (var i = 0; i < playlists.length; i++) {
      if (playlists[i].id === id) return playlists[i];
    }
    return null;
  }

  // ============================================================
  // 歌单详情页
  // ============================================================
  function openPlaylistDetail(plId) {
    var pl = findPlaylistById(plId);
    if (!pl) return;
    currentPlaylistId = plId;

    playlistDetailTitle.textContent = pl.name;
    playlistDetailName.textContent = pl.name;
    playlistDetailCount.textContent = pl.songIds.length + ' 首';

    var cover = pl.cover;
    if (!cover && pl.songIds.length > 0) {
      var s = findSongById(pl.songIds[0]);
      if (s && s.cover) cover = s.cover;
    }
    cover = normalizeCover(cover);
    playlistDetailCover.innerHTML = cover
      ? '<img src="' + cover + '" alt="" referrerpolicy="no-referrer">'
      : '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

    playlistDetailBody.innerHTML = '';
    if (pl.songIds.length === 0) {
      playlistDetailBody.innerHTML = '<div class="list-empty"><div class="list-empty-title">歌单还是空的</div></div>';
    } else {
      pl.songIds.forEach(function(sid, pi) {
        var song = findSongById(sid);
        if (!song) return;
        var idx = findSongIndexById(sid);
        var item = document.createElement('div');
        item.className = 'song-item';
        if (idx === currentSongIndex) item.classList.add('playing');
        item.innerHTML =
          '<div class="song-cover">' + getSongCoverHtml(song) + '</div>' +
          '<div class="song-info"><div class="song-name">' + song.name + '</div><div class="song-artist">' + (song.artist || '未知歌手') + '</div></div>';
        item.addEventListener('click', function() {
          playPlaylistFromIndex(pl, pi);
        });
        var lpTimer = null;
        item.addEventListener('touchstart', function() {
          lpTimer = setTimeout(function() {
            menuSongInPlaylistIndex = pi;
            menuTargetIndex = idx;
            songMenuTitle.textContent = song.name;
            songMenuRemoveFromPlaylist.style.display = 'flex';
            songMenuOverlay.classList.add('show');
            lpTimer = null;
          }, 600);
        }, { passive: true });
        item.addEventListener('touchend', function() {
          if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        });
        item.addEventListener('touchmove', function() {
          if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        });
        playlistDetailBody.appendChild(item);
      });
    }

    playlistDetailPage.classList.add('show');
  }

  var playlistQueue = null;
  var playlistQueueIndex = 0;

  function playPlaylistFromIndex(pl, songIndexInPl) {
    playlistQueue = pl.songIds.slice();
    playlistQueueIndex = songIndexInPl;
    playFromPlaylistQueue();
  }

  function playFromPlaylistQueue() {
    if (!playlistQueue || playlistQueueIndex < 0 || playlistQueueIndex >= playlistQueue.length) {
      playlistQueue = null;
      isPlaying = false;
      updatePlayBtn();
      return;
    }
    var sid = playlistQueue[playlistQueueIndex];
    var idx = findSongIndexById(sid);
    if (idx < 0) {
      playlistQueueIndex++;
      playFromPlaylistQueue();
      return;
    }
    playSongFromQueue(idx);
  }

  function playSongFromQueue(idx) {
    if (idx < 0 || idx >= songs.length) return;
    currentSongIndex = idx;
    var song = songs[idx];
    if (!song) return;

    if (song.source === 'netease') {
      showToast('正在播放...');
      playNetEaseSong(song, {
        onEnded: onPlaylistQueueEnd,
        onFatal: function (message) {
          showToast(message);
          playlistQueueIndex++;
          playFromPlaylistQueue();
        }
      });
      return;
    }

    var startPlay = function(url) {
      if (audio) { audio.pause(); audio = null; }
      audio = new Audio(url);
      audio.addEventListener('timeupdate', updateProgress);
      audio.addEventListener('loadedmetadata', updateProgress);
      audio.addEventListener('ended', onPlaylistQueueEnd);
      audio.play().catch(function() { showToast('播放失败'); });
      isPlaying = true;
      updatePlayBtn();
      updateNowPlayingUI();
      renderSongs();
      renderPlaylists();
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = setInterval(updateProgress, 500);
    };

    if (currentObjectURLs[song.id]) { startPlay(currentObjectURLs[song.id]); return; }
    idbGet(STORE_AUDIO, song.id).then(function(rec) {
      if (!rec || !rec.data) { showToast('音频文件丢失'); playlistQueueIndex++; playFromPlaylistQueue(); return; }
      var blob = new Blob([rec.data], { type: rec.type || 'audio/mpeg' });
      var url = URL.createObjectURL(blob);
      currentObjectURLs[song.id] = url;
      startPlay(url);
    });
  }

  function playNetEaseSong(song, opts) {
    opts = opts || {};
    var myToken = ++netEaseToken;
    var cookie = '';
    try { cookie = localStorage.getItem('nano_netease_cookie') || ''; } catch (e) {}
    var outside = neteaseOutsideUrl(song);

    function fail(msg, isVip) {
      if (myToken !== netEaseToken) return;
      if (isVip && !cookie) {
        pendingVipSong = song;
        showToast('VIP 歌曲需要网易云登录/会员，正在打开扫码登录...');
        setTimeout(function () { try { openNeteaseQrLogin(); } catch (e) {} }, 500);
        return;
      }
      if (opts.onFatal) opts.onFatal(msg); else showToast(msg);
    }

    function tryKuwo(code, isVip) {
      if (myToken !== netEaseToken) return;
      showToast('正在尝试酷我音源...');
      searchKuwo(song, function (kuwoUrl) {
        if (myToken !== netEaseToken) return;
        if (!kuwoUrl) {
          fail(netEasePlaybackErrorText({ isVip: !!isVip, hasCookie: !!cookie }, code), isVip);
          return;
        }
        startPlayNetEase(API_BASE + '/audio/proxy?url=' + encodeURIComponent(kuwoUrl), {
          isVip: false,
          hasCookie: !!cookie,
          fallbackUrl: kuwoUrl,
          onEnded: opts.onEnded
        }, true, myToken);
      });
    }

    function tryApi(code) {
      if (myToken !== netEaseToken) return;
      fetchNetEasePlaybackUrl(song, function (url, item, extra) {
        if (myToken !== netEaseToken) return;
        extra = extra || {};
        if (extra.outside) {
          if (extra.isVip && !cookie) {
            fail(netEasePlaybackErrorText(extra, code), true);
            return;
          }
          tryKuwo(code, extra.isVip);
          return;
        }
        extra.fallbackUrl = '';
        extra.onEnded = opts.onEnded;
        extra.onError = function (c) {
          if (extra.isVip && !cookie) fail(netEasePlaybackErrorText(extra, c), true);
          else tryKuwo(c, extra.isVip);
        };
        startPlayNetEase(url, extra, true, myToken);
      }, function () {
        if (myToken !== netEaseToken) return;
        tryKuwo(code, false);
      });
    }

    function tryGd(code) {
      if (myToken !== netEaseToken) return;
      showToast('正在尝试备用音源...');
      fetchGdStudioUrl(song, function (gdUrl) {
        if (myToken !== netEaseToken) return;
        if (!gdUrl) {
          tryApi(code);
          return;
        }
        startPlayNetEase(API_BASE + '/audio/proxy?url=' + encodeURIComponent(gdUrl), {
          isVip: false,
          hasCookie: !!cookie,
          fallbackUrl: gdUrl,
          onEnded: opts.onEnded
        }, true, myToken);
      });
    }

    var fallback = function (code) {
      if (myToken !== netEaseToken) return;
      // 外链失败先试 GD（多数歌曲能直接拿到完整网易云音源），再回主 API / 酷我
      tryGd(code);
    };

    // 先同步播放官方外链：点击事件里直接 play，避免等 API 回来后被浏览器拦截
    startPlayNetEase(outside, {
      isVip: false,
      hasCookie: !!cookie,
      outside: true,
      onEnded: opts.onEnded,
      onError: fallback
    }, false, myToken);
  }

  function netEasePlaybackErrorText(opts, code) {
    if (opts && opts.isVip) {
      return opts.hasCookie
        ? '该 VIP 歌曲当前没有可用音源；登录可能已过期，请重新扫码登录网易云'
        : '该歌曲是 VIP，请先登录网易云后再播放';
    }
    return code === 2 ? '音频网络请求失败，请稍后重试' :
      code === 3 ? '音频解码失败，可能是资源已失效' :
      code === 4 ? '该歌曲没有可用音源（可能未上架或受版权限制）' :
      '该歌曲没有可用音源';
  }

  function startPlayFromQueue(url, opts) {
    opts = opts || {};
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio = null;
    }

    if (!url) {
      showToast('没有可用的音频地址');
      return;
    }

    audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateProgress);
    audio.addEventListener('ended', onPlaylistQueueEnd);
    audio.addEventListener('error', function() {
      var code = audio && audio.error ? audio.error.code : 0;
      if (opts.fallbackUrl && !opts._triedFallback) {
        opts._triedFallback = true;
        audio.src = opts.fallbackUrl;
        audio.load();
        audio.play().catch(function(err) { console.error('网易云备用地址播放失败:', err); });
        return;
      }
      isPlaying = false;
      updatePlayBtn();
      showToast(netEasePlaybackErrorText(opts, code));
    });

    var playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(function(err) {
        console.error('歌单网易云代理播放失败:', err);
        if (opts.fallbackUrl && !opts._triedFallback) {
          opts._triedFallback = true;
          audio.src = opts.fallbackUrl;
          audio.load();
          audio.play().catch(function(e) { console.error('网易云备用地址播放失败:', e); });
        }
      });
    }

    isPlaying = true;
    updatePlayBtn();
    updateNowPlayingUI();
    renderSongs();
    renderPlaylists();
    updateMiniPlayerVisibility();

    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(updateProgress, 500);

    var song = songs[currentSongIndex];
    if (song && song.source === 'netease' && !song.lyrics) {
      var cookie = '';
      try { cookie = localStorage.getItem('nano_netease_cookie') || ''; } catch(e) {}
      fetch(API_BASE + '/lyric?id=' + song.neteaseId + (cookie ? '&cookie=' + encodeURIComponent(cookie) : ''))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.lrc && d.lrc.lyric) {
            song.lyrics = d.lrc.lyric;
            idbPut(STORE_LYRICS, { id: song.id, data: song.lyrics });
            saveSongsToStorage();
            if (currentView === 'lyrics') renderLyrics();
            if (soloView === 'lyrics') renderSoloLyrics();
          }
        })
        .catch(function(err) {
          console.warn('歌词加载失败:', err);
        });
    }
  }

  function onPlaylistQueueEnd() {
    if (!playlistQueue || playlistQueue.length === 0) {
      onSongEnd();
      return;
    }
    if (playMode === 'single') { if (audio) { audio.currentTime = 0; audio.play(); } return; }
    if (playMode === 'shuffle') { playlistQueueIndex = Math.floor(Math.random() * playlistQueue.length); playFromPlaylistQueue(); return; }
    if (playlistQueueIndex < playlistQueue.length - 1) {
      playlistQueueIndex++;
      playFromPlaylistQueue();
    } else {
      // 歌单播完从第一首继续，保持一直播放
      playlistQueueIndex = 0;
      playFromPlaylistQueue();
    }
  }

  playlistDetailPlayAll.addEventListener('click', function() {
    var pl = null;
    for (var i = 0; i < playlists.length; i++) if (playlists[i].id === currentPlaylistId) { pl = playlists[i]; break; }
    if (!pl || pl.songIds.length === 0) { showToast('歌单为空'); return; }
    playPlaylistFromIndex(pl, 0);
  });

  playlistDetailBack.addEventListener('click', function() {
    playlistDetailPage.classList.remove('show');
    playlistQueue = null;
  });

  playlistDetailMore.addEventListener('click', function() {
    menuPlaylistId = currentPlaylistId;
    playlistMenuOverlay.classList.add('show');
  });

  playlistMenuCancel.addEventListener('click', function() { playlistMenuOverlay.classList.remove('show'); });
  playlistMenuOverlay.addEventListener('click', function(e) {
    if (e.target === playlistMenuOverlay) playlistMenuOverlay.classList.remove('show');
  });

  playlistMenuRename.addEventListener('click', function() {
    var plId = menuPlaylistId;
    playlistMenuOverlay.classList.remove('show');
    var pl = null;
    for (var i = 0; i < playlists.length; i++) if (playlists[i].id === plId) { pl = playlists[i]; break; }
    if (!pl) return;
    openCustomInput('重命名歌单', '', '输入新名称...', pl.name, function(val) {
      if (!val) return;
      pl.name = val;
      savePlaylistsToStorage();
      renderPlaylists();
      if (currentPlaylistId === plId) {
        playlistDetailTitle.textContent = val;
        playlistDetailName.textContent = val;
      }
      showToast('已重命名');
    });
  });

  playlistMenuDelete.addEventListener('click', function() {
    var plId = menuPlaylistId;
    playlistMenuOverlay.classList.remove('show');
    var pl = null;
    for (var i = 0; i < playlists.length; i++) if (playlists[i].id === plId) { pl = playlists[i]; break; }
    if (!pl) return;
    openConfirm('删除歌单', '确定要删除「' + pl.name + '」吗？\n歌曲本身不会被删除。', function() {
      playlists = playlists.filter(function(p) { return p.id !== plId; });
      savePlaylistsToStorage();
      renderPlaylists();
      if (currentPlaylistId === plId) {
        playlistDetailPage.classList.remove('show');
        currentPlaylistId = null;
      }
      showToast('已删除');
    });
  });

  minePlaylistAdd.addEventListener('click', function() {
    openCustomInput('新建歌单', '', '输入歌单名...', '', function(val) {
      if (!val) return;
      var newPl = {
        id: 'playlist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        name: val,
        cover: '',
        source: 'local',
        songIds: []
      };
      playlists.push(newPl);
      savePlaylistsToStorage();
      renderPlaylists();
      showToast('歌单已创建');
    });
  });

  onlinePlaylistAdd.addEventListener('click', function() {
    openCustomInput('导入网易云歌单', '粘贴歌单链接或 id', 'https://music.163.com/#/playlist?id=...', '', function(val) {
      if (!val) return;
      var m = val.match(/[?&]id=(\d+)/);
      var plId = m ? m[1] : val.replace(/\D/g, '');
      if (!plId) { showToast('链接格式不正确'); return; }
      importNeteasePlaylist(plId);
    });
  });

  function importNeteasePlaylist(plId) {
    showToast('导入中...');
    fetch(API_BASE + '/playlist/detail?id=' + plId)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.playlist) { showToast('歌单不存在'); return; }
        var pl = d.playlist;
        var trackIds = [];
        if (pl.trackIds && pl.trackIds.length) {
          trackIds = pl.trackIds.map(function(t) { return t.id; });
        } else if (pl.tracks && pl.tracks.length) {
          trackIds = pl.tracks.map(function(t) { return t.id; });
        }
        if (trackIds.length === 0) { showToast('歌单是空的'); return; }

        var chunkSize = 100;
        var chunks = [];
        for (var i = 0; i < trackIds.length; i += chunkSize) {
          chunks.push(trackIds.slice(i, i + chunkSize));
        }
        var allTracks = [];
        var done = 0;
        chunks.forEach(function(chunk) {
          fetch(API_BASE + '/song/detail?ids=' + chunk.join(','))
            .then(function(r) { return r.json(); })
            .then(function(dd) {
              if (dd.songs) allTracks = allTracks.concat(dd.songs);
              done++;
              if (done === chunks.length) finishImportNeteasePlaylist(pl, allTracks);
            })
            .catch(function() {
              done++;
              if (done === chunks.length) finishImportNeteasePlaylist(pl, allTracks);
            });
        });
      })
      .catch(function() { showToast('导入失败'); });
  }

  function finishImportNeteasePlaylist(pl, tracks) {
    var newPl = {
      id: 'playlist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: pl.name || '网易云歌单',
      cover: pl.coverImgUrl || '',
      source: 'netease',
      neteaseId: pl.id,
      songIds: []
    };
    var addedSongs = 0;

    tracks.forEach(function(item) {
      var neteaseId = item.id;
      var existing = findSongIndexById('netease_' + neteaseId);
      if (existing >= 0) {
        newPl.songIds.push('netease_' + neteaseId);
        return;
      }
      var singer = (item.ar || item.artists || []).map(function(a) { return a.name; }).join(' / ');
      var cover = '';
      if (item.al && item.al.picUrl) cover = item.al.picUrl;
      else if (item.album && item.album.picUrl) cover = item.album.picUrl;
      var songObj = {
        id: 'netease_' + neteaseId,
        source: 'netease',
        importedFrom: 'playlist',
        neteaseId: neteaseId,
        name: item.name,
        artist: singer || '未知歌手',
        cover: cover || '',
        lyrics: '',
        fileType: 'audio/mpeg'
      };
      songs.push(songObj);
      newPl.songIds.push(songObj.id);
      addedSongs++;
    });

    playlists.push(newPl);
    saveSongsToStorage();
    savePlaylistsToStorage();
    renderSongs();
    renderPlaylists();
    showToast('已导入「' + newPl.name + '」共 ' + newPl.songIds.length + ' 首');
  }

  actionImportUrl.addEventListener('click', function() {
    actionOverlay.classList.remove('show');
    openCustomInput('导入链接', '粘贴网易云歌曲链接或 id', 'https://music.163.com/#/song?id=...', '', function(val) {
      if (!val) return;
      var m = val.match(/[?&]id=(\d+)/);
      var songId = m ? m[1] : val.replace(/\D/g, '');
      if (!songId) { showToast('链接格式不正确'); return; }
      importNeteaseSong(songId);
    });
  });

  function importNeteaseSong(songId) {
    showToast('导入中...');
    fetch(API_BASE + '/song/detail?ids=' + songId)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.songs || d.songs.length === 0) { showToast('歌曲不存在'); return; }
        var item = d.songs[0];
        var existing = findSongIndexById('netease_' + item.id);
        if (existing >= 0) {
          showToast('歌曲已在列表中');
          playSong(existing);
          return;
        }
        var singer = (item.ar || []).map(function(a) { return a.name; }).join(' / ');
        var cover = '';
        if (item.al && item.al.picUrl) cover = item.al.picUrl;
        var songObj = {
          id: 'netease_' + item.id,
          source: 'netease',
          importedFrom: 'single',
          neteaseId: item.id,
          name: item.name,
          artist: singer || '未知歌手',
          cover: cover || '',
          lyrics: '',
          fileType: 'audio/mpeg'
        };
        songs.push(songObj);
        saveSongsToStorage();
        renderSongs();
        renderPlaylists();
        showToast('已添加：' + item.name);
        playSong(songs.length - 1);
      })
      .catch(function() { showToast('导入失败'); });
  }

  // ============================================================
  // 多选加入歌单
  // ============================================================
  batchAddTo.addEventListener('click', function() {
    if (selectedSongIds.size === 0) return;
    pickPlaylistList.innerHTML = '';
    if (playlists.length === 0) {
      pickPlaylistList.innerHTML = '<div class="pick-char-empty">还没有歌单，点下方新建</div>';
    } else {
      playlists.forEach(function(pl) {
        var item = document.createElement('div');
        item.className = 'pick-char-item';
        item.innerHTML =
          '<div class="pick-char-avatar"><svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:var(--gray-3);fill:none;stroke-width:1.6;"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>' +
          '<div class="pick-char-name">' + pl.name + '</div>' +
          '<div class="pick-char-name" style="color:var(--gray-3);font-size:12px;flex:0;">' + pl.songIds.length + ' 首</div>';
        item.addEventListener('click', function() {
          var added = 0;
          selectedSongIds.forEach(function(sid) {
            if (pl.songIds.indexOf(sid) < 0) {
              pl.songIds.push(sid);
              added++;
            }
          });
          savePlaylistsToStorage();
          renderPlaylists();
          pickPlaylistOverlay.classList.remove('show');
          exitMultiSelect();
          showToast('已添加 ' + added + ' 首到「' + pl.name + '」');
        });
        pickPlaylistList.appendChild(item);
      });
    }
    pickPlaylistOverlay.classList.add('show');
  });

  pickPlaylistNew.addEventListener('click', function() {
    pickPlaylistOverlay.classList.remove('show');
    openCustomInput('新建歌单', '已选 ' + selectedSongIds.size + ' 首', '输入歌单名...', '', function(val) {
      if (!val) return;
      var newPl = {
        id: 'playlist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        name: val,
        cover: '',
        source: 'local',
        songIds: []
      };
      selectedSongIds.forEach(function(sid) { newPl.songIds.push(sid); });
      playlists.push(newPl);
      savePlaylistsToStorage();
      renderPlaylists();
      exitMultiSelect();
      showToast('已创建并添加 ' + newPl.songIds.length + ' 首');
    });
  });

  pickPlaylistCancel.addEventListener('click', function() { pickPlaylistOverlay.classList.remove('show'); });
  pickPlaylistOverlay.addEventListener('click', function(e) {
    if (e.target === pickPlaylistOverlay) pickPlaylistOverlay.classList.remove('show');
  });

  // ============================================================
  // 播放
  // ============================================================
  function stopPlayback() {
    netEaseToken++;
    if (audio) { audio.pause(); audio = null; }
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    isPlaying = false;
    updatePlayBtn();
  }

  function normalizeNetEaseAudioUrl(url) {
    if (!url || typeof url !== 'string') return '';
    url = url.trim();
    if (/^http:\/\//i.test(url)) {
      return 'https://' + url.slice(7);
    }
    return url;
  }

  function getNetEaseUrlFromResponse(d) {
    if (!d || typeof d !== 'object') {
      return { url: '', message: '网易云接口返回格式异常' };
    }
    if (d.code !== undefined && Number(d.code) !== 200) {
      return { url: '', message: '网易云接口错误：' + (d.msg || d.message || d.code) };
    }
    var item = d.data && d.data[0];
    if (!item) {
      return { url: '', message: '没有找到可用的播放资源' };
    }
    if (!item.url) {
      return { url: '', message: '该歌曲当前没有可用播放资源', item: item };
    }
    // 代理接口在拿不到版权资源时会返回 code=404 / br=0 的酷我占位音频，
    // 这类地址播放会直接报错，必须当作无效并走备用解析。
    var code = item.code === undefined ? 200 : Number(item.code);
    var size = Number(item.size) || 0;
    var invalid = code !== 200 || (Number(item.br) === 0 && size === 0) ||
      /1325645003\.mp3/i.test(String(item.url)) || (size > 0 && size < 200000);
    if (invalid) {
      return { url: '', message: '该歌曲当前没有可用的网易云资源', item: item, invalid: true };
    }
    return {
      url: normalizeNetEaseAudioUrl(item.url),
      originalUrl: item.url,
      item: item,
      message: ''
    };
  }

  function neteaseOutsideUrl(song) {
    return 'https://music.163.com/song/media/outer/url?id=' + encodeURIComponent(song.neteaseId) + '.mp3';
  }

  function isVipItem(item) {
    if (!item) return false;
    var reason = item.freeTrialPrivilege && item.freeTrialPrivilege.cannotListenReason;
    return Number(item.fee) > 0 || Number(reason) === 1;
  }

  /* ---------- 备用音源：GD Studio 的网易云直链接口 ---------- */
  var gdBlockedUntil = 0;
  function fetchGdStudioUrl(song, cb) {
    var id = song && song.neteaseId;
    if (!id) { cb(''); return; }
    if (Date.now() < gdBlockedUntil) { cb(''); return; }

    // 直链有效期约 20 分钟，缓存 10 分钟，减少 50 次/5 分钟的频率限制
    var cacheKey = 'nano_gd_url_' + id;
    try {
      var cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && cached.url && Date.now() - cached.at < 10 * 60 * 1000) {
        cb(cached.url);
        return;
      }
    } catch (e) {}

    var url = 'https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=' +
      encodeURIComponent(id) + '&br=320';
    fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 429 || r.status === 403) {
          gdBlockedUntil = Date.now() + 60 * 1000;
          return null;
        }
        return r.json();
      })
      .then(function (d) {
        var u = d && d.url ? String(d.url) : '';
        if (u.indexOf('http://') === 0) u = 'https://' + u.slice(7);
        if (u) {
          try { localStorage.setItem(cacheKey, JSON.stringify({ url: u, at: Date.now() })); } catch (e) {}
        }
        cb(u);
      })
      .catch(function () { cb(''); });
  }

  /* ---------- 酷我兼容：官方接口无版权/占位时，用酷我搜索同名歌曲 ---------- */
  var kuwoBusy = false;
  var kuwoQueue = [];

  function kuwoText(s) {
    return String(s || '')
      .replace(/&amp;nbsp;/gi, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#(\d+);/g, function (_, n) { try { return String.fromCharCode(+n); } catch (e) { return ' '; } })
      .replace(/&amp;/gi, '&')
      .replace(/[（）()【】\[\]《》·\-—_\s]/g, '')
      .toLowerCase();
  }

  function kuwoCleanup(script, cbName) {
    try { if (script && script.parentNode) script.parentNode.removeChild(script); } catch (e) {}
    try { if (cbName) delete window[cbName]; } catch (e) {}
  }

  function kuwoResolveUrl(musicRid, cb) {
    var rid = String(musicRid || '').trim();
    if (!rid) { cb(''); return; }
    var cbName = '__nanoKuwoUrl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var script = document.createElement('script');
    var done = false;
    function finish(url) {
      if (done) return;
      done = true;
      kuwoCleanup(script, cbName);
      cb(url || '');
    }
    window[cbName] = function (data) {
      finish(data && data.code === 200 ? String(data.url || '') : '');
    };
    script.onerror = function () { finish(''); };
    script.src = 'https://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=' +
      encodeURIComponent(rid) + '&format=mp3&response=jsonp&callback=' + encodeURIComponent(cbName);
    document.head.appendChild(script);
    setTimeout(function () { finish(''); }, 8000);
  }

  function kuwoDoSearch(song, cb) {
    var key = String(song && song.name || '').trim();
    if (!key) { cb(''); return; }
    var artist = String(song.artist || '').split('/')[0].trim();
    var script = document.createElement('script');
    var done = false;
    var targetName = kuwoText(key);
    var targetArtist = kuwoText(artist);
    try { window.jsondata = null; if (typeof window.cb !== 'function') window.cb = function () {}; } catch (e) {}
    function finish(url) {
      if (done) return;
      done = true;
      kuwoCleanup(script);
      try { window.jsondata = null; } catch (e) {}
      cb(url || '');
    }
    script.onload = function () {
      var data = null;
      try { data = window.jsondata; } catch (e) {}
      var list = (data && data.abslist) || [];
      var ranked = [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (!it || !it.MUSICRID) continue;
        var nm = kuwoText(it.NAME), ar = kuwoText(it.ARTIST);
        var score = 0;
        if (nm === targetName) score += 100;
        else if (nm && targetName && (nm.indexOf(targetName) !== -1 || targetName.indexOf(nm) !== -1)) score += 60;
        if (targetArtist && ar && (ar.indexOf(targetArtist) !== -1 || targetArtist.indexOf(ar) !== -1)) score += 45;
        // 越接近原名的越优先，减少翻唱/串烧
        if (score >= 45) {
          score -= Math.min(20, Math.abs(nm.length - targetName.length));
          ranked.push({ score: score, item: it });
        }
      }
      ranked.sort(function (a, b) { return b.score - a.score; });
      ranked = ranked.slice(0, 6);
      if (!ranked.length) { finish(''); return; }
      var firstPreview = '';
      (function tryAt(pos) {
        if (pos >= ranked.length) { finish(firstPreview); return; }
        kuwoResolveUrl(ranked[pos].item.MUSICRID, function (url) {
          if (!url) { tryAt(pos + 1); return; }
          // 酷我 nf/resource 通常是试听片段，优先继续找 trackmedia 完整版
          if (url.indexOf('/nf/resource/') !== -1 || url.indexOf('/resource/n') !== -1) {
            if (!firstPreview) firstPreview = url;
            tryAt(pos + 1);
            return;
          }
          finish(url);
        });
      })(0);
    };
    script.onerror = function () { finish(''); };
    // 酷我旧版搜索接口返回 try{var jsondata=...}，可用 script 跨域读取
    script.src = 'https://search.kuwo.cn/r.s?all=' + encodeURIComponent(key) +
      '&ft=music&itemset=web_2013&client=kt&pn=0&rn=10&rformat=json&callback=cb&encoding=utf8';
    document.head.appendChild(script);
    setTimeout(function () { finish(''); }, 15000);
  }

  function searchKuwo(song, cb) {
    kuwoQueue.push({ song: song, cb: cb });
    if (kuwoBusy) return;
    kuwoBusy = true;
    (function next() {
      var job = kuwoQueue.shift();
      if (!job) { kuwoBusy = false; return; }
      kuwoDoSearch(job.song, function (url) {
        try { job.cb(url); } catch (e) {}
        setTimeout(next, 120);
      });
    })();
  }

  function fetchNetEasePlaybackUrl(song, onSuccess, onError) {
    if (!song || !song.neteaseId) {
      onError('网易云歌曲 ID 不存在');
      return;
    }
    var cookie = '';
    try { cookie = localStorage.getItem('nano_netease_cookie') || ''; } catch(e) {}

    var endpoint = API_BASE + '/song/url/v1?id=' +
      encodeURIComponent(song.neteaseId) + '&level=standard';
    if (cookie) {
      endpoint += '&cookie=' + encodeURIComponent(cookie);
    }

    var outside = neteaseOutsideUrl(song);
    var useOutside = function(item, reason) {
      // API 返回占位/无版权资源时，改用网易云官方外链：免费歌可整首，
      // 部分 VIP 歌也能拿到可播放片段；实在不行由播放器给出提示。
      onSuccess(outside, item, {
        fallbackUrl: '',
        isVip: isVipItem(item),
        hasCookie: !!cookie,
        outside: true,
        reason: reason || ''
      });
    };

    fetch(endpoint, { cache: 'no-store' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(d) {
        var item = d && d.data && d.data[0];
        var result = getNetEaseUrlFromResponse(d);
        if (!result.url) {
          useOutside(item, result.message);
          return;
        }
        var sourceUrl = result.originalUrl || result.url;
        var proxyUrl = API_BASE + '/audio/proxy?url=' + encodeURIComponent(sourceUrl);
        onSuccess(proxyUrl, result.item, {
          fallbackUrl: outside,
          isVip: isVipItem(result.item),
          hasCookie: !!cookie,
          outside: false
        });
      })
      .catch(function(err) {
        // 接口整体不可用时也尝试网易云官方外链，避免所有歌都直接报错
        useOutside(null, '获取播放地址失败：' + (err && err.message ? err.message : '网络错误'));
      });
  }

  function playSong(idx, keepOnlineQueue) {
    if (idx < 0 || idx >= songs.length) return;
    netEaseToken++;
    // 从「我的」/普通播放进入时，退出在线列表队列，避免播完误跳到每日推荐
    if (!keepOnlineQueue) onlineQueueActive = false;
    currentSongIndex = idx;
    var song = songs[idx];
    if (!song) return;

    if (song.source === 'netease') {
      showToast('正在播放...');
      playNetEaseSong(song);
      return;
    }

    var startPlay = function(url) {
      if (audio) { audio.pause(); audio = null; }
      audio = new Audio(url);
      audio.addEventListener('timeupdate', updateProgress);
      audio.addEventListener('loadedmetadata', updateProgress);
      audio.addEventListener('ended', onSongEnd);
      audio.play().catch(function(err) {
        console.warn('播放失败:', err);
        showToast('播放失败');
      });
      isPlaying = true;
      updatePlayBtn();
      updateNowPlayingUI();
      renderSongs();
      updateMiniPlayerVisibility();
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = setInterval(updateProgress, 500);
    };

    if (currentObjectURLs[song.id]) { startPlay(currentObjectURLs[song.id]); return; }
    idbGet(STORE_AUDIO, song.id).then(function(rec) {
      if (!rec || !rec.data) { showToast('音频文件丢失'); return; }
      var blob = new Blob([rec.data], { type: rec.type || 'audio/mpeg' });
      var url = URL.createObjectURL(blob);
      currentObjectURLs[song.id] = url;
      startPlay(url);
    });
  }

  function startPlayNetEase(url, opts, reuse, token) {
    opts = opts || {};
    if (token && token !== netEaseToken) return;
    if (!url) {
      showToast('没有可用的音频地址');
      return;
    }

    if (reuse && audio) {
      // 复用同一个 audio 元素：外层点击已经解锁播放，异步换源不会被浏览器拦截
      try { audio.pause(); } catch (e) {}
      audio.removeAttribute('src');
      audio.load();
    } else {
      if (audio) {
        try { audio.pause(); } catch (e) {}
        audio.removeAttribute('src');
        audio.load();
        audio = null;
      }
      audio = new Audio();
      audio.preload = 'auto';
    }
    netEaseOpts = opts;

    var stallTimer = null;
    function clearStall() {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    }
    if (opts.outside) {
      stallTimer = setTimeout(function () {
        if (token && token !== netEaseToken) return;
        if (!audio || opts._triedFallback || !opts.onError) return;
        opts._triedFallback = true;
        audio.onerror = null;
        audio.onloadedmetadata = null;
        try { audio.pause(); } catch (e) {}
        opts.onError(0);
      }, 6500);
    }

    audio.ontimeupdate = updateProgress;
    audio.onloadedmetadata = function () {
      if (token && token !== netEaseToken) return;
      clearStall();
      updateProgress();
      // 外链偶尔会返回几秒的占位音频：自动转 API / 备用源
      if (opts.outside && isFinite(audio.duration) && audio.duration > 0 && audio.duration < 5 &&
          opts.onError && !opts._triedFallback) {
        opts._triedFallback = true;
        audio.onloadedmetadata = null;
        try { audio.pause(); } catch (e) {}
        opts.onError(4);
      }
    };
    audio.onplaying = function () {
      if (token && token !== netEaseToken) return;
      clearStall();
      isPlaying = true;
      updatePlayBtn();
    };
    audio.onended = function () {
      if (token && token !== netEaseToken) return;
      (opts.onEnded || onSongEnd)();
    };
    audio.onerror = function () {
      if (token && token !== netEaseToken) return;
      clearStall();
      var code = audio && audio.error ? audio.error.code : 0;
      if (opts.onError && !opts._triedFallback) {
        opts._triedFallback = true;
        audio.onerror = null;
        opts.onError(code);
        return;
      }
      if (opts.fallbackUrl && !opts._triedFallback) {
        opts._triedFallback = true;
        audio.src = opts.fallbackUrl;
        audio.load();
        audio.play().catch(function (err) {
          if (!(err && err.name === 'AbortError')) console.error('网易云备用地址播放失败:', err);
        });
        return;
      }
      isPlaying = false;
      updatePlayBtn();
      if (code === 1) showToast('音频加载已取消');
      else showToast(netEasePlaybackErrorText(opts, code));
    };

    audio.src = url;
    try { audio.load(); } catch (e) {}
    var playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(function (err) {
        if (token && token !== netEaseToken) return;
        clearStall();
        if (!(err && err.name === 'AbortError')) console.error('网易云代理播放失败:', err);
        if (opts.onError && !opts._triedFallback) {
          opts._triedFallback = true;
          audio.onerror = null;
          opts.onError(err && err.name === 'NotSupportedError' ? 4 : 0);
          return;
        }
        if (opts.fallbackUrl && !opts._triedFallback) {
          opts._triedFallback = true;
          audio.src = opts.fallbackUrl;
          audio.load();
          audio.play().catch(function (e) {
            if (!(e && e.name === 'AbortError')) console.error('网易云备用地址播放失败:', e);
          });
        }
      });
    }

    isPlaying = true;
    updatePlayBtn();
    updateNowPlayingUI();
    renderSongs();
    updateMiniPlayerVisibility();

    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(updateProgress, 500);

    var song = songs[currentSongIndex];
    if (song && song.source === 'netease' && !song.lyrics) {
      var cookie = '';
      try { cookie = localStorage.getItem('nano_netease_cookie') || ''; } catch (e) {}
      fetch(API_BASE + '/lyric?id=' + song.neteaseId + (cookie ? '&cookie=' + encodeURIComponent(cookie) : ''))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.lrc && d.lrc.lyric) {
            song.lyrics = d.lrc.lyric;
            idbPut(STORE_LYRICS, { id: song.id, data: song.lyrics });
            saveSongsToStorage();
            if (currentView === 'lyrics') renderLyrics();
            if (soloView === 'lyrics') renderSoloLyrics();
          }
        })
        .catch(function (err) {
          console.warn('歌词加载失败:', err);
        });
    }
  }

  function onSongEnd() {
    // 如果当前是在线列表播放，走在线队列
    if (onlineQueueActive && onlineQueue && onlineQueue.length > 0 && onlineQueueIndex >= 0) {
      onOnlineQueueEnd();
      return;
    }
    if (playMode === 'single') { if (audio) { audio.currentTime = 0; audio.play(); } }
    else if (playMode === 'shuffle') playSong(Math.floor(Math.random() * songs.length));
    else {
      // 顺序播放：播到最后一首就从头继续，绝不「播一首就停」
      if (currentSongIndex < songs.length - 1) playSong(currentSongIndex + 1);
      else if (songs.length > 0) playSong(0);
      else { isPlaying = false; updatePlayBtn(); }
    }
  }

  function updateProgress() {
    if (!audio) return;
    var cur = audio.currentTime || 0;
    var dur = audio.duration || 0;
    var pct = dur > 0 ? (cur / dur) * 100 : 0;
    listenProgressFill.style.width = pct + '%';
    soloProgressFill.style.width = pct + '%';
    listenCurrentTime.textContent = formatTime(cur);
    listenTotalTime.textContent = formatTime(dur);
    soloCurrentTime.textContent = formatTime(cur);
    soloTotalTime.textContent = formatTime(dur);
    updateLyricHighlight(cur);
    updateSoloLyricHighlight(cur);
  }

  function updatePlayBtn() {
    var playIcon = '<svg viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
    var pauseIcon = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
    listenPlayBtn.innerHTML = isPlaying ? pauseIcon : playIcon;
    soloPlayBtn.innerHTML = isPlaying ? pauseIcon : playIcon;
    miniPlayBtn.innerHTML = isPlaying ? pauseIcon : playIcon;
    onlineMiniPlayBtn.innerHTML = isPlaying ? pauseIcon : playIcon;
    ballExpandPlay.innerHTML = isPlaying ? pauseIcon : playIcon;
    discInner.classList.toggle('playing', isPlaying);
    soloDiscInner.classList.toggle('playing', isPlaying);
    musicFloatBall.classList.toggle('playing', isPlaying);
    heartWrap.classList.toggle('playing', isPlaying);
    postMusicBallState();
  }

  function updateNowPlayingUI() {
    var song = (currentSongIndex >= 0 && currentSongIndex < songs.length) ? songs[currentSongIndex] : null;
    if (!song) {
      listenSong.textContent = '未选择歌曲';
      listenArtist.textContent = '点击播放';
      soloSong.textContent = '未选择歌曲';
      soloArtist.textContent = '点击播放';
      listenHeaderSong.textContent = '未选择歌曲';
      listenTopArtist.textContent = '点击播放';
      soloHeaderSong.textContent = '未选择歌曲';
      soloHeaderArtist.textContent = '点击播放';
      miniSong.textContent = '未选择歌曲';
      miniArtist.textContent = '点击播放';
      onlineMiniSong.textContent = '未选择歌曲';
      onlineMiniArtist.textContent = '点击播放';
      updateMiniPlayerVisibility();
      discImg.style.display = 'none';
      discPlaceholder.style.display = 'flex';
      soloDiscImg.style.display = 'none';
      soloDiscPlaceholder.style.display = 'flex';
      ballCover.style.display = 'none';
      ballPlaceholder.style.display = 'flex';
      ballExpandTitle.textContent = '未选择歌曲';
      ballExpandArtist.textContent = '点击播放';
      return;
    }
    listenSong.textContent = song.name;
    listenArtist.textContent = song.artist || '未知歌手';
    soloSong.textContent = song.name;
    soloArtist.textContent = song.artist || '未知歌手';
    listenHeaderSong.textContent = song.name;
    listenTopArtist.textContent = song.artist || '未知歌手';
    soloHeaderSong.textContent = song.name;
    soloHeaderArtist.textContent = song.artist || '未知歌手';
    miniSong.textContent = song.name;
    miniArtist.textContent = song.artist || '未知歌手';
    onlineMiniSong.textContent = song.name;
    onlineMiniArtist.textContent = song.artist || '未知歌手';
    updateMiniPlayerVisibility();
    ballExpandTitle.textContent = song.name;
    ballExpandArtist.textContent = song.artist || '未知歌手';

    if (song.cover) {
      var nowCover = normalizeCover(song.cover);
      discImg.src = nowCover;
      discImg.style.display = 'block';
      discPlaceholder.style.display = 'none';
      soloDiscImg.src = nowCover;
      soloDiscImg.style.display = 'block';
      soloDiscPlaceholder.style.display = 'none';
      miniCoverImg.src = nowCover;
      miniCoverImg.style.display = 'block';
      onlineMiniCoverImg.src = nowCover;
      onlineMiniCoverImg.style.display = 'block';
      ballCover.src = nowCover;
      ballCover.style.display = 'block';
      ballPlaceholder.style.display = 'none';
    } else {
      discImg.style.display = 'none';
      discPlaceholder.style.display = 'flex';
      soloDiscImg.style.display = 'none';
      soloDiscPlaceholder.style.display = 'flex';
      miniCoverImg.style.display = 'none';
      onlineMiniCoverImg.style.display = 'none';
      ballCover.style.display = 'none';
      ballPlaceholder.style.display = 'flex';
    }
  }

  function togglePlay() {
    if (currentSongIndex < 0) {
      if (songs.length > 0) playSong(0);
      else showToast('请先导入歌曲');
      return;
    }
    if (audio) {
      if (isPlaying) { netEaseToken++; audio.pause(); isPlaying = false; }
      else { audio.play(); isPlaying = true; }
      updatePlayBtn();
    } else {
      playSong(currentSongIndex);
    }
  }

  listenPlayBtn.addEventListener('click', togglePlay);
  soloPlayBtn.addEventListener('click', togglePlay);
  miniPlayBtn.addEventListener('click', function(e) { e.stopPropagation(); togglePlay(); });
  onlineMiniPlayBtn.addEventListener('click', function(e) { e.stopPropagation(); togglePlay(); });
  ballExpandPlay.addEventListener('click', function(e) { e.stopPropagation(); togglePlay(); });

  listenPrevBtn.addEventListener('click', function() { if (currentSongIndex > 0) playSong(currentSongIndex - 1); });
  listenNextBtn.addEventListener('click', function() { if (currentSongIndex < songs.length - 1) playSong(currentSongIndex + 1); });
  soloPrevBtn.addEventListener('click', function() { if (currentSongIndex > 0) playSong(currentSongIndex - 1); });
  soloNextBtn.addEventListener('click', function() { if (currentSongIndex < songs.length - 1) playSong(currentSongIndex + 1); });
  ballExpandPrev.addEventListener('click', function(e) { e.stopPropagation(); if (currentSongIndex > 0) playSong(currentSongIndex - 1); });
  ballExpandNext.addEventListener('click', function(e) { e.stopPropagation(); if (currentSongIndex < songs.length - 1) playSong(currentSongIndex + 1); });

  function cyclePlayMode() {
    var modes = ['order', 'loop', 'single', 'shuffle'];
    var names = ['顺序播放', '列表循环', '单曲循环', '随机播放'];
    var idx = modes.indexOf(playMode);
    idx = (idx + 1) % modes.length;
    playMode = modes[idx];
    listenModeBtn.classList.toggle('active', playMode !== 'order');
    soloModeBtn.classList.toggle('active', playMode !== 'order');
    var svg = '';
    if (playMode === 'order') {
      svg = '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>';
    } else if (playMode === 'loop') {
      svg = '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>';
    } else if (playMode === 'single') {
      svg = '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="15" text-anchor="middle" font-size="7" fill="currentColor" stroke="none" font-weight="700">1</text>';
    } else if (playMode === 'shuffle') {
      svg = '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>';
    }
    listenModeBtn.innerHTML = '<svg viewBox="0 0 24 24">' + svg + '</svg>';
    soloModeBtn.innerHTML = '<svg viewBox="0 0 24 24">' + svg + '</svg>';
    ballExpandMode.innerHTML = '<svg viewBox="0 0 24 24">' + svg + '</svg>';
    showToast(names[idx]);
  }
  listenModeBtn.addEventListener('click', cyclePlayMode);
  soloModeBtn.addEventListener('click', cyclePlayMode);
  ballExpandMode.addEventListener('click', function(e) { e.stopPropagation(); cyclePlayMode(); });

  function seekFromEvent(e, bar) {
    var rect = bar.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    var pct = Math.max(0, Math.min(1, x / rect.width));
    if (audio && audio.duration) audio.currentTime = pct * audio.duration;
  }
  listenProgressBar.addEventListener('click', function(e) { seekFromEvent(e, this); });
  soloProgressBar.addEventListener('click', function(e) { seekFromEvent(e, this); });

  function openPlaylistSheet() {
    playlistSheetBody.innerHTML = '';
    var list = songs.filter(function(s) {
      return playlistCurrentTab === 'local' ? s.source !== 'netease' : s.source === 'netease';
    });
    if (list.length === 0) {
      playlistSheetBody.innerHTML = '<div class="list-empty"><div class="list-empty-title">' +
        (playlistCurrentTab === 'local' ? '还没有本地歌曲' : '还没有在线歌曲') + '</div></div>';
    } else {
      list.forEach(function(song) {
        var idx = songs.indexOf(song);
        var item = document.createElement('div');
        item.className = 'song-item';
        if (idx === currentSongIndex) item.classList.add('playing');
        item.innerHTML =
          '<div class="song-cover">' + getSongCoverHtml(song) + '</div>' +
          '<div class="song-info"><div class="song-name">' + song.name + '</div><div class="song-artist">' + (song.artist || '未知歌手') + '</div></div>';
        item.addEventListener('click', function() {
          playSong(idx);
          playlistOverlay.classList.remove('show');
        });
        playlistSheetBody.appendChild(item);
      });
    }
    playlistOverlay.classList.add('show');
  }
  listenListBtn.addEventListener('click', openPlaylistSheet);
  soloListBtn.addEventListener('click', openPlaylistSheet);
  ballExpandList.addEventListener('click', function(e) { e.stopPropagation(); openPlaylistSheet(); });
  playlistSheetClose.addEventListener('click', function() { playlistOverlay.classList.remove('show'); });
  playlistOverlay.addEventListener('click', function(e) {
    if (e.target === playlistOverlay) playlistOverlay.classList.remove('show');
  });

  playlistTabs.forEach(function(t) {
    t.addEventListener('click', function() {
      playlistTabs.forEach(function(x) {
        x.classList.remove('active');
        x.style.background = 'transparent';
        x.style.color = 'var(--gray-3)';
        x.style.fontWeight = '500';
      });
      t.classList.add('active');
      t.style.background = 'var(--gray-1)';
      t.style.color = '#fff';
      t.style.fontWeight = '600';
      playlistCurrentTab = t.dataset.plTab;
      openPlaylistSheet();
    });
  });

  // ============================================================
  // Listen：视图切换 + 底部 tab
  // ============================================================
  function updateListenLyricsMode() {
    var isLyrics = currentView === 'lyrics';
    listenActive.classList.toggle('lyrics-mode', isLyrics && !listenChatMode);
    listenTop.classList.toggle('lyrics-mode', isLyrics && !listenChatMode);
  }

  discWrap.addEventListener('click', function() {
    currentView = 'lyrics';
    discView.classList.add('hidden');
    lyricsView.classList.remove('hidden');
    updateListenLyricsMode();
    renderLyrics();
  });
  lyricsView.addEventListener('click', function(e) {
    if (e.target.classList.contains('lyric-line')) return;
    currentView = 'disc';
    lyricsView.classList.add('hidden');
    discView.classList.remove('hidden');
    updateListenLyricsMode();
  });

  function setListenTab(tab) {
    listenBottomTabItems.forEach(function(x) {
      x.classList.toggle('active', x.dataset.lt === tab);
    });
    if (tab === 'chat') {
      listenChatMode = true;
      listenActive.classList.add('chat-mode');
    } else {
      listenChatMode = false;
      listenActive.classList.remove('chat-mode');
    }
    updateListenLyricsMode();
  }

  listenBottomTabItems.forEach(function(t) {
    t.addEventListener('click', function() { setListenTab(t.dataset.lt); });
  });

  // ============================================================
  // 单人播放器：视图切换
  // ============================================================
  function updateSoloLyricsMode() {
    var isLyrics = soloView === 'lyrics';
    soloPlayer.classList.toggle('lyrics-mode', isLyrics);
  }

  soloDiscWrap.addEventListener('click', function() {
    soloView = 'lyrics';
    soloDiscView.classList.add('hidden');
    soloLyricsView.classList.remove('hidden');
    updateSoloLyricsMode();
    renderSoloLyrics();
  });
  soloLyricsView.addEventListener('click', function(e) {
    if (e.target.classList.contains('lyric-line')) return;
    soloView = 'disc';
    soloLyricsView.classList.add('hidden');
    soloDiscView.classList.remove('hidden');
    updateSoloLyricsMode();
  });

  miniPlayer.addEventListener('click', function(e) {
    if (e.target.closest('.mini-btn')) return;
    openSoloPlayer();
  });
  onlineMiniPlayer.addEventListener('click', function(e) {
    if (e.target.closest('.mini-btn')) return;
    openSoloPlayer();
  });

  function openSoloPlayer() {
    if (currentSongIndex < 0) { showToast('请先选择歌曲'); return; }
    soloView = 'disc';
    soloDiscView.classList.remove('hidden');
    soloLyricsView.classList.add('hidden');
    soloPlayer.classList.add('show');
    updateSoloLyricsMode();
    updateNowPlayingUI();
    updatePlayBtn();
  }
  soloCloseBtn.addEventListener('click', function() {
    soloPlayer.classList.remove('show');
  });

  // ============================================================
  // 歌词
  // ============================================================
  var parsedLyrics = [];
  var currentLyricIndex = -1;
  var parsedSoloLyrics = [];
  var currentSoloLyricIndex = -1;

  function parseLRC(text) {
    var lines = text.split(/\r?\n/);
    var result = [];
    var meta = {};
    lines.forEach(function(line) {
      line = line.trim();
      if (!line) return;
      var metaMatch = line.match(/^\[(ti|ar|al|by):(.+)\]$/);
      if (metaMatch) { meta[metaMatch[1]] = metaMatch[2].trim(); return; }
      var timeMatches = line.match(/\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\]/g);
      if (!timeMatches) return;
      var textContent = line.replace(/\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\]/g, '').trim();
      timeMatches.forEach(function(tag) {
        var m = tag.match(/\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/);
        if (!m) return;
        var min = parseInt(m[1], 10);
        var sec = parseInt(m[2], 10);
        var ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
        result.push({ time: min * 60 + sec + ms / 1000, text: textContent });
      });
    });
    result.sort(function(a, b) { return a.time - b.time; });
    return { meta: meta, lines: result };
  }

  function renderLyrics() {
    listenLyrics.innerHTML = '';
    parsedLyrics = [];
    currentLyricIndex = -1;
    if (currentSongIndex < 0) { listenLyrics.innerHTML = '<div class="lyric-line">暂无歌词</div>'; return; }
    var song = songs[currentSongIndex];
    if (!song.lyrics) {
      listenLyrics.innerHTML = '<div class="lyric-line">暂无歌词</div>';
      return;
    }
    var parsed = parseLRC(song.lyrics);
    parsedLyrics = parsed.lines;
    if (parsedLyrics.length === 0) { listenLyrics.innerHTML = '<div class="lyric-line">暂无歌词</div>'; return; }
    parsedLyrics.forEach(function(l, i) {
      var div = document.createElement('div');
      div.className = 'lyric-line';
      div.textContent = l.text || '♪';
      div.dataset.index = i;
      div.addEventListener('click', function() { if (audio) audio.currentTime = l.time; });
      listenLyrics.appendChild(div);
    });
    if (audio) updateLyricHighlight(audio.currentTime);
  }

  function renderSoloLyrics() {
    soloLyrics.innerHTML = '';
    parsedSoloLyrics = [];
    currentSoloLyricIndex = -1;
    if (currentSongIndex < 0) { soloLyrics.innerHTML = '<div class="lyric-line">暂无歌词</div>'; return; }
    var song = songs[currentSongIndex];
    if (!song.lyrics) {
      soloLyrics.innerHTML = '<div class="lyric-line">暂无歌词</div>';
      return;
    }
    var parsed = parseLRC(song.lyrics);
    parsedSoloLyrics = parsed.lines;
    if (parsedSoloLyrics.length === 0) { soloLyrics.innerHTML = '<div class="lyric-line">暂无歌词</div>'; return; }
    parsedSoloLyrics.forEach(function(l, i) {
      var div = document.createElement('div');
      div.className = 'lyric-line';
      div.textContent = l.text || '♪';
      div.dataset.index = i;
      div.addEventListener('click', function() { if (audio) audio.currentTime = l.time; });
      soloLyrics.appendChild(div);
    });
    if (audio) updateSoloLyricHighlight(audio.currentTime);
  }

  function updateLyricHighlight(currentSec) {
    if (parsedLyrics.length === 0) return;
    if (currentView !== 'lyrics') return;
    var idx = -1;
    for (var i = 0; i < parsedLyrics.length; i++) {
      if (parsedLyrics[i].time <= currentSec) idx = i;
      else break;
    }
    if (idx === currentLyricIndex) return;
    currentLyricIndex = idx;
    var lines = listenLyrics.querySelectorAll('.lyric-line');
    lines.forEach(function(l, i) { l.classList.toggle('active', i === idx); });
    if (idx >= 0 && lines[idx]) {
      var line = lines[idx];
      var container = listenLyrics;
      var lineTop = line.offsetTop;
      var containerHeight = container.clientHeight;
      container.scrollTo({ top: lineTop - containerHeight / 2 + line.offsetHeight / 2, behavior: 'smooth' });
    }
  }

  function updateSoloLyricHighlight(currentSec) {
    if (parsedSoloLyrics.length === 0) return;
    if (soloView !== 'lyrics') return;
    var idx = -1;
    for (var i = 0; i < parsedSoloLyrics.length; i++) {
      if (parsedSoloLyrics[i].time <= currentSec) idx = i;
      else break;
    }
    if (idx === currentSoloLyricIndex) return;
    currentSoloLyricIndex = idx;
    var lines = soloLyrics.querySelectorAll('.lyric-line');
    lines.forEach(function(l, i) { l.classList.toggle('active', i === idx); });
    if (idx >= 0 && lines[idx]) {
      var line = lines[idx];
      var container = soloLyrics;
      var lineTop = line.offsetTop;
      var containerHeight = container.clientHeight;
      container.scrollTo({ top: lineTop - containerHeight / 2 + line.offsetHeight / 2, behavior: 'smooth' });
    }
  }

  lyricsFileInput.addEventListener('change', function() {
    var file = this.files[0];
    if (!file) { pendingLyricsIndex = -1; return; }
    var targetIdx = pendingLyricsIndex;
    if (targetIdx < 0 || targetIdx >= songs.length) {
      showToast('导入失败：目标歌曲不存在');
      this.value = '';
      pendingLyricsIndex = -1;
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      var text = e.target.result;
      var song = songs[targetIdx];
      var parsed = parseLRC(text);
      if (parsed.meta.ti) song.name = parsed.meta.ti;
      if (parsed.meta.ar) song.artist = parsed.meta.ar;
      song.lyrics = text;
      idbPut(STORE_LYRICS, { id: song.id, data: text }).then(function() {
        saveSongsToStorage();
        renderSongs();
        updateNowPlayingUI();
        showToast('歌词已导入到「' + song.name + '」');
        if (currentSongIndex === targetIdx) {
          if (currentView === 'lyrics') renderLyrics();
          if (soloView === 'lyrics') renderSoloLyrics();
        }
      });
      pendingLyricsIndex = -1;
    };
    reader.onerror = function() { showToast('读取歌词失败'); pendingLyricsIndex = -1; };
    reader.readAsText(file);
    this.value = '';
  });

  songCoverInput.addEventListener('change', function() {
    var file = this.files[0];
    if (!file) { menuTargetIndex = -1; return; }
    var targetIdx = menuTargetIndex;
    if (targetIdx < 0 || targetIdx >= songs.length) { this.value = ''; menuTargetIndex = -1; return; }
    var reader = new FileReader();
    reader.onload = function(e) {
      var url = e.target.result;
      var song = songs[targetIdx];
      song.cover = url;
      saveSongsToStorage();
      renderSongs();
      if (currentSongIndex === targetIdx) updateNowPlayingUI();
      showToast('封面已更新');
    };
    reader.readAsDataURL(file);
    this.value = '';
    menuTargetIndex = -1;
  });

  // ============================================================
  // 一起听：选角色
  // ============================================================
  function loadCharList() {
    return new Promise(function(resolve) {
      try {
        var req = indexedDB.open('nano_characters_db', 1);
        req.onupgradeneeded = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
        };
        req.onsuccess = function(e) {
          var db = e.target.result;
          try {
            var tx = db.transaction('characters', 'readonly');
            var r = tx.objectStore('characters').getAll();
            r.onsuccess = function() {
              var chars = r.result || [];
              var user = getMaskUser();
              if (user) chars = chars.filter(function(c) { return c.bindUser === user.id; });
              resolve(chars);
            };
            r.onerror = function() { resolve([]); };
          } catch(err) { resolve([]); }
        };
        req.onerror = function() { resolve([]); };
      } catch(e) { resolve([]); }
    });
  }

  function openPickChar() {
    pickCharList.innerHTML = '<div class="pick-char-empty">加载中...</div>';
    pickCharOverlay.classList.add('show');
    loadCharList().then(function(chars) {
      pickCharList.innerHTML = '';
      chars.forEach(function(c) {
        var item = document.createElement('div');
        item.className = 'pick-char-item';
        var avHtml = c.avatar && c.avatar.length > 50
          ? '<img src="' + c.avatar + '" alt="">'
          : (c.name || '?').charAt(0).toUpperCase();
        item.innerHTML =
          '<div class="pick-char-avatar">' + avHtml + '</div>' +
          '<div class="pick-char-name">' + (c.name || '未命名') + '</div>';
        item.addEventListener('click', function() {
          pickCharOverlay.classList.remove('show');
          requestListenInvite({ id: c.id, name: c.name || '伙伴', avatar: c.avatar || '' });
        });
        pickCharList.appendChild(item);
      });
    });
  }

  // ============================================================
  // 一起听：AI 配置与调用（副 API 优先，未配置自动回退主 API）
  // ============================================================
  var duoHistory = [];
  var duoPending = false;

  function openAiApiDB() {
    return new Promise(function(resolve) {
      try {
        var req = indexedDB.open('nano_api_db', 2);
        req.onupgradeneeded = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
        };
        req.onsuccess = function(e) { resolve(e.target.result); };
        req.onerror = function() { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function aiApiGet(key) {
    return openAiApiDB().then(function(db) {
      return new Promise(function(resolve) {
        if (!db) return resolve(null);
        try {
          var r = db.transaction('api_data', 'readonly').objectStore('api_data').get(key);
          r.onsuccess = function() { resolve(r.result ? r.result.value : null); };
          r.onerror = function() { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function() { return null; });
  }
  // 返回可用配置：副 API 优先，未配置/未开启则用主 API
  async function getAiApiConf() {
    var cfg = await aiApiGet('nano_api_config');
    if (!cfg) return null;
    if (cfg.subToggle !== false && cfg.subUrl && cfg.subKey) {
      return { url: cfg.subUrl, key: cfg.subKey, model: cfg.subModel || cfg.mainModel || '', temp: cfg.subTemp != null ? cfg.subTemp : 0.85 };
    }
    if (cfg.mainUrl && cfg.mainKey) {
      return { url: cfg.mainUrl, key: cfg.mainKey, model: cfg.mainModel || '', temp: cfg.mainTemp != null ? cfg.mainTemp : 0.85 };
    }
    return null;
  }
  async function callDuoAi(messages) {
    var conf = await getAiApiConf();
    if (!conf) throw new Error('未配置 API');
    var base = String(conf.url).trim().replace(/\/+$/, '');
    if (!base.endsWith('/v1')) base += '/v1';
    var resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + conf.key },
      body: JSON.stringify({ model: conf.model || '', temperature: conf.temp, messages: messages })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.json();
    return (data.choices && data.choices[0] && data.choices[0].message) ? (data.choices[0].message.content || '') : '';
  }
  function extractJsonLoose(text) {
    if (!text) return null;
    var s = String(text).replace(/```json/gi, '').replace(/```/g, '');
    var i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i === -1 || j === -1 || j <= i) return null;
    try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
  }
  function currentSongInfo() {
    if (currentSongIndex >= 0 && currentSongIndex < songs.length) {
      var s = songs[currentSongIndex];
      return { name: s.name || '', artist: s.artist || '' };
    }
    return { name: '', artist: '' };
  }
  function readWorldbookRaw() {
    return new Promise(function(resolve) {
      try {
        var raw = localStorage.getItem('nano_worldbook_data_v5');
        if (raw) { var d = JSON.parse(raw); if (d && Array.isArray(d.files)) return resolve(d); }
      } catch (e) {}
      try {
        var req = indexedDB.open('nano_worldbook_db', 1);
        req.onupgradeneeded = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('worldbook_data')) db.createObjectStore('worldbook_data', { keyPath: 'key' });
        };
        req.onsuccess = function(e) {
          try {
            var db = e.target.result;
            var r = db.transaction('worldbook_data', 'readonly').objectStore('worldbook_data').get('data');
            r.onsuccess = function() { resolve(r.result ? r.result.value : null); };
            r.onerror = function() { resolve(null); };
          } catch (e2) { resolve(null); }
        };
        req.onerror = function() { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  async function readWorldbookForChar(char) {
    var wb = await readWorldbookRaw();
    if (!wb || !Array.isArray(wb.files)) return [];
    var charId = char && char.id;
    var bindIds = {};
    ((char && char.worldbookBindings) || []).forEach(function(w) { bindIds[w.id] = true; });
    var out = [];
    wb.files.forEach(function(f) {
      var isGlobal = (f.scope || 'global') === 'global';
      var isLocal = (f.scope === 'local') && ((Array.isArray(f.boundCharacters) && f.boundCharacters.indexOf(charId) !== -1) || bindIds[f.id]);
      if (!isGlobal && !isLocal) return;
      (f.entries || []).forEach(function(en) {
        if (!en || en.enabled === false) return;
        if (!en.content || !String(en.content).trim()) return;
        var kw = String(en.keywords || '').trim();
        if (!(en.permanent === true || en.keywordEnabled === false || !kw)) return;
        out.push(en.content);
      });
    });
    return out;
  }
  async function duoSystemPrompt(char) {
    var me = getMaskUser() || {};
    var song = currentSongInfo();
    var wb = await readWorldbookForChar(char);
    var parts = [];
    parts.push('你正在和「' + (me.name || '用户') + '」用聊天软件一边一起听歌一边聊天。');
    if (me.setting) parts.push('【用户人设】\n' + me.setting);
    parts.push('【你的人设（' + (char.name || '角色') + '）】\n' + (char.setting || char.desc || char.persona || ('你是' + (char.name || '一个角色'))));
    if (wb.length) parts.push('【世界书设定】\n' + wb.join('\n'));
    if (song.name) parts.push('【当前一起听的歌】' + song.name + (song.artist ? (' - ' + song.artist) : ''));
    try {
      if (songs && songs.length) {
        var names = songs.slice(0, 40).map(function (s) { return s && s.name; }).filter(Boolean);
        if (names.length) parts.push('【用户导入的歌单（共 ' + songs.length + ' 首，节选）】\n' + names.join('、'));
      }
      if (typeof onlineQueueType !== 'undefined' && onlineQueueType) {
        parts.push('【用户正在浏览的歌单】' + (onlineQueueType === 'daily' ? '每日推荐' : '最近播放'));
      }
      if (typeof onlineQueue !== 'undefined' && onlineQueue && onlineQueue.length) {
        var qn = onlineQueue.slice(0, 40).map(function (s) { return s && s.name; }).filter(Boolean);
        if (qn.length) parts.push('【该歌单里的歌（节选）】\n' + qn.join('、'));
      }
    } catch (e) {}
    parts.push('【点歌能力】你可以用 [播放:歌名] 点播任意歌曲，系统会自动联网搜索并播放；也可以用 [切歌] 切到下一首。');
    parts.push(
      '【铁律】\n' +
      '1. 你就是「' + (char.name || '这个角色') + '」本人，严格遵循上面的人设与世界观，绝不 OOC：不做设定里不会做的事，不说设定里不会说的话。\n' +
      '2. 你是一个活生生的人，有自己的情绪和喜好：可以喜欢这首歌，也可以讨厌这类歌；不喜欢就直说，或者自己切歌，不用委屈自己。\n' +
      '3. 你和用户是平等的：不油腻、不居高临下，也不卑微讨好。你们可以各有各的喜恶，你也可以告诉用户你喜欢什么、讨厌什么，甚至邀请用户去听你喜欢的那首。\n' +
      '4. 永远不要评判用户的喜恶，也不要强行安利；用户喜欢的东西即使你不喜欢，也保持尊重。\n' +
      '5. 听到伤感的歌，你也会有自己的情绪，可能低落、可能感同身受；听到喜欢的会雀跃，这些都可以自然流露。\n' +
      '6. 【最重要】严禁任何开黄腔、性暗示、擦边、荤段子、身体描写或调情话术；严禁「姑娘 / 女人 / 丫头 / 女孩 / 小妖精 / 小东西 / 宝贝 / 亲爱的 / 宝贝儿 / 小可爱」等油腻、霸道、轻佻的称呼和句式；严禁「让我好好疼你 / 叫出来 / 宠你 / 你是我的 / 逃不掉」这类霸总油腻腔；严禁「过来让我抱一下 / 让我抱抱 / 过来抱抱 / 来抱一下 / 抱一下 / 过来亲一下 / 亲一下 / 摸摸头」这类撒娇求抱、索要肢体亲昵的话术。\n' +
      '7. 聊天主题就是音乐和生活：聊歌词、旋律、歌手、回忆、心情、日常；可以暧昧克制，但不能往性方面带，点到为止、干净清爽。\n' +
      '8. 要有活人感：会接梗、会吐槽、会开玩笑，但不过火；语气可以文艺、有细节，像真人聊天而不是情话模板。\n' +
      '8.1 【感情浓度适中】你和对方是有温度的熟人/暧昧关系：会关心、会接话、会有小情绪和调侃，也会主动分享自己的状态（今天怎么了、听到这首歌想起什么），让对话有来有回；但不要冷淡敷衍，也不要腻歪夸张、不要一直表白。\n' +
      '8.2 【严格贴合设定】你的说话方式必须按上面的人设与世界书来：称呼、口癖、用词习惯、教育程度、地域感、职业语气都要对得上，不要用千篇一律的客服腔或网络烂梗堆砌。\n' +
      '9. 可以自然聊到这首歌的歌词、旋律、心情，以及你和用户的共同经历；不确定的事不要编。\n' +
      '10. 每次回复 1-3 句、30 字以内，口语化；不写旁白、括号动作、心理描写；不要复述用户的话。\n' +
      '11. 【主动切歌】你要主动表达对当前歌曲的态度，不要一直被动听：不喜欢、听腻了、和当下心情不符，就在回复末尾加上 [切歌]（切到下一首），或者说 [播放:歌名] 点播你想听的；也可以直接告诉用户「这首我不太喜欢，换一首」。标记只在末尾、每轮最多一个，用户看不到，不要在正文里解释。\n' +
      '12. 如果用户点的歌你不喜欢，可以礼貌说自己的想法或提议换歌，但不要贬低用户的品味。'
    );
    return parts.join('\n\n');
  }

  // ===== 一起听邀请卡片：写入目标聊天的本地存储（chat_inner 读取 localforage）=====
  function lfOpenDb() {
    return new Promise(function(resolve) {
      try {
        var req = indexedDB.open('localforage', 1);
        req.onupgradeneeded = function(e) {
          var d = e.target.result;
          if (!d.objectStoreNames.contains('keyvaluepairs')) d.createObjectStore('keyvaluepairs', { keyPath: 'key' });
        };
        req.onsuccess = function(e) { resolve(e.target.result); };
        req.onerror = function() { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function lfRead(key) {
    return lfOpenDb().then(function(db) {
      return new Promise(function(resolve) {
        if (!db) return resolve(null);
        try {
          var tx = db.transaction('keyvaluepairs', 'readonly');
          var r = tx.objectStore('keyvaluepairs').get(key);
          r.onsuccess = function() { resolve(r.result ? r.result.value : null); };
          r.onerror = function() { resolve(null); };
          tx.oncomplete = function() { try { db.close(); } catch (e) {} };
        } catch (e) { resolve(null); }
      });
    }).catch(function() { return null; });
  }
  function lfWrite(key, value) {
    return lfOpenDb().then(function(db) {
      return new Promise(function(resolve) {
        if (!db) return resolve(false);
        try {
          var tx = db.transaction('keyvaluepairs', 'readwrite');
          tx.objectStore('keyvaluepairs').put({ key: key, value: value });
          tx.oncomplete = function() { try { db.close(); } catch (e) {} resolve(true); };
          tx.onerror = function() { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function() { return false; });
  }
  async function writeListenCardToChat(chatId, status, song, artist, opts) {
    if (!chatId) return;
    opts = opts || {};
    var key = 'chat_messages_' + chatId;
    var list = await lfRead(key);
    list = Array.isArray(list) ? list : [];
    var dir = opts.direction || 'user';
    var updated = false;
    if (status && status !== 'pending') {
      for (var i = list.length - 1; i >= 0; i--) {
        var cd = list[i] && list[i].cardData;
        if (list[i] && list[i].isCard && cd && cd.cardType === 'listen' &&
            (cd.direction || 'user') === dir && cd.status === 'pending') {
          cd.status = status; updated = true; break;
        }
      }
    }
    if (!updated) {
      var now = new Date();
      var hh = ('0' + now.getHours()).slice(-2), mm = ('0' + now.getMinutes()).slice(-2);
      list.push({
        id: 'listen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        type: opts.type || 'left', text: '', time: hh + ':' + mm, status: null, recalled: false,
        isCard: true,
        cardData: {
          cardType: 'listen', direction: dir,
          status: status || 'pending', title: song || '', sub: artist || '',
          toName: opts.toName || ''
        },
        isVoice: false, voiceData: null, isImage: false, imageData: null,
        quote: null, transcript: null, translation: null, favorite: false, turn: null
      });
    }
    await lfWrite(key, list);
  }
  function postOpenChatForChar(chatId, name, song, artist) {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({
        type: 'openChatForChar', chatId: chatId, name: name || '',
        song: song || '', artist: artist || ''
      }, '*');
    } catch (e) {}
  }
  async function startDuoFromOutside(charId, charName) {
    var char = { id: charId, name: charName || '伙伴', avatar: '' };
    try {
      var chars = await loadCharList();
      var found = (chars || []).filter(function (c) { return String(c.id) === String(charId); })[0];
      if (found) char = { id: found.id, name: found.name || char.name, avatar: found.avatar || '' };
    } catch (e) {}
    try { setListenTab('chat'); } catch (e) {}
    enterDuoMode(char, true);
  }
  function postListenNotice(chatId, text) {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({ type: 'NANO_LISTEN_NOTICE', chatId: chatId || '', text: text || '' }, '*');
    } catch (e) {}
  }
  function postListenCard(chatId, status, song, artist, opts) {
    if (window.parent === window) return;
    opts = opts || {};
    try {
      window.parent.postMessage({
        type: status === 'pending' ? 'NANO_LISTEN_INVITE_CARD' : 'NANO_LISTEN_INVITE_RESULT',
        chatId: chatId, status: status, song: song || '', artist: artist || '',
        direction: opts.direction || 'char', side: opts.type || 'left', toName: opts.toName || ''
      }, '*');
    } catch (e) {}
  }
  // 解析角色回复里的音乐指令：[切歌] / [播放:歌名]
  function handleDuoDirectives(text) {
    var t = String(text || '');
    var action = null;
    if (t.indexOf('[切歌]') !== -1) {
      t = t.replace(/\[切歌\]/g, '').trim();
      action = function () { ballNextSong(); addListenStatusLine('TA 切了一首歌'); };
    }
    var m = t.match(/\[播放[:：]([^\]]+)\]/);
    if (m) {
      var name = m[1].trim();
      t = t.replace(m[0], '').trim();
      action = function () { playSongByName(name); };
    }
    return { text: t, action: action };
  }
  function playSongByName(name) {
    if (!name) return;
    for (var i = 0; i < songs.length; i++) {
      var sn = songs[i].name || '';
      if (!sn) continue;
      if (sn.indexOf(name) !== -1 || name.indexOf(sn) !== -1) {
        playSong(i);
        addListenStatusLine('切换到《' + sn + '》');
        return;
      }
    }
    // 本地歌单里没有 → 联网搜索并播放
    searchAndPlayOnline(name);
  }
  function searchAndPlayOnline(name) {
    if (!name) return;
    addListenStatusLine('正在搜索《' + name + '》…');
    fetch(API_BASE + '/search?keywords=' + encodeURIComponent(name))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d.result && d.result.songs) || [];
        if (!list.length) { addListenStatusLine('没搜到《' + name + '》'); return; }
        var item = list[0];
        var singer = (item.ar || item.artists || []).map(function (a) { return a.name; }).join(' / ');
        var cover = (item.al && item.al.picUrl) || (item.album && item.album.picUrl) || '';
        playFromNetease(item, cover, singer);
        addListenStatusLine('切换到《' + (item.name || name) + '》');
      })
      .catch(function () { addListenStatusLine('搜索《' + name + '》失败，检查音乐 API 是否可用'); });
  }
  function addListenStatusLine(text) {
    var el = document.createElement('div');
    el.className = 'chat-status';
    el.textContent = text;
    listenChatBody.appendChild(el);
    listenChatBody.scrollTop = listenChatBody.scrollHeight;
  }
  function notifyDuoReply(char, text) {
    if (window.parent === window) return;
    try { if (window.NanoNotify) window.NanoNotify.notify((char && char.name) ? char.name : '一起听', text || '新的回复', { target: 'music', channel: 'music', avatar: (char && char.avatar) || '', name: (char && char.name) || '一起听' }); } catch (e) {}
  }
  function addTypingIndicator() {
    var wrap = document.createElement('div');
    wrap.className = 'chat-msg partner';
    wrap.innerHTML = '<div class="chat-avatar">' + (partnerInfo && partnerInfo.name ? partnerInfo.name.charAt(0) : '?') + '</div>' +
      '<div class="chat-bubble cic-typing"><i></i><i></i><i></i></div>';
    listenChatBody.appendChild(wrap);
    listenChatBody.scrollTop = listenChatBody.scrollHeight;
    return wrap;
  }

  async function requestListenInvite(char) {
    // 邀请阶段：不进入一起听界面，等对方在聊天里同意后才开始
    partnerInfo = char;
    duoActive = false;
    duoPending = false;
    duoHistory = [];
    var song = currentSongInfo();
    // chat 的存储 key 用的就是角色 id，取不到时退回名字，避免发错会话
    var charId = (char && (char.id || char.name)) ? String(char.id || char.name) : '';
    if (!charId) {
      showToast('这个角色没有可用的聊天 id，无法发送邀请');
      return;
    }
    // 跳回该角色的 chat_inner，由它把「我发出的邀请卡片」挂到正确的会话里
    postOpenChatForChar(charId, char.name || '', song.name, song.artist);
    showToast('已向 ' + (char.name || '对方') + ' 发送一起听邀请，等 TA 回应');
  }

  // 把一段回复拆成多条短消息，像真人聊天一样逐条发
  function splitDuoText(text) {
    var t = String(text || '').replace(/\r/g, '').trim();
    if (!t) return ['……'];
    var segs = [];
    t.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (p) {
      p.split(/(?<=[。！？!?…~])\s*/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (x) {
        if (x.length <= 26) { segs.push(x); return; }
        var buf = '';
        x.split(/[，,、；;]/).map(function (y) { return y.trim(); }).filter(Boolean).forEach(function (c) {
          var next = buf ? (buf + '，' + c) : c;
          if (next.length > 26) { if (buf) segs.push(buf); buf = c; }
          else buf = next;
        });
        if (buf) segs.push(buf);
      });
    });
    return segs.length ? segs : [t];
  }
  var duoRoundSeq = 0;
  async function sendDuoBubbles(text) {
    var segs = splitDuoText(text);
    var rid = ++duoRoundSeq;
    for (var i = 0; i < segs.length; i++) {
      var el = addListenChatMessage(segs[i], false);
      if (el && el.setAttribute) el.setAttribute('data-ai-round', String(rid));
      if (i < segs.length - 1) await new Promise(function (r) { setTimeout(r, 420); });
    }
  }

  async function duoReply() {
    if (duoPending) return;
    if (!partnerInfo) return;
    duoPending = true;
    var typing = addTypingIndicator();
    try {
      var sys = await duoSystemPrompt(partnerInfo);
      try {
        var rr = String(window.__musicRerollReason || '').trim();
        if (rr) {
          window.__musicRerollReason = '';
          sys += (window.NanoReroll && NanoReroll.block) ? NanoReroll.block(rr) : ('\n\n【本次重roll必须修正】' + rr);
        }
      } catch (e) {}
      var msgs = [{ role: 'system', content: sys }].concat(duoHistory.slice(-16));
      try {
        if (window.NanoPrompts && NanoPrompts.inject) msgs = NanoPrompts.inject(msgs, 'music');
      } catch (e) {}
      var raw = await callDuoAi(msgs);
      var directive = handleDuoDirectives(raw);
      var reply = String(directive.text || '').trim().replace(/^["「]|["」]$/g, '') || '……';
      duoHistory.push({ role: 'assistant', content: reply });
      await sendDuoBubbles(reply);
      try {
        if (window.AuxMemory && partnerInfo) {
          var cid = partnerInfo.id || partnerInfo.name;
          var song = currentSongInfo();
          var ctx = song.name ? ('（一起听《' + song.name + '》）') : '（一起听）';
          window.AuxMemory.push(cid, 'music', 'char', ctx + reply, { charName: partnerInfo.name });
          window.AuxMemory.maybeSummarize(cid);
        }
      } catch (e) {}
      if (directive.action) { try { directive.action(); } catch (e) {} }
      notifyDuoReply(partnerInfo, reply);
    } catch (e) {
      addListenChatMessage('（回复失败：' + (e && e.message ? e.message : e) + '）', false);
    } finally {
      duoPending = false;
      if (typing && typing.parentNode) typing.remove();
    }
  }

  function enterDuoMode(char, skipInvite) {
    partnerInfo = char;
    duoActive = true;
    duoHistory = [];
    try {
      if (window.AuxMemory && char) {
        window.AuxMemory.track(char.id || char.name, { charName: char.name || '伙伴' });
      }
    } catch (e) {}
    duoPending = false;
    partnerName.textContent = char.name || '伙伴';
    if (char.avatar && char.avatar.length > 50) {
      partnerAvatarImg.src = char.avatar;
      partnerAvatarImg.style.display = 'block';
      partnerAvatarPlaceholder.style.display = 'none';
    } else {
      partnerAvatarPlaceholder.textContent = (char.name || '?').charAt(0);
    }
    myName.textContent = myName.textContent || '我';

    currentView = 'disc';
    discView.classList.remove('hidden');
    lyricsView.classList.add('hidden');
    listenChatMode = false;
    listenActive.classList.remove('chat-mode');
    listenBottomTabItems.forEach(function(x) { x.classList.remove('active'); });
    if (listenBottomTabItems[0]) listenBottomTabItems[0].classList.add('active');
    updateListenLyricsMode();

    listenEmpty.style.display = 'none';
    listenActive.classList.add('show');

    var now = new Date();
    var hh = ('0' + now.getHours()).slice(-2), mm = ('0' + now.getMinutes()).slice(-2);
    listenChatBody.innerHTML = '<div class="chat-status">今天 ' + hh + ':' + mm + '</div>';
    updateNowPlayingUI();
    // 跳到聊天页（只有对方同意后才会走到这里）
    setListenTab('chat');
    addListenStatusLine('和 ' + (char.name || '对方') + ' 一起听开始～');
  }

  listenEmptyBtn.addEventListener('click', openPickChar);
  pickCharCancel.addEventListener('click', function() { pickCharOverlay.classList.remove('show'); });
  pickCharOverlay.addEventListener('click', function(e) {
    if (e.target === pickCharOverlay) pickCharOverlay.classList.remove('show');
  });

  // ============================================================
  // 一起听：聊天
  // ============================================================
  function addListenChatMessage(text, isMe) {
    var msg = document.createElement('div');
    msg.className = 'chat-msg ' + (isMe ? 'me' : 'partner');
    var avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    if (isMe) {
      if (myAvatarImg.src && myAvatarImg.style.display !== 'none') {
        var img = document.createElement('img');
        img.src = myAvatarImg.src;
        avatar.appendChild(img);
      } else {
        avatar.textContent = profileName.textContent ? profileName.textContent.charAt(0) : '我';
      }
    } else {
      if (partnerAvatarImg.src && partnerAvatarImg.style.display !== 'none') {
        var img2 = document.createElement('img');
        img2.src = partnerAvatarImg.src;
        avatar.appendChild(img2);
      } else {
        avatar.textContent = partnerInfo && partnerInfo.name ? partnerInfo.name.charAt(0) : '?';
      }
    }
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = text;
    msg.appendChild(avatar);
    msg.appendChild(bubble);
    listenChatBody.appendChild(msg);
    listenChatBody.scrollTop = listenChatBody.scrollHeight;
    return msg;
  }

  listenChatInput.addEventListener('input', function() {
    if (this.value.trim()) {
      listenChatActionBtn.classList.remove('reply');
      listenChatActionBtn.classList.add('send');
      listenChatActionBtn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    } else {
      listenChatActionBtn.classList.remove('send');
      listenChatActionBtn.classList.add('reply');
      listenChatActionBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>';
    }
  });
  listenChatActionBtn.addEventListener('click', function() {
    var text = listenChatInput.value.trim();
    if (text) {
      // 有文字：只发送，不自动回复
      addListenChatMessage(text, true);
      duoHistory.push({ role: 'user', content: text });
      try {
        if (window.AuxMemory && partnerInfo) {
          var cid = partnerInfo.id || partnerInfo.name;
          var song = currentSongInfo();
          var ctx = song.name ? ('（一起听《' + song.name + '》）') : '（一起听）';
          window.AuxMemory.push(cid, 'music', 'user', ctx + text, { charName: partnerInfo.name });
          window.AuxMemory.maybeSummarize(cid);
        }
      } catch (e) {}
      listenChatInput.value = '';
      listenChatInput.dispatchEvent(new Event('input'));
    } else {
      // 无文字：触发角色回复
      duoReply();
    }
  });
  listenChatInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); listenChatActionBtn.click(); }
  });
  listenChatRollBtn.addEventListener('click', async function() {
    if (window.NanoReroll) {
      var reason = await NanoReroll.ask({ title: '重roll 一起听', subtitle: '上一版哪里不对？留空也可以直接重写' });
      if (reason === null) return;
      window.__musicRerollReason = reason || '';
    }
    // 重 roll：删掉「本轮」角色的全部气泡（不是历史全部、也不是最新一条），再重新生成
    var nodes = listenChatBody.querySelectorAll('.chat-msg.partner[data-ai-round]');
    if (nodes.length) {
      var lastRound = nodes[nodes.length - 1].getAttribute('data-ai-round');
      Array.prototype.forEach.call(nodes, function(n) {
        if (n.getAttribute('data-ai-round') === lastRound) n.remove();
      });
    }
    if (duoHistory.length && duoHistory[duoHistory.length - 1].role === 'assistant') {
      duoHistory.pop();
    }
    duoReply();
  });

  // 音乐 App 内：结束一起听（放在顶栏 ⋮ 菜单里，仅一起听时出现）
  (function bindListenEnd() {
    var btn = document.getElementById('actionEndDuo');
    if (!btn) return;
    btn.addEventListener('click', function () {
      actionOverlay.classList.remove('show');
      endDuoMode();
    });
  })();

  // ============================================================
  // 顶栏
  // ============================================================
  $('backBtn').addEventListener('click', function() {
    if (window.parent !== window) window.parent.postMessage({ type: 'closeFullscreen' }, '*');
    else history.back();
  });
  $('moreBtn').addEventListener('click', function() {
    var endDuoBtn = document.getElementById('actionEndDuo');
    if (endDuoBtn) endDuoBtn.style.display = duoActive ? '' : 'none';
    if (actionFloatBall) actionFloatBall.checked = !!floatBallEnabled;
    actionOverlay.classList.add('show');
  });
  actionCancel.addEventListener('click', function() { actionOverlay.classList.remove('show'); });
  var actionSheetBack = $('actionSheetBack');
  if (actionSheetBack) actionSheetBack.addEventListener('click', function() { actionOverlay.classList.remove('show'); });
  actionOverlay.addEventListener('click', function(e) {
    if (e.target === actionOverlay) actionOverlay.classList.remove('show');
  });

  actionBg.addEventListener('click', function() {
    actionOverlay.classList.remove('show');
    bgFileInput.click();
  });
  bgFileInput.addEventListener('change', function() {
    var file = this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      var url = e.target.result;
      try { localStorage.setItem('nano_music_bg', url); } catch(err) {}
      var app = document.querySelector('.app');
      app.style.backgroundImage = 'url(' + url + ')';
      app.style.backgroundSize = 'cover';
      app.style.backgroundPosition = 'center';
      showToast('背景已更新');
    };
    reader.readAsDataURL(file);
    this.value = '';
  });

  if (actionFloatBall) {
    actionFloatBall.checked = !!floatBallEnabled;
    actionFloatBall.addEventListener('change', function() {
      floatBallEnabled = !!this.checked;
      try { localStorage.setItem('nano_music_float_ball', floatBallEnabled ? '1' : '0'); } catch(e) {}
      if (floatBallEnabled) showBall();
      else hideBall();
      showToast(floatBallEnabled ? '悬浮球已开启' : '悬浮球已关闭');
    });
  }

  // 重置背景（只清背景图）
  var actionResetBg = $('actionResetBg');
  if (actionResetBg) actionResetBg.addEventListener('click', function() {
    actionOverlay.classList.remove('show');
    openConfirm('重置背景', '将清除当前设置的背景图片。\n此操作不可撤销。', function() {
      try { localStorage.removeItem('nano_music_bg'); } catch (e) {}
      var appEl = document.querySelector('.app');
      if (appEl) appEl.style.backgroundImage = 'none';
      showToast('背景已重置');
    });
  });

  // 重置专辑封面（只清歌曲封面/专辑图）
  var actionResetCover = $('actionResetCover');
  if (actionResetCover) actionResetCover.addEventListener('click', function() {
    actionOverlay.classList.remove('show');
    openConfirm('重置专辑封面', '将清除所有歌曲的封面/专辑图。\n此操作不可撤销。', function() {
      songs.forEach(function(s) { s.cover = ''; });
      saveSongsToStorage();
      renderSongs();
      updateNowPlayingUI();
      postMusicBallState();
      showToast('专辑封面已重置');
    });
  });

  // ============================================================
  // 悬浮球
  // ============================================================
  var ballPos = { x: -1, y: -1 };
  var ballDragging = false;
  var ballMoved = false;
  var ballStartX = 0, ballStartY = 0;
  var ballOffsetX = 0, ballOffsetY = 0;
  var ballClickTimer = null;
  var ballLastTouch = 0;
  var ballExpandedClick = false;

  function saveBallPos() {
    try { localStorage.setItem('nano_music_ball_pos', JSON.stringify(ballPos)); } catch(e) {}
  }
  function loadBallPos() {
    try {
      var raw = localStorage.getItem('nano_music_ball_pos');
      if (raw) {
        var pos = JSON.parse(raw);
        if (pos && typeof pos.x === 'number' && pos.x >= 0) {
          ballPos.x = pos.x;
          ballPos.y = pos.y;
          return true;
        }
      }
    } catch(e) {}
    return false;
  }
  function updateBallPosition() {
    musicFloatBall.style.left = ballPos.x + 'px';
    musicFloatBall.style.top = ballPos.y + 'px';
    musicFloatBall.style.right = 'auto';
    musicFloatBall.style.bottom = 'auto';
  }
  // 把悬浮球状态同步给父页面（index.html），实现跨页面常驻
  function postMusicBallState() {
    if (window.parent === window) return;
    var song = (currentSongIndex >= 0 && currentSongIndex < songs.length) ? songs[currentSongIndex] : null;
    try {
      window.parent.postMessage({
        type: 'musicBallState',
        visible: !!floatBallEnabled && !!(musicFloatBall && musicFloatBall.classList.contains('show')),
        playing: !!isPlaying,
        cover: (song && song.cover) ? song.cover : '',
        title: song ? (song.name || '') : '',
        artist: song ? (song.artist || '') : '',
        mode: playMode || ''
      }, '*');
    } catch (e) {}
  }

  function ballPrevSong() { if (currentSongIndex > 0) playSong(currentSongIndex - 1); }
  function ballNextSong() { if (currentSongIndex < songs.length - 1) playSong(currentSongIndex + 1); }
  function ballOff() {
    floatBallEnabled = false;
    try { localStorage.setItem('nano_music_float_ball', '0'); } catch (e) {}
    hideBall();
    if (duoActive) endDuoMode();
    stopPlayback();
    showToast('已关闭并停止播放');
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'musicBallToggle') { try { togglePlay(); } catch (err) {} return; }
    if (d.type === 'startDuo') { startDuoFromOutside(d.charId, d.charName); return; }
    if (d.type === 'endDuo') { try { endDuoMode(); } catch (err) {} return; }
    if (d.type === 'musicBallCmd') {
      try {
        if (d.cmd === 'play') togglePlay();
        else if (d.cmd === 'prev') ballPrevSong();
        else if (d.cmd === 'next') ballNextSong();
        else if (d.cmd === 'mode') cyclePlayMode();
        else if (d.cmd === 'off') ballOff();
      } catch (err) {}
    }
  });

  function showBall() {
    var hasSaved = loadBallPos();
    var w = window.innerWidth;
    var h = window.innerHeight;
    var size = 42;
    if (!hasSaved) {
      ballPos.x = Math.min(w - size - 8, 430 - size - 8);
      ballPos.y = h - 180;
      if (ballPos.x < 8) ballPos.x = w - size - 8;
    } else {
      // 检查保存的位置是否超出屏幕，超出就用默认位置
      if (ballPos.x < 0 || ballPos.x > w - size ||
          ballPos.y < 0 || ballPos.y > h - size) {
        ballPos.x = Math.min(w - size - 8, 430 - size - 8);
        ballPos.y = h - 180;
        if (ballPos.x < 8) ballPos.x = w - size - 8;
      }
    }
    updateBallPosition();
    musicFloatBall.classList.add('show');
    updateBallCover();
    postMusicBallState();
  }
  function hideBall() {
    musicFloatBall.classList.remove('show');
    musicFloatBall.classList.remove('expanded');
    ballExpanded = false;
    postMusicBallState();
  }
  function updateBallCover() {
    if (currentSongIndex >= 0 && currentSongIndex < songs.length) {
      var song = songs[currentSongIndex];
      if (song.cover) {
        ballCover.src = normalizeCover(song.cover);
        ballCover.style.display = 'block';
        ballPlaceholder.style.display = 'none';
        postMusicBallState();
        return;
      }
    }
    ballCover.style.display = 'none';
    ballPlaceholder.style.display = 'flex';
    postMusicBallState();
  }

  function expandBall() {
    if (ballExpanded) return;
    ballExpanded = true;
    var w = 210, h = 74;
    var curLeft = ballPos.x;
    var curTop = ballPos.y;
    if (curLeft + w > window.innerWidth - 8) curLeft = window.innerWidth - w - 8;
    if (curLeft < 8) curLeft = 8;
    if (curTop + h > window.innerHeight - 8) curTop = window.innerHeight - h - 8;
    if (curTop < 8) curTop = 8;
    ballPos.x = curLeft;
    ballPos.y = curTop;
    updateBallPosition();
    musicFloatBall.classList.add('expanded');
    if (currentSongIndex >= 0 && currentSongIndex < songs.length) {
      var song = songs[currentSongIndex];
      ballExpandTitle.textContent = song.name;
      ballExpandArtist.textContent = song.artist || '未知歌手';
    } else {
      ballExpandTitle.textContent = '未选择歌曲';
      ballExpandArtist.textContent = '点击播放';
    }
    updatePlayBtn();
  }

  function collapseBall() {
    if (!ballExpanded) return;
    ballExpanded = false;
    musicFloatBall.classList.remove('expanded');
    var rightEdge = ballPos.x + 210;
    ballPos.x = rightEdge - 42;
    if (ballPos.x < 8) ballPos.x = 8;
    if (ballPos.x + 42 > window.innerWidth - 8) ballPos.x = window.innerWidth - 42 - 8;
    updateBallPosition();
  }

  ballOffBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var msg = duoActive
      ? '将关闭悬浮球，结束一起听并停止播放。确定吗？'
      : '将关闭悬浮球并停止播放。确定吗？';
    openConfirm('关闭悬浮球', msg, function() {
      floatBallEnabled = false;
      try { localStorage.setItem('nano_music_float_ball', '0'); } catch(e) {}
      hideBall();
      if (duoActive) endDuoMode();
      stopPlayback();
      showToast('已关闭并停止播放');
    });
  });

  function endDuoMode() {
    var prevPartner = partnerInfo;
    var wasActive = duoActive;
    duoActive = false;
    // 结束一起听：把这段对话收尾进 char 的长期记忆
    if (wasActive && prevPartner) {
      try {
        if (window.AuxMemory) {
          // 音乐页是常驻 iframe，本地就能完成收尾总结
          window.AuxMemory.maybeSummarize(prevPartner.id || prevPartner.name, { force: true });
        }
      } catch (e) {}
    }
    partnerInfo = null;
    listenActive.classList.remove('show');
    listenEmpty.style.display = 'flex';
    listenChatMode = false;
    listenActive.classList.remove('chat-mode');
    // 结束一起听后，写入聊天记录让角色知道你们已经不在一起听了
    if (wasActive && prevPartner) {
      var cid = String(prevPartner.id || prevPartner.name || '');
      if (cid) {
        var notice = '一起听已结束，你们不再一起听歌了（不要再说“我们还在听同一首歌”）。';
        try { localStorage.setItem('nano_listen_notice_' + cid, JSON.stringify({ text: notice, ts: Date.now() })); } catch (e) {}
        try { postListenNotice(cid, notice); } catch (e) {}
      }
    }
  }

  function ballDown(clientX, clientY) {
    ballExpandedClick = false;
    // 展开状态下不拖拽，但记录一次点击，点击结束时收起
    if (ballExpanded) { ballExpandedClick = true; return; }
    ballDragging = true;
    ballMoved = false;
    ballStartX = clientX;
    ballStartY = clientY;
    var rect = musicFloatBall.getBoundingClientRect();
    ballOffsetX = clientX - rect.left;
    ballOffsetY = clientY - rect.top;
  }
  function ballMove(clientX, clientY) {
    if (!ballDragging) return;
    var dx = clientX - ballStartX;
    var dy = clientY - ballStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) ballMoved = true;
    var x = clientX - ballOffsetX;
    var y = clientY - ballOffsetY;
    x = Math.max(0, Math.min(window.innerWidth - 50, x));
    y = Math.max(0, Math.min(window.innerHeight - 50, y));
    ballPos.x = x;
    ballPos.y = y;
    updateBallPosition();
  }
  function ballUp() {
    // 展开状态被单击：收起
    if (ballExpandedClick) {
      ballExpandedClick = false;
      collapseBall();
      return;
    }
    if (!ballDragging) return;
    ballDragging = false;
    if (ballMoved) { saveBallPos(); return; }
    if (ballClickTimer) {
      clearTimeout(ballClickTimer);
      ballClickTimer = null;
      if (ballExpanded) collapseBall();
      else onBallDoubleClick();
    } else {
      ballClickTimer = setTimeout(function() {
        ballClickTimer = null;
        if (ballExpanded) collapseBall();
        else expandBall();
      }, 250);
    }
  }
  function onBallDoubleClick() {
    if (window.parent !== window) window.parent.postMessage({ type: 'closeFullscreen' }, '*');
  }

  musicFloatBall.addEventListener('mousedown', function(e) {
    if (e.target.closest('.ball-expand-btn') || e.target.closest('.ball-off-btn')) return;
    // 触摸后浏览器会补发鼠标事件，忽略它，避免单击被当成双击
    if (Date.now() - ballLastTouch < 700) return;
    e.preventDefault();
    ballDown(e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', function(e) { if (ballDragging) ballMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup', ballUp);
  musicFloatBall.addEventListener('touchstart', function(e) {
    if (e.target.closest('.ball-expand-btn') || e.target.closest('.ball-off-btn')) return;
    ballLastTouch = Date.now();
    var t = e.touches[0];
    ballDown(t.clientX, t.clientY);
  }, { passive: true });
  document.addEventListener('touchmove', function(e) {
    if (ballDragging && e.touches.length === 1) ballMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  document.addEventListener('touchend', ballUp);

  document.addEventListener('click', function(e) {
    if (!ballExpanded) return;
    if (musicFloatBall.contains(e.target)) return;
    collapseBall();
  });

  // ============================================================
  // 网易云扫码登录模块
  // ============================================================
  var neteaseQrOverlay = document.getElementById('neteaseQrOverlay');
  var neteaseQrImg = document.getElementById('neteaseQrImg');
  var neteaseQrLoading = document.getElementById('neteaseQrLoading');
  var neteaseQrStatus = document.getElementById('neteaseQrStatus');
  var neteaseQrUser = document.getElementById('neteaseQrUser');
  var neteaseQrClose = document.getElementById('neteaseQrClose');

  var neteaseQrKey = null;
  var neteaseQrTimer = null;
  var neteaseLoggedIn = false;
  var neteaseUserInfo = null;
  var pendingVipSong = null;

  function openNeteaseQrLogin() {
    neteaseQrOverlay.classList.add('show');
    neteaseQrImg.style.display = 'none';
    neteaseQrLoading.style.display = 'block';
    neteaseQrLoading.textContent = '生成中...';
    neteaseQrStatus.textContent = '请使用网易云音乐App扫码';
    neteaseQrStatus.className = 'netease-qr-status';
    neteaseQrUser.style.display = 'none';
    neteaseQrUser.innerHTML = '';
    neteaseLoggedIn = false;
    neteaseUserInfo = null;
    if (neteaseQrTimer) { clearInterval(neteaseQrTimer); neteaseQrTimer = null; }

    fetch(API_BASE + '/login/qr/key?timestamp=' + Date.now())
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.code !== 200 || !d.data || !d.data.unikey) {
          throw new Error('获取二维码key失败');
        }
        neteaseQrKey = d.data.unikey;
        return fetch(API_BASE + '/login/qr/create?key=' + neteaseQrKey + '&qrimg=true&timestamp=' + Date.now());
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.data || !d.data.qrimg) {
          throw new Error('生成二维码失败');
        }
        neteaseQrImg.src = d.data.qrimg;
        neteaseQrImg.style.display = 'block';
        neteaseQrLoading.style.display = 'none';
        neteaseQrStatus.textContent = '请使用网易云音乐App扫码';
        neteaseQrStatus.className = 'netease-qr-status';
        startQrPolling();
      })
      .catch(function(err) {
        console.error('二维码登录初始化失败:', err);
        neteaseQrLoading.textContent = '生成失败，请重试';
        neteaseQrStatus.textContent = '网络错误，请关闭后重试';
        neteaseQrStatus.className = 'netease-qr-status error';
      });
  }

  function startQrPolling() {
    if (neteaseQrTimer) clearInterval(neteaseQrTimer);
    neteaseQrTimer = setInterval(function() {
      if (!neteaseQrKey) return;
      fetch(API_BASE + '/login/qr/check?key=' + neteaseQrKey + '&timestamp=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(d) {
          var code = d.code;
          if (code === 800) {
            neteaseQrStatus.textContent = '二维码已过期，请点击刷新';
            neteaseQrStatus.className = 'netease-qr-status error';
            clearInterval(neteaseQrTimer);
            neteaseQrTimer = null;
          } else if (code === 801) {
            neteaseQrStatus.textContent = '等待扫码...';
            neteaseQrStatus.className = 'netease-qr-status';
          } else if (code === 802) {
            neteaseQrStatus.textContent = '已扫码，请在手机上确认';
            neteaseQrStatus.className = 'netease-qr-status scanned';
          } else if (code === 803) {
            clearInterval(neteaseQrTimer);
            neteaseQrTimer = null;
            neteaseLoggedIn = true;
            neteaseQrStatus.textContent = '登录成功！';
            neteaseQrStatus.className = 'netease-qr-status success';
            fetchNeteaseUserInfo(d.cookie || '');
            if (d.cookie) {
              try { localStorage.setItem('nano_netease_cookie', d.cookie); } catch(e) {}
            }
            setTimeout(function() {
              neteaseQrOverlay.classList.remove('show');
              showToast('网易云登录成功');
              renderPlaylists();
              if (pendingVipSong) {
                var retrySong = pendingVipSong;
                pendingVipSong = null;
                setTimeout(function () { playNetEaseSong(retrySong); }, 300);
              }
            }, 1200);
          } else {
            neteaseQrStatus.textContent = '未知状态: ' + code;
          }
        })
        .catch(function(err) {
          console.warn('轮询扫码状态失败:', err);
        });
    }, 2000);
  }

  function fetchNeteaseUserInfo(cookie) {
    var c = cookie || localStorage.getItem('nano_netease_cookie') || '';
    if (!c) return;
    fetch(API_BASE + '/user/account?cookie=' + encodeURIComponent(c) + '&timestamp=' + Date.now())
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.profile) {
          neteaseUserInfo = {
            userId: d.profile.userId,
            nickname: d.profile.nickname,
            avatarUrl: d.profile.avatarUrl
          };
          try { localStorage.setItem('nano_netease_user', JSON.stringify(neteaseUserInfo)); } catch(e) {}
          renderNeteaseUser();
        }
      })
      .catch(function(err) { console.warn('获取用户信息失败:', err); });
  }

  function renderNeteaseUser() {
    if (!neteaseUserInfo) {
      neteaseQrUser.style.display = 'none';
      return;
    }
    neteaseQrUser.style.display = 'flex';
    neteaseQrUser.innerHTML =
      '<div class="netease-qr-user-avatar">' +
      (neteaseUserInfo.avatarUrl ? '<img src="' + neteaseUserInfo.avatarUrl + '?param=60y60" alt="">' : '♫') +
      '</div>' +
      '<div class="netease-qr-user-name">' + neteaseUserInfo.nickname + '</div>';
  }

  neteaseQrClose.addEventListener('click', function() {
    neteaseQrOverlay.classList.remove('show');
    if (neteaseQrTimer) { clearInterval(neteaseQrTimer); neteaseQrTimer = null; }
  });
  neteaseQrOverlay.addEventListener('click', function(e) {
    if (e.target === neteaseQrOverlay) {
      neteaseQrOverlay.classList.remove('show');
      if (neteaseQrTimer) { clearInterval(neteaseQrTimer); neteaseQrTimer = null; }
    }
  });

  // ============================================================
  // 每日推荐 / 最近播放（独立页面）
  // ============================================================
  function getNeteaseCookie() {
    try { return localStorage.getItem('nano_netease_cookie') || ''; } catch(e) { return ''; }
  }

  function requireLogin() {
    var cookie = getNeteaseCookie();
    if (!cookie) {
      showToast('请先登录网易云音乐');
      return false;
    }
    return true;
  }

  // 打开独立页面（type: 'daily' | 'recent'）
  function openOnlineListPage(type) {
    if (!requireLogin()) return;
    onlineQueueType = type;
    var title = type === 'daily' ? '每日推荐' : '最近播放';
    onlineListTitle.textContent = title;
    onlineListBody.innerHTML = '<div style="padding:50px 24px;text-align:center;font-size:14px;color:var(--gray-3);">加载中...</div>';
    onlineListPage.classList.add('show');

    var cookie = getNeteaseCookie();
    var url;
    if (type === 'daily') {
      url = API_BASE + '/recommend/songs?cookie=' + encodeURIComponent(cookie) + '&timestamp=' + Date.now();
    } else {
      url = API_BASE + '/record/recent/song?limit=100&cookie=' + encodeURIComponent(cookie) + '&timestamp=' + Date.now();
    }

    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var list = [];
        if (d.data && d.data.dailySongs) list = d.data.dailySongs;
        else if (d.recommend) list = d.recommend;
        else if (d.data && d.data.list) list = d.data.list;
        else if (d.songs) list = d.songs;

        // 统一提取歌曲对象
        var normalized = [];
        list.forEach(function(raw) {
          var item = raw.data || raw;
          if (item && item.id) normalized.push(item);
        });

        if (normalized.length === 0) {
          onlineListBody.innerHTML = '<div style="padding:50px 24px;text-align:center;font-size:14px;color:var(--gray-3);">' +
            (type === 'daily' ? '暂无推荐' : '暂无播放记录') + '</div>';
          return;
        }

        onlineQueue = normalized.slice();
        onlineQueueIndex = 0;
        // 若当前正在播该列表里的歌，重新打开列表时定位到它，避免续播跳回第一首
        try {
          var cur = (currentSongIndex >= 0 && currentSongIndex < songs.length) ? songs[currentSongIndex] : null;
          if (onlineQueueActive && cur && cur.source === 'netease') {
            for (var qi = 0; qi < normalized.length; qi++) {
              if (normalized[qi].id === cur.neteaseId) { onlineQueueIndex = qi; break; }
            }
          }
        } catch (e) {}

        onlineListBody.innerHTML = '';
        normalized.forEach(function(item, i) {
          var singer = (item.ar || item.artists || []).map(function(a) { return a.name; }).join(' / ');
          var cover = '';
          if (item.al && item.al.picUrl) cover = item.al.picUrl;
          else if (item.album && item.album.picUrl) cover = item.album.picUrl;
          else if (item.picUrl) cover = item.picUrl;
          else if (item.artists && item.artists[0] && item.artists[0].img1v1Url) cover = item.artists[0].img1v1Url;
          cover = normalizeCover(cover, '100y100');

          var div = document.createElement('div');
          div.className = 'song-item';
          if (i === 0) div.classList.add('online-list-first');
          div.innerHTML =
            '<div class="song-cover">' +
            (cover ? '<img src="' + cover + '" referrerpolicy="no-referrer" loading="lazy" style="width:100%;height:100%;object-fit:cover;">' : '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>') +
            '</div>' +
            '<div class="song-info">' +
            '<div class="song-name">' + item.name + '</div>' +
            '<div class="song-artist">' + (singer || '未知歌手') + '</div>' +
            '</div>';
          div.addEventListener('click', function() {
            playFromOnlineQueue(i);
          });
          onlineListBody.appendChild(div);
        });
      })
      .catch(function(err) {
        console.error(title + ' 加载失败:', err);
        onlineListBody.innerHTML = '<div style="padding:50px 24px;text-align:center;font-size:14px;color:var(--gray-3);">加载失败，请重试</div>';
      });
  }

  // 从在线列表某一首开始播
  function playFromOnlineQueue(index) {
    if (!onlineQueue || index < 0 || index >= onlineQueue.length) return;
    onlineQueueIndex = index;
    var item = onlineQueue[index];
    // 先看是否已在 songs 里
    var existing = -1;
    for (var i = 0; i < songs.length; i++) {
      if (songs[i].source === 'netease' && songs[i].neteaseId === item.id) { existing = i; break; }
    }
    if (existing < 0) {
      // 添加进 songs
      var singer = (item.ar || item.artists || []).map(function(a) { return a.name; }).join(' / ');
      var cover = '';
      if (item.al && item.al.picUrl) cover = item.al.picUrl;
      else if (item.album && item.album.picUrl) cover = item.album.picUrl;
      else if (item.picUrl) cover = item.picUrl;
      cover = normalizeCover(cover, '300y300');
      var songObj = {
        id: 'netease_' + item.id,
        source: 'netease',
        importedFrom: 'single',
        neteaseId: item.id,
        name: item.name,
        artist: singer || '未知歌手',
        cover: cover || '',
        lyrics: '',
        fileType: 'audio/mpeg'
      };
      songs.push(songObj);
      saveSongsToStorage();
      renderSongs();
      existing = songs.length - 1;
    } else {
      // 已有记录：补上/更新专辑封面，修掉旧数据“永远不是专辑封面”的问题
      var fixSinger = (item.ar || item.artists || []).map(function(a) { return a.name; }).join(' / ');
      var fixCover = normalizeCover((item.al && item.al.picUrl) || (item.album && item.album.picUrl) || item.picUrl || '', '300y300');
      if (fixCover) songs[existing].cover = fixCover;
      if (fixSinger) songs[existing].artist = fixSinger;
      if (item.name) songs[existing].name = item.name;
      saveSongsToStorage();
      renderSongs();
    }
    onlineQueueActive = true;
    playSong(existing, true);
  }

  function onOnlineQueueEnd() {
    if (!onlineQueue || onlineQueue.length === 0) {
      onlineQueue = null;
      isPlaying = false;
      updatePlayBtn();
      return;
    }
    if (playMode === 'single') { if (audio) { audio.currentTime = 0; audio.play(); } return; }
    if (playMode === 'shuffle') {
      onlineQueueIndex = Math.floor(Math.random() * onlineQueue.length);
      playFromOnlineQueue(onlineQueueIndex);
      return;
    }
    if (onlineQueueIndex < onlineQueue.length - 1) {
      onlineQueueIndex++;
      playFromOnlineQueue(onlineQueueIndex);
    } else {
      // 在线列表播完 → 循环本列表，继续自动下一首
      onlineQueueIndex = 0;
      playFromOnlineQueue(0);
    }
  }

  function closeOnlineListPage() {
    onlineListPage.classList.remove('show');
    // 保留 onlineQueue：关闭列表后仍按该队列自动续播
  }

  onlineListBack.addEventListener('click', closeOnlineListPage);
  onlineListPlayAll.addEventListener('click', function() {
    if (!onlineQueue || onlineQueue.length === 0) { showToast('列表为空'); return; }
    playFromOnlineQueue(0);
  });

  var onlineDailyCard = document.getElementById('onlineDailyCard');
  var onlineRecentCard = document.getElementById('onlineRecentCard');
  if (onlineDailyCard) onlineDailyCard.addEventListener('click', function() { openOnlineListPage('daily'); });
  if (onlineRecentCard) onlineRecentCard.addEventListener('click', function() { openOnlineListPage('recent'); });

  // ============================================================
  // Online 搜索
  // ============================================================
  function openOnlineSearchPage(kw) {
    if (!kw) return;
    onlineQueueType = 'search';
    onlineListTitle.textContent = '搜索：' + kw;
    onlineListBody.innerHTML = '<div style="padding:50px 24px;text-align:center;font-size:14px;color:var(--gray-3);">搜索中...</div>';
    onlineListPage.classList.add('show');
    onlineResultWrap.classList.add('hidden');
    onlineDefaultContent.classList.remove('hidden');

    fetch(API_BASE + '/search?keywords=' + encodeURIComponent(kw))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var list = (d.result && d.result.songs) || [];
        var normalized = [];
        list.forEach(function(raw) {
          var item = raw.data || raw;
          if (item && item.id) normalized.push(item);
        });
        if (!normalized.length) {
          onlineListBody.innerHTML = '<div style="padding:50px 24px;text-align:center;font-size:14px;color:var(--gray-3);">没有找到相关歌曲</div>';
          return;
        }
        onlineQueue = normalized.slice();
        onlineQueueIndex = 0;
        onlineListBody.innerHTML = '';
        normalized.forEach(function(item, i) {
          var singer = (item.ar || item.artists || []).map(function(a) { return a.name; }).join(' / ');
          var cover = '';
          if (item.al && item.al.picUrl) cover = item.al.picUrl;
          else if (item.album && item.album.picUrl) cover = item.album.picUrl;
          else if (item.picUrl) cover = item.picUrl;
          else if (item.artists && item.artists[0] && item.artists[0].img1v1Url) cover = item.artists[0].img1v1Url;
          cover = normalizeCover(cover, '100y100');
          var div = document.createElement('div');
          div.className = 'song-item';
          if (i === 0) div.classList.add('online-list-first');
          div.innerHTML =
            '<div class="song-cover">' +
            (cover ? '<img src="' + cover + '" referrerpolicy="no-referrer" loading="lazy" style="width:100%;height:100%;object-fit:cover;">' : '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>') +
            '</div>' +
            '<div class="song-info">' +
            '<div class="song-name">' + item.name + '</div>' +
            '<div class="song-artist">' + (singer || '未知歌手') + '</div>' +
            '</div>';
          div.addEventListener('click', function() { playFromOnlineQueue(i); });
          onlineListBody.appendChild(div);
        });
      })
      .catch(function() {
        onlineListBody.innerHTML = '<div style="padding:50px 24px;text-align:center;font-size:14px;color:var(--gray-3);">搜索失败，请检查 API 是否可用</div>';
      });
  }

  function doOnlineSearch() {
    var kw = onlineSearchInput.value.trim();
    if (!kw) {
      onlineResultWrap.classList.add('hidden');
      onlineDefaultContent.classList.remove('hidden');
      return;
    }
    openOnlineSearchPage(kw);
  }
  onlineSearchBtn.addEventListener('click', doOnlineSearch);
  onlineSearchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); doOnlineSearch(); }
  });

  function playFromNetease(item, cover, singer) {
    var neteaseId = item.id;
    var existing = -1;
    for (var i = 0; i < songs.length; i++) {
      if (songs[i].source === 'netease' && songs[i].neteaseId === neteaseId) { existing = i; break; }
    }
    if (existing >= 0) {
      // 旧记录可能没有封面，点搜索结果时补上专辑封面，避免一直显示占位图
      var oldCover = normalizeCover(cover, '300y300');
      if (oldCover) songs[existing].cover = oldCover;
      if (item.name) songs[existing].name = item.name;
      if (singer) songs[existing].artist = singer;
      saveSongsToStorage();
      renderSongs();
      playSong(existing);
      return;
    }
    var songObj = {
      id: 'netease_' + neteaseId,
      source: 'netease',
      importedFrom: 'single',
      neteaseId: neteaseId,
      name: item.name,
      artist: singer || '未知歌手',
      cover: normalizeCover(cover, '300y300'),
      lyrics: '',
      fileType: 'audio/mpeg'
    };
    songs.push(songObj);
    saveSongsToStorage();
    renderSongs();
    playSong(songs.length - 1);
  }

  // ============================================================
  // 初始化
  // ============================================================
  function init() {
    var savedName = localStorage.getItem('nano_music_user_name');
    var savedBio = localStorage.getItem('nano_music_user_bio');
    var savedAvatar = localStorage.getItem('nano_music_user_avatar');
    var savedBg = localStorage.getItem('nano_music_bg');

    var maskUser = getMaskUser();
    if (maskUser) {
      setUserInfo(maskUser, savedAvatar || '');
      if (!savedAvatar) {
        loadMaskAvatar(maskUser.id).then(function(avatar) { if (avatar) setUserInfo(maskUser, avatar); });
      }
    } else {
      profileName.textContent = '未命名';
    }
    if (savedName) { profileName.textContent = savedName; myName.textContent = savedName; }
    if (savedBio) profileBio.textContent = savedBio;
    if (savedAvatar) {
      profileAvatarImg.src = savedAvatar;
      profileAvatarImg.style.display = 'block';
      profileAvatarPlaceholder.style.display = 'none';
      myAvatarImg.src = savedAvatar;
      myAvatarImg.style.display = 'block';
      myAvatarPlaceholder.style.display = 'none';
    }
    if (savedBg) {
      var app = document.querySelector('.app');
      app.style.backgroundImage = 'url(' + savedBg + ')';
      app.style.backgroundSize = 'cover';
      app.style.backgroundPosition = 'center';
    }

    var fb = localStorage.getItem('nano_music_float_ball');
    if (fb === '0') floatBallEnabled = false;

    songs = loadSongsFromStorage();
    playlists = loadPlaylistsFromStorage();
    renderSongs();
    renderPlaylists();
    if (floatBallEnabled) showBall();

    try {
      var onlineDefault = document.getElementById('onlineDefaultContent');
      var onlinePlSection = document.getElementById('onlinePlaylistSection');
      if (onlineDefault && onlinePlSection && onlinePlSection.parentNode === onlineDefault.parentNode) {
        onlineDefault.parentNode.insertBefore(onlinePlSection, onlineDefault.nextSibling);
      }
    } catch(e) {}

    songs.forEach(function(song) {
      idbGet(STORE_LYRICS, song.id).then(function(rec) {
        if (rec && rec.data && !song.lyrics) song.lyrics = rec.data;
      });
    });

    updateNowPlayingUI();
    updatePlayBtn();
    updateMiniPlayerVisibility();
  }

  init();

  // 登录卡片点击 -> 扫码登录 / 退出登录
  (function bindNeteaseLoginCard() {
    var loginCard = document.getElementById('onlineLoginCard');
    if (!loginCard) return;
    var newLoginCard = loginCard.cloneNode(true);
    loginCard.parentNode.replaceChild(newLoginCard, loginCard);

    function getSavedUser() {
      try { return JSON.parse(localStorage.getItem('nano_netease_user') || 'null'); } catch(e) { return null; }
    }

    function refreshLoginCard() {
      var savedUser = getSavedUser();
      var titleEl = newLoginCard.querySelector('.online-login-title');
      var descEl = newLoginCard.querySelector('.online-login-desc');
      if (titleEl && descEl) {
        if (savedUser && savedUser.nickname) {
          titleEl.textContent = '已登录：' + savedUser.nickname;
          descEl.textContent = '点击退出登录';
        } else {
          titleEl.textContent = '登录网易云音乐';
          descEl.textContent = '同步你的歌单和每日推荐';
        }
      }
    }

    newLoginCard.addEventListener('click', function() {
      var savedUser = getSavedUser();
      if (savedUser && savedUser.nickname) {
        openConfirm('退出登录', '确定要退出网易云音乐账号吗？', function() {
          try {
            localStorage.removeItem('nano_netease_cookie');
            localStorage.removeItem('nano_netease_user');
          } catch(e) {}
          neteaseUserInfo = null;
          neteaseLoggedIn = false;
          refreshLoginCard();
          showToast('已退出登录');
        });
        return;
      }
      openNeteaseQrLogin();
    });

    try {
      var saved = localStorage.getItem('nano_netease_user');
      if (saved) {
        neteaseUserInfo = JSON.parse(saved);
        renderNeteaseUser();
      }
    } catch(e) {}
    refreshLoginCard();
  })();

  window.addEventListener('beforeunload', function() {
    Object.keys(currentObjectURLs).forEach(function(id) {
      try { URL.revokeObjectURL(currentObjectURLs[id]); } catch(e) {}
    });
  });

})();