/* A phone canvas of an afternoon sea. The lens stays level. Drag, scroll, or
   tap to sink from the swell through the waterline into shafts and drift.
   Idea after @snychng — no upstream code. */
(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var canvas = document.getElementById("canvas");
  var dive = document.getElementById("dive");
  var pauseBtn = document.getElementById("pause");
  var hint = document.getElementById("hint");
  if (!stage || !canvas || !dive) return;

  if (!/play\.html$/i.test(location.pathname || "")) {
    document.documentElement.classList.add("gb-ui-open");
  }

  var goal = 0;
  var prog = 0;
  var simTime = 1.7;
  var paused = false;
  try { paused = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  var dragging = false;
  var moved = false;
  var lastY = 0;
  var downY = 0;
  var activePtr = null;
  var sent = false;
  var lab = "";
  var plab = "";
  var longCap = 960;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function setLab(t) { if (t !== lab) { dive.textContent = t; lab = t; } }
  function setPause() {
    var t = paused ? "Resume waves" : "Pause waves";
    if (pauseBtn && t !== plab) { pauseBtn.textContent = t; plab = t; }
  }
  setPause();
  setLab("Dive");

  function signal() {
    if (sent) return;
    if (window.__gbSandbox && typeof window.__gbSandbox.ready === "function") {
      sent = true;
      window.__gbSandbox.ready();
    }
  }

  function toggleGoal() {
    goal = goal > 0.5 ? 0 : 1;
    ensureAudio();
  }

  dive.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    toggleGoal();
  });
  ["pointerdown", "pointermove", "pointerup", "touchstart", "touchmove", "wheel"].forEach(function (name) {
    dive.addEventListener(name, function (e) { e.stopPropagation(); }, { passive: false });
  });
  if (pauseBtn) {
    pauseBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      paused = !paused;
      setPause();
      ensureAudio();
    });
  }
  if (hint) {
    hint.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    hint.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: true });
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (e.target !== canvas) return;
    dragging = true;
    moved = false;
    activePtr = e.pointerId;
    lastY = e.clientY;
    downY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    ensureAudio();
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!dragging || e.pointerId !== activePtr) return;
    var dy = e.clientY - lastY;
    if (Math.abs(e.clientY - downY) > 8) moved = true;
    lastY = e.clientY;
    if (!moved) return;
    e.preventDefault();
    var h = stage.clientHeight || 480;
    goal = clamp01(goal + (-dy) / (h * 1.15));
  }, { passive: false });
  function endPtr(e) {
    if (activePtr == null || e.pointerId !== activePtr) return;
    var tap = !moved && Math.abs(e.clientY - downY) < 10;
    dragging = false;
    activePtr = null;
    if (tap) toggleGoal();
  }
  canvas.addEventListener("pointerup", endPtr);
  canvas.addEventListener("pointercancel", endPtr);
  window.addEventListener("pointerup", endPtr);
  stage.addEventListener("wheel", function (e) {
    if (e.target && e.target.closest && e.target.closest("#hint")) return;
    e.preventDefault();
    var h = stage.clientHeight || 480;
    var dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= h;
    goal = clamp01(goal + dy / (h * 1.35));
    ensureAudio();
  }, { passive: false });

  function fit() {
    var w = canvas.clientWidth || stage.clientWidth || 0;
    var h = canvas.clientHeight || stage.clientHeight || 0;
    if (w < 2 || h < 2) return false;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var pw = Math.max(2, Math.round(w * dpr));
    var ph = Math.max(2, Math.round(h * dpr));
    var m = Math.max(pw, ph);
    if (m > longCap) {
      var s = longCap / m;
      pw = Math.max(2, Math.round(pw * s));
      ph = Math.max(2, Math.round(ph * s));
    }
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    return true;
  }

  fit();
  var ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  function rgb(r, g, b) {
    return "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function trace(w, y0, amp, freq, phase) {
    var step = w > 700 ? 12 : 8;
    ctx.beginPath();
    for (var x = 0; x <= w + step; x += step) {
      var u = x > w ? w : x;
      var y = y0
        + Math.sin(u * freq + phase) * amp
        + Math.sin(u * freq * 0.43 - phase * 0.72) * amp * 0.4;
      if (x === 0) ctx.moveTo(0, y);
      else ctx.lineTo(u, y);
    }
  }
  function fillUnder(w, h, y0, amp, freq, phase, style) {
    trace(w, y0, amp, freq, phase);
    ctx.lineTo(w, h + 4);
    ctx.lineTo(0, h + 4);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }

  function draw() {
    var w = canvas.width;
    var h = canvas.height;
    var t = simTime;
    var depth = prog;
    var under = smooth(clamp01((depth - 0.05) / 0.62));
    var bob = Math.sin(t * 0.65) * h * 0.004 * (1 - depth);
    var line = h * (0.44 - depth * 0.78) + bob;
    var amp = Math.max(12, h * 0.028);
    ctx.globalAlpha = 1;

    var skyBottom = Math.max(line + amp * 2.2, 8);
    var sky = ctx.createLinearGradient(0, 0, 0, skyBottom);
    sky.addColorStop(0, "#3d86c4");
    sky.addColorStop(0.42, "#8ec4e4");
    sky.addColorStop(0.78, "#f2b07a");
    sky.addColorStop(1, "#f8d7a6");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    if (line > 8) {
      var sx = w * 0.72;
      var sy = Math.max(amp, line * 0.38);
      var rad = Math.max(16, w * 0.105);
      var glow = ctx.createRadialGradient(sx, sy, rad * 0.2, sx, sy, rad * 2.8);
      glow.addColorStop(0, "rgba(255,252,236,0.95)");
      glow.addColorStop(0.28, "rgba(255,236,196,0.45)");
      glow.addColorStop(1, "rgba(255,210,150,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, rad * 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fffdf8";
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    var sea = ctx.createLinearGradient(0, Math.min(Math.max(line, 0), h - 2), 0, h);
    var topC = mix([176, 224, 212], [16, 72, 82], under * 0.4);
    var midC = mix([48, 150, 158], [8, 42, 54], under);
    var botC = mix([10, 50, 62], [2, 14, 22], under);
    sea.addColorStop(0, rgb(topC[0], topC[1], topC[2]));
    sea.addColorStop(0.32, rgb(midC[0], midC[1], midC[2]));
    sea.addColorStop(1, rgb(botC[0], botC[1], botC[2]));
    fillUnder(w, h, line, amp * 1.15, 0.011, t * 0.8, sea);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.34 * (1 - under * 0.7);
    ctx.strokeStyle = "rgba(214, 242, 232, 0.95)";
    ctx.lineWidth = Math.max(12, h * 0.05);
    trace(w, line + h * 0.075, amp * 1.5, 0.008, t * 0.55 + 1.1);
    ctx.stroke();
    ctx.strokeStyle = "rgba(8, 52, 64, 0.7)";
    ctx.lineWidth = Math.max(16, h * 0.075);
    trace(w, line + h * 0.22, amp * 2.1, 0.0062, t * 0.4 + 2.2);
    ctx.stroke();
    ctx.restore();

    if (line > -amp * 2 && line < h) {
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2.2, w * 0.007);
      ctx.strokeStyle = "rgba(255,252,246," + (0.88 * (1 - under)) + ")";
      trace(w, line, amp * 1.15, 0.011, t * 0.8);
      ctx.stroke();
    }

    if (under < 0.92 && line < h * 0.95) {
      var sunX = w * 0.72;
      var top = Math.max(line, 0);
      var reach = Math.min(h * 0.38, h - top);
      var path = ctx.createLinearGradient(0, top, 0, top + reach);
      var pa = 0.34 * (1 - under);
      path.addColorStop(0, "rgba(255,246,220," + pa + ")");
      path.addColorStop(1, "rgba(255,246,220,0)");
      ctx.fillStyle = path;
      ctx.beginPath();
      ctx.moveTo(sunX - w * 0.035, top + 1);
      ctx.lineTo(sunX + w * 0.035, top + 1);
      ctx.lineTo(sunX + w * 0.09, top + reach);
      ctx.lineTo(sunX - w * 0.09, top + reach);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff8e8";
      var nGlint = 14;
      for (var i = 0; i < nGlint; i++) {
        var fade = 1 - i / nGlint;
        var gy = top + 4 + i * (reach / nGlint);
        if (gy > h - 2) break;
        var flick = Math.abs(Math.sin(t * 2.6 + i * 1.37));
        if (flick < 0.28) continue;
        var half = (0.8 + fade * 2.2) * (i % 2 ? 1.5 : 0.7);
        ctx.globalAlpha = flick * fade * (1 - under);
        ctx.fillRect(sunX + Math.sin(t * 1.8 + i * 2.1) * (3 + i * 0.85) - half, gy, half * 2, Math.max(1.2, h * 0.0026));
      }
      ctx.globalAlpha = 1;
    }

    if (under > 0.02) {
      ctx.fillStyle = "rgba(2, 20, 30," + (under * 0.55) + ")";
      ctx.fillRect(0, 0, w, h);

      var shafts = 3;
      for (var s = 0; s < shafts; s++) {
        var x0 = w * (0.22 + s * 0.26);
        var sway = Math.sin(t * 0.35 + s * 1.4) * w * 0.04;
        var spread = w * 0.07;
        ctx.beginPath();
        ctx.moveTo(x0 - spread * 0.35, 0);
        ctx.lineTo(x0 + spread * 0.35, 0);
        ctx.lineTo(x0 + spread * 1.6 + sway, h);
        ctx.lineTo(x0 - spread * 1.15 + sway, h);
        ctx.closePath();
        var sg = ctx.createLinearGradient(0, 0, 0, h);
        sg.addColorStop(0, "rgba(255,226,176," + (0.2 * under) + ")");
        sg.addColorStop(0.55, "rgba(180,220,190," + (0.06 * under) + ")");
        sg.addColorStop(1, "rgba(120,180,170,0)");
        ctx.fillStyle = sg;
        ctx.fill();
      }

      if (under > 0.18) {
        var ceilA = Math.min(1, (under - 0.18) / 0.5);
        trace(w, h * 0.15, h * 0.018, 0.018, t * 1.15);
        ctx.lineTo(w, 0);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fillStyle = "rgba(176,232,214," + (0.62 * ceilA) + ")";
        ctx.fill();
        ctx.globalAlpha = 0.5 * ceilA;
        ctx.strokeStyle = "rgba(236,255,248,0.95)";
        ctx.lineWidth = Math.max(1, w * 0.004);
        trace(w, h * 0.09, h * 0.012, 0.032, -t * 1.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.lineWidth = Math.max(1, w * 0.003);
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(160,246,216,0.95)";
      for (var c = 0; c < 5; c++) {
        var x0 = ((c * 97) % 70) / 100 * w;
        var y0 = h * (0.5 + (c % 3) * 0.13);
        ctx.globalAlpha = (0.16 + (c % 3) * 0.07) * under;
        ctx.beginPath();
        var steps = 10;
        for (var s = 0; s <= steps; s++) {
          var px = x0 + s * (w * 0.045);
          var py = y0 + Math.sin(px * 0.045 + t * 1.25 + c) * (h * 0.012);
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (under > 0.4) {
        var fishA = Math.min(1, (under - 0.4) / 0.35);
        ctx.globalAlpha = 0.8 * fishA;
        ctx.fillStyle = "rgba(10, 40, 48, 0.9)";
        for (var f = 0; f < 2; f++) {
          var span = w + 80;
          var fx = f === 0 ? ((t * 28 + 40) % span) - 40 : w - ((t * 36 + 20) % span);
          var fy = h * (0.42 + f * 0.22) + Math.sin(t * 0.9 + f) * h * 0.02;
          var dir = f === 0 ? 1 : -1;
          var fs = Math.max(1, w / 390);
          ctx.beginPath();
          ctx.ellipse(fx, fy, 16 * fs, 5.5 * fs, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(fx - dir * 12 * fs, fy);
          ctx.lineTo(fx - dir * 22 * fs, fy - 6 * fs);
          ctx.lineTo(fx - dir * 22 * fs, fy + 6 * fs);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = "#e7fff6";
      for (var m = 0; m < 16; m++) {
        var mx = ((m * 47 + 13) % 100) / 100 * w + Math.sin(t * 0.5 + m) * 6;
        var speed = 16 + (m % 5) * 7;
        var my = h - ((t * speed + m * 37) % (h + 24));
        ctx.globalAlpha = (0.2 + (m % 4) * 0.12) * under;
        ctx.beginPath();
        ctx.arc(mx, my, 1.1 + (m % 3) * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  var actx = null;
  var surfGain = null;
  var underGain = null;
  function ensureAudio() {
    if (actx) {
      if (actx.state === "suspended") { try { actx.resume(); } catch (e) {} }
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      actx = new AC();
      var rate = actx.sampleRate;
      var len = rate;
      var buf = actx.createBuffer(1, len, rate);
      var data = buf.getChannelData(0);
      var brown = 0;
      for (var i = 0; i < len; i++) {
        brown = brown * 0.96 + (Math.random() * 2 - 1) * 0.04;
        data[i] = brown * 2.1;
      }
      var src = actx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      var bp = actx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 420;
      bp.Q.value = 0.45;
      surfGain = actx.createGain();
      surfGain.gain.value = 0;
      src.connect(bp);
      bp.connect(surfGain);
      surfGain.connect(actx.destination);
      src.start();
      var osc = actx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 62;
      var lp = actx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 140;
      underGain = actx.createGain();
      underGain.gain.value = 0;
      osc.connect(lp);
      lp.connect(underGain);
      underGain.connect(actx.destination);
      osc.start();
    } catch (err) { actx = null; }
  }
  function mixAudio() {
    if (!actx || !surfGain || !underGain) return;
    var now = actx.currentTime;
    surfGain.gain.setTargetAtTime((1 - prog) * 0.035, now, 0.12);
    underGain.gain.setTargetAtTime(Math.max(0, prog - 0.35) * 0.05, now, 0.16);
  }

  var lastTick = 0;
  var holdUntil = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    var gap = lastTick ? now - lastTick : 16;
    lastTick = now;
    var dt = Math.min(0.05, gap / 1000);
    if (!paused) simTime += dt;
    var k = dragging ? 10 : 1.35;
    prog += (goal - prog) * (1 - Math.exp(-k * dt));
    if (Math.abs(goal - prog) < 0.0008) prog = goal;
    setLab(goal > 0.5 ? "Return" : "Dive");
    if (now < holdUntil) return;
    if (!fit()) return;
    var t0 = performance.now();
    draw();
    var cost = performance.now() - t0;
    signal();
    mixAudio();
    if (cost > 28) {
      longCap = Math.max(480, Math.round(longCap * 0.75));
      holdUntil = performance.now() + 80;
    }
  }

  function first() {
    if (!fit()) {
      requestAnimationFrame(first);
      return;
    }
    draw();
    requestAnimationFrame(function (now) {
      signal();
      lastTick = now;
      requestAnimationFrame(loop);
    });
  }

  if (fit()) draw();
  requestAnimationFrame(first);
  window.addEventListener("resize", function () {
    if (fit()) draw();
  });
})();
