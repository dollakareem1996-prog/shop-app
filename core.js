/* المنطق المالي المشترك بين الخادم والتطبيق. أي تعديل هنا يعمل على الطرفين. */
var Core = (function () {
  function int(n) { return Math.round(Number(n) || 0); }
  function isDate(s) {
    var m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function addMonths(date, n) {
    var p = date.split('/').map(Number);
    var y = p[0], mo = p[1] - 1 + n, d = p[2];
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    var dd = Math.min(d, last);
    return y + '/' + (mo + 1 < 10 ? '0' : '') + (mo + 1) + '/' + (dd < 10 ? '0' : '') + dd;
  }
  /** الأقساط مقربة إلى مضاعفات 250 دينارًا، والقسط الأخير يأخذ الفرق حتى يطابق المجموع تمامًا. */
  function buildSchedule(amount, months, firstDue) {
    amount = int(amount); months = int(months);
    if (amount <= 0 || months < 1) return [];
    var base = Math.floor(amount / months / 250) * 250;
    if (base <= 0) base = Math.floor(amount / months);
    var out = [];
    for (var i = 0; i < months; i++) {
      out.push({ due: addMonths(firstDue, i), amount: i === months - 1 ? amount - base * (months - 1) : base });
    }
    return out.filter(function (e) { return e.amount > 0; });
  }
  function linesTotal(lines) {
    return int((lines || []).reduce(function (s, l) { return s + Number(l.qty) * Number(l.price); }, 0));
  }
  /** يحسب المجاميع والجدول من مدخلات البيع، فلا يعتمد الخادم على أرقام يرسلها الجهاز. */
  function normalizeSale(p) {
    var lines = (p.lines || []).map(function (l) {
      var line = { itemId: String(l.itemId || ''), name: String(l.name || ''), qty: Number(l.qty), price: int(l.price) };
      if (l.cost !== undefined && l.cost !== null) line.cost = int(l.cost);
      return line;
    });
    var type = p.type;
    if (['cash', 'installment', 'opening'].indexOf(type) < 0) throw new Error('نوع البيع غير معروف.');
    if (!isDate(p.date)) throw new Error('تاريخ البيع غير صحيح.');
    if (!lines.length) throw new Error('الفاتورة بلا أصناف.');
    lines.forEach(function (l) {
      if (!(l.qty > 0) || l.price < 0) throw new Error('الكمية أو السعر غير صحيح.');
    });
    var discount = int(p.discount);
    if (discount < 0) throw new Error('الخصم غير صحيح.');
    var total = linesTotal(lines) - discount;
    if (total < 0) throw new Error('الخصم أكبر من قيمة الفاتورة.');
    var rec = {
      id: p.id, no: String(p.no || ''), customerId: String(p.customerId || ''), customerName: String(p.customerName || ''),
      type: type, date: p.date, lines: lines, discount: discount, total: total, down: 0, months: 0, firstDue: '',
      schedule: [], note: String(p.note || '').slice(0, 200)
    };
    if (type === 'cash') {
      rec.down = total;
    } else {
      if (!rec.customerId) throw new Error('البيع بالأقساط يحتاج إلى زبون.');
      if (type === 'opening') {
        // الدين القديم: مبلغ واحد، أو أقساط متبقية تبدأ من تاريخ القسط القادم
        var om = int(p.months);
        if (om >= 1 && om <= 60 && isDate(p.firstDue)) { rec.months = om; rec.firstDue = String(p.firstDue); rec.schedule = buildSchedule(total, om, rec.firstDue); }
        else rec.schedule = [{ due: p.date, amount: total }];
      } else {
        rec.down = int(p.down);
        rec.months = int(p.months);
        rec.firstDue = String(p.firstDue || '');
        if (rec.down < 0 || rec.down > total) throw new Error('المقدمة يجب ألا تتجاوز قيمة الفاتورة.');
        if (rec.months < 1 || rec.months > 60) throw new Error('عدد الأشهر يجب أن يكون بين 1 و60.');
        if (!isDate(rec.firstDue)) throw new Error('تاريخ أول قسط غير صحيح.');
        rec.schedule = buildSchedule(total - rec.down, rec.months, rec.firstDue);
      }
    }
    return rec;
  }
  /** سعر القسط: مبلغ ثابت، أو نسبة على سعر النقد أو على الربح، لكل صنف أو حسب النسبة العامة. */
  function instPrice(it, def) {
    def = def || {};
    var mode = it.instMode || 'default', price = int(it.price);
    if (mode === 'fixed') return int(it.instFixed);
    var pct = Number(mode === 'pct' ? it.instPct : def.pct) || 0;
    var base = (mode === 'pct' ? it.instBase : def.base) || 'price';
    if (!pct) return price;
    var add = base === 'profit' ? Math.max(price - int(it.cost), 0) * pct / 100 : price * pct / 100;
    return Math.round((price + add) / 250) * 250;
  }
  function saleProfit(s) {
    if (s.cancelled || s.type === 'opening') return 0;
    var known = s.lines.every(function (l) { return l.cost !== undefined; });
    if (!known) return null;
    return int(s.lines.reduce(function (a, l) { return a + (l.price - l.cost) * l.qty; }, 0)) - int(s.discount);
  }
  function values(map) { return Object.keys(map || {}).map(function (k) { return map[k]; }); }

  /** يوزع التسديدات على الأقساط من الأقدم استحقاقًا، ويعيد حساب كل زبون. */
  function buildLedgers(state, today) {
    var out = {};
    function get(id) { return out[id] = out[id] || { customerId: id, entries: [], payments: [], debts: 0, paid: 0, balance: 0, overdue: 0, credit: 0, nextDue: '' }; }
    values(state.sales).forEach(function (s) {
      if (s.cancelled || !s.customerId) return;
      var l = get(s.customerId);
      (s.schedule || []).forEach(function (e, i) {
        l.entries.push({ saleId: s.id, saleNo: s.no, index: i, due: e.due, amount: e.amount, paid: 0, rem: e.amount, createdAt: s.createdAt || '' });
        l.debts += e.amount;
      });
    });
    values(state.payments).forEach(function (p) {
      if (p.cancelled || !p.customerId) return;
      var l = get(p.customerId);
      l.payments.push(p);
      l.paid += p.amount;
    });
    Object.keys(out).forEach(function (id) {
      var l = out[id];
      l.entries.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.index - b.index); });
      l.payments.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt < b.createdAt ? -1 : 1); });
      var pool = l.paid;
      l.entries.forEach(function (e) {
        var take = Math.min(pool, e.amount);
        e.paid = take; e.rem = e.amount - take; pool -= take;
        e.overdue = e.rem > 0 && e.due < today;
        if (e.overdue) l.overdue += e.rem;
        if (e.rem > 0 && !l.nextDue) l.nextDue = e.due;
      });
      l.balance = l.debts - l.paid;
      l.credit = l.balance < 0 ? -l.balance : 0;
    });
    return out;
  }
  function stockLevels(state) {
    var out = {};
    values(state.moves).forEach(function (m) { out[m.itemId] = (out[m.itemId] || 0) + Number(m.qty); });
    values(state.sales).forEach(function (s) {
      if (s.cancelled) return;
      (s.lines || []).forEach(function (l) { if (l.itemId) out[l.itemId] = (out[l.itemId] || 0) - Number(l.qty); });
    });
    Object.keys(out).forEach(function (k) { out[k] = Math.round(out[k] * 1000) / 1000; });
    return out;
  }
  /** تقرير فترة: الربح يبقى null إذا لم تصل التكلفة إلى هذا الجهاز بسبب الصلاحية. */
  function report(state, from, to, today) {
    var r = { sales: 0, cashSales: 0, installmentSales: 0, downs: 0, payments: 0, received: 0, profit: 0, discount: 0, count: 0, cancelled: 0, byMonth: {}, byItem: {}, bySeller: {}, saleList: [], paymentList: [] };
    var inRange = function (d) { return d >= from && d <= to; };
    values(state.sales).forEach(function (s) {
      if (!inRange(s.date)) return;
      r.saleList.push(s);
      if (s.cancelled) { r.cancelled++; return; }
      if (s.type === 'opening') return;
      r.count++; r.sales += s.total; r.discount += s.discount;
      if (s.type === 'cash') r.cashSales += s.total; else { r.installmentSales += s.total; r.downs += s.down; }
      var pr = saleProfit(s);
      if (pr === null) r.profit = null; else if (r.profit !== null) r.profit += pr;
      var mk = s.date.slice(0, 7);
      var m = r.byMonth[mk] = r.byMonth[mk] || { sales: 0, received: 0 };
      m.sales += s.total; m.received += s.down;
      s.lines.forEach(function (l) {
        var it = r.byItem[l.name] = r.byItem[l.name] || { qty: 0, total: 0 };
        it.qty += l.qty; it.total += int(l.qty * l.price);
      });
      var who = s.createdByName || 'غير معروف';
      var sl = r.bySeller[who] = r.bySeller[who] || { sales: 0, count: 0 };
      sl.sales += s.total; sl.count++;
    });
    values(state.payments).forEach(function (p) {
      if (!inRange(p.date)) return;
      r.paymentList.push(p);
      if (p.cancelled) return;
      r.payments += p.amount;
      var mk = p.date.slice(0, 7);
      var m = r.byMonth[mk] = r.byMonth[mk] || { sales: 0, received: 0 };
      m.received += p.amount;
    });
    r.received = r.cashSales + r.downs + r.payments;
    var led = buildLedgers(state, today);
    r.outstanding = 0; r.overdue = 0; r.overdueCustomers = 0;
    Object.keys(led).forEach(function (k) {
      r.outstanding += Math.max(led[k].balance, 0);
      if (led[k].overdue > 0) { r.overdue += led[k].overdue; r.overdueCustomers++; }
    });
    var sortD = function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1); };
    r.saleList.sort(sortD); r.paymentList.sort(sortD);
    return r;
  }
  /** يطبق عملية على نسخة الجهاز. الخادم يعيد التحقق ويقرر النتيجة النهائية. */
  function applyOp(state, op, me) {
    var p = op.payload, stamp = { createdAt: op.createdAt, createdBy: me.id, createdByName: me.name, pending: true };
    var put = function (table, rec) { state[table][rec.id] = rec; };
    switch (op.type) {
      case 'customer.save': put('customers', Object.assign({}, state.customers[p.id] || stamp, p, { pending: true })); break;
      case 'item.save': { var it = Object.assign({}, state.items[p.id] || stamp, p, { pending: true }); it.instPrice = instPrice(it, me.instDefault); put('items', it); break; }
      case 'log.event': break;
      case 'stock.move': put('moves', Object.assign({}, stamp, p)); break;
      case 'sale.create': {
        var rec = normalizeSale(Object.assign({}, p, {
          lines: (p.lines || []).map(function (l) {
            var it = state.items[l.itemId];
            return Object.assign({}, l, it && it.cost !== undefined ? { cost: it.cost } : {});
          })
        }));
        put('sales', Object.assign({}, stamp, rec));
        break;
      }
      case 'sale.cancel': if (state.sales[p.id]) put('sales', Object.assign({}, state.sales[p.id], { cancelled: true, pending: true })); break;
      case 'payment.create': put('payments', Object.assign({}, stamp, p, { amount: int(p.amount) })); break;
      case 'payment.cancel': if (state.payments[p.id]) put('payments', Object.assign({}, state.payments[p.id], { cancelled: true, pending: true })); break;
      default: throw new Error('عملية غير معروفة.');
    }
  }
  return { int: int, isDate: isDate, addMonths: addMonths, buildSchedule: buildSchedule, instPrice: instPrice, normalizeSale: normalizeSale, saleProfit: saleProfit, buildLedgers: buildLedgers, stockLevels: stockLevels, report: report, applyOp: applyOp, values: values };
})();
if (typeof module !== 'undefined') module.exports = Core;
