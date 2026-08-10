/* =========================================================================
   Dashboard Dr. Vinicius — Tráfego pago (MENSAGEM/CTWA + LP + faturamento)
   3 abas: Visão Geral · Tráfego Pago · Relatório.
   Dados: window.DASH (data.js) — daily[] (funil/dia) + grain[] (dia × anúncio) + fin[] (faturamento/dia).
   Fonte 1: Meta Graph API (insights nível anúncio). Resultado-headline = CONVERSAS (CTWA).
   Programar (Schedule/LP) e Leads (formulário) = secundários. Fonte 3: planilha das secretárias.
   CTR sempre de LINK. Imposto ×1,1385 sobre todo gasto.
   ========================================================================= */
(function () {
  "use strict";
  var D = window.DASH || {};
  var arr = function (x) { return Array.isArray(x) ? x : (x ? [x] : []); };
  var daily = arr(D.daily).slice().sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
  var grain = arr(D.grain);
  var finAll = arr(D.fin);
  var TAX = D.tax || 1.1385;

  /* ---------------------------------------------------------------- formato */
  var nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nf4 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
  function ok(v) { return v !== null && v !== undefined && isFinite(v); }
  function money(v) { return (v < 0 ? '−R$ ' : 'R$ ') + nf2.format(Math.abs(v || 0)); }
  function money0(v) { return (v < 0 ? '−R$ ' : 'R$ ') + nf0.format(Math.round(Math.abs(v || 0))); }
  function int(v) { return nf0.format(Math.round(v || 0)); }
  function pct1(v) { return nf1.format((v || 0) * 100) + '%'; }
  function roasStr(v) { return ok(v) ? nf1.format(v) + '×' : '—'; }
  function taxStr(v) { return nf4.format(v || 1); }
  var M = {
    money: function (v) { return ok(v) ? money(v) : '—'; },
    money0: function (v) { return ok(v) ? money0(v) : '—'; },
    int: function (v) { return ok(v) ? int(v) : '—'; },
    pct1: function (v) { return ok(v) ? pct1(v) : '—'; },
    roas: function (v) { return roasStr(v); }
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function $(id) { return document.getElementById(id); }
  function div(a, b) { return b > 0 ? a / b : null; }

  function dayAdd(ds, n) { var p = ds.split('-'); var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
  function brDate(ds) { var p = ds.split('-'); return p[2] + '/' + p[1]; }
  function brFull(ds) { var p = ds.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function diffDays(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5); }

  /* ---------------------------------------------------------------- período */
  var minDate = daily.length ? daily[0].d : '2026-01-01';
  var maxDate = daily.length ? daily[daily.length - 1].d : '2026-01-01';
  function firstOfMonth(ds) { return ds.slice(0, 7) + '-01'; }
  function clampD(ds) { return ds < minDate ? minDate : (ds > maxDate ? maxDate : ds); }

  var STATE = {
    from: minDate, to: maxDate, preset: 'all', compare: true, tab: 'overview',
    metric: 'spend', treeSort: { key: 'spend', dir: -1 }, expanded: {}, camps: null, campGroup: 'all'
  };
  var CAMP_SPEND = {}; grain.forEach(function (g) { CAMP_SPEND[g.camp] = (CAMP_SPEND[g.camp] || 0) + g.spend; });
  var ALL_CAMPS = Object.keys(CAMP_SPEND).sort(function (a, b) { return CAMP_SPEND[b] - CAMP_SPEND[a]; });
  // grupo de campanha (abas): quiz = Leads/LP · msg = Mensagens · seg = Topo/Seguidores
  var GROUP_LABEL = { all: 'Todas as campanhas', quiz: 'Quiz (E2 · Cap Leads)', msg: 'Mensagem (E2 · Cap ENGJ)', seg: 'Seguidores (E1 · Dist)' };
  function groupOf(c) { var f = funnelOf(c); return f === 'Leads/LP' ? 'quiz' : f === 'Mensagens' ? 'msg' : f === 'Topo' ? 'seg' : 'other'; }
  function campOK(c) { if (STATE.campGroup && STATE.campGroup !== 'all' && groupOf(c) !== STATE.campGroup) return false; return !STATE.camps || STATE.camps[c] === true; }
  function campFilterActive() { return !!(STATE.campGroup && STATE.campGroup !== 'all') || !!STATE.camps; }
  function campSelectedCount() { return STATE.camps ? Object.keys(STATE.camps).filter(function (k) { return STATE.camps[k]; }).length : ALL_CAMPS.length; }

  /* ---------------------------------------------------------------- objetivo da campanha */
  function funnelOf(camp) {
    var c = String(camp || '').toUpperCase();
    if (/\bLEAD/.test(c) || c.indexOf('FORM') >= 0 || c.indexOf(' LP') >= 0 || c.indexOf('QUIZ') >= 0) return 'Leads/LP';
    if (/ALCANCE|ALCAN|PERFIL|VISIT|TOPO|SEGUID/.test(c)) return 'Topo';
    if (/\bENGJ?\b|WHATS|MENSAG|MSG|DIRECT|CTWA|CONVERSA/.test(c)) return 'Mensagens';
    return 'Outros';
  }
  function within(d, from, to) { return d >= from && d <= to; }

  /* ---------------------------------------------------------------- agregação (mídia) */
  function blank() { return { spend: 0, impr: 0, reach: 0, clk: 0, conv: 0, reply: 0, lead: 0, sched: 0 }; }
  function derive(t) {
    var o = Object.assign({}, t);
    o.cpm = div(t.spend * 1000, t.impr);
    o.ctr = div(t.clk, t.impr);            // CTR de LINK
    o.cpc = div(t.spend, t.clk);
    o.cpConv = div(t.spend, t.conv);       // custo por conversa (headline)
    o.cpLead = div(t.spend, t.lead);       // custo por lead (secundário)
    o.cpSched = div(t.spend, t.sched);     // custo por Programar (secundário)
    o.convRate = div(t.conv, t.clk);       // clique → conversa
    o.replyRate = div(t.reply, t.conv);    // conversas que responderam
    o.result = t.conv || 0;                // resultado-headline = conversas
    return o;
  }
  function aggregate(from, to) {
    var t = blank();
    for (var i = 0; i < grain.length; i++) {
      var g = grain[i]; if (!within(g.d, from, to)) continue; if (!campOK(g.camp)) continue;
      t.spend += g.spend; t.impr += g.impr; t.reach += g.reach; t.clk += g.clk;
      t.conv += g.conv; t.reply += g.reply; t.lead += g.lead; t.sched += g.sched;
    }
    return derive(t);
  }
  function dailyRows(from, to) {
    var md = {};
    for (var j = 0; j < grain.length; j++) {
      var g = grain[j]; if (!within(g.d, from, to)) continue; if (!campOK(g.camp)) continue;
      var m = md[g.d] || (md[g.d] = blank());
      m.spend += g.spend; m.impr += g.impr; m.reach += g.reach; m.clk += g.clk;
      m.conv += g.conv; m.reply += g.reply; m.lead += g.lead; m.sched += g.sched;
    }
    var out = [];
    for (var i = 0; i < daily.length; i++) {
      var x = daily[i]; if (!within(x.d, from, to)) continue;
      var m = md[x.d]; if (!m) { if (campFilterActive()) continue; m = Object.assign(blank(), { spend: x.spend, impr: x.impr, reach: x.reach, clk: x.clk, conv: x.conv, reply: x.reply, lead: x.lead, sched: x.sched }); }
      out.push(derive(Object.assign(blank(), { d: x.d }, m)));
    }
    return out;
  }

  /* ---------------------------------------------------------------- faturamento (secretárias) */
  function finAgg(from, to) {
    var o = { agend: 0, cirurg: 0, fatCon: 0, fatCir: 0, fatTot: 0, dias: 0 };
    for (var i = 0; i < finAll.length; i++) {
      var f = finAll[i]; if (!within(f.d, from, to)) continue;
      o.agend += (f.agend || 0); o.cirurg += (f.cirurg || 0);
      o.fatCon += (f.fatCon || 0); o.fatCir += (f.fatCir || 0); o.fatTot += (f.fatTot || 0); o.dias++;
    }
    return o;
  }
  var HAS_FIN = finAll.length > 0;

  /* ---------------------------------------------------------------- agregação por grupo de campanha */
  function aggregateGroup(grp, from, to) {
    var t = blank();
    for (var i = 0; i < grain.length; i++) {
      var g = grain[i]; if (!within(g.d, from, to)) continue; if (groupOf(g.camp) !== grp) continue;
      t.spend += g.spend; t.impr += g.impr; t.reach += g.reach; t.clk += g.clk;
      t.conv += g.conv; t.reply += g.reply; t.lead += g.lead; t.sched += g.sched;
    }
    return derive(t);
  }

  /* ---------------------------------------------------------------- leads do quiz (planilha ao vivo, gviz) */
  var LEADS_SHEET = '1tFaH49FCD2egRPjbzKP8_KixwXyyRjhMyOONSiLpR2I';
  var LEADS_GID = '0';
  var LEADS = null;   // null=carregando · {error:true} · {rows:[{d,prio,pts}]}
  function parseCSV(text) {
    var rows = [], row = [], cur = '', inQ = false, ch;
    for (var i = 0; i < text.length; i++) {
      ch = text[i];
      if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function normPrio(s) { s = String(s || '').trim().toLowerCase(); if (s.indexOf('alta') >= 0) return 'alta'; if (s.indexOf('méd') >= 0 || s.indexOf('med') >= 0) return 'media'; if (s.indexOf('baix') >= 0) return 'baixa'; return ''; }
  function leadDate(s) {
    s = String(s || '').trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);   // planilha pt-BR: D/M/Y
    if (m) { return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2); }
    return '';
  }
  function fetchLeads(cb) {
    var url = 'https://docs.google.com/spreadsheets/d/' + LEADS_SHEET + '/gviz/tq?tqx=out:csv&gid=' + LEADS_GID + '&_=' + Date.now();
    fetch(url).then(function (r) { return r.text(); }).then(function (t) {
      var rows = parseCSV(t), out = [];
      for (var i = 1; i < rows.length; i++) {           // pula cabeçalho
        var r = rows[i]; if (!r || r.length < 5) continue;
        var nome = String(r[1] || '').trim();
        if (/^teste/i.test(nome)) continue;             // ignora linhas de teste
        out.push({ d: leadDate(r[0]), prio: normPrio(r[3]), pts: +String(r[4] || '').replace(/[^\d]/g, '') || 0 });
      }
      LEADS = { rows: out };
      cb && cb();
    }).catch(function () { LEADS = { error: true }; cb && cb(); });
  }
  function leadsAgg(from, to, all) {
    var o = { total: 0, alta: 0, media: 0, baixa: 0, sem: 0 };
    if (!LEADS || !LEADS.rows) return o;
    LEADS.rows.forEach(function (r) {
      if (!all) { if (!r.d) return; if (r.d < from || r.d > to) return; }
      o.total++;
      if (r.prio === 'alta') o.alta++; else if (r.prio === 'media') o.media++; else if (r.prio === 'baixa') o.baixa++; else o.sem++;
    });
    return o;
  }

  /* ---------------------------------------------------------------- régua de benchmarks (Leandro) */
  var BANDS = {
    ctr: { label: 'CTR (link)', good: 0.01, mid: 0.006, dir: 'high', fmt: M.pct1 },
    cpc: { label: 'CPC', good: 2, mid: 4, dir: 'low', fmt: M.money },
    cpm: { label: 'CPM', good: 35, mid: 60, dir: 'low', fmt: M.money }
  };
  function statusOf(v, b) {
    if (!ok(v)) return null;
    var lvl;
    if (b.dir === 'high') lvl = v >= b.good ? 'good' : v >= b.mid ? 'warn' : 'bad';
    else lvl = v <= b.good ? 'good' : v <= b.mid ? 'warn' : 'bad';
    var word = lvl === 'good' ? 'bom' : lvl === 'warn' ? 'médio' : 'ruim';
    var cls = lvl === 'good' ? 'g' : lvl === 'warn' ? 'y' : 'r';
    return { lvl: lvl, word: word, cls: cls };
  }
  function scoreOf(v, b) {
    if (!ok(v)) return null;
    if (b.dir === 'high') {
      if (v >= b.good) return 100;
      if (v >= b.mid) return 60 + (v - b.mid) / (b.good - b.mid) * 30;
      return Math.max(5, v / b.mid * 55);
    } else {
      if (v <= b.good) return 100;
      if (v <= b.mid) return 60 + (b.mid - v) / (b.mid - b.good) * 30;
      return Math.max(5, 55 - (v - b.mid) / b.mid * 55);
    }
  }
  var scoreColor = function (s) { return s == null ? 'var(--ink-3)' : s >= 75 ? 'var(--good)' : s >= 50 ? 'var(--warning)' : 'var(--critical)'; };
  var bandLabel = function (s) { return s == null ? 'sem dados' : s >= 80 ? 'Saudável' : s >= 60 ? 'Bom' : s >= 40 ? 'Atenção' : 'Crítico'; };

  var HEALTH_KEYS = ['ctr', 'cpc', 'cpm'];
  function health(a) {
    var bars = HEALTH_KEYS.map(function (k) {
      var b = BANDS[k], v = a[k], sc = scoreOf(v, b);
      return { label: b.label, valueStr: b.fmt(v), score: sc, band: b, cls: (statusOf(v, b) || {}).cls };
    });
    var valid = bars.filter(function (b) { return b.score != null; });
    var score = valid.length ? Math.round(valid.reduce(function (s, b) { return s + b.score; }, 0) / valid.length) : null;
    return { score: score, band: bandLabel(score), bars: bars };
  }

  /* ---------------------------------------------------------------- SVG helpers */
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(n, at) { var e = document.createElementNS(NS, n); for (var k in at) e.setAttribute(k, at[k]); return e; }
  function niceMax(v) { if (!(v > 0)) return 1; var e = Math.pow(10, Math.floor(Math.log10(v))); var f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }
  function ticks(max, n) { n = n || 4; var out = []; for (var i = 0; i <= n; i++) out.push(max * i / n); return out; }
  function labelStep(count, width) { return Math.max(1, Math.ceil(count / Math.max(2, Math.floor(width / 58)))); }

  var TIP = null;
  function showTip(html, ev) {
    TIP.innerHTML = html; TIP.style.opacity = 1;
    var r = TIP.getBoundingClientRect();
    var x = ev.clientX + 14, y = ev.clientY - r.height - 12;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y < 8) y = ev.clientY + 18;
    TIP.style.left = x + 'px'; TIP.style.top = y + 'px';
  }
  function hideTip() { TIP.style.opacity = 0; }

  function comboChart(host, rows, cfg) {
    host.innerHTML = '';
    var W = Math.max(300, host.clientWidth || 520), H = 240;
    var P = { t: 22, r: 50, b: 28, l: 56 }, iw = W - P.l - P.r, ih = H - P.t - P.b, n = rows.length;
    var svg = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img' });
    var leftMax = niceMax(Math.max.apply(null, rows.flatMap(function (r) { return cfg.bars.map(function (b) { return r[b.key] || 0; }); }).concat([0])));
    var rightVals = rows.map(function (r) { return r[cfg.line.key]; }).filter(ok);
    var rightMax = niceMax(Math.max.apply(null, rightVals.concat([0])));
    var yL = function (v) { return P.t + ih - (leftMax > 0 ? (v / leftMax) * ih : 0); };
    var yR = function (v) { return P.t + ih - (rightMax > 0 ? (v / rightMax) * ih : 0); };
    ticks(leftMax).forEach(function (t) { svg.appendChild(svgEl('line', { class: 'gl', x1: P.l, x2: P.l + iw, y1: yL(t), y2: yL(t) })); var tx = svgEl('text', { x: P.l - 7, y: yL(t) + 4, 'text-anchor': 'end' }); tx.textContent = cfg.leftFmt(t); svg.appendChild(tx); });
    ticks(rightMax).forEach(function (t) { var tx = svgEl('text', { x: P.l + iw + 7, y: yR(t) + 4, 'text-anchor': 'start' }); tx.textContent = cfg.rightFmt(t); svg.appendChild(tx); });
    svg.appendChild(svgEl('line', { class: 'ax', x1: P.l, x2: P.l + iw, y1: P.t + ih, y2: P.t + ih }));
    var slot = iw / Math.max(1, n), nb = cfg.bars.length;
    var groupW = Math.min(slot - 3, nb > 1 ? 40 : 30), bw = Math.max(2, groupW / nb - 1), step = labelStep(n, iw);
    rows.forEach(function (r, i) {
      var cx = P.l + slot * i + slot / 2;
      cfg.bars.forEach(function (b, bi) {
        var v = r[b.key] || 0, h = Math.max(v > 0 ? 1.5 : 0, P.t + ih - yL(v));
        var x = cx - groupW / 2 + bi * (groupW / nb) + (groupW / nb - bw) / 2;
        if (h > 0) svg.appendChild(svgEl('rect', { x: x, y: P.t + ih - h, width: bw, height: h, fill: b.color, rx: Math.min(3, bw / 2) }));
      });
      if (i % step === 0 || i === n - 1) { var tx = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }); tx.textContent = brDate(r.d); svg.appendChild(tx); }
    });
    var pts = rows.map(function (r, i) { var v = r[cfg.line.key]; return ok(v) ? [P.l + slot * i + slot / 2, yR(v), v] : null; });
    var seg = [], segs = [];
    pts.forEach(function (p) { if (p) seg.push(p); else if (seg.length) { segs.push(seg); seg = []; } }); if (seg.length) segs.push(seg);
    segs.forEach(function (s) { var d = s.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' '); svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: cfg.line.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })); });
    if (n <= 45) pts.forEach(function (p) { if (p) svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 3.2, fill: cfg.line.color, stroke: 'var(--card)', 'stroke-width': 1.5 })); });
    var cross = svgEl('line', { class: 'cross', y1: P.t, y2: P.t + ih }); svg.appendChild(cross);
    var hit = svgEl('rect', { class: 'hit', x: P.l, y: P.t, width: iw, height: ih });
    hit.addEventListener('mousemove', function (ev) {
      var box = svg.getBoundingClientRect();
      var i = Math.max(0, Math.min(n - 1, Math.floor((((ev.clientX - box.left) / box.width) * W - P.l) / slot)));
      var r = rows[i], cx = P.l + slot * i + slot / 2;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.opacity = 1;
      var html = '<b>' + brFull(r.d) + '</b>';
      cfg.bars.forEach(function (b) { html += '<div class="r"><em><i style="background:' + b.color + '"></i>' + b.name + '</em><strong>' + cfg.leftFmt(r[b.key] || 0) + '</strong></div>'; });
      html += '<div class="r"><em><i style="background:' + cfg.line.color + '"></i>' + cfg.line.name + '</em><strong>' + cfg.lineFmt(r[cfg.line.key]) + '</strong></div>';
      showTip(html, ev);
    });
    hit.addEventListener('mouseleave', function () { cross.style.opacity = 0; hideTip(); });
    svg.appendChild(hit);
    host.appendChild(svg);
  }

  function lineChart(host, labels, series, fmt) {
    host.innerHTML = '';
    var W = Math.max(320, host.clientWidth || 900), H = 240;
    var P = { t: 16, r: 14, b: 28, l: 64 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
    var svg = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img' });
    var all = series.flatMap(function (s) { return s.values.filter(ok); });
    var max = niceMax(Math.max.apply(null, all.concat([0])));
    var n = labels.length;
    var x = function (i) { return n === 1 ? P.l + iw / 2 : P.l + (iw * i) / (n - 1); };
    var y = function (v) { return P.t + ih - (max > 0 ? (v / max) * ih : 0); };
    ticks(max).forEach(function (t) { svg.appendChild(svgEl('line', { class: 'gl', x1: P.l, x2: P.l + iw, y1: y(t), y2: y(t) })); var tx = svgEl('text', { x: P.l - 8, y: y(t) + 4, 'text-anchor': 'end' }); tx.textContent = fmt(t); svg.appendChild(tx); });
    svg.appendChild(svgEl('line', { class: 'ax', x1: P.l, x2: P.l + iw, y1: P.t + ih, y2: P.t + ih }));
    var step = labelStep(n, iw);
    labels.forEach(function (lb, i) { if (i % step === 0 || i === n - 1) { var tx = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }); tx.textContent = lb; svg.appendChild(tx); } });
    series.forEach(function (s) {
      var pts = s.values.map(function (v, i) { return [x(i), y(v || 0)]; });
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      var path = svgEl('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      if (s.dashed) path.setAttribute('stroke-dasharray', '5 4');
      svg.appendChild(path);
      if (n <= 40) pts.forEach(function (p) { svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 4, fill: s.color, stroke: 'var(--card)', 'stroke-width': 2 })); });
    });
    var cross = svgEl('line', { class: 'cross', y1: P.t, y2: P.t + ih }); svg.appendChild(cross);
    var hit = svgEl('rect', { class: 'hit', x: P.l - 4, y: P.t, width: iw + 8, height: ih });
    hit.addEventListener('mousemove', function (ev) {
      var box = svg.getBoundingClientRect();
      var rel = ((ev.clientX - box.left) / box.width) * W;
      var i = Math.max(0, Math.min(n - 1, Math.round(n === 1 ? 0 : ((rel - P.l) / iw) * (n - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.opacity = 1;
      showTip('<b>' + (series[0].fullLabels ? series[0].fullLabels[i] : labels[i]) + '</b>' +
        series.map(function (s) { return '<div class="r"><em><i style="background:' + s.color + '"></i>' + s.name + '</em><strong>' + fmt(s.values[i]) + '</strong></div>'; }).join(''), ev);
    });
    hit.addEventListener('mouseleave', function () { cross.style.opacity = 0; hideTip(); });
    svg.appendChild(hit);
    host.appendChild(svg);
  }

  function gauge(score, colorVar) {
    var s = ok(score) ? score : 0, r = 54, c = 2 * Math.PI * r, off = c * (1 - s / 100);
    var disp = ok(score) ? Math.round(score) : '—';
    return '<div class="gauge"><svg viewBox="0 0 132 132" width="132" height="132">' +
      '<circle cx="66" cy="66" r="' + r + '" fill="none" stroke="var(--plane)" stroke-width="12"/>' +
      '<circle cx="66" cy="66" r="' + r + '" fill="none" stroke="' + colorVar + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/>' +
      '</svg><div class="gv"><b>' + disp + '</b><span>de 100</span></div></div>';
  }

  /* ---------------------------------------------------------------- deltas */
  function miniDelta(cur, prev, better) {
    if (!STATE.compare || !ok(prev) || prev === 0 || !ok(cur)) return '<span class="flat">—</span>';
    var ch = (cur - prev) / Math.abs(prev);
    var ar = Math.abs(ch) < 0.0005 ? '→' : (ch > 0 ? '▲' : '▼');
    var cls;
    if (better === null) cls = 'flat';
    else { var bad = better === false; cls = Math.abs(ch) < 0.0005 ? 'flat' : ((ch > 0) !== bad ? 'up' : 'down'); }
    return '<span class="' + cls + '">' + ar + ' ' + nf1.format(Math.abs(ch) * 100) + '%</span>';
  }

  /* ---------------------------------------------------------------- árvore campanha › conjunto › anúncio */
  function tblank(label) { return { label: label, spend: 0, impr: 0, reach: 0, clk: 0, conv: 0, reply: 0, lead: 0, sched: 0, kids: {} }; }
  var RAW = ['spend', 'impr', 'reach', 'clk', 'conv', 'reply', 'lead', 'sched'];
  function tderive(t) {
    var o = Object.assign({}, t);
    o.cpm = div(t.spend * 1000, t.impr); o.ctr = div(t.clk, t.impr); o.cpc = div(t.spend, t.clk);
    o.cpConv = div(t.spend, t.conv); o.cpLead = div(t.spend, t.lead); o.cpSched = div(t.spend, t.sched);
    o.convRate = div(t.conv, t.clk);
    return o;
  }
  function accum(a, g) { for (var i = 0; i < RAW.length; i++) { a[RAW[i]] += g[RAW[i]]; } }
  function buildTree(from, to) {
    var root = {};
    for (var i = 0; i < grain.length; i++) {
      var g = grain[i]; if (!within(g.d, from, to)) continue; if (!campOK(g.camp)) continue;
      var c = root[g.camp] || (root[g.camp] = tblank(g.camp));
      var s = c.kids[g.adset] || (c.kids[g.adset] = tblank(g.adset));
      var a = s.kids[g.ad] || (s.kids[g.ad] = tblank(g.ad));
      accum(a, g);
    }
    function roll(node, key, level) {
      var kids = Object.keys(node.kids).map(function (k) { return roll(node.kids[k], key + ' ▸ ' + k, level + 1); });
      var agg = tblank(node.label);
      RAW.forEach(function (k) { agg[k] = node[k]; });
      kids.forEach(function (c) { RAW.forEach(function (k) { agg[k] += c[k]; }); });
      var d = tderive(agg); d.key = key; d.level = level; d.kids = kids;
      return d;
    }
    return Object.keys(root).map(function (k) { return roll(root[k], k, 0); });
  }
  function adsByName(from, to) {
    var map = {};
    for (var i = 0; i < grain.length; i++) {
      var g = grain[i]; if (!within(g.d, from, to)) continue; if (!campOK(g.camp)) continue;
      var a = map[g.ad] || (map[g.ad] = tblank(g.ad));
      accum(a, g);
    }
    return Object.keys(map).map(function (k) { return tderive(map[k]); }).filter(function (a) { return a.spend > 0 || a.conv > 0 || a.lead > 0 || a.sched > 0; });
  }

  /* colunas da árvore/tabela */
  var TCOLS = [
    { k: 'label', label: 'Campanha › Conjunto › Anúncio' },
    { k: 'spend', label: 'Invest.', fmt: M.money },
    { k: 'ctr', label: 'CTR', fmt: M.pct1, scale: 'high' },
    { k: 'cpc', label: 'CPC', fmt: M.money, scale: 'low' },
    { k: 'clk', label: 'Cliques', fmt: M.int },
    { k: 'conv', label: 'Conversas', fmt: M.int, scale: 'high' },
    { k: 'cpConv', label: 'Custo/conversa', fmt: M.money, scale: 'low' },
    { k: 'lead', label: 'Leads', fmt: M.int },
    { k: 'sched', label: 'Programar', fmt: M.int }
  ];

  /* ================================================================ VISÃO GERAL */
  function renderQuizLeads(m, lc) {
    var head = '<h2>🧩 Quiz — funil de leads <small style="font-weight:500;color:var(--ink-3)">leitura ao vivo da planilha' + (STATE.preset === 'all' ? ' · todas as respostas' : ' · no período') + '</small></h2>';
    if (LEADS === null) return '<div class="panel quiz-panel">' + head + '<p class="note">⏳ Lendo a planilha de leads em tempo real…</p></div>';
    if (LEADS.error) return '<div class="panel quiz-panel">' + head + '<p class="note">⚠️ Não consegui ler a planilha agora. Confirme que ela está com acesso <b>"qualquer pessoa com o link"</b> e recarregue.</p></div>';
    var total = lc.total, cpl = div(m.spend, total);
    var stages = [
      { n: 'Investimento', big: M.money(m.spend), bg: '#8fe01e', ink: '#0c1400', cl: 'com imposto', cv: '×' + taxStr(TAX), sub: 'campanha do quiz (E2 · Cap Leads)' },
      { n: 'Impressões', big: M.int(m.impr), bg: '#7ecb1c', ink: '#0c1400', cl: 'CPM', cv: M.money(m.cpm), sub: 'CTR (link) <b>' + M.pct1(m.ctr) + '</b>' },
      { n: 'Cliques / visitas', big: M.int(m.clk), bg: '#5aa60f', ink: '#fff', cl: 'CPC', cv: M.money(m.cpc), sub: 'clique → lead <b>' + M.pct1(div(total, m.clk)) + '</b>' },
      { n: 'Leads (quiz)', big: M.int(total), bg: '#356606', ink: '#fff', cl: 'Custo / lead', cv: (total ? M.money(cpl) : '—'), sub: total ? 'preencheram o formulário' : 'sem lead no período ainda' }
    ];
    var funnelHTML = stages.map(function (s) {
      return '<div class="fstage"><div class="fl" style="background:' + s.bg + ';color:' + s.ink + '"><div class="fn">' + s.n + '</div><div class="fv">' + s.big + '</div></div>' +
        '<div class="fr"><div class="cl">' + s.cl + '</div><div class="cv">' + s.cv + '</div><div class="fsub">' + s.sub + '</div></div></div>';
    }).join('');
    function qcard(cls, emoji, label, n, faixa) {
      var share = total ? n / total : 0;
      return '<div class="qcard ' + cls + '"><div class="qtop">' + emoji + ' ' + label + '</div><div class="qbig">' + int(n) + '</div><div class="qmeta">' + pct1(share) + ' dos leads · <span>' + faixa + '</span></div></div>';
    }
    var ranking = '<div class="qual-grid">' +
      qcard('q-hot', '🟢', 'Qualificados', lc.alta, 'pontuação ≥ 33') +
      qcard('q-mid', '🟡', 'Médios', lc.media, '21 – 32') +
      qcard('q-cold', '🔵', 'Frios', lc.baixa, '< 21') +
      '</div>';
    var note = '<p class="note" style="margin-top:10px">Ranking pela <b>pontuação do quiz</b> (0–48). Atualiza sozinho a cada resposta nova — é só recarregar.' + (lc.sem ? ' <span style="color:var(--ink-3)">' + int(lc.sem) + ' sem classificação.</span>' : '') + '</p>';
    return '<div class="panel quiz-panel">' + head + '<div class="funnel">' + funnelHTML + '</div>' + ranking + note + '</div>';
  }

  function renderOverview() {
    var from = STATE.from, to = STATE.to, len = diffDays(from, to) + 1;
    var pTo = dayAdd(from, -1), pFrom = dayAdd(pTo, -(len - 1));
    var cur = aggregate(from, to), prev = STATE.compare ? aggregate(pFrom, pTo) : null;
    var fin = finAgg(from, to);

    var h = health(cur), sc = scoreColor(h.score);
    var healthHTML = gauge(h.score, sc) +
      '<div><p class="health-head">Saúde da mídia' +
      '<span class="tag" style="background:color-mix(in srgb,' + sc + ' 20%,transparent);color:' + sc + '">' + h.band + '</span>' +
      '<span style="font-size:11.5px;font-weight:500;color:var(--ink-3);margin-left:6px">' + (h.score == null ? '—' : h.score + '/100') + ' · pela sua régua de benchmarks</span></p>' +
      '<div class="hbars" style="margin-top:12px">' + h.bars.map(function (b) {
        var col = b.score == null ? 'var(--ink-3)' : scoreColor(b.score);
        var w = b.score == null ? 0 : Math.max(0, Math.min(100, b.score));
        var lim = b.band.dir === 'high' ? 'bom ≥ ' + b.band.fmt(b.band.good) : 'bom ≤ ' + b.band.fmt(b.band.good);
        return '<div class="hbar"><div class="hb-top"><em>' + b.label + ' <span style="color:var(--ink-3);font-weight:500">· ' + lim + '</span></em><strong>' + b.valueStr + '</strong></div>' +
          '<div class="hb-track"><div class="hb-fill" style="width:' + w.toFixed(0) + '%;background:' + col + '"></div></div></div>';
      }).join('') + '</div></div>';

    var heroHTML =
      '<div class="hcard"><div class="hk">💸 Investimento <small>c/ imposto</small></div>' +
      '<div class="hv">' + M.money(cur.spend) + '</div><div class="hd">' + miniDelta(cur.spend, prev && prev.spend, null) + ' vs anterior</div></div>' +
      '<div class="op">→</div>' +
      '<div class="hcard"><div class="hk">💬 Conversas <small>WhatsApp</small></div>' +
      '<div class="hv g">' + M.int(cur.conv) + '</div><div class="hd">' + miniDelta(cur.conv, prev && prev.conv, true) + ' vs anterior</div></div>' +
      '<div class="op">=</div>' +
      '<div class="hcard roas"><div class="hk">🎯 Custo por conversa</div>' +
      '<div class="hv">' + M.money(cur.cpConv) + '</div><div class="hd">' + miniDelta(cur.cpConv, prev && prev.cpConv, false) + ' vs anterior</div></div>' +
      '<div class="op">·</div>' +
      '<div class="hcard"><div class="hk">📅 Programar <small>LP</small> · 🧲 Leads</div>' +
      '<div class="hv">' + M.int(cur.sched) + ' · ' + M.int(cur.lead) + '</div><div class="hd">' + (cur.sched === 0 ? 'LP sem conversão' : 'custo/prog ' + M.money(cur.cpSched)) + '</div></div>';

    var heroLine = (cur.conv > 0 || cur.lead > 0 || cur.sched > 0)
      ? '<b>' + int(cur.conv) + ' conversas</b> no período por <b>' + M.money(cur.spend) + '</b> investidos — custo médio por conversa <b>' + M.money(cur.cpConv) + '</b>' +
        (cur.reply > 0 ? ' · ' + int(cur.reply) + ' responderam (' + M.pct1(cur.replyRate) + ')' : '') +
        '. Programar (LP): <b>' + int(cur.sched) + '</b> · Leads: <b>' + int(cur.lead) + '</b>.'
      : 'Sem conversa, programar ou lead no período.';

    // painel de leads do quiz (planilha ao vivo) + banner por grupo de campanha
    var quizMedia = aggregateGroup('quiz', from, to);
    var lc = leadsAgg(from, to, STATE.preset === 'all');
    var showQuiz = (STATE.campGroup === 'all' || STATE.campGroup === 'quiz') && (quizMedia.spend > 0 || lc.total > 0 || LEADS === null);
    var quizPanel = showQuiz ? renderQuizLeads(quizMedia, lc) : '';
    var groupBanner = STATE.campGroup === 'seg'
      ? '<div class="alertbar amber">👥 <b>Aba Seguidores (E1 · Dist)</b> — mostrando as métricas de mídia do Meta desta campanha. O funil de seguidores completo entra quando a planilha específica for integrada (placeholder pronto).</div>'
      : '';
    var lpAlert = groupBanner + quizPanel;

    var finEmpty = (fin.agend === 0 && fin.cirurg === 0 && fin.fatTot === 0);
    var finTicket = div(fin.fatCon, fin.agend), finConvCir = div(fin.cirurg, fin.agend);
    var finStages = [
      { n: 'Consultas confirmadas', big: int(fin.agend), bg: '#8fe01e', ink: '#0c1400', cl: 'Faturamento consultas', cv: money0(fin.fatCon), sub: fin.agend ? 'ticket médio ' + money0(finTicket || 0) : 'agendamentos confirmados no período' },
      { n: 'Cirurgias confirmadas', big: int(fin.cirurg), bg: '#5aa60f', ink: '#fff', cl: 'Faturamento cirurgias', cv: money0(fin.fatCir), sub: fin.agend ? 'consulta → cirurgia ' + pct1(finConvCir || 0) : 'nenhuma no período' },
      { n: 'Faturamento total', big: money0(fin.fatTot), bg: '#356606', ink: '#fff', cl: 'ROAS geral (ref.)', cv: M.roas(div(fin.fatTot, cur.spend)), sub: 'consultas + cirurgias · operação inteira' }
    ];
    var finFunnel = '<div class="funnel" style="margin-top:6px">' + finStages.map(function (s) {
      return '<div class="fstage"><div class="fl" style="background:' + s.bg + ';color:' + s.ink + '"><div class="fn">' + s.n + '</div><div class="fv">' + s.big + '</div></div>' +
        '<div class="fr"><div class="cl">' + s.cl + '</div><div class="cv">' + s.cv + '</div><div class="fsub">' + s.sub + '</div></div></div>';
    }).join('') + '</div>';
    var finHTML = HAS_FIN ? (
      '<div class="panel"><h2>💰 Atendimento & faturamento no período <span style="font-weight:500;color:var(--ink-3)">— planilha das secretárias</span></h2>' +
      (finEmpty
        ? '<p class="note">Nenhum agendamento ou valor lançado no período. Assim que as secretárias preencherem a planilha (consultas e cirurgias confirmadas + valores), o funil aparece aqui automaticamente — sem telefone, só os números.</p>'
        : finFunnel + '<div class="alertbar amber">⚠️ <b>Faturamento inclui Unimed / indicação / particular — não é só tráfego.</b> O ROAS acima é referência da operação inteira, não do tráfego pago.</div>') +
      '</div>'
    ) : '';

    var overview =
      lpAlert +
      '<div class="panel"><div class="health" id="health">' + healthHTML + '</div></div>' +
      '<div class="hero" id="hero">' + heroHTML + '</div>' +
      '<p class="hero-line" style="margin-bottom:10px">' + heroLine + '</p>' +
      finHTML +
      '<div class="panel"><h2>Investimento por objetivo <span style="font-weight:500;color:var(--ink-3)">— com imposto ×' + taxStr(TAX) + '</span></h2><div class="funil-grid" id="funilInv"></div></div>' +
      '<div class="grid-funnel">' +
      '<div class="panel"><h2>Funil completo</h2><p class="note">Investimento → Impressões → Cliques → Conversas. Cada etapa mostra o <b>volume</b> e, à direita, o <b>custo</b> e a <b>taxa de passagem</b>.</p><div class="funnel" id="funnel"></div></div>' +
      '<div class="panel"><h2>Resultados por dia</h2><p class="note">Barras = <b>Investimento c/ imposto</b> (esq., R$) · linha = <b>Conversas</b> (dir., nº).</p><div class="legend" id="legA"></div><div id="chA"></div>' +
      '<h2 style="margin-top:20px">Conversas × Responderam × Custo/conversa</h2><p class="note">Barras = <b>Conversas</b> e <b>Responderam</b> (esq., nº) · linha = <b>Custo por conversa</b> (dir., R$).</p><div class="legend" id="legB"></div><div id="chB"></div></div>' +
      '</div>' +
      '<div class="panel"><h2 id="metricTitle">Investimento por dia</h2><p class="note">Escolha a métrica; com a comparação ligada, a linha tracejada é o período anterior alinhado dia a dia.</p><div class="tabs" id="metricTabs"></div><div class="legend" id="legend"></div><div id="chMetric"></div></div>' +
      '<div class="panel"><h2>Visão diária — principais métricas por dia</h2><p class="note">Uma linha por dia, mais recente no topo. Heatmap por coluna: <b style="color:var(--good-text)">verde = melhor</b>, <b style="color:var(--critical)">vermelho = pior</b> no período.</p><div class="tblwrap"><table id="dtbl" class="daily"></table></div></div>';

    $('overviewView').innerHTML = overview;

    renderFunilInv(from, to);
    renderFunnel(cur);
    var rows = dailyRows(from, to), pRows = dailyRows(pFrom, pTo);
    comboChart($('chA'), rows, { bars: [{ key: 'spend', color: 'var(--critical)', name: 'Investimento c/ imposto' }], line: { key: 'conv', color: 'var(--good)', name: 'Conversas' }, leftFmt: M.money0, rightFmt: M.int, lineFmt: M.int });
    comboChart($('chB'), rows, { bars: [{ key: 'conv', color: 'var(--good)', name: 'Conversas' }, { key: 'reply', color: 'var(--series-2)', name: 'Responderam' }], line: { key: 'cpConv', color: 'var(--ink-1)', name: 'Custo/conversa' }, leftFmt: M.int, rightFmt: M.money0, lineFmt: M.money });
    var lgSq = function (c) { return '<i style="background:' + c + '"></i>'; }, lgLn = function (c) { return '<i style="width:15px;height:0;border-top:2px solid ' + c + ';border-radius:0"></i>'; };
    $('legA').innerHTML = '<span>' + lgSq('var(--critical)') + '<span style="color:var(--ink-2)">Investimento c/ imposto</span></span><span>' + lgLn('var(--good)') + '<span style="color:var(--ink-2)">Conversas (eixo dir.)</span></span>';
    $('legB').innerHTML = '<span>' + lgSq('var(--good)') + '<span style="color:var(--ink-2)">Conversas</span></span><span>' + lgSq('var(--series-2)') + '<span style="color:var(--ink-2)">Responderam</span></span><span>' + lgLn('var(--ink-1)') + '<span style="color:var(--ink-2)">Custo/conversa (eixo dir.)</span></span>';

    var METRICS = [
      { k: 'spend', label: 'Investimento', fmt: M.money0 }, { k: 'conv', label: 'Conversas', fmt: M.int },
      { k: 'cpConv', label: 'Custo/conversa', fmt: M.money }, { k: 'reply', label: 'Responderam', fmt: M.int },
      { k: 'lead', label: 'Leads', fmt: M.int }, { k: 'sched', label: 'Programar', fmt: M.int },
      { k: 'cpc', label: 'CPC', fmt: M.money }, { k: 'cpm', label: 'CPM', fmt: M.money0 },
      { k: 'ctr', label: 'CTR', fmt: M.pct1 }, { k: 'impr', label: 'Impressões', fmt: M.int }, { k: 'clk', label: 'Cliques', fmt: M.int }
    ];
    $('metricTabs').innerHTML = METRICS.map(function (x) { return '<button class="btn' + (x.k === STATE.metric ? ' on' : '') + '" data-metric="' + x.k + '">' + x.label + '</button>'; }).join('');
    var met = METRICS.find(function (m) { return m.k === STATE.metric; }) || METRICS[0];
    var series = [{ name: 'Período atual', color: 'var(--series-1)', values: rows.map(function (r) { return r[met.k]; }), fullLabels: rows.map(function (r) { return brFull(r.d); }) }];
    if (STATE.compare) series.push({ name: 'Período anterior', color: 'var(--series-2)', dashed: true, values: rows.map(function (_, i) { return pRows[i] ? pRows[i][met.k] : null; }) });
    $('legend').innerHTML = series.length > 1 ? series.map(function (s) { return '<span style="color:' + s.color + '"><i class="' + (s.dashed ? 'dash' : '') + '" style="background:' + (s.dashed ? 'transparent' : s.color) + '"></i><span style="color:var(--ink-2)">' + s.name + '</span></span>'; }).join('') : '';
    lineChart($('chMetric'), rows.map(function (r) { return brDate(r.d); }), series, met.fmt);
    $('metricTitle').textContent = met.label + ' por dia';
    Array.prototype.forEach.call(document.querySelectorAll('[data-metric]'), function (b) { b.onclick = function () { STATE.metric = b.dataset.metric; renderOverview(); }; });

    renderDaily(from, to);
  }

  var FUNIL_META = {
    'Mensagens': { color: 'var(--good)', desc: 'conversas / WhatsApp (CTWA)' },
    'Leads/LP': { color: 'var(--brand)', desc: 'landing page / formulário' },
    'Topo': { color: 'var(--series-2)', desc: 'alcance / perfil (topo)' },
    'Outros': { color: 'var(--ink-3)', desc: 'demais campanhas' }
  };
  function renderFunilInv(from, to) {
    var g = {}, total = 0;
    for (var i = 0; i < grain.length; i++) { var x = grain[i]; if (!within(x.d, from, to)) continue; if (!campOK(x.camp)) continue; var f = funnelOf(x.camp); (g[f] || (g[f] = { spend: 0, clk: 0, conv: 0, lead: 0, sched: 0, impr: 0 })); g[f].spend += x.spend; g[f].clk += x.clk; g[f].conv += x.conv; g[f].lead += x.lead; g[f].sched += x.sched; g[f].impr += x.impr; total += x.spend; }
    var cards = ['Mensagens', 'Leads/LP', 'Topo', 'Outros'].filter(function (k) { return g[k]; }).map(function (k) {
      var o = g[k], m = FUNIL_META[k], share = total ? o.spend / total : 0;
      var detail = k === 'Mensagens' ? (int(o.conv) + ' conversas · ' + money0(div(o.spend, o.conv) || 0) + '/conv')
        : k === 'Leads/LP' ? (int(o.sched + o.lead) + ' resultado(s) · ' + (o.sched === 0 && o.lead === 0 ? 'sem conversão' : money0(div(o.spend, o.sched + o.lead) || 0) + '/result'))
        : (int(o.impr) + ' impressões · ' + int(o.clk) + ' cliques');
      return '<div class="finv"><div class="fshare">' + pct1(share) + '</div><div class="ftop"><span class="fico" style="background:' + m.color + '"></span>' + k + '</div><div class="fmain" style="color:' + m.color + '">' + money0(o.spend) + '</div><div class="fmeta">' + m.desc + '<br>' + detail + '</div></div>';
    });
    cards.push('<div class="finv total"><div class="ftop">Σ Total</div><div class="fmain">' + money0(total) + '</div><div class="fmeta">soma dos objetivos · com imposto ×' + taxStr(TAX) + '</div></div>');
    $('funilInv').innerHTML = cards.join('');
  }
  function renderFunnel(c) {
    var stages = [
      { n: 'Investimento', big: M.money(c.spend), bg: '#8fe01e', ink: '#0c1400', cl: 'Gasto bruto', cv: M.money(c.spend / TAX), sub: '+ imposto ×' + taxStr(TAX) + ' = <b>' + M.money(c.spend) + '</b>' },
      { n: 'Impressões', big: M.int(c.impr), bg: '#7ecb1c', ink: '#0c1400', cl: 'CPM', cv: M.money(c.cpm), sub: 'CTR (link) <b>' + M.pct1(c.ctr) + '</b>' },
      { n: 'Cliques (link)', big: M.int(c.clk), bg: '#5aa60f', ink: '#fff', cl: 'CPC', cv: M.money(c.cpc), sub: 'Clique → Conversa <b>' + M.pct1(c.convRate) + '</b>' },
      { n: 'Conversas', big: M.int(c.conv), bg: '#356606', ink: '#fff', cl: 'Custo / Conversa', cv: M.money(c.cpConv), sub: (c.sched > 0 || c.lead > 0) ? '+ <b>' + M.int(c.sched) + '</b> programar · <b>' + M.int(c.lead) + '</b> leads' : 'resultado principal (WhatsApp)' }
    ];
    $('funnel').innerHTML = stages.map(function (s) {
      return '<div class="fstage"><div class="fl" style="background:' + s.bg + ';color:' + s.ink + '"><div class="fn">' + s.n + '</div><div class="fv">' + s.big + '</div></div>' +
        '<div class="fr"><div class="cl">' + s.cl + '</div><div class="cv">' + s.cv + '</div><div class="fsub">' + s.sub + '</div></div></div>';
    }).join('');
  }

  var DCOLS = [
    { k: 'd', label: 'Dia' }, { k: 'spend', label: 'Invest.', fmt: M.money }, { k: 'cpm', label: 'CPM', fmt: M.money, scale: 'low' },
    { k: 'cpc', label: 'CPC', fmt: M.money, scale: 'low' }, { k: 'ctr', label: 'CTR', fmt: M.pct1, scale: 'high' },
    { k: 'clk', label: 'Cliques', fmt: M.int }, { k: 'conv', label: 'Conversas', fmt: M.int, scale: 'high' }, { k: 'cpConv', label: 'Custo/conversa', fmt: M.money, scale: 'low' },
    { k: 'lead', label: 'Leads', fmt: M.int }, { k: 'sched', label: 'Programar', fmt: M.int }
  ];
  function renderDaily(from, to) {
    var rows = dailyRows(from, to).reverse();
    var scales = {};
    DCOLS.filter(function (c) { return c.scale; }).forEach(function (c) {
      var vals = rows.filter(function (r) { return r.spend > 0 && ok(r[c.k]); }).map(function (r) { return r[c.k]; });
      if (vals.length > 1) scales[c.k] = { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals), dir: c.scale };
    });
    function heat(k, v) {
      var s = scales[k]; if (!s || !ok(v) || s.max === s.min) return '';
      var t = (v - s.min) / (s.max - s.min); if (s.dir === 'low') t = 1 - t;
      var hue = t >= 0.5 ? 'var(--good)' : 'var(--critical)', strength = Math.round(Math.abs(t - 0.5) * 2 * 32);
      return strength < 6 ? '' : 'background:color-mix(in srgb,' + hue + ' ' + strength + '%,transparent)';
    }
    var head = DCOLS.map(function (c) { return '<th>' + c.label + '</th>'; }).join('');
    var body = rows.map(function (r) {
      return '<tr>' + DCOLS.map(function (c) {
        if (c.k === 'd') return '<td>' + brFull(r.d) + '</td>';
        var st = c.scale ? heat(c.k, r[c.k]) : '', v = c.fmt(r[c.k]);
        return '<td>' + (st ? '<span class="cell-scale" style="' + st + '">' + v + '</span>' : v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    $('dtbl').innerHTML = '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>';
  }

  /* ================================================================ TRÁFEGO PAGO */
  function renderTraffic() {
    var from = STATE.from, to = STATE.to, len = diffDays(from, to) + 1;
    var pTo = dayAdd(from, -1), pFrom = dayAdd(pTo, -(len - 1));
    var cur = aggregate(from, to), prev = STATE.compare ? aggregate(pFrom, pTo) : null;

    function kpi(lbl, val, sub, delta) { return '<div class="kpi"><div class="k">' + lbl + '</div><div class="v sm">' + val + '</div><div class="d">' + (delta || '') + (sub ? '<span>' + sub + '</span>' : '') + '</div></div>'; }
    var kpis = [
      kpi('Investimento', M.money0(cur.spend), 'com imposto', miniDelta(cur.spend, prev && prev.spend, null)),
      kpi('CPM', M.money(cur.cpm), 'bom ≤ R$35', flagFor('cpm', cur.cpm)),
      kpi('CTR (link)', M.pct1(cur.ctr), 'bom ≥ 1%', flagFor('ctr', cur.ctr)),
      kpi('CPC', M.money(cur.cpc), 'bom ≤ R$2', flagFor('cpc', cur.cpc)),
      kpi('Cliques', M.int(cur.clk), int(cur.impr) + ' impressões', ''),
      kpi('Conversas', M.int(cur.conv), 'custo/conversa ' + M.money(cur.cpConv), miniDelta(cur.conv, prev && prev.conv, true)),
      kpi('Programar · Leads', M.int(cur.sched) + ' · ' + M.int(cur.lead), cur.sched === 0 ? 'LP sem conversão' : 'custo/prog ' + M.money(cur.cpSched), ''),
      kpi('Clique → Conversa', M.pct1(cur.convRate), 'conversas ÷ cliques', '')
    ];

    $('trafficView').innerHTML =
      '<div class="scopenote"><span>🎯 Aba operacional: métricas de mídia (Meta) e resultado por anúncio. <b>Conversas</b> = conversa iniciada no WhatsApp (CTWA); <b>Programar</b> = conversão da LP (Schedule); <b>Leads</b> = formulário. CTR sempre de <b>link</b>.</span></div>' +
      '<div class="kpis">' + kpis.join('') + '</div>' +
      '<div class="panel"><h2>Investimento por objetivo <span style="font-weight:500;color:var(--ink-3)">— com imposto ×' + taxStr(TAX) + '</span></h2><div class="funil-grid" id="funilInv"></div></div>' +
      '<div class="panel"><h2>Otimização — Campanha › Conjunto › Anúncio</h2>' +
      '<p class="note">Clique numa <b>campanha</b> pra abrir os conjuntos, e num conjunto pra abrir os anúncios. Clique nos cabeçalhos pra ordenar. Heatmap: verde = melhor.</p>' +
      '<div class="tblwrap"><table id="tbl" class="tree"></table></div></div>';

    renderFunilInv(from, to);
    renderTree(from, to);
  }
  function flagFor(k, v) {
    var st = statusOf(v, BANDS[k]); if (!st) return '';
    return '<span class="rep-flag ' + st.cls + '">' + st.word + '</span>';
  }
  function sortNodes(list, key, dir) {
    return list.slice().sort(function (a, b) {
      if (key === 'label') return dir * a.label.localeCompare(b.label, 'pt-BR');
      var av = a[key], bv = b[key], an = !ok(av), bn = !ok(bv);
      if (an && bn) return 0; if (an) return 1; if (bn) return -1; return dir * (av - bv);
    });
  }
  function renderTree(from, to) {
    var camps = buildTree(from, to);
    var key = STATE.treeSort.key, dir = STATE.treeSort.dir;
    var scales = {};
    TCOLS.filter(function (c) { return c.scale; }).forEach(function (c) {
      var vals = camps.filter(function (r) { return r.spend > 0 && ok(r[c.k]); }).map(function (r) { return r[c.k]; });
      if (vals.length > 1) scales[c.k] = { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals), dir: c.scale };
    });
    function shade(k, v) { var s = scales[k]; if (!s || !ok(v) || s.max === s.min) return ''; var t = (v - s.min) / (s.max - s.min); if (s.dir === 'low') t = 1 - t; if (t < 0.15) return ''; return 'background:color-mix(in srgb,var(--scale-ink) ' + Math.round(t * 32) + '%,transparent)'; }
    var head = TCOLS.map(function (c) { var active = key === c.k; var arw = active ? (dir === 1 ? '▲' : '▼') : '▾'; return '<th data-k="' + c.k + '"' + (active ? ' data-active' : '') + '>' + c.label + '<span class="arw">' + arw + '</span></th>'; }).join('');
    function flatten() {
      var out = [];
      sortNodes(camps, key, dir).forEach(function (c) {
        out.push(c);
        if (STATE.expanded[c.key]) sortNodes(c.kids, key, dir).forEach(function (s) {
          out.push(s);
          if (STATE.expanded[s.key]) sortNodes(s.kids, key, dir).forEach(function (a) { out.push(a); });
        });
      });
      return out;
    }
    function rowHTML(r) {
      var exp = r.level < 2 && r.kids && r.kids.length > 0, open = STATE.expanded[r.key];
      var caret = '<span class="caret">' + (exp ? '▸' : '') + '</span>';
      return '<tr class="lv' + r.level + (exp ? ' exp' : '') + (open ? ' open' : '') + '" data-key="' + encodeURIComponent(r.key) + '">' +
        '<td><span class="nm">' + caret + esc(r.label) + '</span></td>' +
        TCOLS.slice(1).map(function (c) { var st = c.scale ? shade(c.k, r[c.k]) : ''; var v = c.fmt(r[c.k]); return '<td>' + (st ? '<span class="cell-scale" style="' + st + '">' + v + '</span>' : v) + '</td>'; }).join('') + '</tr>';
    }
    var tot = tderive(camps.reduce(function (t, r) { RAW.forEach(function (k) { t[k] += r[k]; }); return t; }, tblank('')));
    var rows = flatten();
    $('tbl').innerHTML = '<thead><tr>' + head + '</tr></thead><tbody>' +
      (rows.map(rowHTML).join('') || '<tr><td colspan="' + TCOLS.length + '" style="text-align:center;color:var(--ink-3);padding:32px">Sem dados no período.</td></tr>') +
      '</tbody><tfoot><tr><td>Total — ' + camps.length + ' campanha(s)</td>' + TCOLS.slice(1).map(function (c) { return '<td>' + c.fmt(tot[c.k]) + '</td>'; }).join('') + '</tr></tfoot>';
    Array.prototype.forEach.call(document.querySelectorAll('#tbl tbody tr.exp'), function (tr) {
      tr.querySelector('td:first-child').onclick = function () { var k = decodeURIComponent(tr.dataset.key); STATE.expanded[k] = !STATE.expanded[k]; renderTree(from, to); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tbl thead th'), function (th) {
      th.onclick = function () { var k = th.dataset.k; STATE.treeSort = key === k ? { key: k, dir: -dir } : { key: k, dir: k === 'label' ? 1 : -1 }; renderTree(from, to); };
    });
  }

  /* ================================================================ RELATÓRIO */
  function repStat(l, v) { return '<div class="rep-stat"><div class="l">' + l + '</div><div class="v">' + v + '</div></div>'; }
  function renderReport() {
    var from = STATE.from, to = STATE.to, days = diffDays(from, to) + 1;
    var pTo = dayAdd(from, -1), pFrom = dayAdd(pTo, -(days - 1));
    var cur = aggregate(from, to), prev = aggregate(pFrom, pTo);
    var fin = finAgg(from, to);
    var dRows = dailyRows(from, to), camps = buildTree(from, to), ads = adsByName(from, to);
    var perLabel = days === 1 ? brFull(from) : brFull(from) + ' a ' + brFull(to) + ' · ' + days + ' dias';

    function selo(k, v) { var st = statusOf(v, BANDS[k]); return st ? '<span class="rep-flag ' + st.cls + '">' + st.word + '</span>' : ''; }
    var dTbl = '<div class="tblwrap"><table style="min-width:520px"><thead><tr><th style="text-align:left">Dia</th><th>Gasto</th><th>Cliques</th><th>Conversas</th><th>Custo/conversa</th><th>Prog.</th><th>Leads</th></tr></thead><tbody>' +
      dRows.slice().reverse().map(function (r) { return '<tr><td style="text-align:left">' + brFull(r.d) + '</td><td>' + M.money(r.spend) + '</td><td>' + int(r.clk) + '</td><td>' + int(r.conv) + '</td><td>' + M.money(r.cpConv) + '</td><td>' + int(r.sched) + '</td><td>' + int(r.lead) + '</td></tr>'; }).join('') + '</tbody></table></div>';

    var finSec = HAS_FIN ? (
      '<div class="rep-sec"><div class="step">2 · FATURAMENTO</div><h3>💰 Faturamento no período (secretárias)</h3><div class="rep-stats">' +
      repStat('Faturamento total', money0(fin.fatTot)) + repStat('Consultas', money0(fin.fatCon)) +
      repStat('Cirurgias', money0(fin.fatCir)) + repStat('Agendamentos', int(fin.agend)) +
      repStat('Cirurgias confirmadas', int(fin.cirurg)) + repStat('ROAS geral', M.roas(div(fin.fatTot, cur.spend))) + '</div>' +
      '<p class="rep-p muted">⚠️ Inclui Unimed / indicação / particular — não é só tráfego. ROAS geral é referência da operação inteira; o ROAS do tráfego virá do cruzamento por telefone (Fase 3).</p></div>'
    ) : '';

    var secVisual =
      '<div class="rep-sec"><div class="step">1 · RESUMO</div><h3>📊 Números do período</h3><div class="rep-stats">' +
      repStat('Investimento', M.money(cur.spend)) + repStat('Conversas', int(cur.conv)) +
      repStat('Custo por conversa', M.money(cur.cpConv)) + repStat('Responderam', int(cur.reply)) +
      repStat('Programar (LP)', int(cur.sched)) + repStat('Leads', int(cur.lead)) + '</div>' +
      '<p class="rep-p muted">Resultado principal = <b>conversas por WhatsApp</b>. Programar (conversão da LP) e Leads entram como secundários.</p></div>' +

      finSec +

      '<div class="rep-sec"><div class="step">3 · MÍDIA (TOPO)</div><h3>🚀 Eficiência da mídia</h3><div class="rep-stats">' +
      repStat('CTR ' + selo('ctr', cur.ctr), M.pct1(cur.ctr)) + repStat('CPC ' + selo('cpc', cur.cpc), M.money(cur.cpc)) +
      repStat('CPM ' + selo('cpm', cur.cpm), M.money(cur.cpm)) + repStat('Impressões', int(cur.impr)) + repStat('Cliques', int(cur.clk)) + '</div>' +
      '<p class="rep-p muted">Selos pela régua de benchmarks: CTR (link) bom ≥ 1% · CPC bom ≤ R$2 · CPM bom ≤ R$35.</p></div>' +

      '<div class="rep-sec"><div class="step">4 · DIA A DIA</div><h3>📅 Funil por dia</h3>' + dTbl + '</div>' +

      '<div class="rep-sec"><div class="step">5 · CAMPANHAS</div><h3>🗂️ Investimento e resultados</h3>' +
      '<div class="tblwrap"><table style="min-width:520px"><thead><tr><th style="text-align:left">Campanha</th><th>Gasto</th><th>CTR</th><th>CPC</th><th>Conversas</th><th>Custo/conv</th><th>Prog.</th></tr></thead><tbody>' +
      camps.filter(function (c) { return c.spend > 0; }).sort(function (a, b) { return b.spend - a.spend; }).map(function (c) { return '<tr><td style="text-align:left">' + esc(c.label) + '</td><td>' + M.money(c.spend) + '</td><td>' + M.pct1(c.ctr) + '</td><td>' + M.money(c.cpc) + '</td><td>' + int(c.conv) + '</td><td>' + M.money(c.cpConv) + '</td><td>' + int(c.sched) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +

      '<div class="rep-sec"><div class="step">6 · MELHORES ANÚNCIOS</div><h3>🏆 Destaques pra produzir mais</h3>' +
      (function () {
        var b = ads.filter(function (a) { return a.conv > 0; }).sort(function (a, z) { return (a.cpConv || 1e9) - (z.cpConv || 1e9); }).slice(0, 6);
        return b.length ? b.map(function (a) { var res = int(a.conv) + ' conversa(s) · custo/conversa ' + M.money(a.cpConv); return '<div class="rep-ad"><div><span class="nm">' + esc(a.label) + '</span> <span class="mt">· ' + res + ' · ' + M.money(a.spend) + ' gastos</span></div><input data-adlink="' + encodeURIComponent(a.label) + '" placeholder="cole o link do anúncio (Instagram)"></div>'; }).join('')
          : '<p class="rep-p muted">Sem conversa atribuída a um anúncio específico no período.</p>';
      })() + '</div>';

    /* ---- briefing do gestor (interno) ---- */
    var brief = [];
    var xGeral = 'Investimento ' + M.money(cur.spend) + ' gerou ' + int(cur.conv) + ' conversa(s) (custo/conversa ' + M.money(cur.cpConv) + '), ' + int(cur.sched) + ' programar (LP) e ' + int(cur.lead) + ' lead(s). ' + (HAS_FIN ? 'Faturamento no período (operação inteira, inclui Unimed/indicação): ' + money0(fin.fatTot) + '.' : '');
    brief.push({ t: 'Leitura geral', h: '<p>' + xGeral + '</p>', x: xGeral });

    var topStatus = [['ctr', cur.ctr], ['cpc', cur.cpc], ['cpm', cur.cpm]].map(function (p) { var st = statusOf(p[1], BANDS[p[0]]); return BANDS[p[0]].label + ' ' + BANDS[p[0]].fmt(p[1]) + ' (' + (st ? st.word : '—') + ')'; }).join(' · ');
    var allTopGood = ['ctr', 'cpc', 'cpm'].every(function (k) { var st = statusOf(cur[k], BANDS[k]); return st && st.lvl === 'good'; });
    var xTopo = 'Mídia: ' + topStatus + '. ' + (allTopGood ? 'A mídia está barata e atraente — o gargalo, se houver, está na conversão da conversa em agendamento, não no clique.' : 'Há espaço pra melhorar a mídia (criativo/público) antes de escalar.');
    brief.push({ t: 'Mídia (topo)', h: '<p>' + xTopo + '</p>', x: xTopo });

    var ds = dRows.filter(function (r) { return r.conv > 0; });
    var xDia;
    if (ds.length) {
      var best = ds.reduce(function (a, b) { return (b.cpConv || 1e9) < (a.cpConv || 1e9) ? b : a; });
      var worst = ds.reduce(function (a, b) { return (b.cpConv || 0) > (a.cpConv || 0) ? b : a; });
      xDia = ds.length + ' dia(s) com conversa. Melhor: ' + brFull(best.d) + ' (custo/conversa ' + M.money(best.cpConv) + ', ' + int(best.conv) + ' conversas)' + (worst !== best ? ' · pior: ' + brFull(worst.d) + ' (custo/conversa ' + M.money(worst.cpConv) + ')' : '') + '.';
    } else xDia = 'Sem conversa dia a dia no período.';
    brief.push({ t: 'Dia a dia', h: '<p>' + xDia + '</p>', x: xDia });

    var winners = ads.filter(function (a) { return a.conv > 0 && ok(a.cpConv); }).sort(function (a, b) { return a.cpConv - b.cpConv; }).slice(0, 4);
    var burning = ads.filter(function (a) { return a.spend >= (cur.cpConv || 20) * 3 && a.conv === 0 && a.lead === 0 && a.sched === 0; }).sort(function (a, b) { return b.spend - a.spend; }).slice(0, 4);
    var campHtml = '';
    if (winners.length) campHtml += '<p><span class="rep-flag g">CAMPEÕES</span> menor custo/conversa:</p><ul>' + winners.map(function (a) { return '<li><b>' + esc(a.label) + '</b> — ' + int(a.conv) + ' conversa(s), custo/conversa ' + M.money(a.cpConv) + ', ' + M.money(a.spend) + ' gastos.</li>'; }).join('') + '</ul>';
    if (burning.length) campHtml += '<p style="margin-top:10px"><span class="rep-flag r">QUEIMANDO VERBA</span> gasto relevante sem resultado:</p><ul>' + burning.map(function (a) { return '<li><b>' + esc(a.label) + '</b> — ' + M.money(a.spend) + ' gastos, 0 conversa/lead — candidato a pausar/revisar criativo.</li>'; }).join('') + '</ul>';
    if (!campHtml) campHtml = '<p class="rep-p muted">Ainda sem volume por anúncio pra separar campeões de perdedores com segurança.</p>';
    var campX = 'Campeões (custo/conversa): ' + (winners.map(function (a) { return a.label + ' (' + M.money(a.cpConv) + ')'; }).join('; ') || '—') + '.\nQueimando verba: ' + (burning.map(function (a) { return a.label + ' (' + M.money(a.spend) + ', 0 resultado)'; }).join('; ') || '—') + '.';
    brief.push({ t: 'Campanhas / anúncios', h: campHtml, x: campX });

    // insights e gargalos
    var ins = [];
    var topGoods = ['ctr', 'cpc', 'cpm'].filter(function (k) { var st = statusOf(cur[k], BANDS[k]); return st && st.lvl === 'good'; });
    if (topGoods.length >= 2) ins.push(['✅', '<b>Mídia forte:</b> ' + topGoods.map(function (k) { return BANDS[k].label; }).join(', ') + ' dentro da faixa boa. A entrega está barata — o ganho está em converter a conversa em agendamento.']);
    var lpSpendR = 0; for (var li = 0; li < grain.length; li++) { var lg = grain[li]; if (!within(lg.d, from, to)) continue; if (!campOK(lg.camp)) continue; if (funnelOf(lg.camp) === 'Leads/LP') lpSpendR += lg.spend; }
    if (cur.sched === 0 && lpSpendR > 0) ins.push(['⚠️', '<b>LP não converte:</b> ' + M.money(lpSpendR) + ' em campanhas de LP/Leads e 0 evento "Programar". Checar pixel/evento na landing (Gerenciador de Eventos → Testar eventos) e a otimização da campanha.']);
    if (cur.conv > 0 && ok(cur.replyRate) && cur.replyRate < 0.4) ins.push(['🔎', '<b>Baixa taxa de resposta:</b> só ' + M.pct1(cur.replyRate) + ' das conversas responderam. Agilizar o 1º atendimento (velocidade + script).']);
    burning.slice(0, 2).forEach(function (a) { ins.push(['🔥', '<b>Queimando verba:</b> "' + esc(a.label) + '" gastou ' + M.money(a.spend) + ' sem resultado — candidato a pausar.']); });
    winners.slice(0, 2).forEach(function (a) { ins.push(['⭐', '<b>Destaque:</b> "' + esc(a.label) + '" custo/conversa ' + M.money(a.cpConv) + ' com ' + int(a.conv) + ' conversa(s) — colocar mais verba e criar variações.']); });
    ins.push(['🧭', allTopGood ? '<b>Resumo:</b> mídia saudável — foco em volume de conversa qualificada e no atendimento rápido.' : '<b>Resumo:</b> ajustar mídia (criativo/público) antes de escalar verba.']);
    var insHtml = '<div>' + ins.map(function (i) { return '<div class="insight"><span class="ico">' + i[0] + '</span><span class="tx">' + i[1] + '</span></div>'; }).join('') + '</div>';
    brief.push({ t: 'Insights e gargalos', h: insHtml, x: ins.map(function (i) { return '• ' + i[1].replace(/<[^>]+>/g, ''); }).join('\n') });

    // próximos passos
    var sug = [];
    if (cur.sched === 0 && lpSpendR > 0) sug.push('Destravar o evento "Programar" na LP: testar pixel/evento no Gerenciador de Eventos e recriar a campanha da LP otimizando por Schedule.');
    if (ok(cur.replyRate) && cur.replyRate < 0.4 && cur.conv > 0) sug.push('Melhorar taxa de resposta das conversas: atendimento mais rápido e script de abertura.');
    if (winners.length) sug.push('Escalar os campeões de custo/conversa: ' + winners.slice(0, 3).map(function (a) { return esc(a.label); }).join(', ') + '.');
    burning.slice(0, 2).forEach(function (a) { sug.push('Pausar/revisar "' + esc(a.label) + '" (' + M.money(a.spend) + ' sem resultado).'); });
    sug.push('Fase 3: pedir às secretárias pra preencher o telefone dos pacientes → cruzar com os leads pra medir o ROAS só do tráfego.');
    if (!sug.length) sug.push('Manter monitoramento diário do custo por conversa e do volume.');
    brief.push({ t: 'Próximos passos (sugestões)', h: '<ul>' + sug.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>', x: sug.map(function (s) { return '• ' + s.replace(/<[^>]+>/g, ''); }).join('\n') });

    var briefText = 'BRIEFING DO GESTOR — Dr. Vinicius\n' + perLabel + '\n\n' + brief.map(function (s) { return s.t.toUpperCase() + '\n' + s.x; }).join('\n\n') + '\n\n— gerado pela dashboard (' + (D.generatedAt || '') + ' ' + (D.tz || 'BRT') + ')';

    var briefingBlock = '<div class="briefing"><div class="bh"><h3>🔒 Briefing do gestor <span style="font-weight:500;font-size:12px;color:var(--ink-3)">— uso interno, não vai no print/cliente.</span></h3><button class="rep-copy" id="repCopy">📋 Copiar briefing</button></div>' +
      brief.map(function (s) { return '<div class="brief-sub"><div class="bt">' + s.t + '</div>' + s.h + '</div>'; }).join('') +
      '<div class="brief-scratch"><div class="bt" style="color:var(--brand)">✍️ Suas anotações (rascunho)</div><textarea data-note="scratch" rows="3" placeholder="rascunho livre pra você…"></textarea></div></div>';

    $('reportView').innerHTML = '<div class="report"><div class="rep-head"><div><h2>📄 Relatório — ' + esc(perLabel) + '</h2>' +
      '<p class="sub" style="margin-top:2px">Muda sozinho conforme o período · dados de ' + esc(D.generatedAt || '—') + '</p></div></div>' +
      '<p class="sub" style="margin:0 0 8px">⬇️ Blocos visuais limpos (é o que você manda em print pro cliente). Seu <b style="color:var(--ink-2)">briefing interno</b> fica no final.</p>' +
      secVisual + briefingBlock + '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('#reportView [data-note]'), function (t) {
      var k = 'dv-note-' + t.dataset.note; try { t.value = localStorage.getItem(k) || ''; } catch (e) { }
      t.oninput = function () { try { localStorage.setItem(k, t.value); } catch (e) { } };
    });
    Array.prototype.forEach.call(document.querySelectorAll('#reportView [data-adlink]'), function (inp) {
      var k = 'dv-adlink-' + decodeURIComponent(inp.dataset.adlink); try { inp.value = localStorage.getItem(k) || ''; } catch (e) { }
      inp.oninput = function () { try { localStorage.setItem(k, inp.value); } catch (e) { } };
    });
    $('repCopy').onclick = function (e) {
      var btn = e.currentTarget, scratch = ''; try { scratch = (localStorage.getItem('dv-note-scratch') || '').trim(); } catch (_) { }
      var full = briefText + (scratch ? '\n\nSUAS ANOTAÇÕES\n' + scratch : '');
      navigator.clipboard.writeText(full).then(function () { btn.textContent = '✅ Copiado!'; setTimeout(function () { btn.textContent = '📋 Copiar briefing'; }, 1800); }).catch(function () { btn.textContent = '❌ copie manualmente'; });
    };
  }

  /* ================================================================ filtro de campanha */
  function setCamps(sel) {
    if (!sel || sel.length === 0 || sel.length >= ALL_CAMPS.length) STATE.camps = null;
    else { STATE.camps = {}; sel.forEach(function (n) { STATE.camps[n] = true; }); }
    try { localStorage.setItem('dv-camps', STATE.camps ? JSON.stringify(Object.keys(STATE.camps)) : ''); } catch (e) { }
    updateCampBtn();
  }
  function updateCampBtn() {
    var b = $('campBtn'); if (!b) return;
    b.textContent = (STATE.camps ? (campSelectedCount() + ' de ' + ALL_CAMPS.length + ' campanhas') : 'Todas as campanhas') + ' ▾';
    b.classList.toggle('on', campFilterActive());
  }
  function renderCampPanel() {
    var p = $('campPanel'); if (!p) return;
    var allChecked = !STATE.camps;
    var rows = ALL_CAMPS.map(function (c) {
      var ck = allChecked || (STATE.camps && STATE.camps[c] === true);
      return '<label class="dd-item"><input type="checkbox" data-camp="' + encodeURIComponent(c) + '"' + (ck ? ' checked' : '') + '><b class="dd-sp">' + money0(CAMP_SPEND[c]) + '</b><span class="dd-nm">' + esc(c) + '</span></label>';
    }).join('');
    p.innerHTML = '<div class="dd-head"><span>Filtrar campanhas</span><button class="dd-mini" id="campAll">Selecionar todas</button></div>' + rows;
    function current() { var a = []; Array.prototype.forEach.call(p.querySelectorAll('[data-camp]'), function (cb) { if (cb.checked) a.push(decodeURIComponent(cb.dataset.camp)); }); return a; }
    Array.prototype.forEach.call(p.querySelectorAll('[data-camp]'), function (cb) { cb.onchange = function () { setCamps(current()); refresh(); }; });
    $('campAll').onclick = function () { Array.prototype.forEach.call(p.querySelectorAll('[data-camp]'), function (cb) { cb.checked = true; }); setCamps(null); refresh(); };
  }
  function initCampSelector() {
    var b = $('campBtn'), p = $('campPanel'); if (!b || !p) return;
    try { var saved = localStorage.getItem('dv-camps'); if (saved) { var a = JSON.parse(saved).filter(function (n) { return ALL_CAMPS.indexOf(n) >= 0; }); if (a.length && a.length < ALL_CAMPS.length) { STATE.camps = {}; a.forEach(function (n) { STATE.camps[n] = true; }); } } } catch (e) { }
    updateCampBtn();
    b.onclick = function (e) { e.stopPropagation(); var open = p.hidden; if (open) renderCampPanel(); p.hidden = !open; b.setAttribute('aria-expanded', String(open)); };
    p.onclick = function (e) { e.stopPropagation(); };
    document.addEventListener('click', function () { if (!p.hidden) { p.hidden = true; b.setAttribute('aria-expanded', 'false'); } });
  }
  function filterBarHTML() {
    if (STATE.campGroup && STATE.campGroup !== 'all')
      return '<div class="filterbar">🎯 <b>Campanha: ' + esc(GROUP_LABEL[STATE.campGroup]) + '</b> — os números de mídia refletem só essa campanha. O faturamento das secretárias é sempre o total da operação.</div>';
    if (campFilterActive()) return '<div class="filterbar">🔎 <b>Filtro de campanha ativo</b> — ' + campSelectedCount() + ' de ' + ALL_CAMPS.length + ' campanhas.</div>';
    return '';
  }

  /* ================================================================ shell / roteamento */
  function refresh() {
    var len = diffDays(STATE.from, STATE.to) + 1;
    $('filterBar').innerHTML = filterBarHTML();
    $('cmpNote').textContent = STATE.compare
      ? 'comparando com ' + brFull(dayAdd(dayAdd(STATE.from, -1), -(len - 1))) + ' – ' + brFull(dayAdd(STATE.from, -1)) + ' (' + len + (len > 1 ? ' dias' : ' dia') + ')'
      : len + (len > 1 ? ' dias selecionados' : ' dia selecionado');
    $('overviewView').hidden = STATE.tab !== 'overview';
    $('trafficView').hidden = STATE.tab !== 'traffic';
    $('reportView').hidden = STATE.tab !== 'report';
    if (STATE.tab === 'overview') renderOverview();
    else if (STATE.tab === 'traffic') renderTraffic();
    else renderReport();
  }
  function setPeriod(from, to, preset) {
    STATE.from = clampD(from); STATE.to = clampD(to); STATE.preset = preset || 'custom';
    $('from').value = STATE.from; $('to').value = STATE.to;
    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) { b.setAttribute('aria-pressed', b.dataset.preset === STATE.preset); });
    refresh();
  }

  function shell() {
    var m = D;
    $('subtitle').innerHTML = '<b>Funil de captação</b> · conversas (WhatsApp) + LP · dados de ' + brFull(minDate) + ' a ' + brFull(maxDate) + ' · ' + int(daily.length) + ' dias com registro';
    $('updated').textContent = 'atualizado ' + esc(m.generatedAt || '—') + ' ' + esc(m.tz || 'BRT');
    $('taxBadge').textContent = TAX === 1 ? 'sem imposto' : 'imposto ×' + taxStr(TAX);
    $('from').min = $('to').min = minDate; $('from').max = $('to').max = maxDate;

    var totalSpend = daily.reduce(function (s, r) { return s + r.spend; }, 0);
    var totConv = daily.reduce(function (s, r) { return s + r.conv; }, 0);
    var totSched = daily.reduce(function (s, r) { return s + r.sched; }, 0);
    $('footer').innerHTML =
      'Gasto total do período completo: ' + money(totalSpend) + ' (já com imposto ×' + taxStr(TAX) + '). ' +
      'Fonte: <b>Meta Graph API</b> (insights nível anúncio) · conta <code>' + esc(m.account || '') + '</code> + planilha das secretárias (faturamento). ' +
      '<b>Conversas</b> = conversa iniciada no WhatsApp (' + int(totConv) + ' no total) · <b>Programar</b> = conversão da LP (' + int(totSched) + '). ' +
      'CTR sempre de <b>link</b>. Somente leitura.';

    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
      b.onclick = function () {
        var p = b.dataset.preset;
        if (p === 'all') return setPeriod(minDate, maxDate, 'all');
        if (p === 'today') return setPeriod(maxDate, maxDate, 'today');
        if (p === 'yesterday') { var y = dayAdd(maxDate, -1); return setPeriod(y, y, 'yesterday'); }
        if (p === 'month') return setPeriod(firstOfMonth(maxDate), maxDate, 'month');
        var n = +p; return setPeriod(dayAdd(maxDate, -(n - 1)), maxDate, p);
      };
    });
    function clampDates() { var f = $('from').value, t = $('to').value; if (!f || !t) return; if (f > t) { var tmp = f; f = t; t = tmp; } setPeriod(f, t, 'custom'); }
    $('from').onchange = clampDates; $('to').onchange = clampDates;
    $('cmp').onclick = function (e) { STATE.compare = !STATE.compare; e.currentTarget.classList.toggle('on', STATE.compare); e.currentTarget.setAttribute('aria-pressed', STATE.compare); refresh(); };

    try { var tv = localStorage.getItem('dv-tab'); if (['overview', 'traffic', 'report'].indexOf(tv) >= 0) STATE.tab = tv; } catch (e) { }
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === STATE.tab);
      b.onclick = function () {
        STATE.tab = b.dataset.tab;
        try { localStorage.setItem('dv-tab', STATE.tab); } catch (e) { }
        Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (x) { x.setAttribute('aria-selected', x.dataset.tab === STATE.tab); });
        refresh();
      };
    });

    // abas de campanha (grupo): Todas / Quiz / Mensagem / Seguidores
    try { var cg = localStorage.getItem('dv-campgroup'); if (['all', 'quiz', 'msg', 'seg'].indexOf(cg) >= 0) STATE.campGroup = cg; } catch (e) { }
    Array.prototype.forEach.call(document.querySelectorAll('[data-camp-group]'), function (b) {
      b.setAttribute('aria-selected', b.dataset.campGroup === STATE.campGroup);
      b.onclick = function () {
        STATE.campGroup = b.dataset.campGroup;
        try { localStorage.setItem('dv-campgroup', STATE.campGroup); } catch (e) { }
        Array.prototype.forEach.call(document.querySelectorAll('[data-camp-group]'), function (x) { x.setAttribute('aria-selected', x.dataset.campGroup === STATE.campGroup); });
        refresh();
      };
    });

    initCampSelector();
    setPeriod(minDate, maxDate, 'all');
    fetchLeads(function () { if (STATE.tab === 'overview' && (STATE.campGroup === 'all' || STATE.campGroup === 'quiz')) refresh(); });
  }

  /* ---------------------------------------------------------------- tema */
  function applyTheme(t) { document.documentElement.dataset.theme = t; $('theme').textContent = t === 'dark' ? 'Claro' : 'Escuro'; try { localStorage.setItem('dv-theme', t); } catch (e) { } }
  $('theme').onclick = function () { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); };
  $('refresh').onclick = function () { var b = this; b.textContent = '⏳ Atualizando…'; b.disabled = true; setTimeout(function () { location.reload(); }, 60); };
  try { var saved = localStorage.getItem('dv-theme'); applyTheme(saved || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')); } catch (e) { applyTheme('dark'); }

  /* ---------------------------------------------------------------- boot */
  TIP = $('tip');
  var rt;
  addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (daily.length) refresh(); }, 180); });
  if (!daily.length) { $('overviewView').innerHTML = '<div class="panel"><div class="loading">Sem dados. Rode o build.</div></div>'; }
  else shell();
})();
