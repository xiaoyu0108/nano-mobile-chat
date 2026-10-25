/* ============================================================
   成人内容免责声明 / 首次进入确认
   - 第一次打开（或声明版本更新后）显示，必须阅读满 7 秒才能同意
   - 同意后写入 localStorage：nano_adult_ack_v2
   - 可在控制台调用 NanoAdultGate.open() 再次查看
   ============================================================ */
(function () {
  'use strict';
  if (window.NanoAdultGate) return;

  var STORAGE_KEY = 'nano_adult_ack_v2';
  var VERSION = '2';
  var COOLDOWN_MS = 7000;
  var root = null;
  var timer = null;
  var lockPrev = null;
  var isOpen = false;

  function readAck() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      if (String(data.version || '') !== VERSION) return null;
      if (!data.acceptedAt) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function writeAck() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: VERSION,
        acceptedAt: Date.now(),
        ua: navigator.userAgent || ''
      }));
    } catch (e) {}
  }

  function lockScroll() {
    if (lockPrev !== null) return;
    var html = document.documentElement;
    var body = document.body;
    lockPrev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyWidth: body.style.width,
      bodyTouch: body.style.touchAction
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.width = '100%';
    body.style.touchAction = 'none';
  }

  function unlockScroll() {
    if (lockPrev === null) return;
    var html = document.documentElement;
    var body = document.body;
    html.style.overflow = lockPrev.htmlOverflow;
    body.style.overflow = lockPrev.bodyOverflow;
    body.style.position = lockPrev.bodyPosition;
    body.style.width = lockPrev.bodyWidth;
    body.style.touchAction = lockPrev.bodyTouch;
    lockPrev = null;
  }

  function termsHtml() {
    return '' +
      '<p class="nag-lead">本应用是一个虚拟游戏 / 虚构作品。请先确认你已年满 18 周岁，并完整阅读以下条款；不同意请立即退出。</p>' +
      '<section class="nag-sec"><h3>一、年龄要求（必须 18+）</h3><p>你必须在法律意义上已满 <strong>18 周岁</strong>（或你所在国家/地区规定的成年年龄，以较高者为准）才能注册、登录或使用本应用。未满 18 周岁、或无法独立承担民事责任的未成年人，<strong>禁止使用</strong>。若你不符合年龄要求，请立即退出。</p></section>' +
      '<section class="nag-sec"><h3>二、虚拟游戏声明</h3><p>本应用是<strong>虚拟游戏与虚构作品</strong>。其中的角色、对话、剧情、图片、关系与事件均为虚构或由 AI 生成，不代表现实人物、真实事件或开发者立场。<strong>不可当真</strong>，不要将游戏内容当作现实事实、承诺、命令或判断依据。请自行分辨虚拟与现实。</p></section>' +
      '<section class="nag-sec"><h3>三、自我判断与责任</h3><p>你应自行判断游戏内容是否适合自己，并<strong>自行承担使用本应用产生的一切后果</strong>，包括但不限于情绪影响、时间投入、与他人的关系、数据丢失、设备风险及因自身行为引发的法律责任。开发者不对你的使用行为或依赖游戏内容作出的决定负责。</p></section>' +
      '<section class="nag-sec"><h3>四、账号与密码</h3><p>账号和密码仅限你本人使用，请<strong>妥善保管，不得外传、共享、出售或借给他人</strong>。因主动泄露、共用设备、弱密码或保管不当造成的账号被盗、内容泄露、数据丢失等后果，由你自行承担。发现异常请及时在设置中下线其他设备；如密码已经泄露，请联系管理员删除账号后重新注册。</p></section>' +
      '<section class="nag-sec"><h3>五、合法使用</h3><p>你应确保使用行为符合你所在地的法律法规。<strong>严禁</strong>利用本应用制作、传播或索取违法、侵权、暴力、仇恨、诈骗或侵害他人权益的内容，严禁冒充现实中的真实人物。因你的输入、导入或传播行为产生的纠纷与责任，由你自行承担。</p></section>' +
      '<section class="nag-sec"><h3>六、内容与版权</h3><p>导入的 PNG / JSON 角色卡、世界书、规则、图片与文本，其版权归原作者或权利人所有。请勿在未获授权的情况下公开传播、倒卖或二次发布。本应用不保证第三方内容的准确性、合法性或适用性。</p></section>' +
      '<section class="nag-sec"><h3>七、数据与隐私</h3><p>聊天记录、角色卡、API Key 等数据通常保存在你的浏览器本地或你自行配置的服务器中。使用第三方模型 API、云同步或导入外部内容时，相关数据可能会传输给对应服务商处理。请勿输入身份证号、住址、银行卡、密码等敏感个人信息，并自行做好设备与备份管理。</p></section>' +
      '<section class="nag-sec"><h3>八、非专业建议</h3><p>本应用不提供医疗、心理、法律、金融或其他专业建议。若你正经历心理危机、现实暴力或健康问题，请立即联系当地专业机构或紧急服务，不要依赖 AI 或游戏内容寻求帮助。</p></section>' +
      '<section class="nag-sec"><h3>九、确认</h3><p>点击“同意并进入”即表示：你已年满 18 周岁，已阅读并理解全部条款，知道这是虚拟游戏、不会当真，并愿意为自己的账号、密码与一切使用行为负责。</p></section>';
  }

  function build() {
    var el = document.createElement('div');
    el.id = 'nanoAdultGate';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'nagTitle');
    el.innerHTML = '' +
      '<div class="nag-card">' +
        '<div class="nag-head">' +
          '<div class="nag-badge">18+</div>' +
          '<div class="nag-head-text">' +
            '<h2 class="nag-title" id="nagTitle">年龄确认与免责声明</h2>' +
            '<div class="nag-sub">首次使用必须阅读 · 请确认你已年满 18 周岁</div>' +
          '</div>' +
        '</div>' +
        '<div class="nag-body" id="nagBody">' + termsHtml() + '</div>' +
        '<div class="nag-foot">' +
          '<label class="nag-check">' +
            '<input type="checkbox" id="nagAgree">' +
            '<span class="nag-box" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.2 4.2L19 6.8"/></svg></span>' +
            '<span>我已年满 18 周岁，已阅读并同意以上全部条款；我知道这是虚拟游戏、不会当真，并会妥善保管账号密码、自行承担使用责任。</span>' +
          '</label>' +
          '<div class="nag-actions">' +
            '<button type="button" class="nag-btn nag-decline" id="nagDecline">未满 18 岁 / 不同意</button>' +
            '<button type="button" class="nag-btn nag-accept" id="nagAccept" disabled>请阅读条款（7s）</button>' +
          '</div>' +
          '<p class="nag-tip">同意状态仅保存在本机浏览器，不会上传。</p>' +
        '</div>' +
      '</div>';
    return el;
  }

  function showClosed() {
    var card = root && root.querySelector('.nag-card');
    if (!card) return;
    card.innerHTML = '' +
      '<div class="nag-closed">' +
        '<h2>已停止访问</h2>' +
        '<p>你选择不继续使用本应用。请关闭此页面。<br>如果你已年满 18 周岁并希望重新阅读条款，可刷新页面后再确认。</p>' +
      '</div>';
  }

  function startCountdown() {
    var accept = root.querySelector('#nagAccept');
    var agree = root.querySelector('#nagAgree');
    var started = Date.now();

    function tick() {
      var left = COOLDOWN_MS - (Date.now() - started);
      if (left > 0) {
        accept.textContent = '请阅读条款（' + Math.ceil(left / 1000) + 's）';
        accept.disabled = true;
      } else {
        accept.textContent = '同意并进入';
        accept.disabled = !agree.checked;
      }
    }

    tick();
    timer = setInterval(tick, 120);
    agree.addEventListener('change', function () {
      var left = COOLDOWN_MS - (Date.now() - started);
      accept.disabled = left > 0 || !agree.checked;
    });
  }

  function close(accepted) {
    if (!root) return;
    clearInterval(timer);
    timer = null;
    root.classList.add('nag-closing');
    setTimeout(function () {
      if (root && root.parentNode) root.parentNode.removeChild(root);
      root = null;
      isOpen = false;
      unlockScroll();
    }, 240);
  }

  function open(options) {
    if (isOpen) return;
    if (!document.body) return;
    isOpen = true;
    lockScroll();
    root = build();
    document.body.appendChild(root);

    var accept = root.querySelector('#nagAccept');
    var agree = root.querySelector('#nagAgree');
    var decline = root.querySelector('#nagDecline');

    accept.addEventListener('click', function () {
      if (accept.disabled) return;
      writeAck();
      close(true);
      try {
        document.dispatchEvent(new CustomEvent('nano-adult-accepted'));
      } catch (e) {}
    });

    decline.addEventListener('click', function () {
      clearInterval(timer);
      timer = null;
      showClosed();
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'nanoAdultDeclined' }, '*');
        }
      } catch (e) {}
    });

    startCountdown();
    setTimeout(function () {
      try { agree.focus({ preventScroll: true }); } catch (e) {}
    }, 80);
  }

  function accepted() {
    return !!readAck();
  }

  window.NanoAdultGate = {
    open: open,
    accepted: accepted,
    reset: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    },
    version: VERSION,
    cooldown: COOLDOWN_MS
  };

  function autoShow() {
    if (window.top !== window.self) return;
    if (accepted()) return;
    open();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoShow, { once: true });
  } else {
    autoShow();
  }
})();
