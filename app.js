(function () {
  'use strict';
  var TZ = 'Asia/Baghdad', BATCH = 50;
  var PERM_LABELS = { manageStock: 'إضافة كميات للمخزون وخصمها', viewReports: 'رؤية التقارير بلا أرباح', cancel: 'إلغاء الفواتير والتسديدات' };
  var S = { url: '', token: '', me: null, base: blank(), settings: {}, rev: 0, deviceNo: 0, counter: 0, pending: [], rejected: [], view: blank(), ledgers: {}, stock: {},
    online: true, syncing: false, lastSync: '', authLost: false, lastError: '', sheet: null, cart: null, search: '', custFilter: 'all', report: null, users: null, confirm: null };
  function blank() { return { customers: {}, items: {}, moves: {}, sales: {}, payments: {}, events: {} }; }
  var $ = function (id) { return document.getElementById(id); };
  var ICON = {
    sell: '<path d="M4 7h16l-1.5 11h-13zM9 7V5a3 3 0 0 1 6 0v2"/>', customers: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6M16 5a3.5 3.5 0 0 1 0 6.5M18 14c2 .8 3 3 3 6"/>',
    items: '<path d="M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9"/>', reports: '<path d="M5 20V10M12 20V4M19 20v-7"/>', more: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    back: '<path d="M9 5l7 7-7 7"/>'
  };
  function svg(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function latin(s) { return String(s === null || s === undefined ? '' : s).replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); }).replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); }); }
  function parseNum(v) { var s = latin(v).replace(/[\s,٬،]/g, ''); return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null; }
  function parseAmount(v) { var n = parseNum(v); return n === null ? null : Math.round(n); }
  function fmt(n) { var neg = n < 0; return (neg ? '-' : '') + String(Math.abs(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function cur() { return S.settings.currency || 'د.ع'; }
  function money(n) { return '<span class="num">' + fmt(n) + '</span> ' + esc(cur()); }
  function plain(n) { return fmt(n) + ' ' + cur(); }
  function parts(d) { var o = {}; new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d || new Date()).forEach(function (x) { o[x.type] = x.value; }); return o; }
  function today() { var p = parts(); return p.year + '/' + p.month + '/' + p.day; }
  function nowText() { var p = parts(); return p.year + '/' + p.month + '/' + p.day + ' ' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute; }
  function iso(d) { return String(d || '').replace(/\//g, '-'); }
  function fromIso(d) { return String(d || '').replace(/-/g, '/'); }
  function uid(p) {
    var a = new Uint8Array(12); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return p + Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function can(p) { return !!(S.me && (S.me.role === 'owner' || (S.me.perms && S.me.perms[p]))); }
  function owner() { return !!(S.me && S.me.role === 'owner'); }
  function monthName(d) { return d.slice(0, 7); }

  /* ---------- التخزين على الجهاز ---------- */
  var Store = (function () {
    var mem = {}, dbp = null;
    function open() {
      if (window.DEMO_BACKEND) return Promise.reject(new Error('demo'));
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        var r = indexedDB.open('shop-ledger', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      return dbp;
    }
    return {
      get: function (k) { return open().then(function (db) { return new Promise(function (res, rej) { var q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }); }).catch(function () { return mem[k]; }); },
      set: function (k, v) { mem[k] = v; return open().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = function () { rej(t.error); }; }); }).catch(function () {}); }
    };
  })();
  function saveMeta() { return Store.set('meta', { lastSyncMs: S.lastSyncMs, url: S.url, token: S.token, me: S.me, settings: S.settings, rev: S.rev, deviceNo: S.deviceNo, counter: S.counter, rejected: S.rejected, lastSync: S.lastSync }); }
  function saveBase() { return Store.set('base', S.base); }
  function savePending() { return Store.set('pending', S.pending); }

  /* ---------- البيانات ---------- */
  function rebuild() {
    var v = blank();
    Object.keys(v).forEach(function (t) { v[t] = Object.assign({}, S.base[t]); });
    var me = Object.assign({}, S.me, { instDefault: S.settings.installment });
    S.pending.forEach(function (op) { try { Core.applyOp(v, op, me); } catch (e) { /* يظهر الرفض عند المزامنة */ } });
    S.view = v;
    S.ledgers = Core.buildLedgers(v, today());
    S.stock = Core.stockLevels(v);
  }
  function addOp(type, payload) {
    var op = { id: uid('op'), type: type, payload: payload, createdAt: nowText(), offline: !S.online };
    // تُحفظ العملية على الجهاز قبل أي شيء آخر
    S.pending.push(op);
    savePending().then(requestBackgroundSync);
    rebuild();
    render();
    syncSoon();
    return op;
  }
  /** يرسل المتصفح الحركات عند عودة الإنترنت حتى لو كان التطبيق مغلقًا، حيث يدعم الجهاز ذلك. */
  function requestBackgroundSync() {
    if (window.DEMO_BACKEND || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) { if (reg.sync) return reg.sync.register('flush-ops'); }).catch(function () {});
  }
  function logEvent(kind, subject) { S.pending.push({ id: uid('op'), type: 'log.event', payload: { id: uid('evt'), kind: kind, subject: subject }, createdAt: nowText(), offline: !S.online }); savePending().then(requestBackgroundSync); paintStatus(); syncSoon(); }
  /** بعد مدة بلا اتصال يتوقف التسجيل حتى يتصل الجهاز، فلا تتراكم حركات لا يعرف عنها صاحب المحل. */
  function offlineBlocked() {
    var lim = Number(S.settings.offlineLimit);
    if (owner() || !lim || !S.lastSyncMs) return false;
    return Date.now() - S.lastSyncMs > lim * 3600000;
  }
  var BLOCK_MSG = 'مرّ وقت طويل بلا اتصال. وصّل الجهاز بالإنترنت لإرسال الحركات، ثم تابع التسجيل.';
  function nextNo() { S.counter++; saveMeta(); return S.deviceNo + '-' + S.counter; }

  /* ---------- الاتصال ---------- */
  function Err(msg, code) { var e = new Error(msg); e.code = code; return e; }
  function api(action, body) {
    var payload = JSON.stringify(Object.assign({ action: action, token: S.token }, body || {}));
    var req;
    if (window.DEMO_BACKEND) {
      req = window.DEMO_BACKEND(payload);
    } else {
      if (!S.url) return Promise.reject(Err('لم يُحدد عنوان الدفتر.', 'net'));
      var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 60000);
      req = fetch(S.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: payload, redirect: 'follow', signal: ctl.signal })
        .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('http ' + r.status); return r.text(); })
        .then(function (t) { return JSON.parse(t); });
    }
    return req.catch(function () { throw Err('لا يوجد اتصال بالإنترنت أو تعذر الوصول إلى الدفتر.', 'net'); })
      .then(function (r) { if (!r.ok) throw Err(r.error, r.code); return r.data; });
  }
  function mergeChanges(ch) {
    if (!ch) return;
    Object.keys(ch).forEach(function (t) { ch[t].forEach(function (r) { S.base[t][r.id] = r; }); });
  }
  var syncTimer, again = false;
  function syncSoon(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms === undefined ? 300 : ms); }
  function sync() {
    if (!S.token) return Promise.resolve();
    if (S.syncing) { again = true; return Promise.resolve(); }
    S.syncing = true; paintStatus();
    var session = S.token;
    var step = function () {
      var batch = S.pending.slice(0, BATCH);
      return api('sync', { ops: batch, since: S.rev }).then(function (r) {
        // إذا تغير المستخدم أثناء الطلب تُهمل نتيجته حتى لا تختلط بيانات حسابين
        if (S.token !== session) { again = true; return; }
        if (r.reset) S.base = blank();
        mergeChanges(r.changes);
        var results = {};
        (r.results || []).forEach(function (x) { results[x.opId] = x; });
        batch.forEach(function (op) {
          var res = results[op.id];
          if (res && res.status === 'rejected') S.rejected.push({ op: op, error: res.error });
        });
        var sent = {}; batch.forEach(function (o) { sent[o.id] = true; });
        S.pending = S.pending.filter(function (o) { return !sent[o.id]; });
        S.rev = r.rev; S.me = r.me; S.settings = r.settings;
        S.online = true; S.authLost = false; S.lastError = ''; S.lastSync = nowText(); S.lastSyncMs = Date.now();
        return Promise.all([savePending(), saveBase(), saveMeta()]).then(function () { if (S.pending.length) return step(); });
      });
    };
    return step().catch(function (e) {
      if (e.code === 'net') { S.online = false; }
      else if (e.code === 'auth') { S.authLost = true; S.lastError = e.message; }
      else { S.lastError = e.message; }
    }).then(function () {
      S.syncing = false;
      rebuild();
      softRender();
      if (again) { again = false; syncSoon(); }
    });
  }
  /* لا تُمسح خانة يكتب فيها المستخدم بسبب مزامنة في الخلفية */
  function softRender() {
    var a = document.activeElement;
    var typing = a && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
    if (S.sheet || typing) { paintStatus(); return; }
    render();
  }
  function statusInfo() {
    var n = S.pending.length;
    if (S.authLost) return { cls: 'err', text: 'انتهت جلسة الدخول. سجل الدخول لإرسال ما تبقى' };
    if (S.syncing) return { cls: 'off', text: n ? 'جارٍ إرسال ' + n + ' حركة…' : 'جارٍ التحديث…' };
    if (S.rejected.length) return { cls: 'err', text: S.rejected.length + ' حركة رفضها الدفتر. اضغط للتفاصيل' };
    if (!S.online) return { cls: 'off', text: n ? 'بلا إنترنت. ' + n + ' حركة محفوظة على الجهاز وستُرسل عند الاتصال' : 'بلا إنترنت. يمكنك متابعة العمل' };
    if (n) return { cls: 'off', text: n + ' حركة بانتظار الإرسال' };
    if (S.lastError) return { cls: 'err', text: S.lastError };
    return { cls: '', text: 'كل الحركات محفوظة في الدفتر' + (S.lastSync ? '. آخر تحديث ' + S.lastSync.slice(11) : '') };
  }
  function paintStatus() {
    var el = $('status'); if (!el) return;
    var i = statusInfo();
    el.className = 'status ' + i.cls;
    el.innerHTML = '<i></i><span>' + esc(i.text) + '</span>';
  }

  var toastTimer;
  function toast(m) { var t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 5000); }

  /* ---------- التوجيه ---------- */
  function route() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return { name: 'sell' };
    var m = /^customer-(.+)$/.exec(h);
    if (m) return { name: 'customer', id: m[1] };
    return { name: h };
  }
  function render() {
    if (!S.token || !S.me) { $('nav').hidden = true; renderGate(); return; }
    var r = route(), html;
    if (r.name === 'customers') html = viewCustomers();
    else if (r.name === 'customer') html = viewCustomer(r.id);
    else if (r.name === 'items') html = viewItems();
    else if (r.name === 'reports') html = viewReports();
    else if (r.name === 'more') html = viewMore();
    else if (r.name === 'users') html = viewUsers();
    else html = viewSell();
    $('app').className = 'page';
    $('app').innerHTML = '<button id="status" class="status" data-act="go" data-to="more"></button>' + html;
    paintStatus();
    renderNav(r.name);
    renderSheet();
    applyPaper();
  }
  function renderNav(cur) {
    var tabs = [['sell', 'بيع'], ['customers', 'الزبائن'], ['items', 'الأصناف']];
    if (can('viewReports')) tabs.push(['reports', 'التقارير']);
    tabs.push(['more', 'المزيد']);
    var active = cur === 'customer' ? 'customers' : cur === 'users' ? 'more' : cur;
    $('nav').hidden = false;
    $('nav').innerHTML = '<div>' + tabs.map(function (t) { return '<a href="#' + t[0] + '" class="' + (active === t[0] ? 'on' : '') + '">' + svg(t[0]) + t[1] + '</a>'; }).join('') + '</div>';
  }
  function applyPaper() {
    var p = S.settings.paper === '58' ? '58' : '80';
    $('page-size').textContent = '@page{size:' + p + 'mm auto;margin:' + (p === '58' ? '1' : '2') + 'mm}';
  }

  /* ---------- شاشة الدخول ---------- */
  var gate = { step: 'init', error: '', needsSetup: false, shopName: '', reset: false };
  function renderGate() {
    var html = '<div class="gate"><h1><span>دفتر المحل</span></h1>', g = gate;
    if (!S.url && !window.DEMO_BACKEND) {
      html += '<p>الصق عنوان الدفتر الذي حصلت عليه من صاحب المحل أو من خطوة النشر.</p><form id="f-url" class="stack"><div><label for="g-url">عنوان الدفتر</label><input class="f" id="g-url" dir="ltr" autocomplete="off" required placeholder="https://script.google.com/macros/s/.../exec"></div>' + errBox(g.error) + '<button class="btn primary">متابعة</button></form>';
    } else if (g.step === 'init') {
      html += '<p>جارٍ الاتصال بالدفتر…</p>' + errBox(g.error) + (g.error ? '<div class="row"><button class="btn primary" data-act="gate-retry">إعادة المحاولة</button><button class="btn quiet" data-act="gate-url">تغيير العنوان</button></div>' : '');
    } else if (g.needsSetup || g.reset) {
      html += '<p>' + (g.reset ? 'أدخل رمز الاستعادة الذي ظهر عند تشغيل الدالة resetOwnerPassword، واختر كلمة مرور جديدة.' : 'تفعيل الدفتر لأول مرة. رمز التفعيل ظهر عند تشغيل الدالة setup.') + '</p><form id="f-boot" class="stack">' +
        '<div><label for="g-code">رمز التفعيل</label><input class="f" id="g-code" inputmode="numeric" dir="ltr" required autocomplete="off"></div>' +
        (g.reset ? '' : '<div><label for="g-shop">اسم المحل</label><input class="f" id="g-shop" maxlength="60"></div><div><label for="g-name">اسمك</label><input class="f" id="g-name" required maxlength="60"></div><div><label for="g-user">اسم الدخول (بالإنجليزية)</label><input class="f" id="g-user" dir="ltr" required autocapitalize="none" autocomplete="username"></div>') +
        '<div><label for="g-pass">كلمة المرور (6 رموز على الأقل)</label><input class="f" id="g-pass" type="password" dir="ltr" required autocomplete="new-password"></div>' + errBox(g.error) +
        '<button class="btn primary">' + (g.reset ? 'حفظ كلمة المرور' : 'تفعيل الدفتر') + '</button>' + (g.reset ? '<button type="button" class="btn quiet" data-act="gate-reset-off">رجوع</button>' : '') + '</form>';
    } else {
      html += (g.shopName ? '<p>' + esc(g.shopName) + '</p>' : '') + (S.authLost ? '<p class="notice">انتهت جلسة الدخول. سجل الدخول بالحساب نفسه لإرسال الحركات المحفوظة.</p>' : '') +
        '<form id="f-login" class="stack"><div><label for="g-user">اسم الدخول</label><input class="f" id="g-user" dir="ltr" required autocapitalize="none" autocomplete="username"></div>' +
        '<div><label for="g-pass">كلمة المرور</label><input class="f" id="g-pass" type="password" dir="ltr" required autocomplete="current-password"></div>' + errBox(g.error) +
        '<button class="btn primary">دخول</button></form><p class="hint">أول دخول على أي جهاز يحتاج إلى إنترنت. بعدها يعمل التطبيق بلا إنترنت.</p>' +
        (window.DEMO_BACKEND ? '' : '<div class="row"><button class="btn quiet small" data-act="gate-reset">نسيت كلمة مرور صاحب المحل</button><button class="btn quiet small" data-act="gate-url">تغيير عنوان الدفتر</button></div>');
    }
    $('app').className = '';
    $('app').innerHTML = html + '</div>';
  }
  function errBox(m) { return m ? '<div class="err" role="alert">' + esc(m) + '</div>' : ''; }
  function loadStatus() {
    gate.step = 'init'; gate.error = ''; renderGate();
    api('status').then(function (d) { gate.step = 'ready'; gate.needsSetup = d.needsSetup; gate.shopName = d.shopName; renderGate(); })
      .catch(function (e) { gate.error = e.message; renderGate(); });
  }
  function afterLogin(d) {
    S.token = d.token; S.me = d.me; S.deviceNo = d.deviceNo; S.authLost = false;
    if (S.rev === 0) S.base = blank();
    return saveMeta().then(function () { rebuild(); render(); return sync(); });
  }

  /* ---------- البيع ---------- */
  function newCart() { return { lines: [], type: 'cash', discount: '', customerId: '', customerQ: '', itemQ: '', down: '', months: '6', firstDue: Core.addMonths(today(), 1), date: today(), note: '' }; }
  function officialPrice(i, type) { return type === 'installment' ? (i.instPrice === undefined ? i.price : i.instPrice) : i.price; }
  function cartTotals() {
    var c = S.cart;
    var sub = Core.int(c.lines.reduce(function (s, l) { return s + (parseNum(l.qty) || 0) * (parseAmount(l.price) || 0); }, 0));
    var disc = parseAmount(c.discount) || 0;
    var total = sub - disc, down = c.type === 'installment' ? (parseAmount(c.down) || 0) : total;
    var months = parseInt(latin(c.months), 10) || 0;
    var sched = c.type === 'installment' && total - down > 0 && months > 0 && Core.isDate(c.firstDue) ? Core.buildSchedule(total - down, months, c.firstDue) : [];
    return { sub: sub, disc: disc, total: total, down: down, months: months, sched: sched };
  }
  function activeItems() { return Core.values(S.view.items).filter(function (i) { return !i.archived; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }); }
  function activeCustomers() { return Core.values(S.view.customers).filter(function (c) { return !c.archived; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }); }
  function viewSell() {
    if (!S.cart) S.cart = newCart();
    var c = S.cart, t = cartTotals(), edit = owner();
    var h = '<header class="top"><h1>' + esc(S.settings.shopName || 'بيع جديد') + '</h1></header>';
    h += failBanner();
    h += '<div class="stack"><div><label for="item-q">أضف صنفًا</label><input class="f" id="item-q" placeholder="ابحث باسم الصنف أو رمزه" autocomplete="off" value="' + esc(c.itemQ) + '"><div id="item-pick">' + itemPick() + '</div></div>';
    if (c.lines.length) {
      h += '<div>' + c.lines.map(function (l, i) {
        var lvl = S.stock[l.itemId] || 0, q = parseNum(l.qty) || 0;
        return '<div class="line"><div class="nm">' + esc(l.name) + (q > lvl ? ' <span class="tag warn">المتوفر ' + fmt(lvl) + '</span>' : '') + '</div><div class="amt">' + money(Core.int(q * (parseAmount(l.price) || 0))) + '</div><div class="ctl">' +
          '<div class="qty"><button type="button" data-act="qty" data-i="' + i + '" data-d="-1" aria-label="إنقاص">−</button><input data-field="qty" data-i="' + i + '" inputmode="decimal" aria-label="الكمية" value="' + esc(l.qty) + '"><button type="button" data-act="qty" data-i="' + i + '" data-d="1" aria-label="زيادة">+</button></div>' +
          (edit ? '<div class="pr"><input class="f" data-field="price" data-i="' + i + '" inputmode="numeric" aria-label="السعر" value="' + esc(l.price) + '"></div>' : '<div class="pr">السعر: ' + money(parseAmount(l.price) || 0) + '</div>') +
          '<button type="button" class="btn quiet small" data-act="del-line" data-i="' + i + '">حذف</button></div></div>';
      }).join('') + '</div>';
      h += '<div class="seg" role="group" aria-label="طريقة البيع"><button type="button" class="' + (c.type === 'cash' ? 'on' : '') + '" data-act="sale-type" data-v="cash">نقد</button><button type="button" class="' + (c.type === 'installment' ? 'on' : '') + '" data-act="sale-type" data-v="installment">أقساط</button></div>';
      h += customerField();
      if (c.type === 'installment') {
        h += '<div class="two"><div><label for="c-down">المقدمة</label><input class="f" id="c-down" data-field="down" inputmode="numeric" value="' + esc(c.down) + '"></div><div><label for="c-months">عدد الأشهر</label><input class="f" id="c-months" data-field="months" inputmode="numeric" value="' + esc(c.months) + '"></div></div>';
        h += '<div><label for="c-first">تاريخ أول قسط</label><input class="f" id="c-first" type="date" data-field="firstDue" value="' + iso(c.firstDue) + '"></div>';
      }
      if (edit) h += '<div><label for="c-disc">الخصم</label><input class="f" id="c-disc" data-field="discount" inputmode="numeric" value="' + esc(c.discount) + '"></div>';
      h += '<div id="cart-sum">' + cartSummary(t) + '</div><div class="err" id="sale-err" role="alert" hidden></div>';
      h += '<button class="btn pay wide" style="min-height:52px" data-act="save-sale">تسجيل البيع</button>';
    } else {
      h += '<div class="empty"><strong>الفاتورة فارغة</strong>' + (activeItems().length ? 'ابحث عن صنف واضغطه لإضافته.' : (owner() ? 'أضف أصنافك أولًا من تبويب الأصناف.' : 'لم يضف صاحب المحل أي صنف بعد.')) + '</div>';
    }
    return h + '</div>';
  }
  function itemPick() {
    var q = S.cart.itemQ.trim();
    if (!q) return '';
    var list = activeItems().filter(function (i) { return i.name.indexOf(q) > -1 || (i.code && i.code.indexOf(latin(q)) > -1); }).slice(0, 8);
    if (!list.length) return '<p class="hint">لا يوجد صنف بهذا الاسم.</p>';
    return '<div class="pick">' + list.map(function (i) { return '<button type="button" data-act="add-line" data-id="' + esc(i.id) + '"><span>' + esc(i.name) + '</span><span class="num">' + fmt(officialPrice(i, S.cart.type)) + '</span></button>'; }).join('') + '</div>';
  }
  function customerField() {
    var c = S.cart, chosen = c.customerId && S.view.customers[c.customerId];
    if (chosen) return '<div><label>الزبون</label><div class="row" style="align-items:center"><b style="flex:1">' + esc(chosen.name) + '</b><button type="button" class="btn quiet small" style="flex:none" data-act="clear-customer">تغيير</button></div></div>';
    return '<div><label for="cust-q">الزبون' + (c.type === 'cash' ? ' (اختياري)' : '') + '</label><input class="f" id="cust-q" placeholder="ابحث بالاسم أو الهاتف" autocomplete="off" value="' + esc(c.customerQ) + '"><div id="cust-pick">' + custPick() + '</div></div>';
  }
  function custPick() {
    var q = S.cart.customerQ.trim();
    if (!q) return '<button type="button" class="btn quiet small" style="margin-top:6px" data-act="new-customer">زبون جديد</button>';
    var list = activeCustomers().filter(function (x) { return x.name.indexOf(q) > -1 || (x.phone || '').indexOf(latin(q)) > -1; }).slice(0, 6);
    return '<div class="pick">' + list.map(function (x) { return '<button type="button" data-act="pick-customer" data-id="' + esc(x.id) + '"><span>' + esc(x.name) + '</span><span class="num">' + esc(x.phone || '') + '</span></button>'; }).join('') + '</div><button type="button" class="btn quiet small" style="margin-top:6px" data-act="new-customer">زبون جديد باسم «' + esc(q) + '»</button>';
  }
  function cartSummary(t) {
    var c = S.cart, h = '<div class="summary">';
    if (t.disc) h += '<div><span>قبل الخصم</span><span>' + money(t.sub) + '</span></div><div><span>الخصم</span><span>' + money(t.disc) + '</span></div>';
    h += '<div class="big"><span>المجموع</span><span>' + money(t.total) + '</span></div>';
    if (c.type === 'installment') {
      h += '<div><span>المقدمة</span><span>' + money(t.down) + '</span></div><div><span>المتبقي بالأقساط</span><span>' + money(t.total - t.down) + '</span></div>';
      if (t.sched.length) h += '<div><span>' + t.sched.length + ' أقساط تبدأ ' + '<span class="num">' + esc(t.sched[0].due) + '</span></span><span>' + money(t.sched[0].amount) + ' شهريًا</span></div>';
    }
    return h + '</div>';
  }
  function saveSale() {
    var c = S.cart, t = cartTotals(), er = $('sale-err');
    var fail = function (m) { er.textContent = m; er.hidden = false; };
    if (offlineBlocked()) return fail(BLOCK_MSG);
    if (!c.lines.length) return fail('أضف صنفًا واحدًا على الأقل.');
    for (var i = 0; i < c.lines.length; i++) {
      if (!(parseNum(c.lines[i].qty) > 0)) return fail('كمية «' + c.lines[i].name + '» غير صحيحة.');
      if (parseAmount(c.lines[i].price) === null) return fail('سعر «' + c.lines[i].name + '» غير صحيح.');
    }
    if (t.total < 0) return fail('الخصم أكبر من قيمة الفاتورة.');
    if (c.type === 'installment') {
      if (!c.customerId) return fail('البيع بالأقساط يحتاج إلى زبون. اختره أو أضف زبونًا جديدًا.');
      if (c.down !== '' && parseAmount(c.down) === null) return fail('اكتب المقدمة بالأرقام.');
      if (t.down > t.total) return fail('المقدمة أكبر من قيمة الفاتورة.');
      if (t.months < 1 || t.months > 60) return fail('عدد الأشهر يجب أن يكون بين 1 و60.');
      if (t.total - t.down <= 0) return fail('المقدمة تغطي الفاتورة كاملة. اختر البيع نقدًا.');
    }
    var cust = c.customerId ? S.view.customers[c.customerId] : null;
    var payload = {
      id: uid('sal'), no: nextNo(), type: c.type, date: c.date, customerId: c.customerId, customerName: cust ? cust.name : '',
      lines: c.lines.map(function (l) { return { itemId: l.itemId, name: l.name, qty: parseNum(l.qty), price: parseAmount(l.price) }; }),
      discount: t.disc, down: c.type === 'installment' ? t.down : 0, months: c.type === 'installment' ? t.months : 0, firstDue: c.type === 'installment' ? c.firstDue : ''
    };
    S.cart = null;
    S.sheet = { kind: 'invoice', saleId: payload.id, fresh: true };
    addOp('sale.create', payload);
  }

  /* ---------- الزبائن ---------- */
  function ledgerOf(id) { return S.ledgers[id] || { entries: [], payments: [], debts: 0, paid: 0, balance: 0, overdue: 0, credit: 0, nextDue: '' }; }
  function viewCustomers() {
    var all = activeCustomers(), outstanding = 0, overdue = 0, lateCount = 0;
    all.forEach(function (c) { var l = ledgerOf(c.id); outstanding += Math.max(l.balance, 0); if (l.overdue > 0) { overdue += l.overdue; lateCount++; } });
    var h = '<header class="top"><h1>الزبائن</h1></header><section class="total"><p class="label">مجموع الديون والأقساط المتبقية</p><p class="sum"><span class="num">' + fmt(outstanding) + '</span><small>' + esc(cur()) + '</small></p>' +
      (overdue ? '<p class="sub" style="color:var(--debt)">المتأخر: ' + money(overdue) + ' على ' + lateCount + ' زبون</p>' : '<p class="sub">لا توجد أقساط متأخرة</p>') + '</section>';
    h += '<div class="seg" style="margin-bottom:8px"><button class="' + (S.custFilter === 'all' ? 'on' : '') + '" data-act="cust-filter" data-v="all">الكل</button><button class="' + (S.custFilter === 'late' ? 'on' : '') + '" data-act="cust-filter" data-v="late">المتأخرون</button></div>';
    h += '<div class="tools"><input class="f" id="cust-search" type="search" placeholder="ابحث بالاسم أو الهاتف" aria-label="بحث" value="' + esc(S.search) + '"><button class="btn primary" data-act="new-customer">زبون جديد</button></div><div id="cust-list">' + custList() + '</div>';
    return h;
  }
  function custList() {
    var q = S.search.trim();
    var list = activeCustomers().filter(function (c) { return (!q || c.name.indexOf(q) > -1 || (c.phone || '').indexOf(latin(q)) > -1) && (S.custFilter !== 'late' || ledgerOf(c.id).overdue > 0); })
      .sort(function (a, b) { return ledgerOf(b.id).balance - ledgerOf(a.id).balance; });
    if (!activeCustomers().length) return '<div class="empty"><strong>لا يوجد زبائن بعد</strong>أضف زبونًا، أو أضفه أثناء البيع.</div>';
    if (!list.length) return '<div class="empty"><strong>لا توجد نتائج</strong>' + (S.custFilter === 'late' ? 'لا يوجد زبون متأخر بهذا الوصف.' : 'جرّب جزءًا من الاسم أو الهاتف.') + '</div>';
    return '<ul class="list">' + list.map(function (c) {
      var l = ledgerOf(c.id);
      var meta = l.overdue > 0 ? '<span style="color:var(--debt)">متأخر ' + money(l.overdue) + '</span>' : (l.nextDue ? 'القسط التالي <span class="num">' + esc(l.nextDue) + '</span>' : esc(c.phone || 'بلا هاتف'));
      return '<li><button class="rowbtn" data-act="open-customer" data-id="' + esc(c.id) + '"><span class="who"><b>' + esc(c.name) + '</b><small>' + meta + '</small></span>' +
        (l.balance > 0 ? '<span class="amt debt">' + money(l.balance) + '</span>' : l.credit ? '<span class="amt ok">له ' + money(l.credit) + '</span>' : '<span class="amt ok">لا دين عليه</span>') + '</button></li>';
    }).join('') + '</ul>';
  }
  function viewCustomer(id) {
    var c = S.view.customers[id];
    if (!c) return '<header class="top"><a class="icon-btn" href="#customers" aria-label="رجوع">' + svg('back') + '</a><h1>الزبون غير موجود</h1></header>';
    var l = ledgerOf(id), wa = waLink(c.phone, reminderText(c));
    var h = '<header class="top"><a class="icon-btn" href="#customers" aria-label="رجوع">' + svg('back') + '</a><h1>' + esc(c.name) + '</h1></header>';
    h += '<section class="total"><p class="label">' + (l.credit ? 'رصيد للزبون' : 'الدين المتبقي') + '</p><p class="sum ' + (l.balance > 0 ? 'debt' : 'ok') + '"><span class="num">' + fmt(Math.abs(l.balance)) + '</span><small>' + esc(cur()) + '</small></p>' +
      (l.overdue ? '<p class="sub" style="color:var(--debt)">متأخر عليه ' + money(l.overdue) + '</p>' : '') + (c.phone ? '<p class="sub num">' + esc(c.phone) + '</p>' : '') + '</section>';
    h += '<div class="row" style="margin-bottom:12px"><button class="btn pay" data-act="new-payment" data-id="' + esc(id) + '"' + (l.balance > 0 ? '' : ' disabled') + '>تسجيل تسديد</button>' +
      (wa ? '<a class="btn" target="_blank" rel="noopener" data-log="whatsapp" data-subject="' + esc('تنبيهًا إلى ' + c.name) + '" href="' + esc(wa) + '">تنبيه على واتساب</a>' : '<button class="btn quiet" data-act="edit-customer" data-id="' + esc(id) + '">أضف رقم الهاتف لواتساب</button>') +
      '<button class="btn quiet" data-act="statement" data-id="' + esc(id) + '">كشف الحساب</button></div>';
    if (l.entries.length) {
      h += '<section class="section"><h2>الأقساط حسب الشهر</h2><div class="scroll"><table><thead><tr><th>الاستحقاق</th><th class="n">القسط</th><th class="n">المسدد</th><th class="n">المتبقي</th></tr></thead><tbody>' +
        l.entries.map(function (e) { return '<tr><td><span class="num">' + esc(e.due) + '</span>' + (e.overdue ? ' <span class="tag bad">متأخر</span>' : '') + '</td><td class="n">' + fmt(e.amount) + '</td><td class="n">' + fmt(e.paid) + '</td><td class="n">' + fmt(e.rem) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    }
    var sales = Core.values(S.view.sales).filter(function (s) { return s.customerId === id; }).sort(byDateDesc);
    h += '<section class="section"><h2>المشتريات</h2>' + (sales.length ? '<ul class="list">' + sales.map(saleRow).join('') + '</ul>' : '<p class="hint">لا توجد مشتريات.</p>') + '</section>';
    var pays = Core.values(S.view.payments).filter(function (p) { return p.customerId === id; }).sort(byDateDesc);
    h += '<section class="section"><h2>التسديدات</h2>' + (pays.length ? '<ul class="list">' + pays.map(payRow).join('') + '</ul>' : '<p class="hint">لا توجد تسديدات.</p>') + '</section>';
    h += '<div class="row" style="margin-top:14px"><button class="btn quiet small" data-act="edit-customer" data-id="' + esc(id) + '">تعديل البيانات</button>' + (owner() ? '<button class="btn quiet small" data-act="opening-debt" data-id="' + esc(id) + '">إضافة دين سابق</button>' : '') + (l.balance === 0 ? '<button class="btn quiet small" data-act="archive-customer" data-id="' + esc(id) + '">أرشفة الزبون</button>' : '') + '</div>';
    return h;
  }
  function byDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (String(a.createdAt) < String(b.createdAt) ? 1 : -1); }
  function typeLabel(s) { return s.type === 'cash' ? 'نقد' : s.type === 'installment' ? 'أقساط' : 'دين سابق'; }
  function saleRow(s) {
    return '<li><button class="rowbtn" data-act="open-invoice" data-id="' + esc(s.id) + '"><span class="who"><b>' + esc(s.customerName || 'زبون نقدي') + ' <span class="tag">' + typeLabel(s) + '</span>' + (s.cancelled ? ' <span class="tag bad">ملغاة</span>' : '') + (s.flags ? ' <span class="tag warn">للمراجعة</span>' : '') + (s.pending ? ' <span class="tag warn">لم تُرسل</span>' : '') + '</b><small>رقم <span class="num">' + esc(s.no) + '</span>، <span class="num">' + esc(s.date) + '</span>' + (s.createdByName ? '، ' + esc(s.createdByName) : '') + '</small></span><span class="amt">' + money(s.total) + '</span></button></li>';
  }
  function payRow(p) {
    return '<li><button class="rowbtn" data-act="open-payment" data-id="' + esc(p.id) + '"><span class="who"><b>' + esc(p.customerName || (S.view.customers[p.customerId] || {}).name || '') + (p.cancelled ? ' <span class="tag bad">ملغى</span>' : '') + (p.flags ? ' <span class="tag warn">للمراجعة</span>' : '') + (p.pending ? ' <span class="tag warn">لم يُرسل</span>' : '') + '</b><small><span class="num">' + esc(p.date) + '</span>' + (p.createdByName ? '، ' + esc(p.createdByName) : '') + (p.note ? '، ' + esc(p.note) : '') + '</small></span><span class="amt" style="color:var(--paid)">' + money(p.amount) + '</span></button></li>';
  }

  /* ---------- واتساب ---------- */
  function waPhone(p) { var s = latin(p).replace(/[^\d]/g, ''); if (!s) return ''; if (s.indexOf('00') === 0) return s.slice(2); if (s.charAt(0) === '0') return '964' + s.slice(1); return s; }
  function waLink(phone, text) { var p = waPhone(phone); return p ? 'https://wa.me/' + p + '?text=' + encodeURIComponent(text) : ''; }
  function shopLine() { return S.settings.shopName ? '\n' + S.settings.shopName : ''; }
  function reminderText(c) {
    var l = ledgerOf(c.id), t = 'مرحبًا ' + c.name + '،\nالمتبقي على حسابك: ' + plain(Math.max(l.balance, 0));
    if (l.overdue > 0) t += '\nالأقساط المتأخرة: ' + plain(l.overdue);
    else if (l.nextDue) { var e = l.entries.filter(function (x) { return x.rem > 0; })[0]; t += '\nالقسط التالي: ' + plain(e.rem) + ' بتاريخ ' + e.due; }
    return t + shopLine();
  }
  function saleText(s) {
    var t = 'مرحبًا ' + (s.customerName || '') + '،\nفاتورة رقم ' + s.no + ' بتاريخ ' + s.date + '\n' + s.lines.map(function (l) { return l.name + ' × ' + l.qty + ': ' + plain(Core.int(l.qty * l.price)); }).join('\n') + '\nالمجموع: ' + plain(s.total);
    if (s.type === 'installment') t += '\nالمقدمة: ' + plain(s.down) + '\nالأقساط:\n' + s.schedule.map(function (e) { return e.due + ': ' + plain(e.amount); }).join('\n');
    if (s.customerId) t += '\nالمتبقي على حسابك: ' + plain(Math.max(ledgerOf(s.customerId).balance, 0));
    return t + shopLine();
  }
  function statementText(c) {
    var l = ledgerOf(c.id), sales = Core.values(S.view.sales).filter(function (s) { return s.customerId === c.id && !s.cancelled; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var t = 'المشتريات:\n' + sales.map(function (s) { return s.date + ': ' + s.lines.map(function (x) { return x.name + ' × ' + x.qty; }).join('، ') + '\nالقيمة: ' + plain(s.total) + (s.type === 'installment' ? '، المقدمة: ' + plain(s.down) : ''); }).join('\n');
    if (l.entries.length) t += '\n\nالأقساط حسب الشهر:\n' + l.entries.map(function (e) { return monthName(e.due) + ': ' + (e.rem === 0 ? 'مسدد' : e.paid ? 'مسدد ' + fmt(e.paid) + '، متبق ' + fmt(e.rem) : 'متبق ' + fmt(e.rem)) + (e.overdue ? ' (متأخر)' : ''); }).join('\n');
    if (l.payments.length) t += '\n\nالتسديدات:\n' + l.payments.map(function (p) { return p.date + ': ' + plain(p.amount); }).join('\n');
    return t + '\n\nالمتبقي: ' + plain(Math.max(l.balance, 0));
  }
  function paymentText(p) {
    var c = S.view.customers[p.customerId] || {};
    return 'مرحبًا ' + (c.name || '') + '،\nتم استلام ' + plain(p.amount) + ' بتاريخ ' + p.date + '.\n\n' + statementText(c) + shopLine();
  }

  /* ---------- الفاتورة الحرارية ---------- */
  function rcHead(title) {
    var s = S.settings;
    return '<h3>' + esc(s.shopName || 'دفتر المحل') + '</h3>' + (s.shopPhone ? '<p class="c">' + esc(s.shopPhone) + '</p>' : '') + '<p class="c"><b>' + title + '</b></p><hr>';
  }
  function rcFoot() { return '<hr><p class="c">' + esc(S.settings.footer || '') + '</p><p class="c">طُبعت ' + esc(nowText()) + '</p>'; }
  function kv(k, v, cls) { return '<div class="kv ' + (cls || '') + '"><span>' + k + '</span><span>' + v + '</span></div>'; }
  function scheduleTable(entries) {
    if (!entries.length) return '';
    return '<hr><b>الأقساط حسب الشهر</b><table><thead><tr><th>الشهر</th><th class="n">القسط</th><th class="n">مسدد</th><th class="n">متبقي</th></tr></thead><tbody>' +
      entries.map(function (e) { return '<tr><td>' + esc(monthName(e.due)) + '</td><td class="n">' + fmt(e.amount) + '</td><td class="n">' + fmt(e.paid) + '</td><td class="n">' + fmt(e.rem) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function paymentsTable(list) {
    if (!list.length) return '';
    return '<hr><b>التسديدات</b><table><tbody>' + list.map(function (p) { return '<tr><td>' + esc(p.date) + '</td><td class="n">' + fmt(p.amount) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function linesTable(s) {
    return '<table><thead><tr><th>الصنف</th><th class="n">كمية</th><th class="n">سعر</th><th class="n">مبلغ</th></tr></thead><tbody>' +
      s.lines.map(function (l) { return '<tr><td>' + esc(l.name) + '</td><td class="n">' + l.qty + '</td><td class="n">' + fmt(l.price) + '</td><td class="n">' + fmt(Core.int(l.qty * l.price)) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function paperCls() { return S.settings.paper === '58' ? 'receipt p58' : 'receipt'; }
  function invoiceHtml(s) {
    var led = s.customerId ? ledgerOf(s.customerId) : null;
    var h = '<div class="' + paperCls() + '">' + rcHead(s.cancelled ? 'فاتورة ملغاة' : (s.type === 'cash' ? 'فاتورة بيع نقدي' : s.type === 'installment' ? 'فاتورة بيع بالأقساط' : 'دين سابق'));
    h += kv('الرقم', esc(s.no)) + kv('التاريخ', esc(s.date)) + (s.createdByName ? kv('البائع', esc(s.createdByName)) : '') + (s.customerName ? kv('الزبون', esc(s.customerName)) : '') + '<hr>' + linesTable(s) + '<hr>';
    if (s.discount) h += kv('الخصم', fmt(s.discount));
    h += kv('المجموع', plain(s.total), 'tot');
    if (s.type === 'installment') h += kv('المقدمة', fmt(s.down)) + kv('المتبقي من الفاتورة', fmt(s.total - s.down));
    if (led && !s.cancelled) {
      h += scheduleTable(led.entries.filter(function (e) { return e.saleId === s.id; }));
      h += paymentsTable(led.payments);
      h += '<hr>' + kv('مجموع المتبقي على الزبون', plain(Math.max(led.balance, 0)), 'tot');
    }
    return h + rcFoot() + '</div>';
  }
  function statementHtml(c) {
    return '<div class="' + paperCls() + '">' + rcHead('كشف حساب') + kv('الزبون', esc(c.name)) + (c.phone ? kv('الهاتف', esc(c.phone)) : '') + statementBody(c) + rcFoot() + '</div>';
  }
  /** وصل التسديد كشف كامل: ما اشتراه، وكل ما سدده، وما تبقى لكل شهر. */
  function statementBody(c) {
    var l = ledgerOf(c.id);
    var sales = Core.values(S.view.sales).filter(function (s) { return s.customerId === c.id && !s.cancelled; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var h = '<hr><b>المشتريات</b>' + (sales.map(function (s) { return '<div style="margin-top:4px">' + kv(esc(s.date) + ' رقم ' + esc(s.no), fmt(s.total)) + linesTable(s) + (s.type === 'installment' ? kv('المقدمة', fmt(s.down)) : '') + '</div>'; }).join('') || '<p>لا توجد مشتريات.</p>');
    h += scheduleTable(l.entries) + paymentsTable(l.payments) + '<hr>' + kv('مجموع الأقساط والديون', fmt(l.debts)) + kv('مجموع التسديدات', fmt(l.paid)) + (l.overdue ? kv('المتأخر', fmt(l.overdue)) : '') + kv('المتبقي', plain(Math.max(l.balance, 0)), 'tot');
    return h;
  }
  function paymentHtml(p) {
    var c = S.view.customers[p.customerId] || {};
    var h = '<div class="' + paperCls() + '">' + rcHead(p.cancelled ? 'وصل ملغى' : 'وصل تسديد وكشف حساب') + kv('الرقم', esc(p.no)) + kv('التاريخ', esc(p.date)) + kv('الزبون', esc(c.name || '')) + (p.createdByName ? kv('استلمه', esc(p.createdByName)) : '') + kv('المبلغ المستلم', plain(p.amount), 'tot');
    return h + statementBody(c) + rcFoot() + '</div>';
  }
  function printHtml(html) { $('print').innerHTML = html; applyPaper(); window.print(); }

  /* ---------- النوافذ ---------- */
  function renderSheet() {
    var o = $('overlay'), s = S.sheet;
    if (!s) { o.hidden = true; o.innerHTML = ''; o.dataset.key = ''; return; }
    var key = s.kind + (s.saleId || s.paymentId || s.customerId || s.itemId || s.userId || '') + (s.n || 0);
    if (!o.hidden && o.dataset.key === key && s.keep) return;
    o.dataset.key = key; o.hidden = false; s.keep = true;
    var fn = { invoice: sheetInvoice, receipt: sheetPayment, statement: sheetStatement, customer: sheetCustomer, payment: sheetNewPayment, item: sheetItem, stock: sheetStock, opening: sheetOpening, user: sheetUser, password: sheetPassword, rejected: sheetRejected }[s.kind];
    o.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + fn(s) + '</div>';
    var first = o.querySelector('input:not([readonly]):not([type=checkbox])'); if (first && s.focus !== false) first.focus();
    itemPreview();
  }
  function closeBtn(label) { return '<button type="button" class="btn quiet" data-act="close-sheet">' + (label || 'إغلاق') + '</button>'; }
  function sheetInvoice(st) {
    var s = S.view.sales[st.saleId];
    if (!s) return '<p>لم تعد هذه الفاتورة موجودة على الجهاز.</p>' + closeBtn();
    st.focus = false;
    var wa = s.customerId && S.view.customers[s.customerId] ? waLink(S.view.customers[s.customerId].phone, saleText(s)) : '';
    var pr = Core.saleProfit(s);
    return '<h2>' + (st.fresh ? (s.pending && !S.online ? 'حُفظ البيع على الجهاز' : 'سُجل البيع') : 'فاتورة ' + esc(s.no)) + '</h2>' +
      (st.fresh && s.pending && !S.online ? '<p class="notice">لا يوجد إنترنت. سيُرسل البيع إلى الدفتر وإلى هاتف صاحب المحل عند الاتصال.</p>' : '') +
      (s.cancelReason ? '<p class="notice bad">سبب الإلغاء: ' + esc(s.cancelReason) + '، ' + esc(s.cancelledBy) + '</p>' : '') + (s.flags ? '<p class="notice">للمراجعة: ' + esc(s.flags) + '</p>' : '') +
      (owner() && pr !== null && !s.cancelled && s.type !== 'opening' ? '<p class="hint" style="margin-bottom:8px">ربح الفاتورة: ' + money(pr) + '</p>' : '') +
      invoiceHtml(s) + '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="print-invoice" data-id="' + esc(s.id) + '">طباعة الفاتورة</button>' +
      (wa ? '<a class="btn" target="_blank" rel="noopener" data-log="whatsapp" data-subject="' + esc('الفاتورة ' + s.no) + '" href="' + esc(wa) + '">إرسال على واتساب</a>' : '') + closeBtn(st.fresh ? 'بيع جديد' : 'إغلاق') + '</div>' +
      (!st.fresh && !s.cancelled && can('cancel') ? confirmBlock('cancel-sale', s.id, 'إلغاء الفاتورة', 'سيعود المخزون وتُلغى أقساطها، ويصل تنبيه لصاحب المحل.') : '');
  }
  function confirmBlock(act, id, label, warn) {
    if (S.confirm === act + id) return '<div class="section"><p style="margin-bottom:8px">' + warn + '</p><div style="margin-bottom:8px"><label for="cancel-reason">سبب الإلغاء</label><input class="f" id="cancel-reason" maxlength="200"></div><div class="err" id="sheet-err" hidden></div><div class="row"><button class="btn debt small" data-act="' + act + '" data-id="' + esc(id) + '">تأكيد ' + label + '</button><button class="btn quiet small" data-act="confirm-off">تراجع</button></div></div>';
    return '<div style="margin-top:10px"><button class="btn quiet small" data-act="confirm-on" data-v="' + act + esc(id) + '">' + label + '</button></div>';
  }
  function sheetPayment(st) {
    var p = S.view.payments[st.paymentId];
    if (!p) return '<p>لم يعد هذا التسديد موجودًا على الجهاز.</p>' + closeBtn();
    st.focus = false;
    var c = S.view.customers[p.customerId] || {}, wa = waLink(c.phone, paymentText(p));
    return '<h2>' + (st.fresh ? (p.pending && !S.online ? 'حُفظ التسديد على الجهاز' : 'سُجل التسديد') : 'وصل تسديد') + '</h2>' + (p.cancelReason ? '<p class="notice bad">سبب الإلغاء: ' + esc(p.cancelReason) + '، ' + esc(p.cancelledBy) + '</p>' : '') + (p.flags ? '<p class="notice">للمراجعة: ' + esc(p.flags) + '</p>' : '') + paymentHtml(p) +
      '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="print-payment" data-id="' + esc(p.id) + '">طباعة الوصل والكشف</button>' + (wa ? '<a class="btn pay" target="_blank" rel="noopener" data-log="whatsapp" data-subject="' + esc('كشف ' + (c.name || '')) + '" href="' + esc(wa) + '">إرسال الكشف على واتساب</a>' : '<p class="hint" style="flex-basis:100%">أضف رقم هاتف الزبون لإرسال الكشف على واتساب.</p>') + closeBtn() + '</div>' +
      (!st.fresh && !p.cancelled && can('cancel') ? confirmBlock('cancel-payment', p.id, 'إلغاء التسديد', 'سيعود المبلغ إلى دين الزبون، ويصل تنبيه لصاحب المحل.') : '');
  }
  function sheetStatement(st) {
    st.focus = false;
    var c = S.view.customers[st.customerId], wa = waLink(c.phone, 'مرحبًا ' + c.name + '،\n\n' + statementText(c) + shopLine());
    return '<h2>كشف حساب</h2>' + statementHtml(c) + '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="print-statement" data-id="' + esc(c.id) + '">طباعة الكشف</button>' + (wa ? '<a class="btn" target="_blank" rel="noopener" data-log="whatsapp" data-subject="' + esc('كشف ' + c.name) + '" href="' + esc(wa) + '">إرسال على واتساب</a>' : '') + closeBtn() + '</div>';
  }
  function sheetCustomer(st) {
    var c = st.customerId ? S.view.customers[st.customerId] : { name: st.name || '' };
    return '<h2>' + (st.customerId ? 'تعديل بيانات الزبون' : 'زبون جديد') + '</h2><form id="f-customer" class="stack"><div><label for="cu-name">الاسم</label><input class="f" id="cu-name" required maxlength="60" value="' + esc(c.name) + '"></div>' +
      '<div><label for="cu-phone">الهاتف (لتنبيه واتساب)</label><input class="f" id="cu-phone" inputmode="tel" dir="ltr" placeholder="07XXXXXXXXX" value="' + esc(c.phone || '') + '"></div>' +
      '<div><label for="cu-addr">العنوان</label><input class="f" id="cu-addr" maxlength="120" value="' + esc(c.address || '') + '"></div>' +
      (st.customerId ? '' : '<div><label for="cu-open">دين سابق إن وجد</label><input class="f" id="cu-open" inputmode="numeric"></div>') + '<div class="err" id="sheet-err" hidden></div><div class="row"><button class="btn primary">حفظ الزبون</button>' + closeBtn() + '</div></form>';
  }
  function sheetOpening(st) {
    return '<h2>إضافة دين سابق</h2><form id="f-opening" class="stack"><div><label for="op-amt">المبلغ</label><input class="f" id="op-amt" inputmode="numeric" required></div><div><label for="op-note">البيان</label><input class="f" id="op-note" value="دين سابق" maxlength="80"></div><div class="err" id="sheet-err" hidden></div><div class="row"><button class="btn primary">حفظ الدين</button>' + closeBtn() + '</div></form>';
  }
  function sheetNewPayment(st) {
    var c = S.view.customers[st.customerId], l = ledgerOf(c.id), next = l.entries.filter(function (e) { return e.rem > 0; })[0];
    return '<h2>تسديد من ' + esc(c.name) + '</h2><p class="hint" style="margin-bottom:10px">الدين المتبقي: ' + money(l.balance) + '</p><form id="f-payment" class="stack"><div><label for="pay-amt">المبلغ</label><input class="f" id="pay-amt" inputmode="numeric" required dir="ltr" style="font-size:22px;font-weight:700;text-align:center"><div class="row" style="margin-top:6px">' +
      (next ? '<button type="button" class="btn quiet small" data-act="set-amt" data-v="' + next.rem + '">القسط الحالي: ' + fmt(next.rem) + '</button>' : '') + '<button type="button" class="btn quiet small" data-act="set-amt" data-v="' + l.balance + '">كامل المتبقي</button></div></div>' +
      '<div class="two"><div><label for="pay-date">التاريخ</label><input class="f" id="pay-date" type="date" required max="' + iso(today()) + '" value="' + iso(today()) + '"' + (owner() ? '' : ' readonly') + '></div><div><label for="pay-note">ملاحظة</label><input class="f" id="pay-note" maxlength="200"></div></div><div class="err" id="sheet-err" hidden></div><div class="row"><button class="btn pay">تسجيل التسديد</button>' + closeBtn() + '</div></form>';
  }
  function sheetItem(st) {
    var i = st.itemId ? S.view.items[st.itemId] : {}, isNew = !st.itemId, mode = i.instMode || 'default', d = S.settings.installment || {};
    return '<h2>' + (isNew ? 'صنف جديد' : 'تعديل الصنف') + '</h2><form id="f-item" class="stack"><div><label for="it-name">الاسم</label><input class="f" id="it-name" required maxlength="80" value="' + esc(i.name || '') + '"></div><div><label for="it-code">الرمز (اختياري)</label><input class="f" id="it-code" dir="ltr" maxlength="40" value="' + esc(i.code || '') + '"></div>' +
      '<div class="two"><div><label for="it-price">سعر النقد</label><input class="f" id="it-price" data-preview="1" inputmode="numeric" required value="' + esc(i.price === undefined ? '' : i.price) + '"></div><div><label for="it-cost">التكلفة</label><input class="f" id="it-cost" data-preview="1" inputmode="numeric" value="' + esc(i.cost === undefined ? '' : i.cost) + '"></div></div>' +
      '<div><label for="it-mode">سعر القسط</label><select class="f" id="it-mode" data-preview="1"><option value="default"' + (mode === 'default' ? ' selected' : '') + '>النسبة العامة (' + esc(d.pct || 0) + '% ' + (d.base === 'profit' ? 'على الربح' : 'على السعر') + ')</option><option value="pct"' + (mode === 'pct' ? ' selected' : '') + '>نسبة خاصة بهذا الصنف</option><option value="fixed"' + (mode === 'fixed' ? ' selected' : '') + '>سعر قسط ثابت</option></select></div>' +
      '<div class="two" id="it-pct-row"><div><label for="it-pct">النسبة %</label><input class="f" id="it-pct" data-preview="1" inputmode="decimal" value="' + esc(i.instPct || '') + '"></div><div><label for="it-base">تُحسب على</label><select class="f" id="it-base" data-preview="1"><option value="price"' + (i.instBase !== 'profit' ? ' selected' : '') + '>سعر الجهاز</option><option value="profit"' + (i.instBase === 'profit' ? ' selected' : '') + '>الربح</option></select></div></div>' +
      '<div id="it-fixed-row"><label for="it-fixed">سعر القسط الثابت</label><input class="f" id="it-fixed" data-preview="1" inputmode="numeric" value="' + esc(i.instFixed || '') + '"></div><p class="after" id="it-preview" style="font-weight:600"></p>' +
      (isNew ? '<div><label for="it-qty">الكمية الموجودة</label><input class="f" id="it-qty" inputmode="decimal"></div>' : '') + '<div><label for="it-low">نبهني عندما تصل الكمية إلى</label><input class="f" id="it-low" inputmode="numeric" value="' + esc(i.lowStock || '') + '"></div>' +
      '<div class="err" id="sheet-err" hidden></div><div class="row"><button class="btn primary">حفظ الصنف</button>' + closeBtn() + '</div>' + (isNew ? '' : '<button type="button" class="btn quiet small" data-act="archive-item" data-id="' + esc(st.itemId) + '">إخفاء الصنف من البيع</button>') + '</form>';
  }
  function itemInstFields() {
    var mode = $('it-mode').value, pct = parseNum($('it-pct').value || '0'), fixed = parseAmount($('it-fixed').value || '0');
    if (pct === null || fixed === null) return null;
    return { instMode: mode, instPct: pct, instBase: $('it-base').value, instFixed: fixed };
  }
  function itemPreview() {
    if (!$('it-preview')) return;
    var mode = $('it-mode').value;
    $('it-pct-row').hidden = mode !== 'pct'; $('it-fixed-row').hidden = mode !== 'fixed';
    var inst = itemInstFields(), price = parseAmount($('it-price').value), cost = parseAmount($('it-cost').value || '0');
    if (!inst || price === null || cost === null) { $('it-preview').textContent = ''; return; }
    var v = Core.instPrice(Object.assign({ price: price, cost: cost }, inst), S.settings.installment);
    $('it-preview').textContent = 'النقد ' + plain(price) + '، القسط ' + plain(v) + '، وربح القسط ' + plain(v - cost);
  }
  function sheetStock(st) {
    var i = S.view.items[st.itemId];
    return '<h2>مخزون ' + esc(i.name) + '</h2><p class="hint" style="margin-bottom:10px">المتوفر الآن: ' + fmt(S.stock[i.id] || 0) + '</p><form id="f-stock" class="stack"><div class="seg"><button type="button" class="' + (st.out ? '' : 'on') + '" data-act="stock-dir" data-v="in">إضافة</button><button type="button" class="' + (st.out ? 'on' : '') + '" data-act="stock-dir" data-v="out">خصم</button></div><div><label for="st-qty">الكمية</label><input class="f" id="st-qty" inputmode="decimal" required></div><div><label for="st-reason">السبب</label><input class="f" id="st-reason" maxlength="100" placeholder="' + (st.out ? 'تالف أو جرد' : 'شراء بضاعة') + '"></div><div class="err" id="sheet-err" hidden></div><div class="row"><button class="btn primary">حفظ الحركة</button>' + closeBtn() + '</div></form>';
  }
  function sheetUser(st) {
    var u = st.userId ? (S.users || []).filter(function (x) { return x.id === st.userId; })[0] : { perms: {}, active: true };
    var isOwner = u.role === 'owner';
    return '<h2>' + (st.userId ? 'تعديل مستخدم' : 'مستخدم جديد') + '</h2><form id="f-user" class="stack"><div><label for="us-name">الاسم</label><input class="f" id="us-name" required maxlength="60" value="' + esc(u.name || '') + '"></div>' +
      (st.userId ? '<p class="hint">اسم الدخول: <span class="num">' + esc(u.username) + '</span></p>' : '<div><label for="us-user">اسم الدخول (بالإنجليزية)</label><input class="f" id="us-user" dir="ltr" required autocapitalize="none" autocomplete="off"></div>') +
      '<div><label for="us-pass">' + (st.userId ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء عليها)' : 'كلمة المرور') + '</label><input class="f" id="us-pass" type="password" dir="ltr" autocomplete="new-password"' + (st.userId ? '' : ' required') + '></div>' +
      (isOwner ? '' : '<fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:500;font-size:14.5px;padding:0;margin-bottom:4px">الصلاحيات</legend><p class="hint">الأرباح والأسعار والخصم لصاحب المحل فقط، ولا يمكن منحها.</p>' + Object.keys(PERM_LABELS).map(function (p) { return '<label class="check"><input type="checkbox" data-perm="' + p + '"' + (u.perms[p] ? ' checked' : '') + '>' + PERM_LABELS[p] + '</label>'; }).join('') + '</fieldset>') +
      (st.userId && !isOwner ? '<label class="check"><input type="checkbox" id="us-active"' + (u.active ? ' checked' : '') + '>الحساب مفعل</label>' : '') +
      '<div class="err" id="sheet-err" hidden></div><div class="row"><button class="btn primary">حفظ المستخدم</button>' + closeBtn() + '</div></form>';
  }
  function sheetPassword() {
    return '<h2>تغيير كلمة المرور</h2><form id="f-pass" class="stack"><div><label for="pw-cur">الحالية</label><input class="f" id="pw-cur" type="password" dir="ltr" required autocomplete="current-password"></div><div><label for="pw-new">الجديدة (6 رموز على الأقل)</label><input class="f" id="pw-new" type="password" dir="ltr" required autocomplete="new-password"></div><div class="err" id="sheet-err" hidden></div><div class="row"><button class="btn primary">حفظ كلمة المرور</button>' + closeBtn() + '</div></form>';
  }
  function sheetRejected() {
    return '<h2>حركات رفضها الدفتر</h2><p class="hint" style="margin-bottom:8px">لم تُحسب هذه الحركات. راجعها وأعد تسجيلها إن لزم.</p><ul class="list">' + S.rejected.map(function (r, i) {
      var p = r.op.payload || {};
      return '<li style="padding:9px 0"><b>' + esc(opLabel(r.op)) + '</b>' + (p.amount ? ' ' + money(p.amount) : '') + '<br><small>' + esc(r.op.createdAt) + '</small><p style="color:var(--debt);font-size:14px">' + esc(r.error) + '</p><button class="btn quiet small" data-act="dismiss-rejected" data-i="' + i + '">إزالة من القائمة</button></li>';
    }).join('') + '</ul><div style="margin-top:12px">' + closeBtn() + '</div>';
  }
  function opLabel(op) { return { 'sale.create': 'بيع', 'sale.cancel': 'إلغاء فاتورة', 'payment.create': 'تسديد', 'payment.cancel': 'إلغاء تسديد', 'customer.save': 'حفظ زبون', 'item.save': 'حفظ صنف', 'stock.move': 'حركة مخزون' }[op.type] || op.type; }
  function failBanner() {
    var h = '';
    if (S.rejected.length) h += '<div class="notice bad"><p>' + S.rejected.length + ' حركة رفضها الدفتر.</p><button class="btn small" data-act="show-rejected">عرض</button></div>';
    if (offlineBlocked()) h += '<div class="notice bad"><p>' + BLOCK_MSG + '</p></div>';
    (S.settings.staleUsers || []).forEach(function (u) { h += '<div class="notice"><p>لم يتصل جهاز ' + esc(u.name) + (u.seen ? ' منذ <span class="num">' + esc(u.seen) + '</span>' : ' بعد') + '. قد تكون عنده حركات لم تصل.</p></div>'; });
    return h;
  }
  function sheetError(m) { var e = $('sheet-err'); if (e) { e.textContent = m; e.hidden = false; } }

  /* ---------- الأصناف ---------- */
  function viewItems() {
    var h = '<header class="top"><h1>الأصناف والمخزون</h1></header><div class="tools"><input class="f" id="item-search" type="search" placeholder="ابحث باسم الصنف" aria-label="بحث" value="' + esc(S.search) + '">' + (owner() ? '<button class="btn primary" data-act="new-item">صنف جديد</button>' : '') + '</div><div id="items-list">' + itemsList() + '</div>';
    return h;
  }
  function itemsList() {
    var q = S.search.trim(), isOwner = owner(), stockOk = can('manageStock'), list = activeItems().filter(function (i) { return !q || i.name.indexOf(q) > -1 || (i.code || '').indexOf(latin(q)) > -1; });
    if (!activeItems().length) return '<div class="empty"><strong>لا توجد أصناف</strong>' + (isOwner ? 'أضف أول صنف بسعره وتكلفته وكميته.' : 'لم يضف صاحب المحل أي صنف بعد.') + '</div>';
    if (!list.length) return '<div class="empty"><strong>لا توجد نتائج</strong>جرّب جزءًا من الاسم.</div>';
    return '<ul class="list">' + list.map(function (i) {
      var lvl = S.stock[i.id] || 0, low = i.lowStock > 0 && lvl <= i.lowStock, cost = isOwner && i.cost !== undefined ? '، التكلفة <span class="num">' + fmt(i.cost) + '</span>' : '';
      var inner = '<span class="who"><b>' + esc(i.name) + (low ? ' <span class="tag warn">قارب على النفاد</span>' : '') + '</b><small>نقد <span class="num">' + fmt(i.price) + '</span>، قسط <span class="num">' + fmt(officialPrice(i, 'installment')) + '</span>' + cost + '</small></span><span class="amt">' + fmt(lvl) + '</span>';
      return '<li><div style="display:flex;align-items:center;gap:8px">' + (isOwner ? '<button class="rowbtn" style="flex:1;min-width:0" data-act="edit-item" data-id="' + esc(i.id) + '">' + inner + '</button>' : '<div class="rowbtn" style="cursor:default;flex:1;min-width:0">' + inner + '</div>') + (stockOk ? '<button class="btn quiet small" style="flex:none" data-act="stock" data-id="' + esc(i.id) + '">مخزون</button>' : '') + '</div></li>';
    }).join('') + '</ul>';
  }

  /* ---------- التقارير ---------- */
  function rangeOf(k) {
    var t = today();
    if (k === 'today') return [t, t];
    if (k === 'month') return [t.slice(0, 8) + '01', t];
    if (k === 'year') return [t.slice(0, 5) + '01/01', t];
    return [S.report.from, S.report.to];
  }
  function viewReports() {
    if (!can('viewReports')) return '<div class="empty"><strong>التقارير غير متاحة لهذا الحساب</strong>يمكن لصاحب المحل منحك الصلاحية.</div>';
    if (!S.report) S.report = { key: 'month', from: today().slice(0, 8) + '01', to: today(), tab: 'sales' };
    var R = S.report, rg = rangeOf(R.key), r = Core.report(S.view, rg[0], rg[1], today()), showProfit = owner() && r.profit !== null;
    var seg = [['today', 'اليوم'], ['month', 'هذا الشهر'], ['year', 'هذه السنة'], ['custom', 'فترة']].map(function (x) { return '<button class="' + (R.key === x[0] ? 'on' : '') + '" data-act="rep-range" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('');
    var h = '<header class="top"><h1>التقارير</h1></header><div class="seg" style="margin-bottom:10px">' + seg + '</div>';
    if (R.key === 'custom') h += '<div class="two" style="margin-bottom:10px"><div><label for="rep-from">من</label><input class="f" id="rep-from" type="date" value="' + iso(R.from) + '"></div><div><label for="rep-to">إلى</label><input class="f" id="rep-to" type="date" value="' + iso(R.to) + '"></div></div>';
    if (S.pending.length) h += '<p class="notice">التقرير يشمل ' + S.pending.length + ' حركة على هذا الجهاز لم تُرسل بعد.</p>';
    h += '<section class="total"><p class="label">مجموع المبيعات</p><p class="sum"><span class="num">' + fmt(r.sales) + '</span><small>' + esc(cur()) + '</small></p><p class="sub">' + r.count + ' فاتورة' + (r.cancelled ? '، و' + r.cancelled + ' ملغاة' : '') + '</p></section>';
    var stat = function (k, v, c) { return '<div><span>' + k + '</span><b style="' + (c ? 'color:var(--' + c + ')' : '') + '">' + fmt(v) + '</b></div>'; };
    h += '<div class="stats">' + stat('مبيعات نقدية', r.cashSales) + stat('مبيعات بالأقساط', r.installmentSales) + stat('مقدمات مستلمة', r.downs) + stat('تسديدات مستلمة', r.payments) + stat('إجمالي النقد المستلم', r.received, 'paid') + (showProfit ? stat('صافي الربح', r.profit, 'paid') : '') + stat('مجموع الديون الآن', r.outstanding, 'debt') + stat('المتأخر الآن', r.overdue, 'debt') + '</div>';
    var tabs = [['sales', 'الفواتير'], ['payments', 'التسديدات'], ['items', 'الأصناف'], ['sellers', 'البائعون'], ['months', 'الأشهر']];
    if (owner()) tabs.push(['log', 'السجل']);
    h += '<div class="seg" style="margin-block:14px 6px;overflow-x:auto">' + tabs.map(function (t) { return '<button style="min-width:66px;font-size:13.5px" class="' + (R.tab === t[0] ? 'on' : '') + '" data-act="rep-tab" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (R.tab === 'sales') h += r.saleList.length ? '<ul class="list">' + r.saleList.map(saleRow).join('') + '</ul>' : '<p class="empty">لا توجد فواتير في هذه الفترة.</p>';
    if (R.tab === 'payments') h += r.paymentList.length ? '<ul class="list">' + r.paymentList.map(payRow).join('') + '</ul>' : '<p class="empty">لا توجد تسديدات في هذه الفترة.</p>';
    var table = function (heads, rows) { return rows.length ? '<div class="scroll"><table><thead><tr>' + heads.map(function (x, i) { return '<th class="' + (i ? 'n' : '') + '">' + x + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (row) { return '<tr>' + row.map(function (x, i) { return '<td class="' + (i ? 'n' : '') + '">' + x + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' : '<p class="empty">لا توجد بيانات في هذه الفترة.</p>'; };
    if (R.tab === 'items') h += table(['الصنف', 'الكمية', 'المبلغ'], Object.keys(r.byItem).sort(function (a, b) { return r.byItem[b].total - r.byItem[a].total; }).map(function (k) { return [esc(k), r.byItem[k].qty, fmt(r.byItem[k].total)]; }));
    if (R.tab === 'sellers') h += table(['البائع', 'الفواتير', 'المبيعات'], Object.keys(r.bySeller).map(function (k) { return [esc(k), r.bySeller[k].count, fmt(r.bySeller[k].sales)]; }));
    if (R.tab === 'log') {
      var evs = Core.values(S.view.events).filter(function (e) { var d = String(e.serverAt).slice(0, 10); return d >= rg[0] && d <= rg[1]; }).sort(function (a, b) { return a.serverAt < b.serverAt ? 1 : a.serverAt > b.serverAt ? -1 : (a.id < b.id ? 1 : -1); }).slice(0, 300);
      h += evs.length ? '<ul class="list">' + evs.map(function (e) { return '<li style="padding:9px 0;white-space:pre-line;overflow-wrap:anywhere">' + esc(e.text) + '<small style="display:block;color:var(--soft)">' + esc(e.userName) + '، سُجلت <span class="num">' + esc(e.clientAt) + '</span>' + (e.offline === 'نعم' ? ' <span class="tag warn">بلا إنترنت</span>، ووصلت <span class="num">' + esc(e.serverAt) + '</span>' : '') + '</small></li>'; }).join('') + '</ul>' : '<p class="empty">لا توجد حركات في هذه الفترة.</p>';
    }
    if (R.tab === 'months') h += table(['الشهر', 'المبيعات', 'المستلم'], Object.keys(r.byMonth).sort().reverse().map(function (k) { return ['<span class="num">' + k + '</span>', fmt(r.byMonth[k].sales), fmt(r.byMonth[k].received)]; }));
    return h;
  }

  /* ---------- المزيد والإعدادات ---------- */
  function viewMore() {
    var s = S.settings, h = '<header class="top"><h1>المزيد</h1></header>';
    h += '<section class="section"><h2>حالة الجهاز</h2><p>' + esc(statusInfo().text) + '</p>' + (S.lastSync ? '<p class="hint">آخر اتصال بالدفتر: <span class="num">' + esc(S.lastSync) + '</span></p>' : '') + '<div class="row" style="margin-top:8px"><button class="btn quiet small" data-act="sync-now">إرسال وتحديث الآن</button>' + (S.rejected.length ? '<button class="btn small" data-act="show-rejected">الحركات المرفوضة (' + S.rejected.length + ')</button>' : '') + '</div></section>';
    if (owner()) {
      var tg = s.telegram || {}, bk = s.backup || {};
      h += '<section class="section"><h2>المستخدمون والصلاحيات</h2><p class="hint">أضف البائعين وحدد ما يراه كل منهم.</p><div class="row" style="margin-top:8px"><a class="btn quiet small" href="#users">إدارة المستخدمين</a><button class="btn quiet small" data-act="copy-invite">نسخ رابط التطبيق للموظفين</button></div></section>';
      h += '<section class="section"><h2>بيانات المحل والفاتورة</h2><form id="f-settings" class="stack"><div><label for="s-shop">اسم المحل</label><input class="f" id="s-shop" maxlength="60" value="' + esc(s.shopName) + '"></div><div class="two"><div><label for="s-phone">هاتف المحل</label><input class="f" id="s-phone" dir="ltr" maxlength="30" value="' + esc(s.shopPhone) + '"></div><div><label for="s-cur">العملة</label><input class="f" id="s-cur" maxlength="12" value="' + esc(s.currency) + '"></div></div><div><label for="s-foot">نص أسفل الفاتورة</label><input class="f" id="s-foot" maxlength="120" value="' + esc(s.footer) + '"></div><div><label for="s-paper">عرض ورق الطابعة</label><select class="f" id="s-paper"><option value="80"' + (s.paper !== '58' ? ' selected' : '') + '>80 ملم</option><option value="58"' + (s.paper === '58' ? ' selected' : '') + '>58 ملم</option></select></div><div class="two"><div><label for="s-pct">نسبة زيادة القسط العامة %</label><input class="f" id="s-pct" inputmode="decimal" value="' + esc((s.installment || {}).pct || 0) + '"></div><div><label for="s-base">تُحسب على</label><select class="f" id="s-base"><option value="price"' + ((s.installment || {}).base !== 'profit' ? ' selected' : '') + '>سعر الجهاز</option><option value="profit"' + ((s.installment || {}).base === 'profit' ? ' selected' : '') + '>الربح</option></select></div></div><div><label for="s-limit">أوقف تسجيل الموظف بعد كم ساعة بلا اتصال (0 بلا إيقاف)</label><input class="f" id="s-limit" inputmode="numeric" value="' + esc(s.offlineLimit) + '"></div><button class="btn primary">حفظ البيانات</button></form></section>';
      h += '<section class="section"><h2>إشعارات هاتفك على تيليجرام</h2>';
      if (tg.linked) h += '<p>تعمل على البوت <span class="num">@' + esc(tg.bot) + '</span>. يصلك فيها كل بيع وتسديد، وتقرير يومي في الساعة 9 مساءً.</p><div class="row" style="margin-top:8px"><button class="btn quiet small" data-act="tg-test">إرسال رسالة تجربة</button></div>' + (s.failedNotices ? '<p class="notice" style="margin-top:8px">' + s.failedNotices + ' رسالة لم تصل.</p>' : '');
      else if (tg.hasToken) h += '<p>اضغط «فتح تيليجرام» ثم Start، ثم عد واضغط «تأكيد الربط».</p><div class="row" style="margin-top:8px"><a class="btn small" target="_blank" rel="noopener" href="' + esc(tg.link) + '">فتح تيليجرام</a><button class="btn quiet small" data-act="tg-check">تأكيد الربط</button></div>';
      h += '<form id="f-bot" class="stack" style="margin-top:10px"><div><label for="s-bot">' + (tg.hasToken ? 'تغيير رمز البوت' : 'رمز البوت من BotFather') + '</label><input class="f" id="s-bot" dir="ltr" autocomplete="off" spellcheck="false" placeholder="123456789:AA..."></div><button class="btn quiet">حفظ الرمز</button></form></section>';
      h += '<section class="section"><h2>النسخ الاحتياطي على Google Drive</h2><p>' + (bk.last ? 'آخر نسخة: <span class="num">' + esc(bk.last) + '</span>' : 'لم تؤخذ أي نسخة بعد.') + ' تؤخذ نسخة تلقائيًا كل ليلة، ويُحتفظ بآخر 30 نسخة.</p>' + (bk.error ? '<p class="notice bad" style="margin-top:8px">فشلت آخر نسخة: ' + esc(bk.error) + '</p>' : '') + '<div class="row" style="margin-top:8px"><button class="btn quiet small" data-act="backup">أخذ نسخة الآن</button>' + (bk.folderUrl ? '<a class="btn quiet small" target="_blank" rel="noopener" href="' + esc(bk.folderUrl) + '">فتح المجلد</a>' : '') + (s.sheetUrl ? '<a class="btn quiet small" target="_blank" rel="noopener" href="' + esc(s.sheetUrl) + '">فتح جدول البيانات</a>' : '') + '</div></section>';
    }
    h += '<section class="section"><h2>حسابي</h2><p>' + esc(S.me.name) + ' (<span class="num">' + esc(S.me.username) + '</span>)</p><div class="row" style="margin-top:8px"><button class="btn quiet small" data-act="password">تغيير كلمة المرور</button><button class="btn quiet small" data-act="logout">تسجيل الخروج</button></div></section>';
    return h;
  }
  function viewUsers() {
    if (!owner()) return '<div class="empty"><strong>هذه الصفحة لصاحب المحل فقط</strong></div>';
    var h = '<header class="top"><a class="icon-btn" href="#more" aria-label="رجوع">' + svg('back') + '</a><h1>المستخدمون</h1><button class="btn primary small" data-act="new-user">مستخدم جديد</button></header>';
    if (!S.users) { loadUsers(); return h + '<p class="empty">جارٍ جلب المستخدمين…</p>'; }
    return h + '<ul class="list">' + S.users.map(function (u) {
      var granted = Object.keys(PERM_LABELS).filter(function (p) { return u.perms[p]; }).length;
      return '<li><button class="rowbtn" data-act="edit-user" data-id="' + esc(u.id) + '"><span class="who"><b>' + esc(u.name) + (u.active ? '' : ' <span class="tag bad">موقوف</span>') + '</b><small><span class="num">' + esc(u.username) + '</span>، ' + (u.role === 'owner' ? 'صاحب المحل' : granted + ' من ' + Object.keys(PERM_LABELS).length + ' صلاحيات') + (u.role === 'owner' ? '' : '، آخر اتصال ' + (u.lastSeen ? '<span class="num">' + esc(u.lastSeen) + '</span>' : 'لم يحدث')) + '</small></span></button></li>';
    }).join('') + '</ul>';
  }
  function loadUsers() { api('users.list').then(function (d) { S.users = d.users; softRender(); }).catch(function (e) { S.users = []; toast(e.code === 'net' ? 'إدارة المستخدمين تحتاج إلى إنترنت.' : e.message); softRender(); }); }
  function onlineAct(p, msg) { return p.then(function (d) { if (msg) toast(msg); return sync().then(function () { return d; }); }).catch(function (e) { toast(e.code === 'net' ? 'هذه العملية تحتاج إلى إنترنت.' : e.message); throw e; }); }

  /* ---------- الأحداث ---------- */
  var ACT = {
    go: function (t) { location.hash = t.dataset.to; },
    'gate-retry': loadStatus,
    'gate-url': function () { S.url = ''; gate.error = ''; saveMeta(); renderGate(); },
    'gate-reset': function () { gate.reset = true; gate.error = ''; renderGate(); },
    'gate-reset-off': function () { gate.reset = false; gate.error = ''; renderGate(); },
    'close-sheet': function () { S.sheet = null; S.confirm = null; render(); },
    'confirm-on': function (t) { S.confirm = t.dataset.v; if (S.sheet) { S.sheet.keep = false; } renderSheet(); },
    'confirm-off': function () { S.confirm = null; if (S.sheet) S.sheet.keep = false; renderSheet(); },
    'add-line': function (t) {
      var i = S.view.items[t.dataset.id], c = S.cart, ex = c.lines.filter(function (l) { return l.itemId === i.id; })[0];
      if (ex) ex.qty = String((parseNum(ex.qty) || 0) + 1); else c.lines.push({ itemId: i.id, name: i.name, qty: '1', price: String(officialPrice(i, c.type)) });
      c.itemQ = ''; render();
    },
    qty: function (t) { var l = S.cart.lines[+t.dataset.i], q = (parseNum(l.qty) || 0) + Number(t.dataset.d); if (q > 0) { l.qty = String(q); render(); } },
    'del-line': function (t) { S.cart.lines.splice(+t.dataset.i, 1); render(); },
    'sale-type': function (t) { S.cart.type = t.dataset.v; S.cart.lines.forEach(function (l) { var i = S.view.items[l.itemId]; if (i) l.price = String(officialPrice(i, S.cart.type)); }); render(); },
    'pick-customer': function (t) { S.cart.customerId = t.dataset.id; S.cart.customerQ = ''; render(); },
    'clear-customer': function () { S.cart.customerId = ''; render(); },
    'new-customer': function () { S.sheet = { kind: 'customer', name: S.cart && route().name === 'sell' ? S.cart.customerQ : '', fromSale: route().name === 'sell' }; render(); },
    'save-sale': saveSale,
    'cust-filter': function (t) { S.custFilter = t.dataset.v; render(); },
    'open-customer': function (t) { S.search = ''; location.hash = 'customer-' + t.dataset.id; },
    'edit-customer': function (t) { S.sheet = { kind: 'customer', customerId: t.dataset.id }; render(); },
    'opening-debt': function (t) { S.sheet = { kind: 'opening', customerId: t.dataset.id }; render(); },
    'archive-customer': function (t) { var c = S.view.customers[t.dataset.id]; addOp('customer.save', Object.assign({}, stripLocal(c), { archived: true })); location.hash = 'customers'; toast('أُرشف الزبون.'); },
    'new-payment': function (t) { S.sheet = { kind: 'payment', customerId: t.dataset.id }; render(); },
    'set-amt': function (t) { $('pay-amt').value = t.dataset.v; },
    statement: function (t) { S.sheet = { kind: 'statement', customerId: t.dataset.id }; if (!owner()) logEvent('statement', S.view.customers[t.dataset.id].name); render(); },
    'open-invoice': function (t) { S.sheet = { kind: 'invoice', saleId: t.dataset.id }; render(); },
    'open-payment': function (t) { S.sheet = { kind: 'receipt', paymentId: t.dataset.id }; render(); },
    'print-invoice': function (t) { var s = S.view.sales[t.dataset.id]; if (!owner()) logEvent('print', 'الفاتورة ' + s.no); printHtml(invoiceHtml(s)); },
    'print-payment': function (t) { var p = S.view.payments[t.dataset.id]; if (!owner()) logEvent('print', 'وصل وكشف ' + (p.customerName || '')); printHtml(paymentHtml(p)); },
    'print-statement': function (t) { var c = S.view.customers[t.dataset.id]; if (!owner()) logEvent('print', 'كشف ' + c.name); printHtml(statementHtml(c)); },
    'cancel-sale': function (t) { var r = $('cancel-reason').value.trim(); if (!r) return sheetError('اكتب سبب الإلغاء.'); S.confirm = null; S.sheet = null; addOp('sale.cancel', { id: t.dataset.id, reason: r }); toast('أُلغيت الفاتورة، ووصل تنبيه لصاحب المحل.'); },
    'cancel-payment': function (t) { var r = $('cancel-reason').value.trim(); if (!r) return sheetError('اكتب سبب الإلغاء.'); S.confirm = null; S.sheet = null; addOp('payment.cancel', { id: t.dataset.id, reason: r }); toast('أُلغي التسديد، ووصل تنبيه لصاحب المحل.'); },
    'new-item': function () { S.sheet = { kind: 'item' }; render(); },
    'edit-item': function (t) { S.sheet = { kind: 'item', itemId: t.dataset.id }; render(); },
    stock: function (t) { S.sheet = { kind: 'stock', itemId: t.dataset.id }; render(); },
    'stock-dir': function (t) { S.sheet.out = t.dataset.v === 'out'; S.sheet.keep = false; renderSheet(); },
    'archive-item': function (t) { var i = S.view.items[t.dataset.id]; S.sheet = null; addOp('item.save', Object.assign({}, stripLocal(i), { archived: true })); toast('أُخفي الصنف من البيع.'); },
    'rep-range': function (t) { S.report.key = t.dataset.v; render(); },
    'rep-tab': function (t) { S.report.tab = t.dataset.v; render(); },
    'sync-now': function () { sync().then(function () { toast(S.online ? 'تم التحديث.' : 'لا يوجد اتصال. ستُرسل الحركات عند عودة الإنترنت.'); }); },
    'show-rejected': function () { S.sheet = { kind: 'rejected', focus: false }; render(); },
    'dismiss-rejected': function (t) { S.rejected.splice(+t.dataset.i, 1); saveMeta(); if (!S.rejected.length) S.sheet = null; else S.sheet.keep = false; render(); },
    'copy-invite': function () { copyText(location.href.split('#')[0] + '#connect=' + encodeURIComponent(S.url), 'نُسخ الرابط. أرسله إلى الموظف مع اسم الدخول وكلمة المرور.'); },
    'tg-check': function () { onlineAct(api('telegram.check')).then(function (d) { toast(d.linked ? 'تم ربط هاتفك.' : 'لم تصل ضغطة Start بعد. حاول بعد لحظات.'); }).catch(function () {}); },
    'tg-test': function () { onlineAct(api('telegram.test'), 'أُرسلت رسالة التجربة.').catch(function () {}); },
    backup: function () { toast('جارٍ أخذ النسخة…'); onlineAct(api('backup.now'), 'أُخذت النسخة الاحتياطية.').catch(function () {}); },
    password: function () { S.sheet = { kind: 'password' }; render(); },
    logout: function () {
      if (S.pending.length) { toast('لا يمكن الخروج قبل إرسال ' + S.pending.length + ' حركة. اتصل بالإنترنت أولًا.'); return; }
      api('logout').catch(function () {});
      S.token = ''; S.me = null; S.base = blank(); S.rev = 0; S.lastSyncMs = 0; S.settings = {}; S.users = null; S.cart = null;
      Promise.all([saveMeta(), saveBase()]).then(function () { rebuild(); loadStatus(); });
    },
    'new-user': function () { S.sheet = { kind: 'user' }; render(); },
    'edit-user': function (t) { S.sheet = { kind: 'user', userId: t.dataset.id }; render(); }
  };
  function stripLocal(r) { var o = Object.assign({}, r); delete o.pending; delete o.rev; return o; }
  function copyText(text, ok) {
    var fb = function () { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; document.body.appendChild(ta); ta.select(); var d = false; try { d = document.execCommand('copy'); } catch (e) {} ta.remove(); toast(d ? ok : 'تعذر النسخ: ' + text); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(ok); }, fb); else fb();
  }
  document.addEventListener('click', function (ev) {
    if (ev.target === $('overlay')) { ACT['close-sheet'](); return; }
    var lg = ev.target.closest('[data-log]');
    if (lg && !owner()) logEvent(lg.dataset.log, lg.dataset.subject || '');
    var t = ev.target.closest('[data-act]');
    if (t && ACT[t.dataset.act]) { ev.preventDefault(); ACT[t.dataset.act](t); }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && S.sheet) ACT['close-sheet'](); });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.dataset.preview) itemPreview();
    if (t.id === 'item-q') { S.cart.itemQ = t.value; $('item-pick').innerHTML = itemPick(); }
    else if (t.id === 'cust-q') { S.cart.customerQ = t.value; $('cust-pick').innerHTML = custPick(); }
    else if (t.id === 'cust-search') { S.search = t.value; $('cust-list').innerHTML = custList(); }
    else if (t.id === 'item-search') { S.search = t.value; $('items-list').innerHTML = itemsList(); }
    else if (t.dataset.field) {
      var f = t.dataset.field;
      if (t.dataset.i !== undefined) S.cart.lines[+t.dataset.i][f] = t.value;
      else S.cart[f] = f === 'firstDue' ? fromIso(t.value) : t.value;
      var sum = $('cart-sum'); if (sum) sum.innerHTML = cartSummary(cartTotals());
    }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.dataset.preview) itemPreview();
    if (t.id === 'rep-from') { S.report.from = fromIso(t.value); render(); }
    if (t.id === 'rep-to') { S.report.to = fromIso(t.value); render(); }
  });
  var FORMS = {
    'f-url': function () {
      var u = $('g-url').value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/.+\/exec$/.test(u)) { gate.error = 'العنوان يبدأ بـ https://script.google.com/macros وينتهي بـ /exec. انسخه من نافذة النشر.'; renderGate(); return; }
      S.url = u; gate.error = ''; saveMeta(); loadStatus();
    },
    'f-boot': function () {
      var body = { code: latin($('g-code').value), password: $('g-pass').value };
      if (!gate.reset) { body.username = $('g-user').value; body.name = $('g-name').value; body.shopName = $('g-shop').value; }
      api('bootstrap', body).then(function (d) {
        return api('login', { username: d.username, password: body.password, deviceNo: S.deviceNo }).then(afterLogin);
      }).then(function () { gate.reset = false; gate.needsSetup = false; }).catch(function (e) { gate.error = e.message; renderGate(); });
    },
    'f-login': function () {
      var user = $('g-user').value, pass = $('g-pass').value;
      gate.error = '';
      api('login', { username: user, password: pass, deviceNo: S.deviceNo }).then(function (d) {
        if (S.me && S.pending.length && S.me.id !== d.me.id) { gate.error = 'على هذا الجهاز حركات لم تُرسل تخص حسابًا آخر. سجل الدخول بذلك الحساب أولًا.'; renderGate(); return; }
        return afterLogin(d);
      }).catch(function (e) { gate.error = e.message; renderGate(); });
    },
    'f-customer': function () {
      var st = S.sheet, name = $('cu-name').value.trim(), phone = latin($('cu-phone').value).replace(/[^\d+]/g, '');
      if (!name) return sheetError('اكتب اسم الزبون.');
      if (phone && !/^\+?\d{7,15}$/.test(phone)) return sheetError('رقم الهاتف غير صحيح.');
      var dup = activeCustomers().filter(function (c) { return c.name === name && c.id !== st.customerId; })[0];
      if (dup) return sheetError('يوجد زبون بهذا الاسم. أضف ما يميزه، مثل اسم الأب أو المنطقة.');
      var opening = $('cu-open') ? $('cu-open').value.trim() : '';
      if (opening && !(parseAmount(opening) > 0)) return sheetError('اكتب الدين السابق بالأرقام.');
      var base = st.customerId ? stripLocal(S.view.customers[st.customerId]) : { id: uid('cus') };
      var rec = Object.assign(base, { name: name, phone: phone, address: $('cu-addr').value.trim() });
      var from = st.fromSale;
      S.sheet = null;
      addOp('customer.save', rec);
      if (opening) addOp('sale.create', { id: uid('sal'), no: nextNo(), type: 'opening', customerId: rec.id, customerName: name, date: today(), lines: [{ itemId: '', name: 'دين سابق', qty: 1, price: parseAmount(opening) }] });
      if (from && S.cart) { S.cart.customerId = rec.id; S.cart.customerQ = ''; render(); } else if (!st.customerId) location.hash = 'customer-' + rec.id;
      toast('حُفظ الزبون.');
    },
    'f-opening': function () {
      var st = S.sheet, a = parseAmount($('op-amt').value), c = S.view.customers[st.customerId];
      if (!(a > 0)) return sheetError('اكتب المبلغ بالأرقام.');
      S.sheet = null;
      addOp('sale.create', { id: uid('sal'), no: nextNo(), type: 'opening', customerId: c.id, customerName: c.name, date: today(), lines: [{ itemId: '', name: $('op-note').value.trim() || 'دين سابق', qty: 1, price: a }] });
      toast('أُضيف الدين.');
    },
    'f-payment': function () {
      var st = S.sheet, a = parseAmount($('pay-amt').value), l = ledgerOf(st.customerId), date = fromIso($('pay-date').value);
      if (offlineBlocked()) return sheetError(BLOCK_MSG);
      if (!(a > 0)) return sheetError('اكتب المبلغ بالأرقام.');
      if (a > l.balance) return sheetError('المبلغ أكبر من الدين المتبقي (' + plain(l.balance) + ').');
      if (date > today()) return sheetError('لا يمكن تسجيل تسديد بتاريخ لاحق لليوم.');
      var id = uid('pay');
      S.sheet = { kind: 'receipt', paymentId: id, fresh: true };
      addOp('payment.create', { id: id, no: nextNo(), customerId: st.customerId, customerName: S.view.customers[st.customerId].name, amount: a, date: date, note: $('pay-note').value.trim() });
    },
    'f-item': function () {
      var st = S.sheet, name = $('it-name').value.trim(), price = parseAmount($('it-price').value), cost = parseAmount($('it-cost').value || '0'), low = parseAmount($('it-low').value || '0');
      if (!name) return sheetError('اكتب اسم الصنف.');
      if (price === null) return sheetError('اكتب سعر البيع بالأرقام.');
      if (cost === null) return sheetError('اكتب التكلفة بالأرقام.');
      var inst = itemInstFields();
      if (inst === null) return sheetError('اكتب نسبة القسط أو سعره بالأرقام.');
      if (low === null) return sheetError('اكتب حد التنبيه بالأرقام.');
      var qty = $('it-qty') ? $('it-qty').value.trim() : '';
      if (qty && !(parseNum(qty) > 0)) return sheetError('اكتب الكمية بالأرقام.');
      var rec = Object.assign(st.itemId ? stripLocal(S.view.items[st.itemId]) : { id: uid('itm') }, { name: name, code: latin($('it-code').value.trim()), price: price, cost: cost, lowStock: low }, inst);
      S.sheet = null;
      addOp('item.save', rec);
      if (qty) addOp('stock.move', { id: uid('mov'), itemId: rec.id, qty: parseNum(qty), reason: 'كمية افتتاحية', date: today() });
      toast('حُفظ الصنف.');
    },
    'f-stock': function () {
      var st = S.sheet, q = parseNum($('st-qty').value);
      if (!(q > 0)) return sheetError('اكتب الكمية بالأرقام.');
      S.sheet = null;
      addOp('stock.move', { id: uid('mov'), itemId: st.itemId, qty: st.out ? -q : q, reason: $('st-reason').value.trim(), date: today() });
      toast('حُفظت حركة المخزون.');
    },
    'f-settings': function () {
      var pct = parseNum($('s-pct').value || '0'), lim = parseNum($('s-limit').value || '0');
      if (pct === null || lim === null) { toast('اكتب النسبة وعدد الساعات بالأرقام.'); return; }
      var next = { shopName: $('s-shop').value, shopPhone: $('s-phone').value, currency: $('s-cur').value, footer: $('s-foot').value, paper: $('s-paper').value, offlineLimit: lim, installment: { pct: pct, base: $('s-base').value } };
      onlineAct(api('settings.save', { settings: next }), 'حُفظت البيانات.').catch(function () {});
    },
    'f-bot': function () {
      var v = $('s-bot').value.trim();
      if (!v) { toast('الصق رمز البوت أولًا.'); return; }
      onlineAct(api('settings.save', { settings: { botToken: v } }), 'حُفظ الرمز. اربط هاتفك الآن.').catch(function () {});
    },
    'f-user': function () {
      var st = S.sheet, perms = {};
      document.querySelectorAll('[data-perm]').forEach(function (c) { perms[c.dataset.perm] = c.checked; });
      var body = { id: st.userId || '', name: $('us-name').value, password: $('us-pass').value, perms: perms };
      if (!st.userId) body.username = $('us-user').value;
      if ($('us-active')) body.active = $('us-active').checked;
      api('users.save', { user: body }).then(function (d) { S.users = d.users; S.sheet = null; render(); toast('حُفظ المستخدم.'); })
        .catch(function (e) { sheetError(e.code === 'net' ? 'إدارة المستخدمين تحتاج إلى إنترنت.' : e.message); });
    },
    'f-pass': function () {
      api('password', { current: $('pw-cur').value, next: $('pw-new').value }).then(function () { S.sheet = null; render(); toast('تغيرت كلمة المرور.'); })
        .catch(function (e) { sheetError(e.code === 'net' ? 'تغيير كلمة المرور يحتاج إلى إنترنت.' : e.message); });
    }
  };
  document.addEventListener('submit', function (ev) { ev.preventDefault(); var fn = FORMS[ev.target.id]; if (fn) fn(); });
  window.addEventListener('hashchange', function () {
    var m = /^#connect=(.+)$/.exec(location.hash);
    if (m) { connectFromHash(m[1]); return; }
    S.sheet = null; S.search = ''; if (route().name === 'users') S.users = null; render(); window.scrollTo(0, 0);
  });
  function connectFromHash(v) {
    var u = decodeURIComponent(v);
    history.replaceState(null, '', location.pathname);
    if (S.token) return;
    if (/^https:\/\/script\.google\.com\/macros\/.+\/exec$/.test(u)) { S.url = u; saveMeta(); loadStatus(); }
  }
  window.addEventListener('online', function () { S.online = true; syncSoon(0); });
  window.addEventListener('offline', function () { S.online = false; paintStatus(); softRender(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') syncSoon(0); });
  setInterval(function () { if (document.visibilityState === 'visible' && S.token) sync(); }, 60000);

  /* ---------- البدء ---------- */
  function boot() {
    Promise.all([Store.get('meta'), Store.get('base'), Store.get('pending')]).then(function (r) {
      var m = r[0] || {};
      ['url', 'token', 'me', 'settings', 'rev', 'deviceNo', 'counter', 'rejected', 'lastSync', 'lastSyncMs'].forEach(function (k) { if (m[k] !== undefined) S[k] = m[k]; });
      S.settings = S.settings || {}; S.rejected = S.rejected || [];
      if (r[1]) S.base = Object.assign(blank(), r[1]);
      S.pending = r[2] || [];
      S.online = navigator.onLine !== false;
      var c = /^#connect=(.+)$/.exec(location.hash);
      if (c) connectFromHash(c[1]);
      rebuild();
      if (S.token && S.me) { render(); sync(); } else if (S.url || window.DEMO_BACKEND) { loadStatus(); } else { render(); }
    });
    if ('serviceWorker' in navigator && !window.DEMO_BACKEND) navigator.serviceWorker.register('sw.js').catch(function () {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }
  window.__app = { state: S, api: api, sync: sync, render: render, afterLogin: afterLogin, saveMeta: saveMeta };
  boot();
})();
