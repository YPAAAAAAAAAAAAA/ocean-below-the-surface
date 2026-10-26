/* Ocean descent. Original WebGL2 scene: level lens, Gerstner swell,
   a deferred Phillips spectrum on a GPU inverse FFT, and a scroll/tap dive.
   Idea after @snychng — no upstream code. */
(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var canvas = document.getElementById("canvas");
  var dive = document.getElementById("dive");
  var pauseBtn = document.getElementById("pause");
  var hint = document.getElementById("hint");
  if (!stage || !canvas || !dive) return;

  var G = 9.81;
  var PATCH = 40;
  var N = 64;
  var ART = 170;
  var H0S = 1000;
  var WV = [
    [0.27, 0.40, 0.16, 0.40],
    [0.11, -0.24, 0.58, 1.70],
    [0.05, 1.10, -0.42, 2.40],
    [0.026, -1.40, 0.90, 0.80]
  ];

  function hypot(x, z) { return Math.sqrt(x * x + z * z); }
  function omega(kx, kz) { return Math.sqrt(G * hypot(kx, kz)); }
  function swell(t) {
    var h = 0;
    for (var i = 0; i < WV.length; i++) {
      var w = WV[i];
      h += w[0] * Math.sin(w[3] + omega(w[1], w[2]) * t);
    }
    return h;
  }
  function eyeAt(p) {
    if (p < 0.40) return 0.86 + (0.16 - 0.86) * (p / 0.40);
    if (p < 0.62) return 0.16 + (-0.22 - 0.16) * ((p - 0.40) / 0.22);
    return -0.22 + (-3.05 + 0.22) * ((p - 0.62) / 0.38);
  }

  var goal = 0;
  var prog = 0;
  var simTime = 3.05;
  var paused = false;
  try { paused = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  var dragging = false;
  var lastY = 0;
  var activePtr = null;
  var sent = false;
  var lab = "";
  var plab = "";

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function setLab(t) { if (t !== lab) { dive.textContent = t; lab = t; } }
  function setPause() {
    var t = paused ? "Resume waves" : "Pause waves";
    if (pauseBtn && t !== plab) { pauseBtn.textContent = t; plab = t; }
  }
  setPause();

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
      var buf = actx.createBuffer(1, rate * 2, rate);
      var data = buf.getChannelData(0);
      var brown = 0;
      for (var i = 0; i < data.length; i++) {
        var white = Math.random() * 2 - 1;
        brown = brown * 0.94 + white * 0.06;
        data[i] = brown * 2.4;
      }
      var src = actx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      var bp = actx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 480;
      bp.Q.value = 0.4;
      surfGain = actx.createGain();
      surfGain.gain.value = 0;
      src.connect(bp);
      bp.connect(surfGain);
      surfGain.connect(actx.destination);
      src.start();
      var osc = actx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 70;
      var lp = actx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 160;
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
    surfGain.gain.setTargetAtTime((1 - prog) * 0.04, now, 0.12);
    underGain.gain.setTargetAtTime(Math.max(0, prog - 0.28) * 0.055, now, 0.15);
  }

  function signal() {
    if (sent) return;
    if (window.__gbSandbox && typeof window.__gbSandbox.ready === "function") {
      sent = true;
      window.__gbSandbox.ready();
    }
  }

  dive.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    goal = goal > 0.5 ? 0 : 1;
    ensureAudio();
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
    activePtr = e.pointerId;
    lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    ensureAudio();
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!dragging || e.pointerId !== activePtr) return;
    e.preventDefault();
    var h = stage.clientHeight || 480;
    var dy = e.clientY - lastY;
    lastY = e.clientY;
    goal = clamp01(goal + (-dy) / (h * 2.05));
  }, { passive: false });
  function endPtr(e) {
    if (e.pointerId !== activePtr) return;
    dragging = false;
    activePtr = null;
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
    goal = clamp01(goal + dy / (h * 2.05));
    ensureAudio();
  }, { passive: false });
  window.addEventListener("keydown", function (e) {
    if (e.code !== "Space") return;
    if (e.target && e.target.tagName === "BUTTON") return;
    e.preventDefault();
    paused = !paused;
    setPause();
  });

  function fit() {
    var w = canvas.clientWidth || stage.clientWidth || 0;
    var h = canvas.clientHeight || stage.clientHeight || 0;
    if (w < 2 || h < 2) return false;
    var dpr = Math.min(window.devicePixelRatio || 1, 1);
    var pw = Math.max(2, Math.round(w * dpr));
    var ph = Math.max(2, Math.round(h * dpr));
    var cap = 220000;
    if (pw * ph > cap) {
      var s = Math.sqrt(cap / (pw * ph));
      pw = Math.max(2, Math.round(pw * s));
      ph = Math.max(2, Math.round(ph * s));
    }
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    return true;
  }

  function glslWaves() {
    var Q = 0.55;
    var s = "void waves(vec2 xz, out float h, out vec2 slope, out vec2 disp) {\n";
    s += "  h = 0.0;\n  slope = vec2(0.0);\n  disp = vec2(0.0);\n";
    s += "  float th, sn, cs, kk;\n";
    for (var i = 0; i < WV.length; i++) {
      var A = WV[i][0], kx = WV[i][1], kz = WV[i][2], ph = WV[i][3];
      var klen = hypot(kx, kz);
      var om = Math.sqrt(G * klen);
      var damp = i >= 2 ? " * mix(1.0, 0.35, uMix)" : "";
      s += "  th = dot(vec2(" + kx.toFixed(5) + ", " + kz.toFixed(5) + "), xz) + " + ph.toFixed(4) + " + " + om.toFixed(5) + " * uTime;\n";
      s += "  sn = sin(th); cs = cos(th);\n";
      s += "  kk = " + A.toFixed(5) + damp + ";\n";
      s += "  h += kk * sn;\n";
      s += "  slope += kk * vec2(" + kx.toFixed(5) + ", " + kz.toFixed(5) + ") * cs;\n";
      s += "  disp += " + Q.toFixed(3) + " * kk * vec2(" + (kx / klen).toFixed(5) + ", " + (kz / klen).toFixed(5) + ") * cs;\n";
    }
    s += "}\n";
    return s;
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

  function oceanFrag() {
    return [
      "#version 300 es",
      "precision highp float;",
      "precision highp int;",
      "uniform vec2 uRes;",
      "uniform float uTime;",
      "uniform float uEye;",
      "uniform float uMix;",
      "uniform float uL;",
      "uniform sampler2D uDisp;",
      "in vec2 v;",
      "out vec4 o;",
      "const vec3 SUN = vec3(0.17288, 0.31119, 0.93449);",
      glslWaves(),
      "ivec2 w64(vec2 p) {",
      "  return ivec2(clamp(mod(p, 64.0), 0.0, 63.0));",
      "}",
      "vec3 sampD(vec2 world) {",
      "  vec2 g = (world / uL + 0.5) * 64.0 - 0.5;",
      "  vec2 f = fract(g);",
      "  vec2 b = floor(g);",
      "  ivec2 i00 = w64(b);",
      "  ivec2 i10 = w64(b + vec2(1.0, 0.0));",
      "  ivec2 i01 = w64(b + vec2(0.0, 1.0));",
      "  ivec2 i11 = w64(b + vec2(1.0, 1.0));",
      "  vec3 a = texelFetch(uDisp, i00, 0).xyz;",
      "  vec3 c = texelFetch(uDisp, i10, 0).xyz;",
      "  vec3 d = texelFetch(uDisp, i01, 0).xyz;",
      "  vec3 e = texelFetch(uDisp, i11, 0).xyz;",
      "  return mix(mix(a, c, f.x), mix(d, e, f.x), f.y);",
      "}",
      "float heightOnly(vec2 xz) {",
      "  float h; vec2 slope, disp;",
      "  waves(xz, h, slope, disp);",
      "  waves(xz + disp, h, slope, disp);",
      "  return h;",
      "}",
      "void surfaceAt(vec2 xz, out float h, out vec3 nrm) {",
      "  float h0; vec2 slope0, disp0;",
      "  waves(xz, h0, slope0, disp0);",
      "  vec2 p = xz + disp0;",
      "  float h1; vec2 slope1, disp1;",
      "  waves(p, h1, slope1, disp1);",
      "  h = h1;",
      "  vec2 slope = slope1;",
      "  if (uMix > 0.001) {",
      "    vec3 d0 = sampD(p);",
      "    vec3 dxs = sampD(p + vec2(0.62, 0.0));",
      "    vec3 dzs = sampD(p + vec2(0.0, 0.62));",
      "    h += d0.x * uMix;",
      "    slope.x += (dxs.x - d0.x) / 0.62 * uMix;",
      "    slope.y += (dzs.x - d0.x) / 0.62 * uMix;",
      "  }",
      "  nrm = normalize(vec3(-slope.x, 1.0, -slope.y));",
      "}",
      "vec3 sky(vec3 rd) {",
      "  float up = clamp(rd.y, -0.15, 1.0);",
      "  vec3 zen = vec3(0.13, 0.26, 0.50);",
      "  vec3 mid = vec3(0.46, 0.64, 0.78);",
      "  vec3 hor = vec3(0.98, 0.74, 0.52);",
      "  float t = smoothstep(-0.02, 0.55, up);",
      "  vec3 col = mix(hor, mix(mid, zen, smoothstep(0.0, 0.72, up)), smoothstep(0.0, 0.28, up));",
      "  float sd = clamp(dot(rd, SUN), 0.0, 1.0);",
      "  col += vec3(1.0, 0.90, 0.70) * pow(sd, 420.0) * 2.4;",
      "  col += vec3(1.0, 0.70, 0.38) * pow(sd, 8.0) * 0.34;",
      "  float cl = sin(rd.x * 22.0 + rd.z * 8.0 + uTime * 0.05);",
      "  col = mix(col, vec3(0.97, 0.92, 0.86), smoothstep(0.78, 0.98, cl) * smoothstep(0.12, 0.45, rd.y) * 0.18);",
      "  return col;",
      "}",
      "float marchH(vec3 ro, vec3 rd) {",
      "  if (rd.y > 0.012) return -1.0;",
      "  float t = 1.4;",
      "  if (rd.y < -0.0006) t = clamp((0.04 - ro.y) / rd.y, 0.0, 90.0);",
      "  for (int i = 0; i < 4; i++) {",
      "    vec3 p = ro + rd * t;",
      "    float hh = heightOnly(p.xz);",
      "    t += (hh - p.y) / max(0.30, -rd.y + 0.20);",
      "    t = clamp(t, 0.0, 130.0);",
      "  }",
      "  if (t < 0.02 || t > 110.0) return -1.0;",
      "  return t;",
      "}",
      "float lensWet(vec3 ro, vec3 rd) {",
      "  vec3 q = ro + rd * 0.22;",
      "  float hh = heightOnly(q.xz);",
      "  return smoothstep(0.055, -0.06, q.y - hh);",
      "}",
      "vec3 shadeAbove(vec3 ro, vec3 rd) {",
      "  float t = marchH(ro, rd);",
      "  if (t < 0.0) {",
      "    if (rd.y < -0.002) {",
      "      vec3 far = sky(normalize(vec3(rd.x, 0.015, rd.z)));",
      "      return mix(vec3(0.08, 0.26, 0.30), far, 0.72);",
      "    }",
      "    return sky(rd);",
      "  }",
      "  vec3 p = ro + rd * t;",
      "  float h; vec3 nrm;",
      "  surfaceAt(p.xz, h, nrm);",
      "  float ndv = max(dot(nrm, -rd), 0.0);",
      "  float fres = mix(0.04, 0.98, pow(1.0 - ndv, 5.0));",
      "  vec3 refl = sky(reflect(rd, nrm));",
      "  vec3 body = vec3(0.04, 0.30, 0.32);",
      "  body += vec3(0.16, 0.22, 0.10) * pow(max(dot(nrm, SUN), 0.0), 1.4);",
      "  body += vec3(0.08, 0.14, 0.12) * ndv;",
      "  vec3 col = mix(body, refl, fres);",
      "  float spec = pow(max(dot(reflect(-SUN, nrm), -rd), 0.0), 90.0);",
      "  col += vec3(1.0, 0.90, 0.68) * spec * 1.35;",
      "  col += vec3(1.0, 0.78, 0.48) * pow(max(dot(reflect(-SUN, nrm), -rd), 0.0), 12.0) * 0.18;",
      "  float glitter = pow(max(dot(nrm, SUN), 0.0), 28.0);",
      "  float hz = fract(sin(dot(floor(p.xz * 5.5), vec2(12.9, 47.3)) + floor(uTime * 7.0)) * 43758.5);",
      "  col += vec3(1.0, 0.92, 0.72) * glitter * step(0.90, hz) * exp(-t * 0.035) * 0.85;",
      "  float foam = smoothstep(0.14, 0.25, h);",
      "  foam *= 0.6 + 0.4 * sin(p.x * 4.5 + uTime * 1.4) * sin(p.z * 3.8 - uTime);",
      "  foam *= exp(-t * 0.07);",
      "  col = mix(col, vec3(0.84, 0.88, 0.86), clamp(foam, 0.0, 1.0) * 0.72);",
      "  float fog = 1.0 - exp(-t * 0.016);",
      "  vec3 hor = sky(normalize(vec3(rd.x, 0.02, rd.z)));",
      "  col = mix(col, hor, clamp(fog, 0.0, 1.0));",
      "  return col;",
      "}",
      "vec3 shadeBelow(vec3 ro, vec3 rd) {",
      "  float up = clamp(rd.y * 0.85 + 0.35, 0.0, 1.0);",
      "  vec3 col = mix(vec3(0.01, 0.07, 0.11), vec3(0.04, 0.28, 0.34), up);",
      "  float absorb = clamp(-uEye, 0.0, 3.2);",
      "  col *= vec3(exp(-absorb * 0.55), exp(-absorb * 0.16), exp(-absorb * 0.08));",
      "  if (rd.y < -0.05) {",
      "    float tf = (-3.4 - ro.y) / rd.y;",
      "    if (tf > 0.0 && tf < 36.0) {",
      "      vec2 fx = ro.xz + rd.xz * tf;",
      "      float c1 = sin(fx.x * 2.2 + uTime * 1.25) * sin(fx.y * 2.5 - uTime * 1.05);",
      "      float c2 = sin((fx.x + fx.y) * 1.6 - uTime * 0.8);",
      "      float cau = pow(max(0.0, c1 * 0.55 + c2 * 0.45), 2.0);",
      "      col += vec3(0.20, 0.55, 0.50) * cau * exp(-tf * 0.085) * 0.7;",
      "    }",
      "  }",
      "  float ang = atan(rd.x - 0.42, rd.y + 0.12);",
      "  float shaft = pow(max(0.0, sin(ang * 6.0 + uTime * 0.35)), 12.0);",
      "  shaft *= smoothstep(-0.25, 0.55, rd.y) * smoothstep(-2.6, -0.1, uEye);",
      "  col += vec3(0.62, 0.40, 0.18) * shaft * 0.42;",
      "  if (rd.y > 0.52) {",
      "    vec3 wn = vec3(0.0, 1.0, 0.0);",
      "    float ts = clamp((0.08 - ro.y) / max(rd.y, 0.08), 0.15, 14.0);",
      "    float hh; vec3 nn;",
      "    surfaceAt((ro + rd * ts).xz, hh, nn);",
      "    if (dot(nn, rd) > 0.0) wn = nn;",
      "    vec3 air = refract(rd, wn, 0.752);",
      "    if (dot(air, air) > 0.02) col = mix(col, sky(normalize(air)), 0.86);",
      "  }",
      "  vec2 cell = floor(gl_FragCoord.xy * 0.45 + vec2(0.0, uTime * 22.0));",
      "  vec2 fv = fract(gl_FragCoord.xy * 0.45 + vec2(0.0, uTime * 22.0)) - 0.5;",
      "  float mote = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5);",
      "  float dotp = smoothstep(0.42, 0.05, length(fv)) * step(0.975, mote);",
      "  col += vec3(0.75, 0.88, 0.84) * dotp * (rd.y < 0.5 ? 1.0 : 0.2);",
      "  return col;",
      "}",
      "void main() {",
      "  float aspect = uRes.x / max(uRes.y, 1.0);",
      "  vec2 uv = v * 2.0 - 1.0;",
      "  uv.x *= aspect;",
      "  uv.y += 0.34;",
      "  vec3 rd = normalize(vec3(uv * 0.74, 1.0));",
      "  vec3 ro = vec3(0.0, uEye, 0.0);",
      "  float wet = lensWet(ro, rd);",
      "  vec3 col;",
      "  if (wet < 0.40) col = shadeAbove(ro, rd);",
      "  else if (wet > 0.76) col = shadeBelow(ro, rd);",
      "  else col = mix(shadeAbove(ro, rd), shadeBelow(ro, rd), smoothstep(0.40, 0.76, wet));",
      "  float band = smoothstep(0.40, 0.56, wet) * smoothstep(0.78, 0.58, wet);",
      "  col += vec3(0.82, 0.90, 0.88) * band * 1.05;",
      "  col *= 1.0 - band * 0.16;",
      "  vec2 vg = v * 2.0 - 1.0;",
      "  col *= 1.0 - dot(vg, vg) * 0.06;",
      "  col = pow(clamp(col, 0.0, 1.7), vec3(0.90, 0.93, 0.96));",
      "  o = vec4(clamp(col, 0.0, 1.0), 1.0);",
      "}"
    ].join("\n");
  }

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
      console.error(gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  var vs = compile(gl.VERTEX_SHADER, VS);
  function link(fsSrc) {
    var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, "a");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p));
      gl.deleteProgram(p);
      return null;
    }
    return p;
  }

  var ocean = link(oceanFrag());
  if (!ocean) { start2d(); return; }

  var vao = gl.createVertexArray();
  var buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  var U = {};
  ["uRes", "uTime", "uEye", "uMix", "uL", "uDisp"].forEach(function (n) {
    U[n] = gl.getUniformLocation(ocean, n);
  });

  var zeroTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, zeroTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  var mixAmt = 0;
  var fft = null;

  function drawGL(eye) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(ocean);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fft && fft.disp ? fft.disp : zeroTex);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, simTime);
    gl.uniform1f(U.uEye, eye);
    gl.uniform1f(U.uMix, mixAmt);
    gl.uniform1f(U.uL, PATCH);
    gl.uniform1i(U.uDisp, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function mulberry(seed) {
    var s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function gauss(rnd) {
    var u = rnd() || 1e-7;
    var v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
  }

  function setupFft() {
    if (!gl.getExtension("EXT_color_buffer_float")) return false;
    var fftSrc = [
      "#version 300 es",
      "precision highp float;",
      "precision highp int;",
      "uniform sampler2D uSrc;",
      "uniform int uMode;",
      "uniform int uStage;",
      "uniform int uLen;",
      "uniform float uGain;",
      "out vec4 o;",
      "int brev(int x) {",
      "  int r = 0; int v = x;",
      "  for (int b = 0; b < 6; b++) { r = (r << 1) | (v & 1); v = v >> 1; }",
      "  return r;",
      "}",
      "vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }",
      "void main() {",
      "  ivec2 ij = ivec2(gl_FragCoord.xy);",
      "  if (uMode == 4) { o = texelFetch(uSrc, ij, 0) * uGain; return; }",
      "  if (uMode == 0) { o = texelFetch(uSrc, ivec2(brev(ij.x), ij.y), 0) * uGain; return; }",
      "  if (uMode == 1) { o = texelFetch(uSrc, ivec2(ij.x, brev(ij.y)), 0) * uGain; return; }",
      "  int len = uLen; int hn = len >> 1;",
      "  int axis = (uMode == 2) ? ij.x : ij.y;",
      "  int base = (axis / len) * len;",
      "  int j = axis - base;",
      "  int jrel = j < hn ? j : j - hn;",
      "  float ang = 6.28318530718 * float(jrel) / float(len);",
      "  vec2 w = vec2(cos(ang), sin(ang));",
      "  ivec2 ia = ij; ivec2 ib = ij;",
      "  if (uMode == 2) { ia.x = base + jrel; ib.x = ia.x + hn; }",
      "  else { ia.y = base + jrel; ib.y = ia.y + hn; }",
      "  vec4 A = texelFetch(uSrc, ia, 0);",
      "  vec4 B = texelFetch(uSrc, ib, 0);",
      "  vec2 t0 = cmul(B.xy, w);",
      "  vec2 t1 = cmul(B.zw, w);",
      "  vec2 r0 = (j < hn) ? (A.xy + t0) : (A.xy - t0);",
      "  vec2 r1 = (j < hn) ? (A.zw + t1) : (A.zw - t1);",
      "  o = vec4(r0, r1) * uGain;",
      "}"
    ].join("\n");
    var evoSrc = [
      "#version 300 es",
      "precision highp float;",
      "precision highp int;",
      "uniform sampler2D uH0;",
      "uniform float uTime;",
      "uniform float uL;",
      "layout(location=0) out vec4 oA;",
      "layout(location=1) out vec4 oB;",
      "void main() {",
      "  ivec2 ij = ivec2(gl_FragCoord.xy);",
      "  int N = 64;",
      "  int ni = ij.x == 0 ? 0 : N - ij.x;",
      "  int nj = ij.y == 0 ? 0 : N - ij.y;",
      "  float kx = (ij.x < N / 2 ? float(ij.x) : float(ij.x - N)) * 6.28318530718 / uL;",
      "  float kz = (ij.y < N / 2 ? float(ij.y) : float(ij.y - N)) * 6.28318530718 / uL;",
      "  float k = length(vec2(kx, kz));",
      "  if (k < 0.0001) { oA = vec4(0.0); oB = vec4(0.0); return; }",
      "  vec2 h0 = texelFetch(uH0, ij, 0).xy * 0.001;",
      "  vec2 h0m = texelFetch(uH0, ivec2(ni, nj), 0).xy * 0.001;",
      "  float w = sqrt(9.81 * k);",
      "  float c = cos(w * uTime);",
      "  float s = sin(w * uTime);",
      "  vec2 e1 = vec2(h0.x * c - h0.y * s, h0.x * s + h0.y * c);",
      "  vec2 cm = vec2(h0m.x, -h0m.y);",
      "  vec2 e2 = vec2(cm.x * c - cm.y * (-s), cm.x * (-s) + cm.y * c);",
      "  vec2 h = e1 + e2;",
      "  float inv = 1.0 / k;",
      "  vec2 dx = vec2(kx * inv * h.y, -kx * inv * h.x);",
      "  vec2 dz = vec2(kz * inv * h.y, -kz * inv * h.x);",
      "  oA = vec4(h, dx);",
      "  oB = vec4(dz, 0.0, 0.0);",
      "}"
    ].join("\n");
    var combSrc = [
      "#version 300 es",
      "precision highp float;",
      "precision highp int;",
      "uniform sampler2D uA;",
      "uniform sampler2D uB;",
      "uniform float uArt;",
      "out vec4 o;",
      "void main() {",
      "  ivec2 ij = ivec2(gl_FragCoord.xy);",
      "  vec4 a = texelFetch(uA, ij, 0);",
      "  vec2 b = texelFetch(uB, ij, 0).xy;",
      "  o = vec4(a.x * uArt, a.z * uArt, b.x * uArt, 1.0);",
      "}"
    ].join("\n");
    var fp = link(fftSrc);
    var ep = link(evoSrc);
    var cp = link(combSrc);
    if (!fp || !ep || !cp) return false;

    function rt() {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, N, N, 0, gl.RGBA, gl.HALF_FLOAT, null);
      return tex;
    }
    var fbo = gl.createFramebuffer();
    function complete(tex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
    var p0 = rt(), p1 = rt(), p2 = rt(), hold = rt(), disp = rt(), freqA = rt(), freqB = rt();
    if (!complete(p0) || !complete(disp)) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, freqA, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, freqB, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return false;
    }

    var rnd = mulberry(1337);
    var h0 = new Float32Array(N * N * 4);
    var windX = 0.93, windZ = 0.36;
    var wm = hypot(windX, windZ);
    windX /= wm; windZ /= wm;
    var V = 6.5;
    var Lw = (V * V) / G;
    var Amp = 1.6e-3;
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        var kx = (i < N / 2 ? i : i - N) * Math.PI * 2 / PATCH;
        var kz = (j < N / 2 ? j : j - N) * Math.PI * 2 / PATCH;
        var k = hypot(kx, kz);
        var idx = (j * N + i) * 4;
        if (k < 1e-4) continue;
        var kd = (kx * windX + kz * windZ) / k;
        var ph = Amp * Math.exp(-1 / ((k * Lw) * (k * Lw))) / (k * k * k * k) * kd * kd;
        if (kd < 0) ph *= 0.06;
        ph *= Math.exp(-k * k * 0.12 * 0.12);
        var a = Math.sqrt(Math.max(0, ph) * 0.5);
        h0[idx] = gauss(rnd) * a * H0S;
        h0[idx + 1] = gauss(rnd) * a * H0S;
      }
    }
    var h0tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, h0tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, N, N, 0, gl.RGBA, gl.FLOAT, h0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    var fu = {
      src: gl.getUniformLocation(fp, "uSrc"),
      mode: gl.getUniformLocation(fp, "uMode"),
      stage: gl.getUniformLocation(fp, "uStage"),
      len: gl.getUniformLocation(fp, "uLen"),
      gain: gl.getUniformLocation(fp, "uGain")
    };
    var eu = {
      h0: gl.getUniformLocation(ep, "uH0"),
      time: gl.getUniformLocation(ep, "uTime"),
      L: gl.getUniformLocation(ep, "uL")
    };
    var cu = {
      A: gl.getUniformLocation(cp, "uA"),
      B: gl.getUniformLocation(cp, "uB"),
      art: gl.getUniformLocation(cp, "uArt")
    };

    function pass(prog, dst, set) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, N, N);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      set();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function fft1(src, a, b, horizontal) {
      var modeRev = horizontal ? 0 : 1;
      var modeB = horizontal ? 2 : 3;
      pass(fp, a, function () {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src);
        gl.uniform1i(fu.src, 0);
        gl.uniform1i(fu.mode, modeRev);
        gl.uniform1i(fu.stage, 0);
        gl.uniform1i(fu.len, 2);
        gl.uniform1f(fu.gain, 1);
      });
      var cur = a, nxt = b;
      for (var s = 0; s < 6; s++) {
        var gain = s === 5 ? 1 / N : 1;
        var len = 1 << (s + 1);
        var read = cur;
        pass(fp, nxt, function () {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, read);
          gl.uniform1i(fu.src, 0);
          gl.uniform1i(fu.mode, modeB);
          gl.uniform1i(fu.stage, s);
          gl.uniform1i(fu.len, len);
          gl.uniform1f(fu.gain, gain);
        });
        var tmp = cur; cur = nxt; nxt = tmp;
      }
      return cur;
    }
    function fft2(src) {
      var rows = fft1(src, p0, p1, true);
      return fft1(rows, p1, p2, false);
    }

    fft = {
      disp: disp,
      run: function () {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, freqA, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, freqB, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        gl.viewport(0, 0, N, N);
        gl.useProgram(ep);
        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, h0tex);
        gl.uniform1i(eu.h0, 0);
        gl.uniform1f(eu.time, simTime);
        gl.uniform1f(eu.L, PATCH);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        var aDone = fft2(freqA);
        pass(fp, hold, function () {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, aDone);
          gl.uniform1i(fu.src, 0);
          gl.uniform1i(fu.mode, 4);
          gl.uniform1i(fu.stage, 0);
          gl.uniform1i(fu.len, 2);
          gl.uniform1f(fu.gain, 1);
        });
        var bDone = fft2(freqB);
        pass(cp, disp, function () {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, hold);
          gl.uniform1i(cu.A, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, bDone);
          gl.uniform1i(cu.B, 1);
          gl.uniform1f(cu.art, ART);
        });
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    };
    return true;
  }

  var fftTried = false;
  var prev = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    var dt = prev ? Math.min(0.05, (t - prev) / 1000) : 0.016;
    prev = t;
    if (!paused) simTime += dt;
    var k = dragging ? 16 : 0.9;
    prog += (goal - prog) * (1 - Math.exp(-k * dt));
    if (Math.abs(goal - prog) < 0.0006) prog = goal;
    setLab(goal > 0.5 ? "Return" : "Dive");
    var base = eyeAt(prog);
    var follow = Math.exp(-Math.pow((base - 0.02) / 0.22, 2));
    var eye = base + swell(simTime) * 0.5 * follow;
    if (!fit()) return;
    if (!fftTried && t > 4200) {
      fftTried = true;
      try { if (!setupFft()) fft = null; } catch (err) { console.error(err); fft = null; }
    }
    if (fft && fft.run) {
      fft.run();
      mixAmt += (1 - mixAmt) * Math.min(1, dt * 0.7);
    }
    drawGL(eye);
    signal();
    mixAudio();
  }
  requestAnimationFrame(frame);

  function start2d() {
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var prev2 = 0;
    function frame2(t) {
      requestAnimationFrame(frame2);
      var dt = prev2 ? Math.min(0.05, (t - prev2) / 1000) : 0.016;
      prev2 = t;
      if (!paused) simTime += dt;
      var k = dragging ? 16 : 0.9;
      prog += (goal - prog) * (1 - Math.exp(-k * dt));
      setLab(goal > 0.5 ? "Return" : "Dive");
      if (!fit()) return;
      var w = canvas.width, h = canvas.height;
      var base = eyeAt(prog);
      var eye = base + swell(simTime) * 0.25;
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#1a3c66");
      g.addColorStop(0.58, "#f0c09a");
      g.addColorStop(1, "#0c3340");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffe3b8";
      ctx.beginPath();
      ctx.arc(w * 0.74, h * 0.30, Math.max(8, w * 0.045), 0, Math.PI * 2);
      ctx.fill();
      var horizon = h * (0.66 + Math.max(-0.2, Math.min(0.45, -eye * 0.12)));
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, horizon);
      for (var x = 0; x <= w; x += 6) {
        var yy = horizon + Math.sin(x * 0.018 + simTime * 1.2) * 7 + Math.sin(x * 0.05 - simTime * 0.8) * 3;
        ctx.lineTo(x, yy);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = "rgba(10, 58, 68, 0.88)";
      ctx.fill();
      if (eye < 0.2) {
        ctx.fillStyle = "rgba(3, 24, 34, " + Math.max(0, Math.min(0.82, (0.2 - eye) / 2.6)) + ")";
        ctx.fillRect(0, 0, w, h);
      }
      signal();
    }
    requestAnimationFrame(frame2);
  }
})();
