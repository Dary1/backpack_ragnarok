/* BACKPACK RAGNARÖK mock — shared FX (particles, count-up, parallax, ray monitor) */
(function () {
  "use strict";
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- ember / snow particle field ---------- */
  window.initParticles = function (canvas, opts) {
    if (REDUCED) return;
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    let W, H, ps = [];
    function size() { W = canvas.width = canvas.offsetWidth; H = canvas.height = canvas.offsetHeight; }
    size(); addEventListener("resize", size);
    const N = opts.count || 46;
    function spawn(i) {
      const ember = opts.mix === "both" ? (i % 2 === 0) : opts.mix !== "snow";
      return {
        ember,
        x: Math.random() * W,
        y: H + Math.random() * H * 0.4,
        r: ember ? 0.8 + Math.random() * 1.8 : 1 + Math.random() * 2.2,
        vy: ember ? -(12 + Math.random() * 26) : (9 + Math.random() * 16),
        vx: ember ? (4 + Math.random() * 14) : (-6 - Math.random() * 10),
        life: 0, maxLife: 6 + Math.random() * 9,
        tw: 1.5 + Math.random() * 3,
      };
    }
    for (let i = 0; i < N; i++) { const p = spawn(i); p.y = Math.random() * H; ps[i] = p; }
    let last = performance.now();
    (function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        p.life += dt;
        p.x += p.vx * dt + Math.sin(p.life * p.tw) * 12 * dt;
        p.y += p.vy * dt;
        if (p.life > p.maxLife || p.y < -8 || p.y > H + 12 || p.x > W + 12 || p.x < -12) {
          ps[i] = spawn(i);
          if (!ps[i].ember) { ps[i].y = -6; }
          continue;
        }
        const a = Math.max(0, 1 - p.life / p.maxLife) * 0.85;
        if (p.ember) {
          ctx.fillStyle = "rgba(255,138,61," + (a * (0.5 + 0.5 * Math.sin(p.life * p.tw * 2))).toFixed(3) + ")";
          ctx.shadowColor = "rgba(226,88,34,.8)"; ctx.shadowBlur = 6;
        } else {
          ctx.fillStyle = "rgba(214,235,244," + (a * 0.8).toFixed(3) + ")";
          ctx.shadowBlur = 0;
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
      }
      requestAnimationFrame(tick);
    })(last);
  };

  /* ---------- count-up numerals ---------- */
  window.countUp = function (el, target, dur) {
    if (REDUCED) { el.textContent = target.toLocaleString(); return; }
    const t0 = performance.now(); dur = dur || 1200;
    (function step(t) {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(target * e).toLocaleString();
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  };

  /* ---------- pointer parallax (title) ---------- */
  window.initParallax = function (root) {
    if (REDUCED) return;
    const layers = root.querySelectorAll("[data-depth]");
    root.addEventListener("pointermove", (e) => {
      const r = root.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width - 0.5, dy = (e.clientY - r.top) / r.height - 0.5;
      layers.forEach((L) => {
        const d = parseFloat(L.dataset.depth);
        L.style.transform = "translate(" + (-dx * d) + "px," + (-dy * d * 0.6) + "px)";
      });
    });
  };

  /* ============================================================
     RayMonitor — formation-ray battle playback (26×18 dual planes)
     Scripted demo: rays walk cells at 45°/orthogonal, reflect on
     boundaries, flash on hits; 5th bounce => all-field nova.
     ============================================================ */
  window.RayMonitor = function (canvas, logEl, opts) {
    const ctx = canvas.getContext("2d");
    const COLS = 26, ROWS = 18, GAP = 34;
    let W, H, cell, ox, oy, paneW;
    const EMBER = "#FF8A3D", FROST = "#8CDCF5", GOLD = "#C9A959";

    /* static unit footprints: [pane, r, c, w, h, color, label] */
    const packs = [
      [0, 3, 2, 3, 2, "rgba(201,169,89,.30)", "Ⅰ"],
      [0, 8, 4, 2, 3, "rgba(111,196,222,.28)", "Ⅱ"],
      [0, 12, 1, 4, 2, "rgba(226,88,34,.26)", "Ⅲ"],
      [0, 6, 9, 2, 2, "rgba(156,107,212,.26)", "Ⅳ"],
      [1, 4, 18, 3, 3, "rgba(176,65,62,.34)", "?"],
      [1, 10, 21, 2, 2, "rgba(176,65,62,.30)", "?"],
      [1, 13, 16, 4, 2, "rgba(176,65,62,.30)", "?"],
    ];

    /* precompute a ray path walking from a cell along [dr,dc], reflecting at pane bounds */
    function tracePath(pane, r, c, dr, dc, steps) {
      const pts = [{ r, c }], bounces = [];
      for (let i = 0; i < steps; i++) {
        let nr = r + dr, nc = c + dc, b = false;
        if (nr < 0 || nr >= ROWS) { dr = -dr; nr = r + dr; b = true; }
        if (nc < 0 || nc >= COLS) { dc = -dc; nc = c + dc; b = true; }
        r = nr; c = nc;
        pts.push({ r, c });
        if (b) bounces.push(pts.length - 1);
      }
      return { pane, pts, bounces };
    }

    /* demo script: [start_sec, kind, args] */
    const script = [
      [0.4,  "log", "遠征開始 — <span class='kw-gold'>ニヴルヘイム深淵</span> 第3層", "sys"],
      [1.0,  "ray", tracePath(1, 4, 0, 1, 1, 40), FROST, "氷晶の楔 → 敵陣"],
      [2.6,  "hit", 1, 5, 19, FROST, "<span class='kw-frost'>氷晶の楔</span> が 霜狼 に <b class='tnum'>34</b> ダメージ"],
      [3.4,  "ray", tracePath(1, 16, 2, -1, 1, 52), EMBER, "残火の矢 → 敵陣"],
      [4.9,  "hit", 1, 10, 21, EMBER, "<span class='kw-ember'>残火の矢</span> が 氷骸兵 に <b class='tnum'>21</b> ダメージ (反射+50%)"],
      [5.8,  "ray", tracePath(0, 0, 25, 1, -1, 46), "#D14B44", "敵射撃 → 自陣"],
      [7.2,  "hit", 0, 8, 4, "#D14B44", "背嚢Ⅱが <b class='kw-blood tnum'>17</b> 被弾 — <span class='kw-frost'>霜纏い</span> が軽減"],
      [8.2,  "ray", tracePath(1, 0, 16, 1, 1, 88), EMBER, "燔祭の光条 — 反射を重ねる…"],
      [10.9, "nova", 1, "第5反射 — <span class='kw-ember'>全域強打 +150%</span>!"],
      [12.2, "hit", 1, 13, 16, GOLD, "敵編隊 壊滅 — <span class='kw-gold'>戦利品×3</span> 獲得"],
      [13.2, "log", "<span class='kw-link'>ムニン</span> が戦況を持ち帰った — 次戦まで 00:41", "sys"],
    ];
    const DUR = 14.5;

    function size() {
      W = canvas.width = canvas.offsetWidth * devicePixelRatio;
      H = canvas.height = canvas.offsetHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      cell = Math.min((w - GAP - 8) / (COLS * 2), (h - 26) / ROWS);
      paneW = cell * COLS;
      ox = (w - (paneW * 2 + GAP)) / 2; oy = (h - cell * ROWS) / 2 + 6;
    }
    size(); addEventListener("resize", size);

    function cxy(pane, r, c) {
      return [ox + pane * (paneW + GAP) + c * cell + cell / 2, oy + r * cell + cell / 2];
    }

    let t = 0, last = performance.now(), speed = 1, playing = true;
    const fired = new Set(); let flashes = [], novas = [];

    function emitLog(html, cls) {
      if (!logEl) return;
      const li = document.createElement("div");
      li.className = "logline" + (cls ? " " + cls : "");
      li.innerHTML = "<span class='ts tnum'>" + t.toFixed(1).padStart(4, "0") + "</span>" + html;
      logEl.prepend(li);
      while (logEl.children.length > 9) logEl.lastChild.remove();
    }

    function drawPane(p) {
      const x0 = ox + p * (paneW + GAP);
      /* plate */
      ctx.fillStyle = p === 0 ? "rgba(19,24,32,.85)" : "rgba(26,20,22,.85)";
      ctx.fillRect(x0, oy, paneW, cell * ROWS);
      /* grid */
      ctx.strokeStyle = "rgba(233,227,211,.055)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= COLS; c++) { ctx.moveTo(x0 + c * cell, oy); ctx.lineTo(x0 + c * cell, oy + ROWS * cell); }
      for (let r = 0; r <= ROWS; r++) { ctx.moveTo(x0, oy + r * cell); ctx.lineTo(x0 + paneW, oy + r * cell); }
      ctx.stroke();
      /* border + label */
      ctx.strokeStyle = p === 0 ? "rgba(111,196,222,.4)" : "rgba(176,65,62,.45)";
      ctx.strokeRect(x0 - .5, oy - .5, paneW + 1, cell * ROWS + 1);
      ctx.fillStyle = p === 0 ? "rgba(184,233,245,.8)" : "rgba(224,107,95,.8)";
      ctx.font = "600 10px 'Zen Kaku Gothic New', sans-serif";
      ctx.fillText(p === 0 ? "自陣 A1:Z18" : "敵陣 A1:Z18", x0 + 2, oy - 7);
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
      drawPane(0); drawPane(1);
      /* packs */
      packs.forEach(([p, r, c, w, h, col, lbl]) => {
        const [x, y] = [ox + p * (paneW + GAP) + c * cell, oy + r * cell];
        ctx.fillStyle = col;
        ctx.fillRect(x + 1, y + 1, w * cell - 2, h * cell - 2);
        ctx.strokeStyle = col.replace(/[\d.]+\)$/, "0.9)");
        ctx.strokeRect(x + 1, y + 1, w * cell - 2, h * cell - 2);
        ctx.fillStyle = "rgba(233,227,211,.75)";
        ctx.font = "700 " + Math.round(cell * 0.9) + "px 'Shippori Mincho B1', serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(lbl, x + (w * cell) / 2, y + (h * cell) / 2);
        ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
      });
      /* active rays */
      script.forEach((ev, idx) => {
        if (ev[1] !== "ray") return;
        const t0 = ev[0], path = ev[2], col = ev[3];
        const RAY_T = 1.6;
        if (t < t0 || t > t0 + RAY_T + 0.9) return;
        const k = Math.min(1, (t - t0) / RAY_T);
        const n = Math.max(2, Math.floor(path.pts.length * k));
        const fade = t > t0 + RAY_T ? 1 - (t - t0 - RAY_T) / 0.9 : 1;
        ctx.save();
        ctx.globalAlpha = 0.9 * fade;
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, cell * 0.14);
        ctx.shadowColor = col; ctx.shadowBlur = 10;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const [x, y] = cxy(path.pane, path.pts[i].r, path.pts[i].c);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
        /* head */
        if (k < 1) {
          const [hx, hy] = cxy(path.pane, path.pts[n - 1].r, path.pts[n - 1].c);
          ctx.fillStyle = "#fff"; ctx.shadowBlur = 14;
          ctx.beginPath(); ctx.arc(hx, hy, Math.max(2, cell * 0.18), 0, 7); ctx.fill();
        }
        /* bounce sparks */
        path.bounces.forEach((bi) => {
          if (bi < n) {
            const [bx, by] = cxy(path.pane, path.pts[bi].r, path.pts[bi].c);
            ctx.globalAlpha = 0.7 * fade;
            ctx.strokeStyle = "#EBD9A4"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(bx, by, cell * 0.32, 0, 7); ctx.stroke();
          }
        });
        ctx.restore();
      });
      /* hit flashes */
      flashes = flashes.filter((f) => t - f.t < 0.7);
      flashes.forEach((f) => {
        const a = 1 - (t - f.t) / 0.7;
        const [x, y] = cxy(f.pane, f.r, f.c);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = f.col; ctx.shadowColor = f.col; ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.arc(x, y, cell * (0.5 + (1 - a) * 0.9), 0, 7); ctx.fill();
        ctx.restore();
      });
      /* nova (5th bounce all-field) */
      novas = novas.filter((f) => t - f.t < 1.1);
      novas.forEach((f) => {
        const a = 1 - (t - f.t) / 1.1;
        const x0 = ox + f.pane * (paneW + GAP);
        ctx.save();
        ctx.globalAlpha = a * 0.55;
        const g = ctx.createRadialGradient(x0 + paneW / 2, oy + ROWS * cell / 2, 10, x0 + paneW / 2, oy + ROWS * cell / 2, paneW * 0.7);
        g.addColorStop(0, "#FFD9A0"); g.addColorStop(0.5, "rgba(255,138,61,.7)"); g.addColorStop(1, "rgba(226,88,34,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x0, oy, paneW, ROWS * cell);
        ctx.restore();
      });
    }

    function tick(now) {
      const dt = Math.min(0.06, (now - last) / 1000) * (playing ? speed : 0);
      last = now; t += dt;
      if (t > DUR) { t = 0; fired.clear(); flashes = []; novas = []; if (logEl) logEl.innerHTML = ""; }
      script.forEach((ev, i) => {
        if (t >= ev[0] && !fired.has(i)) {
          fired.add(i);
          if (ev[1] === "log") emitLog(ev[2], ev[3]);
          if (ev[1] === "ray") emitLog(ev[4] || "光条発射", "");
          if (ev[1] === "hit") { flashes.push({ t, pane: ev[2], r: ev[3], c: ev[4], col: ev[5] }); emitLog(ev[6], ""); }
          if (ev[1] === "nova") { novas.push({ t, pane: ev[2] }); emitLog(ev[3], "nova"); }
        }
      });
      draw();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    return {
      setSpeed(s) { speed = s; },
      toggle() { playing = !playing; return playing; },
      get t() { return t; }, DUR,
    };
  };
})();
