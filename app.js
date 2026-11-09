/* SYS Admin — შუალედურისთვის მზადება
   სამი რეჟიმი: ბარათები (ვიცი/არ ვიცი), ყველა კითხვა, საგამოცდო სიმულაცია.
   პროგრესი ინახება ბრაუზერში (localStorage) — თითოეულ სტუდენტს თავისი. */
(function () {
  'use strict';

  const QS = (typeof window !== 'undefined' && window.QUESTIONS) || [];
  const QZ = (typeof window !== 'undefined' && window.QUIZZES) || {};
  const byId = new Map(QS.map((q) => [q.id, q]));
  const TYPES = {
    def: { label: 'განმარტება', many: 'განმარტებები' },
    open: { label: 'ღია კითხვა', many: 'ღია კითხვები' },
    mcq: { label: 'ტესტი', many: 'ტესტები' },
  };
  const LET = ['ა', 'ბ', 'გ', 'დ', 'ე', 'ვ'];
  const PLAN = [['def', 5], ['open', 5], ['mcq', 10]];
  const MCQ_MIX = { orig: 6, variation: 2, generated: 2 };
  // ტერმინები, რომლებიც ერთმანეთის „არასწორ ვარიანტად" არ გამოდგება (ძალიან ჰგავს)
  const CONFUSABLE = [
    ['Print Server', 'PDS', 'Network Printing'], ['IIS', 'ვებ სერვერი'], ['Mail server', 'SMTP'],
    ['CA', 'PKI'], ['VPN', 'Remote Access'], ['RDS', 'RDG'], ['LPD', 'LPR'], ['App-V', 'MDOP'],
    ['ხე (Tree)', 'ტყე (Forest)', 'დომენი', 'Child Domain'], ['Hypervisor', 'Nested Virtualization'],
    ['NOS', 'სერვერი'], ['DC', 'Member server'],
  ];

  /* ───────────────────────── სუფთა ლოგიკა (ტესტირებადი) ───────────────────────── */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    rnd = rnd || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  const Logic = {
    mulberry32, shuffle,

    filterQs(qs, f) {
      const quiz = (f && f.quiz) || 'all';
      const type = (f && f.type) || 'all';
      return qs.filter((q) => (quiz === 'all' || q.quizzes.includes(+quiz)) && (type === 'all' || q.type === type));
    },

    /* ბარათების რიგი: მხოლოდ „არ ვიცი"/ახალი კითხვები; ხშირად შეცდომილი — უფრო ადრე */
    flashQueue(ids, learned, miss, rnd) {
      rnd = rnd || Math.random;
      return ids.filter((id) => !learned[id])
        .map((id) => ({ id, k: rnd() - Math.min(miss[id] || 0, 4) * 0.3 }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.id);
    },

    /* „არ ვიცი" → კითხვა ბრუნდება რიგში რამდენიმე ბარათის შემდეგ (არა მაშინვე) */
    requeue(queue, id, misses, rnd) {
      rnd = rnd || Math.random;
      const rest = queue.filter((x) => x !== id);
      if (!rest.length) return [id];
      const base = misses >= 2 ? 2 : 3;
      const pos = Math.min(rest.length, base + Math.floor(rnd() * 3));
      rest.splice(pos, 0, id);
      return rest;
    },

    /* „Domain Name System — სისტემა, რომელიც…" → „სისტემა, რომელიც…" (რომ პასუხი არ გასცეს) */
    stripExpansion(text) {
      const m = String(text).match(/^[A-Za-z0-9 ,.'()&\-]+ — ([\s\S]+)$/);
      return m ? m[1] : text;
    },

    confusableWith(term) {
      const out = new Set();
      CONFUSABLE.forEach((g) => { if (g.includes(term)) g.forEach((t) => out.add(t)); });
      return out;
    },

    /* განმარტებიდან ტესტის აწყობა (ორი ფორმით) — მხოლოდ ბაზაში არსებული მასალით */
    genFromDef(d, defs, rnd) {
      rnd = rnd || Math.random;
      const bad = Logic.confusableWith(d.term);
      const others = defs.filter((x) => x.id !== d.id && !bad.has(x.term));
      const pool = shuffle(others.filter((x) => x.quiz === d.quiz), rnd).concat(shuffle(others.filter((x) => x.quiz !== d.quiz), rnd));
      const body = Logic.stripExpansion(d.a);
      const shortTerm = d.term.replace(/\s*\(.*\)\s*/, '').toLowerCase();
      const canReverse = shortTerm.length > 2 ? !body.toLowerCase().includes(shortTerm) : true;
      const style = canReverse && rnd() < 0.5 ? 'reverse' : 'forward';
      const take = (getter, correct) => {
        const seen = new Set([correct]); const out = [];
        for (const x of pool) { const t = getter(x); if (!seen.has(t)) { seen.add(t); out.push(t); } if (out.length === 3) break; }
        return out;
      };
      let q, correctText, distract;
      if (style === 'forward') {
        q = 'რა არის ' + d.term + '?';
        correctText = body;
        distract = take((x) => Logic.stripExpansion(x.a), body);
      } else {
        q = 'რომელ ტერმინს შეესაბამება განმარტება:\n«' + body + '»';
        correctText = d.term;
        distract = take((x) => x.term, d.term);
      }
      const options = shuffle([correctText].concat(distract), rnd);
      return {
        kind: 'mcq', qid: 'gen:' + d.id + ':' + style, src: 'generated', from: d.id, quiz: d.quiz,
        q, options, correct: [options.indexOf(correctText)],
        note: 'ეს ტესტი ავტომატურად აეწყო ტერმინის „' + d.term + '" განმარტებიდან.',
      };
    },

    mcqItem(q, src, rnd) {
      const order = shuffle(q.options.map((_, i) => i), rnd);
      return {
        kind: 'mcq', qid: q.id, src, quiz: q.quiz, q: q.q,
        options: order.map((i) => q.options[i]),
        correct: q.correct.map((c) => order.indexOf(c)),
        note: q.note || '',
      };
    },

    /* გამოცდა: 5 განმარტება + 5 ღია + 10 ტესტი; ბოლო გამოცდების კითხვებს ერიდება */
    buildExam(qs, rnd, recent) {
      rnd = rnd || Math.random;
      const recentSet = new Set(recent || []);
      const pick = (pool, n) => shuffle(pool.filter((q) => !recentSet.has(q.id)), rnd)
        .concat(shuffle(pool.filter((q) => recentSet.has(q.id)), rnd)).slice(0, n);
      const defs = qs.filter((q) => q.type === 'def');
      const opens = qs.filter((q) => q.type === 'open');
      const orig = qs.filter((q) => q.type === 'mcq' && !q.variation);
      const vars = qs.filter((q) => q.type === 'mcq' && q.variation);

      const spareDefs = Math.max(0, defs.length - 5);
      const errors = [];
      if (defs.length < 5) errors.push('განმარტებები: საჭიროა 5, ბაზაში არის ' + defs.length + '.');
      if (opens.length < 5) errors.push('ღია კითხვები: საჭიროა 5, ბაზაში არის ' + opens.length + '.');
      const genPossible = spareDefs >= 4 ? spareDefs : 0;
      if (orig.length + vars.length + genPossible < 10) errors.push('ტესტები: საჭიროა 10, ხელმისაწვდომია ' + (orig.length + vars.length + genPossible) + '.');
      if (errors.length) return { error: errors };

      const chosenDefs = pick(defs, 5);
      const usedDef = new Set(chosenDefs.map((q) => q.id));
      const chosenOpen = pick(opens, 5);

      let nGen = Math.min(MCQ_MIX.generated, genPossible);
      let nVar = Math.min(MCQ_MIX.variation, vars.length);
      let nOrig = Math.min(10 - nGen - nVar, orig.length);
      let short = 10 - nGen - nVar - nOrig;
      if (short > 0) { const add = Math.min(short, vars.length - nVar); nVar += add; short -= add; }
      if (short > 0) nGen += short;

      const freeDefs = defs.filter((d) => !usedDef.has(d.id));
      const mcqs = pick(orig, nOrig).map((q) => Logic.mcqItem(q, 'orig', rnd))
        .concat(pick(vars, nVar).map((q) => Logic.mcqItem(q, 'variation', rnd)))
        .concat(pick(freeDefs, nGen).map((d) => Logic.genFromDef(d, freeDefs, rnd)));

      const textItem = (kind) => (q) => ({ kind, qid: q.id, quiz: q.quiz, q: q.q, a: q.a, answer: '' });
      const items = chosenDefs.map(textItem('def'))
        .concat(chosenOpen.map(textItem('open')))
        .concat(shuffle(mcqs, rnd).map((m) => Object.assign(m, { picked: null })));
      items.forEach((it) => { it.submitted = false; it.result = null; });
      return { id: Date.now().toString(36), started: Date.now(), pos: 0, finished: false, items };
    },

    score(exam) {
      const by = { def: [0, 0], open: [0, 0], mcq: [0, 0] };
      let c = 0;
      exam.items.forEach((it) => { by[it.kind][1]++; if (it.result === true) { by[it.kind][0]++; c++; } });
      const total = exam.items.length;
      return { correct: c, total, wrong: total - c, pct: total ? Math.round((c / total) * 100) : 0, by };
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Logic;
  if (typeof document === 'undefined') return;

  /* ───────────────────────── მეხსიერება (localStorage) ───────────────────────── */

  const KEY = 'sysadmin-midterm-v1';
  const defaults = () => ({
    flash: { learned: {}, miss: {}, quiz: 'all', review: false, current: null },
    all: { type: 'all', quiz: 'all', order: 'seq', seed: 1, idx: 0, seen: {} },
    exam: { current: null, history: [], recent: [] },
  });
  let storageOK = true;
  function load() {
    const d = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return d;
      const s = JSON.parse(raw);
      return {
        flash: Object.assign(d.flash, s.flash),
        all: Object.assign(d.all, s.all),
        exam: Object.assign(d.exam, s.exam),
      };
    } catch (e) { storageOK = false; return d; }
  }
  let saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    const run = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; } catch (e) { storageOK = false; } };
    if (now) run(); else saveTimer = setTimeout(run, 150);
  }
  try { localStorage.setItem(KEY + '-t', '1'); localStorage.removeItem(KEY + '-t'); } catch (e) { storageOK = false; }

  const S = load();
  // წაშლილი კითხვების ნარჩენების გასუფთავება
  Object.keys(S.flash.learned).forEach((id) => { if (!byId.has(id)) delete S.flash.learned[id]; });

  const U = { fq: null, fqKey: null, fRevealed: false, fPicked: null, aRevealed: false, aPicked: null, confirm: null, resFilter: 'all', lastCard: null, anim: true };

  /* ───────────────────────── დამხმარეები ───────────────────────── */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  function fmt(text) {
    let html = ''; let inList = false;
    String(text || '').split('\n').forEach((raw) => {
      const line = raw.trim();
      if (!line) { if (inList) { html += '</ul>'; inList = false; } return; }
      if (line.startsWith('- ')) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inline(line.slice(2)) + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<p>' + inline(line) + '</p>';
      }
    });
    if (inList) html += '</ul>';
    return html;
  }
  const IC = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    left: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    right: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    eye: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/></svg>',
    disk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M7 7h.01M7 14h.01"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    reset: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  };
  function ring(value, total, cls, label) {
    const r = 46; const c = 2 * Math.PI * r;
    const p = total ? Math.min(1, value / total) : 0;
    return '<div class="ring ' + (cls || '') + '"><svg viewBox="0 0 110 110" aria-hidden="true"><circle class="track" cx="55" cy="55" r="' + r + '"/><circle class="val" cx="55" cy="55" r="' + r + '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - p)).toFixed(1) + '"/></svg><div class="ring-label">' + label + '</div></div>';
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const srcLabel = (q) => {
    if (!q) return '';
    const quizzes = (q.quizzes || [q.quiz]).map((n) => 'ქვიზი ' + n).join(' + ');
    return q.variation ? quizzes.replace('ქვიზი', 'თემა: ქვიზი') : quizzes + ' · ' + TYPES[q.type].label + ' #' + q.num;
  };
  const typeTag = (type) => '<span class="tag t-' + type + '"><i></i>' + TYPES[type].label + '</span>';
  const fmtDate = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' · ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  function announce(msg) { const el = document.getElementById('live'); if (el) { el.textContent = ''; setTimeout(() => { el.textContent = msg; }, 30); } }
  function seg(act, value, items) {
    return '<div class="seg" role="group">' + items.map((it) => '<button type="button" data-act="' + act + '" data-v="' + esc(it[0]) + '" aria-pressed="' + (String(value) === String(it[0])) + '">' + esc(it[1]) + '</button>').join('') + '</div>';
  }
  function confirmBtn(key, label, act, extraCls) {
    if (U.confirm === key) {
      return '<div class="confirm" role="alert"><p>დარწმუნებული ხარ? ამას ვერ დააბრუნებ.</p><div><button class="btn btn-sm btn-bad" data-act="' + act + '">დიახ</button><button class="btn btn-sm" data-act="cancelConfirm">არა</button></div></div>';
    }
    return '<button class="btn btn-sm ' + (extraCls || 'btn-quiet') + '" data-act="askConfirm" data-key="' + key + '">' + IC.reset + label + '</button>';
  }
  function quizChoices(act, value, counter) {
    const keys = ['all'].concat(Object.keys(QZ));
    return '<div class="choices">' + keys.map((k) => {
      const info = k === 'all' ? { name: 'ყველა ქვიზი', topic: 'მთელი მასალა' } : QZ[k];
      return '<button type="button" class="choice" data-act="' + act + '" data-v="' + k + '" aria-pressed="' + (String(value) === k) + '"><span><b>' + esc(info.name) + '</b><small>' + esc(info.topic) + '</small></span><span class="cnt">' + counter(k) + '</span></button>';
    }).join('') + '</div>';
  }

  /* ───────────────────────── კითხვის ბარათი ───────────────────────── */

  function prompt(q) {
    if (q.type === 'def') return '<p class="kicker">განმარტე ტერმინი</p><h2 class="term">' + esc(q.term) + '</h2>';
    if (q.type === 'open') return '<p class="kicker">უპასუხე კითხვას</p><h2 class="qtext">' + esc(q.q) + '</h2>';
    return '<p class="kicker">აირჩიე სწორი პასუხი</p><h2 class="qtext">' + esc(q.q) + '</h2>';
  }
  function optionsHtml(options, correct, picked, revealed, act) {
    return '<div class="options" role="group" aria-label="პასუხის ვარიანტები">' + options.map((o, i) => {
      let cls = 'opt'; let mark = '';
      if (revealed) {
        if (correct.includes(i)) { cls += ' right'; mark = IC.check; }
        else if (picked === i) { cls += ' wrong'; mark = IC.x; }
        else cls += ' dim';
      } else if (picked === i) cls += ' sel';
      const status = revealed ? (correct.includes(i) ? ' (სწორი პასუხი)' : (picked === i ? ' (შენი არჩევანი, არასწორი)' : '')) : '';
      return '<button type="button" class="' + cls + '" data-act="' + act + '" data-i="' + i + '"' + (revealed ? ' disabled' : '') + ' aria-pressed="' + (picked === i) + '" aria-label="' + LET[i] + ') ' + esc(o) + status + '"><span class="let">' + LET[i] + '</span><span class="txt">' + esc(o) + '</span><span class="mark">' + mark + '</span></button>';
    }).join('') + '</div>';
  }
  const EXPL = (typeof window !== 'undefined' && window.EXPLAIN) || {};
  const BULB = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>';
  function explainHtml(qtext) {
    const t = EXPL[qtext]; if (!t) return '';
    const body = t.replace(/^(რას გეკითხება:|მარტივად:)/gm, '**$1**');
    return '<div class="explain"><div class="explain-label">' + BULB + 'მარტივად</div><div class="prose">' + fmt(body) + '</div></div>';
  }
  function explainBtn(qid, qtext, before) {
    if (!EXPL[qtext]) return '';
    return '<button type="button" class="explain-btn" data-act="explain" data-id="' + esc(qid) + '">' + BULB + (before ? 'კითხვა ვერ გავიგე — ამიხსენი მარტივად' : 'ვერ გავიგე — ამიხსენი მარტივად') + '</button>';
  }
  function noteHtml(note) { return note ? '<div class="note">' + IC.info + '<span>' + esc(note) + '</span></div>' : ''; }
  function answerHtml(q) {
    return '<div class="answer"><div class="answer-label">' + IC.check.replace('<svg', '<svg width="14" height="14"') + 'პასუხი</div><div class="prose">' + fmt(q.a) + '</div></div>';
  }
  /* ბარათები და „ყველა კითხვა" იყენებს ერთსა და იმავე ბარათს */
  function studyCard(q, revealed, picked, pickAct, headExtra, actions) {
    const key = q.id + '|' + location.hash;
    const anim = U.anim && U.lastCard !== key; U.lastCard = key;
    let body = prompt(q);
    if (q.type === 'mcq') {
      body += optionsHtml(q.options, q.correct, picked, revealed, pickAct);
      if (revealed) {
        if (picked !== null && picked !== undefined) body += verdictHtml(q.correct.includes(picked), q.correct, q.options);
        body += noteHtml(q.note);
      }
    } else {
      const explained = U.explainKey === q.id;
      if (explained) body += explainHtml(q.q);
      if (revealed || explained) body += answerHtml(q);
      if (!explained) body += explainBtn(q.id, q.q, !revealed);
    }
    return '<article class="panel card t-' + q.type + (anim ? ' enter' : '') + '" aria-label="კითხვა">' +
      '<header class="card-head">' + typeTag(q.type) + (q.variation ? '<span class="tag var">ვარიაცია</span>' : '') +
      '<span class="src">' + esc(srcLabel(q)) + '</span><span class="spacer"></span>' + (headExtra || '') + '</header>' +
      '<div class="card-body">' + body + '</div><footer class="card-actions">' + actions + '</footer></article>';
  }
  function verdictHtml(ok, correct, options) {
    const right = correct.map((i) => LET[i]).join(' ან ');
    return ok
      ? '<div class="verdict ok">' + IC.check + '<span>სწორია!</span></div>'
      : '<div class="verdict bad">' + IC.x + '<span>არასწორია — სწორი პასუხი: ' + right + ')</span></div>';
  }

  /* ───────────────────────── მთავარი გვერდი ───────────────────────── */

  function viewHome() {
    const orig = QS.filter((q) => !q.variation);
    const vars = QS.length - orig.length;
    const n = { def: 0, open: 0, mcq: 0 };
    orig.forEach((q) => { n[q.type]++; });
    const learned = QS.filter((q) => S.flash.learned[q.id]).length;
    const hist = S.exam.history.slice().reverse();
    const last = hist[0];
    const running = S.exam.current && !S.exam.current.finished;

    const rows = hist.slice(0, 6).map((h, i) => {
      const p = pct(h.correct, h.total);
      return '<div class="row"><span class="n">' + String(hist.length - i).padStart(2, '0') + '</span><span class="d">' + fmtDate(h.date) + '</span><span class="s">' + h.correct + '/' + h.total + '</span><span class="p">' + p + '%</span><span class="mini-bar ' + (p >= 70 ? 'good' : p < 50 ? 'low' : '') + '"><i style="width:' + p + '%"></i></span></div>';
    }).join('');

    return '<section class="hero">' +
      '<div class="hero-main">' +
        '<p class="eyebrow"><span class="led"></span>სისტემების ადმინისტრირება · შუალედური გამოცდა</p>' +
        '<h1>ისწავლე. გაიმეორე. <em>ჩააბარე.</em></h1>' +
        '<p class="lead">' + orig.length + ' კითხვა ოთხივე ქვიზიდან და ' + vars + ' დამატებითი ვარიაცია. აირჩიე რეჟიმი ქვემოთ — ყველაფერი ავტომატურად ინახება.</p>' +
        '<div class="hero-cta">' +
          '<a class="btn btn-primary btn-lg" href="#/flash">' + (learned ? 'სწავლის გაგრძელება' : 'სწავლის დაწყება') + IC.arrow + '</a>' +
          '<a class="btn btn-lg" href="#/exam">' + (running ? 'გამოცდის გაგრძელება' : 'გამოცდის დაწყება') + '</a>' +
        '</div>' +
      '</div>' +
      '<aside class="panel status" aria-label="შენი პროგრესი">' +
        '<div class="panel-title" style="margin:0"><span class="led ok"></span>შენი პროგრესი</div>' +
        '<div class="status-top">' + ring(learned, QS.length, learned === QS.length && learned ? 'ok' : '', '<b>' + pct(learned, QS.length) + '%</b><span>ნასწავლი</span>') +
          '<div class="status-copy"><h3>' + learned + ' / ' + QS.length + ' ბარათი ისწავლე</h3><p>' + (learned ? 'დარჩა ' + (QS.length - learned) + '. გააგრძელე იქიდან, სადაც გაჩერდი.' : 'ჯერ არაფერი მოგინიშნავს „ვიცი"-თ. დაიწყე ბარათებით.') + '</p></div></div>' +
        '<div class="stat-grid">' +
          '<div class="stat"><b>' + n.def + '</b><span>განმარტება</span></div>' +
          '<div class="stat"><b>' + n.open + '</b><span>ღია კითხვა</span></div>' +
          '<div class="stat"><b>' + n.mcq + '</b><span>ტესტი</span></div>' +
        '</div>' +
        (last ? '<div class="last-exam">' + IC.flag.replace('<svg', '<svg width="18" height="18"') + '<span>ბოლო გამოცდა: <b>' + last.correct + '/' + last.total + '</b> (' + pct(last.correct, last.total) + '%) · ' + fmtDate(last.date) + '</span></div>' : '<div class="last-exam">' + IC.flag.replace('<svg', '<svg width="18" height="18"') + '<span>გამოცდა ჯერ არ გაგივლია — სცადე, 20 კითხვაა.</span></div>') +
      '</aside>' +
    '</section>' +

    '<section class="modes" aria-label="რეჟიმები">' +
      modeCard('#/flash', '01', 'ბარათები', 'ხედავ კითხვას, იხსენებ, ნახულობ პასუხს და აჭერ „ვიცი" ან „არ ვიცი". ნასწავლი ქრება, უცოდინარი ბრუნდება.', learned + ' / ' + QS.length + ' ნასწავლი') +
      modeCard('#/all', '02', 'ყველა კითხვა', 'მთელი მასალა ერთ ადგილას, გამოტოვების გარეშე. გადადი წინ/უკან და გახსენი პასუხი როცა გინდა.', QS.length + ' კითხვა') +
      modeCard('#/exam', '03', 'საგამოცდო სიმულაცია', 'ნამდვილი გამოცდის ფორმატი: 5 განმარტება, 5 ღია კითხვა, 10 ტესტი. ყოველ ჯერზე სხვა კითხვები.', running ? 'მიმდინარეობს — გააგრძელე' : '20 კითხვა') +
    '</section>' +

    '<section class="home-bottom">' +
      '<div class="panel panel-pad"><div class="panel-title">ბოლო გამოცდები</div>' +
        (rows ? '<div class="rows"><div class="row row-head"><span>#</span><span>თარიღი</span><span class="s">ქულა</span><span class="p">%</span><span class="bh"></span></div>' + rows + '</div>' : '<p class="empty-note">აქ გამოჩნდება შენი გამოცდების შედეგები.</p>') +
      '</div>' +
      '<div class="panel panel-pad"><div class="panel-title">კარგი იქნება თუ იცი</div><div class="info-list">' +
        '<div class="info-item"><span class="info-ic">' + IC.file + '</span><div><b>საიდან არის კითხვები?</b><p>ოთხი ქვიზის ფაილიდან, ზუსტად იმ ფორმით, როგორც იქ წერია. ლაბის (პრაქტიკული) ნაწილი არ შედის.</p></div></div>' +
        '<div class="info-item warn"><span class="info-ic">' + IC.warn + '</span><div><b>პასუხები AI-ს დაწერილია</b><p>ქვიზებში პასუხები არ ეწერა, ამიტომ ისინი Windows Server 2019-ის კურსის მასალის მიხედვით დაიწერა. თუ ლექტორის პასუხი განსხვავდება — ენდე ლექტორს.</p></div></div>' +
        '<div class="info-item"><span class="info-ic">' + IC.disk + '</span><div><b>პროგრესი ინახება ამ ბრაუზერში</b><p>ყველას თავისი პროგრესი აქვს. სხვა მოწყობილობაზე ან სხვა ბრაუზერში თავიდან დაიწყება.</p></div></div>' +
        (storageOK ? '' : '<div class="alert">ბრაუზერი პროგრესის შენახვის უფლებას არ იძლევა (შესაძლოა Private/Incognito რეჟიმია). საიტი იმუშავებს, მაგრამ გვერდის განახლებისას პროგრესი დაიკარგება.</div>') +
      '</div></div>' +
    '</section>';
  }
  function modeCard(href, num, title, text, meta) {
    return '<a class="panel mode" href="' + href + '"><span class="mode-glyph" aria-hidden="true">' + num + '</span><span class="mode-num">' + num + '</span><h2>' + title + '</h2><p>' + text + '</p><span class="mode-foot"><span>' + meta + '</span><span class="mode-arrow">' + IC.arrow + '</span></span></a>';
  }

  /* ───────────────────────── 1. ბარათები ───────────────────────── */

  function flashIds() { return Logic.filterQs(QS, { quiz: S.flash.quiz }).map((q) => q.id); }
  function ensureQueue(force) {
    const f = S.flash; const key = (f.review ? 'r' : 'l') + f.quiz;
    if (!force && U.fq && U.fqKey === key) return;
    const ids = flashIds();
    if (f.review) U.fq = shuffle(ids.filter((id) => f.learned[id]));
    else {
      U.fq = Logic.flashQueue(ids, f.learned, f.miss);
      if (f.current && U.fq.includes(f.current)) U.fq = [f.current].concat(U.fq.filter((x) => x !== f.current));
    }
    U.fqKey = key; U.fRevealed = false; U.fPicked = null;
  }

  function viewFlash() {
    ensureQueue();
    const f = S.flash;
    const ids = flashIds();
    const learnedN = ids.filter((id) => f.learned[id]).length;
    const left = ids.length - learnedN;
    const q = byId.get(U.fq[0]);
    if (!f.review && q) { if (f.current !== q.id) { f.current = q.id; save(); } }

    let main;
    if (!ids.length) {
      main = doneCard('neutral', IC.info, 'ამ ფილტრში კითხვა არ არის', 'აირჩიე სხვა ქვიზი მარჯვნივ.', '');
    } else if (!q && !f.review) {
      main = doneCard('', IC.check, 'ყველა ბარათი ისწავლე!', 'ამ თემის ' + ids.length + '-ვე კითხვა მონიშნე „ვიცი"-თ. ახლა სცადე გამოცდა ან გადახედე ნასწავლს.',
        '<a class="btn btn-primary" href="#/exam">გამოცდის დაწყება</a><button class="btn" data-act="flashMode" data-v="review">ნასწავლის გადახედვა</button>');
    } else if (!q && f.review) {
      main = learnedN
        ? doneCard('', IC.check, 'გადახედვა დასრულდა', 'ყველა ნასწავლი ბარათი ნახე. რაც დაგავიწყდა, ისევ სასწავლ რიგში დაბრუნდა.', '<button class="btn btn-primary" data-act="flashAgain">კიდევ ერთხელ</button><button class="btn" data-act="flashMode" data-v="learn">სწავლაზე დაბრუნება</button>')
        : doneCard('neutral', IC.info, 'ჯერ არაფერი გისწავლია', 'როცა ბარათზე „ვიცი"-ს დააჭერ, ის აქ გამოჩნდება.', '<button class="btn btn-primary" data-act="flashMode" data-v="learn">სწავლის დაწყება</button>');
    } else {
      const miss = f.miss[q.id] || 0;
      const head = (miss ? '<span class="tag warn">არ ვიცი ×' + miss + '</span>' : '') +
        '<span class="counter">' + (f.review ? 'გადასახედი <b>' + U.fq.length + '</b>' : 'დარჩა <b>' + U.fq.length + '</b>') + '</span>';
      let actions;
      if (!U.fRevealed) {
        actions = '<button class="btn btn-primary btn-lg" data-act="flashReveal">' + IC.eye + 'პასუხის ნახვა <kbd>Space</kbd></button>' +
          (q.type === 'mcq' ? '<span class="hint">ან პირდაპირ აირჩიე ვარიანტი (1–4)</span>' : '');
      } else if (!f.review) {
        actions = '<span class="ask">იცოდი?</span><button class="btn btn-bad btn-lg" data-act="flashNo">' + IC.x.replace('<svg', '<svg class="ic"') + 'არ ვიცი <kbd>1</kbd></button><button class="btn btn-ok btn-lg" data-act="flashYes">' + IC.check.replace('<svg', '<svg class="ic"') + 'ვიცი <kbd>2</kbd></button>';
      } else {
        actions = '<span class="ask">ისევ გახსოვს?</span><button class="btn btn-bad btn-lg" data-act="flashForgot">დამავიწყდა <kbd>1</kbd></button><button class="btn btn-ok btn-lg" data-act="flashKeep">ისევ ვიცი <kbd>2</kbd></button>';
      }
      main = studyCard(q, U.fRevealed, U.fPicked, 'flashPick', head, actions);
    }

    const counter = (k) => {
      const list = Logic.filterQs(QS, { quiz: k });
      return list.filter((x) => f.learned[x.id]).length + '/' + list.length;
    };
    const rail = '<aside class="rail">' +
      '<div class="panel"><div class="panel-title">პროგრესი</div>' +
        '<div class="big-num">' + learnedN + '<span> / ' + ids.length + '</span></div>' +
        '<div class="bar' + (left === 0 && ids.length ? ' ok' : '') + '"><i style="width:' + pct(learnedN, ids.length) + '%"></i></div>' +
        '<div class="kv"><span>ვიცი</span><b>' + learnedN + '</b></div><div class="kv"><span>დარჩა სასწავლი</span><b>' + left + '</b></div>' +
      '</div>' +
      '<div class="panel"><div class="panel-title">თემა</div>' + quizChoices('flashQuiz', f.quiz, counter) + '</div>' +
      '<div class="panel"><div class="panel-title">რეჟიმი</div>' +
        seg('flashMode', f.review ? 'review' : 'learn', [['learn', 'სწავლა'], ['review', 'ნასწავლი (' + learnedN + ')']]) +
        '<div class="rail-actions">' + confirmBtn('flashReset', f.quiz === 'all' ? 'ყველაფრის თავიდან დაწყება' : 'ამ ქვიზის თავიდან დაწყება', 'flashReset') + '</div>' +
      '</div>' +
      '<div class="panel keys" aria-label="კლავიშები"><div class="panel-title" style="margin-bottom:4px">კლავიშები</div>' +
        '<div><span>პასუხის ნახვა</span><kbd>Space</kbd></div><div><span>არ ვიცი</span><kbd>1</kbd></div><div><span>ვიცი</span><kbd>2</kbd></div></div>' +
    '</aside>';

    return '<div class="page-head"><div><h1>ბარათები</h1><p>' + (f.review ? 'ნასწავლი ბარათების გადახედვა.' : 'გაიხსენე პასუხი, მერე შეამოწმე. „ვიცი" — ბარათი ქრება, „არ ვიცი" — მოგვიანებით დაბრუნდება.') + '</p></div></div>' +
      '<div class="study"><div>' + main + '</div>' + rail + '</div>';
  }
  function doneCard(kind, icon, title, text, actions) {
    return '<article class="panel card done enter"><div class="done-badge ' + kind + '">' + icon + '</div><h2>' + title + '</h2><p>' + text + '</p>' + (actions ? '<div class="card-actions">' + actions + '</div>' : '') + '</article>';
  }

  /* ───────────────────────── 2. ყველა კითხვა ───────────────────────── */

  function allList() {
    const a = S.all;
    let list = Logic.filterQs(QS, { quiz: a.quiz, type: a.type });
    if (a.order === 'seq') list = list.slice().sort((x, y) => x.quiz - y.quiz);
    else list = shuffle(list, mulberry32(a.seed));
    return list;
  }
  function viewAll() {
    const a = S.all; const list = allList();
    if (a.idx >= list.length) a.idx = Math.max(0, list.length - 1);
    const q = list[a.idx];
    if (q && !a.seen[q.id]) { a.seen[q.id] = 1; save(); }
    const seenN = list.filter((x) => a.seen[x.id]).length;

    let main;
    if (!q) main = doneCard('neutral', IC.info, 'ამ ფილტრით კითხვა ვერ მოიძებნა', 'შეცვალე ტიპი ან ქვიზი მარჯვნივ.', '');
    else {
      const head = '<span class="counter">კითხვა <b>' + (a.idx + 1) + '</b> / ' + list.length + '</span>';
      const actions = '<button class="btn" data-act="allPrev"' + (a.idx === 0 ? ' disabled' : '') + ' aria-label="წინა კითხვა">' + IC.left + 'წინა</button>' +
        '<span class="grow"></span>' +
        '<button class="btn ' + (U.aRevealed ? '' : 'btn-primary') + '" data-act="allReveal">' + IC.eye + (U.aRevealed ? 'პასუხის დამალვა' : 'პასუხის ნახვა') + ' <kbd>Space</kbd></button>' +
        '<span class="grow"></span>' +
        (a.idx < list.length - 1
          ? '<button class="btn" data-act="allNext" aria-label="შემდეგი კითხვა">შემდეგი' + IC.right + '</button>'
          : '<button class="btn btn-ok" data-act="allRestart">' + IC.check.replace('<svg', '<svg class="ic"') + 'ბოლოა — თავიდან</button>');
      main = studyCard(q, U.aRevealed, U.aPicked, 'allPick', head, actions);
    }
    const quizCount = (k) => Logic.filterQs(QS, { quiz: k, type: a.type }).length;
    const rail = '<aside class="rail">' +
      '<div class="panel"><div class="panel-title">სად ხარ</div>' +
        '<div class="big-num">' + (list.length ? a.idx + 1 : 0) + '<span> / ' + list.length + '</span></div>' +
        '<div class="bar"><i style="width:' + pct(a.idx + 1, list.length) + '%"></i></div>' +
        '<div class="kv"><span>ნანახი</span><b>' + seenN + ' / ' + list.length + '</b></div>' +
        '<div class="rail-actions"><button class="btn btn-sm btn-quiet" data-act="allRestart">' + IC.reset + 'თავიდან დაწყება</button></div>' +
      '</div>' +
      '<div class="panel"><div class="panel-title">ფილტრი</div>' +
        seg('allType', a.type, [['all', 'ყველა'], ['def', 'განმარტ.'], ['open', 'ღია'], ['mcq', 'ტესტი']]) +
        seg('allOrder', a.order, [['seq', 'თანმიმდევრობით'], ['rand', 'შემთხვევით']]) +
      '</div>' +
      '<div class="panel"><div class="panel-title">ქვიზი</div>' + quizChoices('allQuiz', a.quiz, quizCount) + '</div>' +
      '<div class="panel keys"><div class="panel-title" style="margin-bottom:4px">კლავიშები</div>' +
        '<div><span>წინა / შემდეგი</span><span><kbd>←</kbd> <kbd>→</kbd></span></div><div><span>პასუხი</span><kbd>Space</kbd></div></div>' +
    '</aside>';
    return '<div class="page-head"><div><h1>ყველა კითხვა</h1><p>სრული მასალა — ბარათებში „ვიცი"-თ მონიშნულიც აქ ყოველთვის ჩანს.</p></div></div>' +
      '<div class="study"><div>' + main + '</div>' + rail + '</div>';
  }

  /* ───────────────────────── 3. გამოცდა ───────────────────────── */

  function historyRows(limit) {
    const hist = S.exam.history.slice().reverse().slice(0, limit);
    if (!hist.length) return '<p class="empty-note">ჯერ გამოცდა არ გაგივლია.</p>';
    return '<div class="rows"><div class="row row-head"><span>#</span><span>თარიღი</span><span class="s">ქულა</span><span class="p">%</span><span class="bh"></span></div>' +
      hist.map((h, i) => {
        const p = pct(h.correct, h.total);
        return '<div class="row"><span class="n">' + String(S.exam.history.length - i).padStart(2, '0') + '</span><span class="d">' + fmtDate(h.date) + '</span><span class="s">' + h.correct + '/' + h.total + '</span><span class="p">' + p + '%</span><span class="mini-bar ' + (p >= 70 ? 'good' : p < 50 ? 'low' : '') + '"><i style="width:' + p + '%"></i></span></div>';
      }).join('') + '</div>';
  }

  function viewExam() {
    const ex = S.exam.current;
    if (!ex) return viewExamIntro();
    if (ex.finished) return viewExamResults(ex);
    return viewExamRun(ex);
  }

  function viewExamIntro(errors) {
    return '<div class="page-head"><div><h1>საგამოცდო სიმულაცია</h1><p>ნამდვილი გამოცდის ფორმატი, ლექტორის ინსტრუქციის მიხედვით.</p></div></div>' +
      '<div class="exam-intro">' +
        '<section class="panel panel-pad">' +
          '<div class="panel-title"><span class="led"></span>როგორ მუშაობს</div>' +
          '<p class="intro-text">ყოველ ჯერზე შემთხვევით აირჩევა 20 კითხვა მთელი მასალიდან (წინა გამოცდების კითხვები მაქსიმალურად არ მეორდება). ტესტებში ზოგი კითხვა სხვა ფორმითაა დასმული — როგორც ლექტორმა გააფრთხილა.</p>' +
          '<div class="plan">' +
            '<div class="plan-item t-def"><b>5</b><span>განმარტება</span><p>წერ პასუხს, ნახულობ სწორს და თვითონ აფასებ: სწორია / არასწორია.</p></div>' +
            '<div class="plan-item t-open"><b>5</b><span>ღია კითხვა</span><p>იგივე: წერ, ადარებ სწორ პასუხს და თვითონ აფასებ.</p></div>' +
            '<div class="plan-item t-mcq"><b>10</b><span>ტესტი</span><p>ირჩევ ვარიანტს — სისტემა ავტომატურად ამოწმებს.</p></div>' +
          '</div>' +
          (errors ? '<div class="alert" role="alert"><b>გამოცდის აწყობა ვერ მოხერხდა — ბაზაში საკმარისი კითხვა არ არის:</b><br>' + errors.map(esc).join('<br>') + '</div>' : '') +
          '<div class="hero-cta" style="margin-top:8px"><button class="btn btn-primary btn-lg" data-act="examStart">გამოცდის დაწყება' + IC.arrow + '</button></div>' +
        '</section>' +
        '<section class="panel panel-pad"><div class="panel-title">შენი გამოცდები</div>' + historyRows(10) + '</section>' +
      '</div>';
  }

  function segmentsHtml(ex) {
    let i = 0;
    return '<div class="segments" aria-hidden="true">' + PLAN.map((p) => {
      const kind = p[0]; const items = ex.items.filter((it) => it.kind === kind);
      const done = items.filter((it) => it.result !== null).length;
      const cells = items.map(() => {
        const it = ex.items[i]; const idx = i; i++;
        const cls = it.result === true ? 'ok' : it.result === false ? 'bad' : idx === ex.pos ? 'cur' : '';
        return '<span class="cell ' + cls + '"></span>';
      }).join('');
      return '<div><div class="grp-label"><span>' + TYPES[kind].many + '</span><span>' + done + '/' + items.length + '</span></div><div class="grp-cells">' + cells + '</div></div>';
    }).join('') + '</div>';
  }

  function viewExamRun(ex) {
    const it = ex.items[ex.pos];
    const key = ex.id + ':' + ex.pos;
    const anim = U.lastCard !== key; U.lastCard = key;
    const sc = Logic.score(ex);
    const answered = ex.items.filter((x) => x.result !== null).length;
    const q = byId.get(it.qid);
    const srcTxt = it.src === 'generated' ? 'ქვიზი ' + it.quiz + '-ის განმარტებიდან' : srcLabel(q);

    let body; let actions;
    if (it.kind === 'mcq') {
      body = '<p class="kicker">აირჩიე სწორი პასუხი</p><h2 class="qtext">' + esc(it.q) + '</h2>' + optionsHtml(it.options, it.correct, it.picked, it.submitted, 'examPick');
      if (it.submitted) body += verdictHtml(it.result, it.correct, it.options) + noteHtml(it.note);
      actions = it.submitted
        ? '<span class="grow"></span><button class="btn btn-primary btn-lg" data-act="examNext">' + (ex.pos === ex.items.length - 1 ? 'შედეგების ნახვა' : 'შემდეგი კითხვა') + IC.arrow + ' <kbd>Enter</kbd></button>'
        : '<span class="hint">აირჩიე ვარიანტი და დაადასტურე</span><span class="grow"></span><button class="btn btn-primary btn-lg" data-act="examSubmitMcq"' + (it.picked === null ? ' disabled' : '') + '>დადასტურება <kbd>Enter</kbd></button>';
    } else {
      body = it.kind === 'def'
        ? '<p class="kicker">განმარტე ტერმინი</p><h2 class="term">' + esc(it.q) + '</h2>'
        : '<p class="kicker">უპასუხე კითხვას</p><h2 class="qtext">' + esc(it.q) + '</h2>';
      if (!it.submitted) {
        body += '<div class="field"><label for="ans">შენი პასუხი</label><textarea id="ans" data-input="examAnswer" placeholder="დაწერე, რაც გახსოვს…">' + esc(it.answer) + '</textarea><span class="hint">დაწერე და დააჭირე „პასუხის შემოწმება" (Ctrl + Enter). ცარიელიც შეიძლება, თუ არ იცი.</span></div>';
        actions = '<span class="grow"></span><button class="btn btn-primary btn-lg" data-act="examSubmitText">პასუხის შემოწმება' + IC.arrow + '</button>';
      } else {
        body += '<div class="compare">' +
          '<div class="answer mine"><div class="answer-label">შენი პასუხი</div><div class="prose">' + (it.answer.trim() ? fmt(it.answer) : '<p class="empty">— არაფერი დაგიწერია —</p>') + '</div></div>' +
          '<div class="answer"><div class="answer-label">სწორი პასუხი</div><div class="prose">' + fmt(it.a) + '</div></div></div>';
        const eq = byId.get(it.qid);
        if (eq) body += U.explainKey === eq.id ? explainHtml(eq.q) : explainBtn(eq.id, eq.q, false);
        actions = it.result === null
          ? '<span class="ask">შეადარე და შეაფასე შენი პასუხი:</span><button class="btn btn-bad btn-lg" data-act="examGrade" data-v="0">' + IC.x.replace('<svg', '<svg class="ic"') + 'არასწორია <kbd>1</kbd></button><button class="btn btn-ok btn-lg" data-act="examGrade" data-v="1">' + IC.check.replace('<svg', '<svg class="ic"') + 'სწორია <kbd>2</kbd></button>'
          : '';
      }
    }
    const card = '<article class="panel card t-' + it.kind + (anim ? ' enter' : '') + '" aria-label="გამოცდის კითხვა ' + (ex.pos + 1) + '">' +
      '<header class="card-head">' + typeTag(it.kind) + (it.src === 'generated' || it.src === 'variation' ? '<span class="tag var">ვარიაცია</span>' : '') +
      '<span class="src">' + esc(srcTxt) + '</span><span class="spacer"></span><span class="counter">კითხვა <b>' + (ex.pos + 1) + '</b> / ' + ex.items.length + '</span></header>' +
      '<div class="card-body">' + body + '</div><footer class="card-actions">' + actions + '</footer></article>';

    const rail = '<aside class="rail">' +
      '<div class="panel"><div class="panel-title">მიმდინარე შედეგი</div>' +
        '<div class="big-num">' + sc.correct + '<span> / ' + answered + '</span></div>' +
        '<div class="bar ok"><i style="width:' + pct(sc.correct, answered || 1) + '%"></i></div>' +
        '<div class="kv"><span>სწორი</span><b>' + sc.correct + '</b></div><div class="kv"><span>არასწორი</span><b>' + (answered - sc.correct) + '</b></div><div class="kv"><span>დარჩა</span><b>' + (ex.items.length - answered) + '</b></div>' +
      '</div>' +
      '<div class="panel keys"><div class="panel-title" style="margin-bottom:4px">კლავიშები</div>' +
        '<div><span>ვარიანტის არჩევა</span><kbd>1–4</kbd></div><div><span>დადასტურება / შემდეგი</span><kbd>Enter</kbd></div><div><span>პასუხის შემოწმება</span><kbd>Ctrl+Enter</kbd></div><div><span>არასწორია / სწორია</span><span><kbd>1</kbd> <kbd>2</kbd></span></div></div>' +
      '<div class="panel">' + confirmBtn('examQuit', 'გამოცდის შეწყვეტა', 'examQuit') + '</div>' +
    '</aside>';

    return '<div class="page-head"><div><h1>გამოცდა</h1><p>უპასუხე ყველა 20 კითხვას — ბოლოს ნახავ დეტალურ შედეგს.</p></div></div>' +
      segmentsHtml(ex) + '<div class="study"><div>' + card + '</div>' + rail + '</div>';
  }

  function viewExamResults(ex) {
    const sc = Logic.score(ex);
    const p = sc.pct;
    const title = p >= 90 ? 'შესანიშნავია!' : p >= 70 ? 'კარგი შედეგია!' : p >= 50 ? 'ცუდი არაა — კიდევ ცოტა.' : 'კიდევ ვარჯიში გჭირდება.';
    const cat = (kind) => {
      const b = sc.by[kind]; const cp = pct(b[0], b[1]);
      return '<div class="cat"><span>' + TYPES[kind].many + '</span><span class="mini-bar ' + (cp >= 70 ? 'good' : cp < 50 ? 'low' : '') + '"><i style="width:' + cp + '%"></i></span><b>' + b[0] + '/' + b[1] + '</b></div>';
    };
    const list = ex.items.map((it, i) => ({ it, i })).filter((x) => U.resFilter === 'all' || x.it.result !== true);
    const items = list.map(({ it, i }) => {
      const ok = it.result === true;
      const res = '<span class="res ' + (ok ? 'ok' : 'bad') + '">' + (ok ? IC.check + 'სწორი' : IC.x + 'არასწორი') + '</span>';
      let detail;
      if (it.kind === 'mcq') {
        const mine = it.picked === null ? '— არ აგირჩევია —' : LET[it.picked] + ') ' + it.options[it.picked];
        const right = it.correct.map((c) => LET[c] + ') ' + it.options[c]).join('\nან: ');
        detail = '<div class="compare"><div class="answer mine"><div class="answer-label">შენი არჩევანი</div><div class="prose"><p>' + esc(mine) + '</p></div></div><div class="answer"><div class="answer-label">სწორი პასუხი</div><div class="prose">' + fmt(right) + (it.note ? '<p class="muted" style="font-size:14px;margin-top:8px">' + esc(it.note) + '</p>' : '') + '</div></div></div>';
      } else {
        detail = '<div class="compare"><div class="answer mine"><div class="answer-label">შენი პასუხი</div><div class="prose">' + (it.answer.trim() ? fmt(it.answer) : '<p class="empty">— არაფერი დაგიწერია —</p>') + '</div></div><div class="answer"><div class="answer-label">სწორი პასუხი</div><div class="prose">' + fmt(it.a) + '</div></div></div>';
      }
      return '<article class="panel ritem"><div class="ritem-head"><span class="ritem-n">' + String(i + 1).padStart(2, '0') + '</span><div class="ritem-q">' + typeTag(it.kind) + esc(it.kind === 'def' ? 'განმარტე: ' + it.q : it.q) + '</div>' + res + '</div>' + detail + '</article>';
    }).join('');

    return '<section class="panel score-hero">' +
        ring(sc.correct, sc.total, p >= 50 ? 'ok' : '', '<b>' + p + '%</b><span>' + sc.correct + ' / ' + sc.total + '</span>') +
        '<div class="score-main"><h1>' + title + '</h1><p>სწორი: <b>' + sc.correct + '</b> · არასწორი: <b>' + sc.wrong + '</b> · ' + fmtDate(ex.started) + '</p>' +
          '<div class="hero-cta"><button class="btn btn-primary" data-act="examStart">ახალი გამოცდა' + IC.arrow + '</button><button class="btn" data-act="examClose">დახურვა</button></div></div>' +
        '<div class="cat-bars">' + cat('def') + cat('open') + cat('mcq') + '</div>' +
      '</section>' +
      '<div class="review-head"><h2>პასუხების განხილვა</h2>' + seg('resFilter', U.resFilter, [['all', 'ყველა (' + sc.total + ')'], ['wrong', 'მხოლოდ შეცდომები (' + sc.wrong + ')']]) + '</div>' +
      '<div class="review">' + (items || '<p class="empty-note">შეცდომა არ გქონია. 🎉</p>') + '</div>';
  }

  /* ───────────────────────── მოქმედებები ───────────────────────── */

  const A = {
    askConfirm(d) { U.confirm = d.key; },
    explain(d) {
      U.explainKey = d.id;
      const r = route();
      if (r === 'flash') U.fRevealed = true;
      if (r === 'all') U.aRevealed = true;
    },
    cancelConfirm() { U.confirm = null; },

    flashReveal() { U.fRevealed = true; announce('პასუხი გაიხსნა'); },
    flashPick(d) { if (U.fRevealed) return; U.fPicked = +d.i; U.fRevealed = true; const q = byId.get(U.fq[0]); announce(q && q.correct.includes(+d.i) ? 'სწორია' : 'არასწორია'); },
    flashYes() {
      const id = U.fq[0]; if (!id) return;
      S.flash.learned[id] = Date.now(); U.fq.shift(); S.flash.current = U.fq[0] || null;
      U.fRevealed = false; U.fPicked = null; save(); announce('მოინიშნა: ვიცი');
    },
    flashNo() {
      const id = U.fq[0]; if (!id) return;
      const m = (S.flash.miss[id] || 0) + 1; S.flash.miss[id] = m;
      U.fq = Logic.requeue(U.fq, id, m); S.flash.current = U.fq[0];
      U.fRevealed = false; U.fPicked = null; save(); announce('მოგვიანებით დაბრუნდება');
    },
    flashForgot() {
      const id = U.fq[0]; if (!id) return;
      delete S.flash.learned[id]; S.flash.miss[id] = (S.flash.miss[id] || 0) + 1;
      U.fq.shift(); U.fRevealed = false; U.fPicked = null; save(); announce('ბარათი დაბრუნდა სასწავლ რიგში');
    },
    flashKeep() { U.fq.shift(); U.fRevealed = false; U.fPicked = null; },
    flashAgain() { ensureQueue(true); },
    flashQuiz(d) { S.flash.quiz = d.v; S.flash.current = null; ensureQueue(true); save(); },
    flashMode(d) { S.flash.review = d.v === 'review'; ensureQueue(true); save(); },
    flashReset() {
      flashIds().forEach((id) => { delete S.flash.learned[id]; delete S.flash.miss[id]; });
      S.flash.review = false; S.flash.current = null; U.confirm = null; ensureQueue(true); save(true); announce('პროგრესი განულდა');
    },

    allReveal() { U.aRevealed = !U.aRevealed; },
    allPick(d) { if (U.aRevealed) return; U.aPicked = +d.i; U.aRevealed = true; },
    allPrev() { if (S.all.idx > 0) { S.all.idx--; U.aRevealed = false; U.aPicked = null; save(); } },
    allNext() { const n = allList().length; if (S.all.idx < n - 1) { S.all.idx++; U.aRevealed = false; U.aPicked = null; save(); } },
    allRestart() { S.all.idx = 0; S.all.seen = {}; if (S.all.order === 'rand') S.all.seed = (Date.now() % 1e9) | 0; U.aRevealed = false; U.aPicked = null; save(); },
    allType(d) { S.all.type = d.v; S.all.idx = 0; U.aRevealed = false; U.aPicked = null; save(); },
    allQuiz(d) { S.all.quiz = d.v; S.all.idx = 0; U.aRevealed = false; U.aPicked = null; save(); },
    allOrder(d) { S.all.order = d.v; S.all.idx = 0; if (d.v === 'rand') S.all.seed = (Date.now() % 1e9) | 0; U.aRevealed = false; U.aPicked = null; save(); },

    examStart() {
      const recent = S.exam.recent || [];
      const ex = Logic.buildExam(QS, Math.random, recent);
      if (ex.error) { U.examError = ex.error; S.exam.current = null; return; }
      U.examError = null; S.exam.current = ex; U.resFilter = 'all'; save(true);
      window.scrollTo({ top: 0 });
    },
    examPick(d) { const it = cur(); if (!it || it.submitted) return; it.picked = +d.i; save(); },
    examSubmitMcq() {
      const it = cur(); if (!it || it.submitted || it.picked === null) return;
      it.submitted = true; it.result = it.correct.includes(it.picked); save(true);
      announce(it.result ? 'სწორია!' : 'არასწორია. სწორი პასუხია ' + it.correct.map((i) => LET[i]).join(' ან '));
    },
    examSubmitText() {
      const it = cur(); if (!it || it.submitted) return;
      const ta = document.getElementById('ans'); if (ta) it.answer = ta.value;
      it.submitted = true; save(true); announce('სწორი პასუხი გამოჩნდა. შეაფასე შენი პასუხი.');
    },
    examGrade(d) {
      const it = cur(); if (!it || !it.submitted || it.result !== null) return;
      it.result = d.v === '1'; A.examNext();
    },
    examNext() {
      const ex = S.exam.current; if (!ex) return;
      const it = ex.items[ex.pos]; if (it.result === null) return;
      if (ex.pos < ex.items.length - 1) { ex.pos++; }
      else {
        ex.finished = true;
        const sc = Logic.score(ex);
        S.exam.history.push({ date: ex.started, correct: sc.correct, total: sc.total, by: sc.by });
        if (S.exam.history.length > 50) S.exam.history = S.exam.history.slice(-50);
        // ბოლო ორი გამოცდის კითხვები — შემდეგ გამოცდაში მაქსიმალურად არ განმეორდება
        const ids = ex.items.map((x) => x.from || x.qid);
        S.exam.recent = ids.concat((S.exam.recent || []).slice(0, 20));
        window.scrollTo({ top: 0 });
      }
      save(true);
    },
    examQuit() { S.exam.current = null; U.confirm = null; save(true); },
    examClose() { S.exam.current = null; save(true); },
    resFilter(d) { U.resFilter = d.v; },
  };
  function cur() { const ex = S.exam.current; return ex && !ex.finished ? ex.items[ex.pos] : null; }

  /* ───────────────────────── როუტინგი და რენდერი ───────────────────────── */

  const app = document.getElementById('app');
  const routes = { '': viewHome, flash: viewFlash, all: viewAll, exam: () => (U.examError && !S.exam.current ? viewExamIntro(U.examError) : viewExam()) };
  const route = () => { const r = location.hash.replace(/^#\/?/, ''); return Object.prototype.hasOwnProperty.call(routes, r) ? r : ''; };

  function render() {
    const r = route();
    app.innerHTML = routes[r]();
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    // ახალი კითხვა — თუ ბარათის თავი ეკრანს მიღმაა (მობილურზე გრძელი პასუხის შემდეგ), ავწიოთ
    const fresh = app.querySelector('.card.enter');
    if (fresh) {
      const top = fresh.getBoundingClientRect().top;
      if (top < 60) window.scrollTo({ top: Math.max(0, top + window.scrollY - 72) });
    }
    const ta = document.getElementById('ans');
    if (ta && window.matchMedia('(min-width: 900px)').matches && document.activeElement !== ta) {
      ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  window.addEventListener('hashchange', () => { U.confirm = null; U.lastCard = null; render(); window.scrollTo({ top: 0 }); app.focus({ preventScroll: true }); });

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = A[el.dataset.act]; if (!fn) return;
    e.preventDefault();
    const act = el.dataset.act; const v = el.dataset.v;
    const isFilter = el.classList.contains('choice') || !!el.closest('.seg');
    fn(el.dataset);
    render();
    // ფილტრზე — ფოკუსი რჩება არჩეულ ღილაკზე; სხვა შემთხვევაში — ბარათზე (კლავიშებისთვის)
    if (isFilter && v != null) {
      const same = app.querySelector('[data-act="' + act + '"][data-v="' + v.replace(/"/g, '') + '"]');
      if (same) { same.focus({ preventScroll: true }); return; }
    }
    if (!document.getElementById('ans')) app.focus({ preventScroll: true });
  });

  app.addEventListener('input', (e) => {
    if (e.target.dataset.input === 'examAnswer') { const it = cur(); if (it) { it.answer = e.target.value; save(); } }
  });

  function run(act, data) {
    if (!A[act]) return;
    A[act](data || {}); render();
    if (!document.getElementById('ans')) app.focus({ preventScroll: true });
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.altKey) return;
    const t = e.target; const tag = (t.tagName || '').toLowerCase();
    const r = route();
    if (tag === 'textarea' || tag === 'input' || tag === 'select') {
      if (r === 'exam' && e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run('examSubmitText'); }
      return;
    }
    if (e.ctrlKey) {
      if (r === 'exam' && e.key === 'Enter' && document.getElementById('ans')) { e.preventDefault(); run('examSubmitText'); }
      return;
    }
    // ღილაკზე Space/Enter — ბრაუზერი თვითონ დააჭერს
    if ((tag === 'button' || tag === 'a') && (e.key === ' ' || e.key === 'Enter')) return;
    const k = e.key;
    // დაჭერილი კლავიში ახალ ტექსტურ ველში რომ არ ჩაიწეროს — preventDefault
    const go = (act, data) => { e.preventDefault(); run(act, data); };
    const num = /^[1-6]$/.test(k) ? +k - 1 : -1;

    if (r === 'flash') {
      const q = byId.get(U.fq && U.fq[0]); if (!q) return;
      if (!U.fRevealed) {
        if (k === ' ' || k === 'Enter') { go('flashReveal'); }
        else if (q.type === 'mcq' && num >= 0 && num < q.options.length) go('flashPick', { i: num });
      } else {
        const rev = S.flash.review;
        if (k === '1' || k === 'ArrowLeft') go(rev ? 'flashForgot' : 'flashNo');
        else if (k === '2' || k === 'ArrowRight') go(rev ? 'flashKeep' : 'flashYes');
      }
    } else if (r === 'all') {
      if (k === 'ArrowLeft') go('allPrev');
      else if (k === 'ArrowRight') go('allNext');
      else if (k === ' ' || k === 'Enter') { go('allReveal'); }
      else if (num >= 0 && !U.aRevealed) {
        const list = allList(); const q = list[S.all.idx];
        if (q && q.type === 'mcq' && num < q.options.length) go('allPick', { i: num });
      }
    } else if (r === 'exam') {
      const it = cur(); if (!it) return;
      if (it.kind === 'mcq') {
        if (!it.submitted && num >= 0 && num < it.options.length) go('examPick', { i: num });
        else if (k === 'Enter') { go(it.submitted ? 'examNext' : 'examSubmitMcq'); }
      } else if (it.submitted && it.result === null) {
        if (k === '1') go('examGrade', { v: '0' });
        else if (k === '2') go('examGrade', { v: '1' });
      }
    }
  });

  render();
})();
