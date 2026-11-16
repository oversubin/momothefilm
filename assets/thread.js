/* MOMO 실 그리기 — 원 둘레 800개 핀 사이를 실이 오간 순서(seq*.bin) 그대로 WebGL2 로 긋는다.
   실의 농도는 반정밀 실수 버퍼에 더하고 빼서(풀릴 때는 정확히 거꾸로) exp(-농도)로 종이 위에 보인다.
   lo 실은 R, hi(얼굴) 실은 G 에 쌓고 얼굴 마스크로 섞는다 — 포스터 렌더(strart.py)와 같은 식. */
(function () {
  var PINS = 800, R = (1500 - 4) / 1500;
  var VS_LINE = '#version 300 es\nin vec3 a;uniform float uI0;out float vI;void main(){vI=a.z;gl_Position=vec4(a.xy,0.,1.);}';
  var FS_LINE = '#version 300 es\nprecision highp float;in float vI;uniform vec2 uC;out vec4 o;void main(){o=vec4(uC,0.,0.);}';
  // 줄마다 굵기 보정: 1px 선은 대각선이 옅으므로 길이/주축길이 만큼 진하게
  var VS_LW = '#version 300 es\nin vec3 a;in float w;out float vw;void main(){vw=w;gl_Position=vec4(a.xy,0.,1.);}';
  var FS_LW = '#version 300 es\nprecision highp float;in float vw;uniform vec2 uC;out vec4 o;void main(){o=vec4(uC*vw,0.,0.);}';
  var VS_Q = '#version 300 es\nin vec2 p;out vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  var FS_Q = '#version 300 es\nprecision highp float;in vec2 v;uniform sampler2D uD,uF,uM,uFace;uniform float uW,uPx;out vec4 o;' +
    'void main(){vec2 d=texture(uD,v).rg;float m=texture(uM,v).r;float t=mix(exp(-d.r),exp(-d.g),m);' +
    'vec2 f=texture(uF,v).rg;float tf=mix(exp(-f.r),exp(-f.g),m);float c=t+(texture(uFace,v).r-tf)*uW;' +
    'float r=length(v*2.-1.);c=mix(1.,clamp(c,0.,1.),smoothstep(1.,1.-uPx,r));o=vec4(c,c,c,1.);}';
  // 막 그은 실: 화면 위에 잠깐 진하게 덧그림
  var VS_FR = '#version 300 es\nin vec3 a;uniform float uNow,uK;out float al;void main(){al=clamp(1.-(uNow-a.z)/uK,0.,1.);gl_Position=vec4(a.xy,0.,1.);}';
  var FS_FR = '#version 300 es\nprecision highp float;in float al;uniform float uAmp;out vec4 o;void main(){float x=al*al*uAmp;o=vec4(0.,0.,0.,x);}';

  function sh(gl, t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(o); return o; }
  function prog(gl, v, f) { var p = gl.createProgram(); gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw gl.getProgramInfoLog(p); return p; }
  function img(src) { return new Promise(function (ok, no) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = no; i.src = src; }); }
  var px = new Float32Array(PINS), py = new Float32Array(PINS);
  for (var k = 0; k < PINS; k++) { var an = 2 * Math.PI * k / PINS; px[k] = R * Math.cos(an); py[k] = -R * Math.sin(an); }

  function ThreadArt(canvas, opt) {
    opt = opt || {};
    this.cv = canvas; this.base = opt.base || 'assets/thread/';
    var gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) { this.ok = false; return; }
    this.ok = true; this.gl = gl;
    this.pL = prog(gl, VS_LW, FS_LW); this.pQ = prog(gl, VS_Q, FS_Q); this.pF = prog(gl, VS_FR, FS_FR);
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.sets = {}; this.cur = null; this.nLo = 0; this.nHi = 0; this.w = 0; this.size = 0;
    this.q = opt.q || 0.8;   // 화질: 0.8 = 화면 1.2배 판, 0.5 = 느린 기기용
    this.resize();
  }
  ThreadArt.prototype.resize = function () {
    if (!this.ok) return;
    var css = this.cv.getBoundingClientRect().width || 600, dpr = Math.min(devicePixelRatio || 1, 1.5);
    var S = Math.min(1200, Math.round(css * dpr)), F = Math.min(2048, Math.round(S * 1.5 * this.q));
    if (S === this.size && F === this.F) return;
    this.size = S; this.cv.width = this.cv.height = S;
    var gl = this.gl;
    if (this.D) { gl.deleteTexture(this.D.t); gl.deleteFramebuffer(this.D.f); }
    for (var id in this.sets) { var o = this.sets[id]; if (o.fin) { gl.deleteTexture(o.fin.t); gl.deleteFramebuffer(o.fin.f); o.fin = null; } }
    this.F = F;
    function fbo() {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, F, F, 0, gl.RG, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t: t, f: f };
    }
    this._fbo = fbo; this.D = fbo();
    if (this.cur) { var c = this.cur; this.cur = null; this.use(c.id); }
  };
  // 한 장(1~3)의 실 순서·마스크·완성 얼굴을 불러온다
  ThreadArt.prototype.load = function (id) {
    var self = this, gl = this.gl;
    if (this.sets[id]) return this.sets[id].p;
    var s = this.sets[id] = { id: id };
    s.p = Promise.all([
      fetch(this.base + 'seq' + id + '.bin').then(function (r) { return r.arrayBuffer(); }),
      img(this.base + 'mask' + id + '.jpg'), img(this.base + 'face' + id + '.jpg')
    ]).then(function (r) {
      var u = new Uint16Array(r[0]), nl = u[0], nh = u[1];
      function buf(off, n) {
        var L = n - 1, a = new Float32Array(L * 8);
        for (var i = 0; i < L; i++) {
          var p = u[off + i], q = u[off + i + 1], dx = px[q] - px[p], dy = py[q] - py[p];
          var w = Math.sqrt(dx * dx + dy * dy) / Math.max(Math.abs(dx), Math.abs(dy), 1e-6);
          a.set([px[p], py[p], i, w, px[q], py[q], i, w], i * 8);
        }
        var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW);
        return { b: b, L: L, seq: u.subarray(off, off + n) };
      }
      s.lo = buf(2, nl); s.hi = buf(2 + nl, nh);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      function tex(im) {
        var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      }
      s.mask = tex(r[1]); s.face = tex(r[2]);
      s.total = s.lo.L + s.hi.L;
      return s;
    });
    return s.p;
  };
  ThreadArt.prototype._lines = function (part, from, to, c, sub) {
    var gl = this.gl; if (to <= from) return;
    gl.useProgram(this.pL); gl.bindBuffer(gl.ARRAY_BUFFER, part.b);
    var la = gl.getAttribLocation(this.pL, 'a'), lw = gl.getAttribLocation(this.pL, 'w');
    gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(lw); gl.vertexAttribPointer(lw, 1, gl.FLOAT, false, 16, 12);
    gl.uniform2fv(gl.getUniformLocation(this.pL, 'uC'), c);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquation(sub ? gl.FUNC_REVERSE_SUBTRACT : gl.FUNC_ADD);
    gl.drawArrays(gl.LINES, from * 2, (to - from) * 2);
    gl.disableVertexAttribArray(lw);
  };
  // 실 한 가닥의 농도: 포스터 렌더는 3000px 판에 굵기 2px·농도 0.16(lo)/0.045(hi)
  ThreadArt.prototype._cLo = function () { return [0.16 * 2 * this.F / 3000, 0]; };
  ThreadArt.prototype._cHi = function () { return [0, 0.045 * 2 * this.F / 3000]; };
  // 완성본(전부 그은 상태)은 장마다 한 번만 만들어 둔다 — 장이 바뀔 때 다시 긋지 않게
  ThreadArt.prototype.prepare = function (id) {
    var s = this.sets[id], gl = this.gl; if (!s || !s.lo || s.fin) return;
    s.fin = this._fbo(); gl.viewport(0, 0, this.F, this.F);
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fin.f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    this._lines(s.lo, 0, s.lo.L, this._cLo()); this._lines(s.hi, 0, s.hi.L, this._cHi());
  };
  ThreadArt.prototype.use = function (id) {
    var s = this.sets[id]; if (!s || !s.lo || this.cur === s) return;
    var gl = this.gl; this.prepare(id); this.cur = s;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.D.f); gl.viewport(0, 0, this.F, this.F); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    this.nLo = this.nHi = 0;
  };
  // 느린 기기: 판을 줄인다
  ThreadArt.prototype.lower = function () { if (this.q <= 0.5) return false; this.q = 0.5; var c = this.cur, n = [this.nLo, this.nHi]; this.resize(); if (c) { this.cur = null; this.use(c.id); this.set(n[0], n[1]); } return true; };
  // 그은 실 수를 맞춘다 — 늘면 더하고, 줄면(풀림) 정확히 뺀다
  ThreadArt.prototype.set = function (nLo, nHi) {
    var s = this.cur, gl = this.gl; if (!s) return;
    nLo = Math.max(0, Math.min(s.lo.L, nLo | 0)); nHi = Math.max(0, Math.min(s.hi.L, nHi | 0));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.D.f); gl.viewport(0, 0, this.F, this.F);
    if (nLo === 0 && nHi === 0) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    else {
      if (nLo > this.nLo) this._lines(s.lo, this.nLo, nLo, this._cLo()); else this._lines(s.lo, nLo, this.nLo, this._cLo(), true);
      if (nHi > this.nHi) this._lines(s.hi, this.nHi, nHi, this._cHi()); else this._lines(s.hi, nHi, this.nHi, this._cHi(), true);
    }
    this.fresh = nLo > this.nLo || nHi > this.nHi;
    this.nLo = nLo; this.nHi = nHi;
  };
  // 화면에 그린다. w = 완성 얼굴이 드러나는 정도(0~1), fresh = 막 그은 실 강조 세기
  ThreadArt.prototype.draw = function (w, freshAmp) {
    var s = this.cur, gl = this.gl; if (!s) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.size, this.size);
    gl.disable(gl.BLEND); gl.useProgram(this.pQ);
    var p = this.pQ, U = function (n) { return gl.getUniformLocation(p, n); };
    [[this.D.t, 'uD'], [s.fin.t, 'uF'], [s.mask, 'uM'], [s.face, 'uFace']].forEach(function (x, i) {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, x[0]); gl.uniform1i(U(x[1]), i);
    });
    gl.uniform1f(U('uW'), w || 0); gl.uniform1f(U('uPx'), 2.5 / this.size);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    var qa = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(qa); gl.vertexAttribPointer(qa, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (freshAmp > 0.01) {
      var f = this.pF; gl.useProgram(f); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      var K = 120, self = this;
      [[s.lo, this.nLo, 1], [s.hi, this.nHi, 0.6]].forEach(function (x) {
        var part = x[0], n = x[1]; if (n < 1) return;
        var from = Math.max(0, n - K);
        gl.bindBuffer(gl.ARRAY_BUFFER, part.b);
        var la = gl.getAttribLocation(f, 'a'); gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 3, gl.FLOAT, false, 16, 0);
        gl.uniform1f(gl.getUniformLocation(f, 'uNow'), n); gl.uniform1f(gl.getUniformLocation(f, 'uK'), K);
        gl.uniform1f(gl.getUniformLocation(f, 'uAmp'), freshAmp * x[2]);
        gl.drawArrays(gl.LINES, from * 2, (n - from) * 2);
      });
    }
  };
  // 지금 실이 걸린 핀 번호(가장 최근 실의 끝)
  ThreadArt.prototype.headPin = function () {
    var s = this.cur; if (!s) return -1;
    if (this.nHi > 0) return s.hi.seq[this.nHi]; if (this.nLo > 0) return s.lo.seq[this.nLo]; return -1;
  };
  ThreadArt.pin = function (k) { return [px[k], py[k]]; };
  ThreadArt.PINS = PINS;
  window.ThreadArt = ThreadArt;
})();
