(function () {
  'use strict';

  var bridge = window.NanoChatBridge || {};
  var dock = document.getElementById('nanoDock');
  var pageContacts = document.getElementById('nanoPageContacts');
  var pageProfile = document.getElementById('nanoPageProfile');
  var appContainer = document.querySelector('.app-container');

  function post(msg) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, '*');
        return true;
      }
    } catch (e) {}
    return false;
  }

  function openPage(url, title) {
    if (!post({ type: 'openFullscreen', url: url, title: title || '', showBack: true, source: 'chat' })) {
      try { location.href = url; } catch (e) {}
    }
  }

  function setDock(tab) {
    if (!dock) return;
    dock.querySelectorAll('.nano-dock-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
  }

  function closeSubpages() {
    if (pageContacts) pageContacts.classList.remove('open');
    if (pageProfile) pageProfile.classList.remove('open');
    if (appContainer) appContainer.style.visibility = '';
  }

  function showSubpage(el, tab) {
    closeSubpages();
    if (el) el.classList.add('open');
    if (appContainer) appContainer.style.visibility = 'hidden';
    setDock(tab);
  }

  function switchTab(tab) {
    if (tab === 'chat') {
      closeSubpages();
      setDock('chat');
      return;
    }
    if (tab === 'contacts') {
      renderContacts();
      showSubpage(pageContacts, 'contacts');
      return;
    }
    if (tab === 'profile') {
      renderProfile();
      showSubpage(pageProfile, 'profile');
      return;
    }
    if (tab === 'moments') {
      openPage('moments.html', '朋友圈');
      setDock('chat');
    }
  }

  function avatarHtml(item) {
    var name = (item && item.name) || '?';
    if (item && item.avatar) {
      return '<span class="nano-contact-avatar"><img src="' + String(item.avatar).replace(/"/g, '&quot;') + '" alt=""></span>';
    }
    return '<span class="nano-contact-avatar">' + String(name).charAt(0).toUpperCase() + '</span>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderContacts() {
    var box = document.getElementById('nanoContactsList');
    if (!box || !bridge.getCharacters) return;
    box.innerHTML = '<div class="nano-empty">正在读取通讯录…</div>';
    Promise.all([
      bridge.getCharacters(),
      Promise.resolve(bridge.getCurrentUser ? bridge.getCurrentUser() : null)
    ]).then(function (res) {
      var chars = res[0] || [];
      var user = res[1];
      if (!user) {
        box.innerHTML = '<div class="nano-empty">请先在「面具」里选择一个人设<br>再查看绑定的角色</div>';
        return;
      }
      chars = chars.filter(function (c) {
        return c && (String(c.bindUser) === String(user.id) || c.nanoAssistant);
      }).sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      });
      if (!chars.length) {
        box.innerHTML = '<div class="nano-empty">这个面具还没有绑定角色<br>去「角色库」添加一个吧</div>';
        return;
      }
      box.innerHTML = chars.map(function (c) {
        return '<div class="nano-contact-item" data-id="' + esc(c.id) + '" data-name="' + esc(c.name || '') + '" data-avatar="' + esc(c.avatar || '') + '">' +
          avatarHtml(c) +
          '<div class="nano-contact-main"><div class="nano-contact-name">' + esc(c.name || '未命名') + '</div>' +
          '<div class="nano-contact-sub">' + esc(c.setting || c.desc || '点击开始聊天') + '</div></div>' +
          '</div>';
      }).join('');
      box.querySelectorAll('.nano-contact-item').forEach(function (row) {
        row.addEventListener('click', function () {
          post({
            type: 'openChat',
            chatId: row.dataset.id,
            chatName: row.dataset.name,
            chatAvatar: row.dataset.avatar
          });
        });
      });
    }).catch(function () {
      box.innerHTML = '<div class="nano-empty">通讯录读取失败</div>';
    });
  }

  function renderProfile() {
    var user = bridge.getCurrentUser ? bridge.getCurrentUser() : null;
    var av = document.getElementById('nanoProfileAvatar');
    var nm = document.getElementById('nanoProfileName');
    var sub = document.getElementById('nanoProfileSub');
    if (!av || !nm || !sub) return;
    if (!user) {
      av.style.backgroundImage = '';
      nm.textContent = '我';
      sub.textContent = '未选择面具';
      return;
    }
    av.style.backgroundImage = user.avatar ? 'url("' + String(user.avatar).replace(/"/g, '\\"') + '")' : '';
    nm.textContent = user.name || '我';
    sub.textContent = '当前面具';
  }

  if (dock) {
    dock.addEventListener('click', function (e) {
      var b = e.target.closest('.nano-dock-btn');
      if (!b) return;
      switchTab(b.dataset.tab);
    });
  }

  var back = document.getElementById('nanoChatBack');
  if (back) {
    back.addEventListener('click', function () {
      if (pageContacts && pageContacts.classList.contains('open')) {
        switchTab('chat');
        return;
      }
      if (pageProfile && pageProfile.classList.contains('open')) {
        switchTab('chat');
        return;
      }
      if (!post({ type: 'closeFullscreen' })) {
        try { history.back(); } catch (e) {}
      }
    });
  }

  document.querySelectorAll('[data-nano-back]').forEach(function (b) {
    b.addEventListener('click', function () { switchTab('chat'); });
  });

  var groupBtn = document.getElementById('nanoGroupBtn');
  if (groupBtn) {
    groupBtn.addEventListener('click', function () {
      var tabGroups = document.getElementById('tabGroups');
      var characterBtn = document.getElementById('characterPageBtn');
      if (tabGroups) tabGroups.click();
      setTimeout(function () {
        if (characterBtn) characterBtn.click();
      }, 30);
    });
  }

  document.querySelectorAll('.nano-func-card').forEach(function (card) {
    card.addEventListener('click', function () {
      openPage(card.dataset.open, card.dataset.title || '');
    });
  });

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d) return;
    if (d.type === 'currentMaskChanged' || d.type === 'homeDataUpdated' || d.type === 'contactsDataUpdated') {
      if (pageContacts && pageContacts.classList.contains('open')) renderContacts();
      if (pageProfile && pageProfile.classList.contains('open')) renderProfile();
    }
    if (d.type === 'nanoOverlayClosed' || d.type === 'nanoOverlayReopen') {
      setDock('chat');
    }
  });

  renderProfile();
})();
