// Shader prewarm for the browser game (v1.22 web-load; the pack is made by tools/package/shaderpack.py).
// The first resort frame used to wait ~23 s while WebGL compiled ~90 shaders one by one (Godot asks for each
// and waits). This asks the browser for all of them at once in a hidden canvas, while the player is on the
// "Who's playing?" screen. With KHR_parallel_shader_compile the browser compiles them on its own threads
// and keeps them in its shader cache, so Godot's own compiles become cache hits.
// The game calls window.peakPrewarmGo(gfx) when it is idle (picker up, or the first resort frame drawn).
// It never starts during the download: compiling alongside it slowed the download by seconds.
// A stale pack (shaders changed) only costs background work: the game still compiles what it needs itself.
(function () {
  'use strict';
  var W = window.__peakPrewarm = { state: 'off', done: 0, total: 0, ms: 0 };
  window.peakPrewarmGo = function () { };
  if (!window.WebGL2RenderingContext || !window.fetch) return;
  var ID = '5bf0c040b903', KEY = 'peak_prewarm_';   // web.py writes the pack's id here
  // The pack's captures: Medium (desktop default) and Low (touch) resorts, and Boot: the few the engine needs
  // before "Who's playing?" (two sky shaders, ~1 s each), started as soon as the pack arrives.
  var BIT = { Medium: 1, Low: 2, Boot: 4 };
  // Emscripten's auto-enabled list plus the ones Godot asks for itself (index.js, Godot 4.7.2): the browser's
  // shader cache only matches when the translator sees the same extensions as the game's own context.
  var EXT = ['ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_disjoint_timer_query', 'EXT_frag_depth', 'EXT_shader_texture_lod',
    'EXT_sRGB', 'OES_element_index_uint', 'OES_fbo_render_mipmap', 'OES_standard_derivatives', 'OES_texture_float',
    'OES_texture_half_float', 'OES_texture_half_float_linear', 'OES_vertex_array_object', 'WEBGL_color_buffer_float',
    'WEBGL_depth_texture', 'WEBGL_draw_buffers', 'EXT_color_buffer_float', 'EXT_conservative_depth', 'EXT_disjoint_timer_query_webgl2',
    'EXT_texture_norm16', 'NV_shader_noperspective_interpolation', 'WEBGL_clip_cull_distance', 'EXT_clip_control',
    'EXT_color_buffer_half_float', 'EXT_depth_clamp', 'EXT_float_blend', 'EXT_polygon_offset_clamp', 'EXT_texture_compression_bptc',
    'EXT_texture_compression_rgtc', 'EXT_texture_filter_anisotropic', 'KHR_parallel_shader_compile', 'OES_texture_float_linear',
    'WEBGL_blend_func_extended', 'WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_etc', 'WEBGL_compressed_texture_etc1',
    'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb', 'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders',
    'WEBGL_lose_context', 'WEBGL_multi_draw', 'WEBGL_polygon_mode', 'WEBGL_draw_instanced_base_vertex_base_instance',
    'WEBGL_multi_draw_instanced_base_vertex_base_instance', 'OVR_multiview2', 'OCULUS_multiview'];
  var cached = function (lv) { try { return localStorage.getItem(KEY + lv) === ID; } catch (e) { return false; } };
  var pack = null, gl = null, par = null, queue = [], live = [], seen = {}, running = false, levels = [], t0 = 0;
  var want = function (lv) {   // queue this level's programs (once per level, and not if done on an earlier visit)
    if (!BIT[lv] || levels.indexOf(lv) >= 0 || cached(lv)) return;
    levels.push(lv);
    pack.progs.forEach(function (p, i) { if ((p[3] & BIT[lv]) && !seen[i]) { seen[i] = true; queue.push(p); } });
    W.total = queue.length + W.done + live.length;
  };
  var text = function (runs) {
    var L = pack.lines, out = [];
    for (var i = 0; i < runs.length; i += 2)
      for (var j = runs[i], e = runs[i] + runs[i + 1]; j < e; j++) out.push(L[j]);
    return out.join('\n');
  };
  var submit = function () {
    var n = 0;
    while (live.length < lim && queue.length && n++ < 2) {
      var p = queue.shift(), pr = gl.createProgram(), sh = [];
      [[gl.VERTEX_SHADER, p[0]], [gl.FRAGMENT_SHADER, p[1]]].forEach(function (v) {
        var s = gl.createShader(v[0]);
        gl.shaderSource(s, text(v[1]));
        gl.compileShader(s);
        gl.attachShader(pr, s);
        sh.push(s);
      });
      (p[2] || []).forEach(function (a) { gl.bindAttribLocation(pr, a[0], a[1]); });
      gl.linkProgram(pr);
      live.push([pr, sh]);
    }
  };
  // How many compile at once adapts: it grows while each step stays quick and halves when one blocks the
  // page (the browser's GPU process is busy), so the picker keeps answering clicks while this runs.
  var lim = 3, last = 0;
  var poll = function () {
    var t = performance.now(), gap = last ? t - last - 20 : 0;   // how late this step ran: the page was blocked
    for (var i = live.length - 1; i >= 0; i--) {
      if (gl.getProgramParameter(live[i][0], par.COMPLETION_STATUS_KHR)) {
        live[i][1].forEach(function (s) { gl.deleteShader(s); });
        gl.deleteProgram(live[i][0]);
        live.splice(i, 1);
        W.done++;
      }
    }
    submit();
    last = performance.now();
    var dt = last - t + gap;
    lim = dt > 60 ? Math.max(1, lim >> 1) : dt < 25 ? Math.min(window.__peakPrewarmMax || 12, lim + 1) : lim;
    W.lim = lim;
    if (live.length) return setTimeout(poll, 20);
    running = false;
    W.state = 'done';
    W.ms = Math.round(performance.now() - t0);
    levels.forEach(function (lv) { try { localStorage.setItem(KEY + lv, ID); } catch (e) { } });
  };
  var start = function (lv) {
    if (!pack) return;
    if (!gl) {
      var c = document.createElement('canvas');
      c.width = c.height = 1;
      gl = c.getContext('webgl2', { alpha: false, depth: true, stencil: false, antialias: false, premultipliedAlpha: true,
        preserveDrawingBuffer: true, powerPreference: 'default', failIfMajorPerformanceCaveat: false });
      if (!gl) { W.state = 'nogl'; pack = null; return; }
      var have = gl.getSupportedExtensions() || [];
      EXT.forEach(function (n) { if (have.indexOf(n) >= 0) gl.getExtension(n); });
      par = gl.getExtension('KHR_parallel_shader_compile');
      if (!par) { W.state = 'noparallel'; pack = null; return; }   // compiles would block the page: leave them to the game
    }
    want(lv);
    if (!running && queue.length) {
      running = true;
      W.state = 'compile';
      t0 = t0 || performance.now();
      submit();
      setTimeout(poll, 20);
    }
  };
  if (cached('Boot') && (cached('Medium') || cached('Low'))) { W.state = 'cached'; return; }   // a returning browser
  W.state = 'fetch';
  var asked = [];   // a go() before the pack arrived
  window.peakPrewarmGo = function (lv) { if (pack) start(String(lv)); else asked.push(String(lv)); };
  fetch('index.shaders.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (pk) {
    if (!pk || pk.v !== 1) { W.state = 'none'; return; }
    pack = pk;
    W.state = 'ready';
    start('Boot');
    asked.forEach(start);
  }).catch(function () { W.state = 'error'; });
})();
