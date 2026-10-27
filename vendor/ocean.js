/* Ocean descent. Original WebGL2 scene: a level lens, analytic swells,
   fresnel and a deferred spectrum tint. Scroll, drag, or tap to sink.
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
  var simTime = 2.15;
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

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function eyeAt(p) {
    if (p < 0.5) return 1.12 + (0.16 - 1.12) * (p / 0.5);
    return 0.16 + (-2.7 - 0.16) * ((p - 0.5) / 0.5);
  }
  function setLab(t) { if (t !== lab) { dive.textContent = t; lab = t; } }
  function setPause() {
    var t = paused ? "Resume waves" : "Pause waves";
    if (pauseBtn && t !== plab) { pauseBtn.textContent = t; plab = t; }
  }
  setPause();
  setLab("Dive");

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
        var white = Math.random() * 2 - 1;
        brown = brown * 0.96 + white * 0.04;
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
    if (!actx || !surfGain) return;
    var now = actx.currentTime;
    surfGain.gain.setTargetAtTime((1 - prog) * 0.035, now, 0.12);
    underGain.gain.setTargetAtTime(Math.max(0, prog - 0.35) * 0.05, now, 0.16);
  }

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
    if (e.pointerId !== activePtr) return;
    var tap = !moved && Math.abs(e.clientY - downY) < 10;
    dragging = false;
    activePtr = null;
    if (tap) toggleGoal();
  }
  canvas.addEventListener("pointerup", endPtr);
  canvas.addEventListener("pointercancel", endPtr);
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

  var softGL = true;
  var longCap = 144;
  var goalCap = 640;

  function fit() {
    var w = canvas.clientWidth || stage.clientWidth || 0;
    var h = canvas.clientHeight || stage.clientHeight || 0;
    if (w < 2 || h < 2) return false;
    var dpr = Math.min(window.devicePixelRatio || 1, softGL ? 1 : 2);
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

  function paint2d(ctx, eye) {
    var w = canvas.width;
    var h = canvas.height;
    var climb = eye < 1.05 ? Math.max(0, Math.min(1, (1.05 - eye) / 1.05)) : 0;
    var sea = Math.max(8, Math.min(h - 4, h * (0.40 - climb * 0.38)));
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#102044");
    g.addColorStop(Math.max(0.02, sea / h * 0.7), "#6ea0c8");
    g.addColorStop(Math.min(0.96, sea / h), "#f0a06a");
    g.addColorStop(1, "#06343c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff4d8";
    ctx.beginPath();
    ctx.arc(w * 0.72, sea * 0.42, Math.max(10, w * 0.055), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (var x = 0; x <= w; x += 8) {
      var yy = sea + Math.sin(x * 0.02 + simTime * 1.1) * 8 + Math.sin(x * 0.008 - simTime * 0.5) * 14;
      ctx.lineTo(x, yy);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = eye < 0.2 ? "#042833" : "#0c4c56";
    ctx.fill();
    if (eye < 0.35) {
      ctx.fillStyle = "rgba(2, 18, 28, " + Math.max(0, Math.min(0.78, (0.35 - eye) / 2.4)) + ")";
      ctx.fillRect(0, 0, w, h);
    }
  }

  var VS = [
    "#version 300 es",
    "layout(location=0) in vec2 a;",
    "out vec2 v;",
    "void main() {",
    "  v = a * 0.5 + 0.5;",
    "  gl_Position = vec4(a, 0.0, 1.0);",
    "}"
  ].join("\n");

  var FS = [
    "#version 300 es",
    "precision mediump float;",
    "uniform vec2 uRes;",
    "uniform float uTime;",
    "uniform float uEye;",
    "in vec2 v;",
    "out vec4 o;",
    "void main() {",
    "  vec2 res = max(uRes, vec2(1.0));",
    "  float aspect = res.x / res.y;",
    "  float climbT = clamp((1.05 - uEye) / 1.05, 0.0, 1.0);",
    "  float climb = climbT * climbT * (3.0 - 2.0 * climbT);",
    "  float wob = sin(v.x * 14.0 + uTime * 0.95) * 0.010 + sin(v.x * 5.2 - uTime * 0.42) * 0.018;",
    "  float seaLine = 0.57 + climb * 0.55 + wob;",
    "  vec2 ndc = vec2((v.x * 2.0 - 1.0) * aspect, (v.y - 0.57) * 1.7);",
    "  vec3 rd = normalize(vec3(ndc.x * 0.9, ndc.y * 0.85, 1.0));",
    "  vec3 sunDir = normalize(vec3(0.22, 0.30, 0.93));",
    "  float up = clamp(rd.y * 0.85 + 0.05, 0.0, 1.0);",
    "  vec3 sky = mix(vec3(0.99, 0.62, 0.40), vec3(0.25, 0.50, 0.82), smoothstep(0.0, 0.34, up));",
    "  sky = mix(sky, vec3(0.06, 0.16, 0.40), smoothstep(0.4, 1.0, up));",
    "  float sd = clamp(dot(rd, sunDir), 0.0, 1.0);",
    "  sky += vec3(1.0, 0.78, 0.46) * pow(sd, 10.0) * 0.38;",
    "  sky += vec3(1.0, 0.98, 0.90) * smoothstep(0.993, 0.9992, sd);",
    "  float dist = clamp((seaLine - v.y) / max(seaLine, 0.25), 0.0, 1.0);",
    "  float nearH = 1.0 - dist;",
    "  float roll = sin(v.x * 3.1 + dist * 7.0 + uTime * 0.7);",
    "  float mid = sin(v.x * 9.0 - dist * 4.0 + uTime * 1.15);",
    "  float rip = sin(v.x * 20.0 + dist * 8.0 - uTime * 1.6);",
    "  vec3 n = normalize(vec3(-(roll * 0.16 + mid * 0.05 + rip * 0.018), 1.0, 0.05));",
    "  vec3 body = mix(vec3(0.00, 0.50, 0.55), vec3(0.00, 0.20, 0.30), smoothstep(0.0, 0.82, dist));",
    "  body *= 0.86 + 0.14 * roll;",
    "  float ndv = max(dot(n, vec3(0.05, 0.25, 0.97)), 0.05);",
    "  float fres = pow(1.0 - ndv, 4.0) * smoothstep(0.05, 0.75, nearH);",
    "  vec3 sea = mix(body, sky, clamp(fres, 0.0, 0.72));",
    "  float spec = pow(max(dot(reflect(vec3(-0.15, -0.12, -0.98), n), sunDir), 0.0), 30.0);",
    "  sea += vec3(1.0, 0.95, 0.82) * spec;",
    "  float dx = (v.x - 0.62) * aspect * 2.4;",
    "  float path = exp(-dx * dx * 3.4) * pow(max(nearH, 0.0), 0.45);",
    "  float glint = 0.6 + 0.4 * sin(dist * 28.0 - uTime * 2.1);",
    "  sea += vec3(1.0, 0.86, 0.55) * path * glint * 0.55;",
    "  float crest = seaLine - sin(v.x * 14.0 + uTime) * 0.008;",
    "  float foam = smoothstep(0.02, 0.0, abs(v.y - crest));",
    "  sea = mix(sea, vec3(0.92, 0.96, 0.95), foam * 0.8 * (1.0 - climb));",
    "  vec3 col = v.y > seaLine ? sky : sea;",
    "  float diveT = clamp((0.48 - uEye) / 0.95, 0.0, 1.0);",
    "  float dive = diveT * diveT * (3.0 - 2.0 * diveT);",
    "  if (dive > 0.004) {",
    "    float depth = clamp((0.2 - uEye) / 2.6, 0.0, 1.0);",
    "    vec3 under = mix(vec3(0.02, 0.20, 0.26), vec3(0.00, 0.05, 0.09), smoothstep(0.15, 0.9, 1.0 - v.y));",
    "    under = mix(under, vec3(0.00, 0.03, 0.06), depth * 0.65);",
    "    float ceil = smoothstep(0.48, 0.92, v.y);",
    "    float ripU = sin(v.x * 34.0 + uTime * 1.6) * sin(v.x * 15.0 - uTime * 1.1);",
    "    vec3 win = mix(vec3(0.08, 0.32, 0.34), vec3(0.62, 0.86, 0.78), ceil);",
    "    win += vec3(0.35, 0.45, 0.40) * ripU * ripU * ceil;",
    "    under = mix(under, win, ceil);",
    "    float shaft = pow(max(sin(v.x * 8.0 + 0.4 + uTime * 0.18), 0.0), 5.0);",
    "    shaft += 0.65 * pow(max(sin(v.x * 8.0 + 2.4 + uTime * 0.12), 0.0), 5.0);",
    "    shaft *= smoothstep(0.05, 0.72, v.y) * (1.0 - ceil);",
    "    under += vec3(0.55, 0.40, 0.18) * shaft * 0.42;",
    "    float cau = sin(v.x * 16.0 + v.y * 7.0 + uTime) * sin(v.x * 6.0 - v.y * 13.0 - uTime * 0.7);",
    "    under += vec3(0.06, 0.28, 0.24) * cau * cau * smoothstep(0.55, 0.05, v.y) * (0.35 + depth);",
    "    vec2 mv = vec2(v.x * 26.0, v.y * 46.0 - uTime * 1.1);",
    "    vec2 cell = floor(mv);",
    "    float mote = fract(sin(dot(cell, vec2(12.9, 78.2))) * 43758.5);",
    "    float blob = smoothstep(0.18, 0.02, length(fract(mv) - 0.5));",
    "    under += vec3(0.75, 0.90, 0.86) * blob * step(0.94, mote) * 0.4;",
    "    col = mix(col, under, dive);",
    "  }",
    "  vec2 vg = v * 2.0 - 1.0;",
    "  col *= 1.0 - dot(vg, vg) * 0.04;",
    "  o = vec4(clamp(col, 0.0, 1.0), 1.0);",
    "}"
  ].join("\n");

  var gl = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false
    });
  } catch (e) { gl = null; }

  if (!gl) { start2d(); return; }

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  var vs = compile(gl.VERTEX_SHADER, VS);
  var fs = compile(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) { start2d(); return; }
  var progGL = gl.createProgram();
  gl.attachShader(progGL, vs);
  gl.attachShader(progGL, fs);
  gl.bindAttribLocation(progGL, 0, "a");
  gl.linkProgram(progGL);
  if (!gl.getProgramParameter(progGL, gl.LINK_STATUS)) { start2d(); return; }

  var vao = gl.createVertexArray();
  var buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  var locRes = gl.getUniformLocation(progGL, "uRes");
  var locTime = gl.getUniformLocation(progGL, "uTime");
  var locEye = gl.getUniformLocation(progGL, "uEye");

  (function detectSoft() {
    var info = gl.getExtension("WEBGL_debug_renderer_info");
    var name = "";
    if (info) {
      try { name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || ""); } catch (e) {}
    }
    var real = /nvidia|geforce|radeon|\bamd\b|apple|adreno|mali|\bintel\b|powervr/i.test(name);
    var softName = !name || /swiftshader|llvmpipe|softpipe|software|mesa|basic render|virgl/i.test(name);
    softGL = softName || !real;
    goalCap = softGL ? 760 : 960;
    longCap = softGL ? 160 : goalCap;
  })();

  function drawGL(eye) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(progGL);
    gl.bindVertexArray(vao);
    gl.uniform2f(locRes, canvas.width, canvas.height);
    gl.uniform1f(locTime, simTime);
    gl.uniform1f(locEye, eye);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  var bootAt = performance.now();
  var lastTick = bootAt;
  var lastDraw = 0;
  var holdUntil = 0;
  var draws = 0;
  var sharpened = false;

  function eyeNow() {
    var base = eyeAt(prog);
    var shore = Math.exp(-((base - 0.2) * (base - 0.2)) / 0.12);
    return base + (Math.sin(simTime * 1.2) * 0.03 + Math.sin(simTime * 0.5) * 0.016) * shore;
  }

  function frame() {
    requestAnimationFrame(frame);
    var now = performance.now();
    var gap = now - lastTick;
    lastTick = now;
    var dt = Math.min(0.05, gap / 1000);
    if (!paused) simTime += dt;
    var k = dragging ? 14 : 1.4;
    prog += (goal - prog) * (1 - Math.exp(-k * dt));
    if (Math.abs(goal - prog) < 0.0008) prog = goal;
    setLab(goal > 0.5 ? "Return" : "Dive");
    if (now < holdUntil) return;
    var age = now - bootAt;
    if (!sharpened && age > 3400) {
      sharpened = true;
      longCap = goalCap;
    }
    if (softGL && !sharpened && now - lastDraw < 130) return;
    if (!fit()) return;
    var t0 = performance.now();
    drawGL(eyeNow());
    var cost = performance.now() - t0;
    lastDraw = performance.now();
    draws += 1;
    if (draws === 1) signal();
    mixAudio();
    if (draws <= 2) {
      if (cost > 36) holdUntil = performance.now() + 280;
      return;
    }
    if (cost > 20 || gap > 46) {
      var floorCap = sharpened ? 420 : 96;
      longCap = Math.max(floorCap, Math.round(longCap * 0.7));
      holdUntil = performance.now() + (sharpened ? 80 : 560);
    }
  }
  requestAnimationFrame(frame);

  function start2d() {
    gl = null;
    softGL = true;
    longCap = 320;
    goalCap = 480;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var prev2 = performance.now();
    var hold2 = 0;
    var last2 = 0;
    function frame2() {
      requestAnimationFrame(frame2);
      var now = performance.now();
      var gap = now - prev2;
      prev2 = now;
      var dt = Math.min(0.05, gap / 1000);
      if (!paused) simTime += dt;
      prog += (goal - prog) * (1 - Math.exp(-1.4 * dt));
      setLab(goal > 0.5 ? "Return" : "Dive");
      if (now < hold2) return;
      if (last2 && now - bootAt < 3600 && now - last2 < 90) return;
      if (!fit()) return;
      var t0 = performance.now();
      paint2d(ctx, eyeNow());
      last2 = performance.now();
      signal();
      if (performance.now() - t0 > 22) {
        longCap = Math.max(120, Math.round(longCap * 0.7));
        hold2 = performance.now() + 280;
      }
    }
    bootAt = performance.now();
    requestAnimationFrame(frame2);
  }
})();
