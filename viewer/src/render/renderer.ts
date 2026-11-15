import { Format, GL, Program, Target, UniformValue } from './gl';
import fullscreenVS from '../shaders/fullscreen.vert?raw';
import strokeVS from '../shaders/stroke.vert?raw';
import strokeFS from '../shaders/stroke.frag?raw';
import spriteVS from '../shaders/sprite.vert?raw';
import spriteFS from '../shaders/sprite.frag?raw';
import copyFS from '../shaders/copy.frag?raw';
import blurFS from '../shaders/blur.frag?raw';
import compositeFS from '../shaders/composite.frag?raw';
import motionGLSL from '../shaders/motion.glsl?raw';
import { hexToRgb } from '../math';
import { textureLayers, textureRevision } from '../themes';

export const MAX_LAYERS = 32;
export const FLOATS_PER_INSTANCE = 20;

/** Growable instance buffer. Strokes and sprites share the 20-float layout. */
export class Instances {
  data = new Float32Array(FLOATS_PER_INSTANCE * 4096);
  count = 0;

  reset() {
    this.count = 0;
  }

  private slot() {
    if ((this.count + 1) * FLOATS_PER_INSTANCE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    return this.count++ * FLOATS_PER_INSTANCE;
  }

  /** A tapered segment A→B (local coords), radii, flex at both ends, colour, glow, layer. */
  stroke(
    ax: number, ay: number, bx: number, by: number,
    ra: number, rb: number, fa: number, fb: number,
    r: number, g: number, b: number, a: number,
    glow: number, layer: number,
    /** 0 = round caps; 1 = flat start (a chain link), round end; 2 = flat at both ends. */
    join = 0,
    /** Motion: branch order (< 2 = limb), and the shoot's pivot x, y, flex and heading. */
    order = 1, px = ax, py = ay, pf = fa, heading = 0,
  ) {
    const d = this.data;
    let o = this.slot();
    d[o++] = ax; d[o++] = ay; d[o++] = bx; d[o++] = by;
    d[o++] = ra; d[o++] = rb; d[o++] = fa; d[o++] = fb;
    d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = a;
    d[o++] = glow; d[o++] = layer; d[o++] = join; d[o++] = order;
    d[o++] = px; d[o++] = py; d[o++] = pf; d[o++] = heading;
  }

  /** A decoration at (x, y) pointing along `angle`, `size` long (local units). */
  sprite(
    x: number, y: number, angle: number, size: number,
    shape: number, flex: number, seed: number,
    r: number, g: number, b: number, a: number,
    glow: number, layer: number,
    order = 1, px = x, py = y, pf = flex, heading = 0,
  ) {
    const d = this.data;
    let o = this.slot();
    d[o++] = x; d[o++] = y; d[o++] = angle; d[o++] = size;
    d[o++] = shape; d[o++] = flex; d[o++] = 0; d[o++] = seed;
    d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = a;
    d[o++] = glow; d[o++] = layer; d[o++] = order; d[o++] = 0;
    d[o++] = px; d[o++] = py; d[o++] = pf; d[o++] = heading;
  }
}

export interface Batch {
  kind: 'stroke' | 'sprite';
  inst: Instances;
}

/** A layer's motion state (motion.ts LayerMotion): see shaders/motion.glsl for the layout. */
export interface MotionState {
  a: ArrayLike<number>;
  b: ArrayLike<number>;
  c: ArrayLike<number>;
}
export const STILL: MotionState = { a: [0, 0, 0, 0], b: [0, 0, 0, 0], c: [0, 0, 0, 0] };

/** Per-layer placement and motion, filled by the app each frame. */
export class LayerUniforms {
  org = new Float32Array(4 * MAX_LAYERS);
  mat = new Float32Array(4 * MAX_LAYERS);
  mA = new Float32Array(4 * MAX_LAYERS);
  mB = new Float32Array(4 * MAX_LAYERS);
  mC = new Float32Array(4 * MAX_LAYERS);
  /** Shape change of the layer's points only (x = vertical squash); widths and sizes stay. */
  shape = new Float32Array(4 * MAX_LAYERS).fill(1);

  /**
   * Local +Y of layer i points along `angle` (radians, 0 = right, pi/2 = up), scaled by `scale`.
   * `sx`/`sy` squash the local axes before rotation (used to fold the halo into a stem).
   */
  set(i: number, ox: number, oy: number, angle: number, scale: number, motion: MotionState = STILL, squash = 1) {
    const sx = 1, sy = 1;
    if (i < 0 || i >= MAX_LAYERS) return;
    const th = angle - Math.PI / 2;
    const c = Math.cos(th) * scale, s = Math.sin(th) * scale;
    this.org.set([ox, oy, 0, 0], i * 4);
    // world = org + [a c; b d] * local, stored as (a, b, c, d).
    this.mat.set([c * sx, s * sx, -s * sy, c * sy], i * 4);
    this.mA.set(motion.a, i * 4);
    this.mB.set(motion.b, i * 4);
    this.mC.set(motion.c, i * 4);
    this.shape[i * 4] = squash;
  }
}

export interface View {
  /** Device pixels per world unit. */
  s: number;
  cx: number;
  cy: number;
  W: number;
  H: number;
}

export interface GlowSettings {
  strength: number;
  radius: number;
  wide: number;
  /** Glow reduction where ink is dense (0 = off). */
  crowd: number;
  /** How much glow is kept off the ink itself (0..1). */
  inkMask: number;
  /** Soft roll-off of bright glow instead of clipping (0 = off). */
  knee: number;
  /** The glow leans toward this colour by tintAmount. */
  tint: string;
  tintAmount: number;
}

export class Renderer {
  readonly gl: GL;
  private fmt: Format;
  private stroke: Program;
  private sprite: Program;
  private copy: Program;
  private blur: Program;
  private composite: Program;
  private vao: WebGLVertexArrayObject;
  private emptyVao: WebGLVertexArrayObject;
  private buf: WebGLBuffer;
  private scene?: Target;
  private levels: { t: Target; tmp: Target }[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, // nothing uses them; saves a full-size buffer
    });
    if (!gl) throw new Error('WebGL2 is not available.');
    this.gl = gl;
    const hdr = !!gl.getExtension('EXT_color_buffer_float');
    this.fmt = hdr ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };

    this.stroke = new Program(gl, strokeVS.replace('//#motion', motionGLSL), strokeFS, 'stroke');
    this.sprite = new Program(gl, spriteVS.replace('//#motion', motionGLSL), spriteFS, 'sprite');
    this.copy = new Program(gl, fullscreenVS, copyFS, 'copy');
    this.blur = new Program(gl, fullscreenVS, blurFS, 'blur');
    this.composite = new Program(gl, fullscreenVS, compositeFS, 'composite');

    // Theme textures: one texture array, 1 × 1 × 1 until a theme with textures is in use.
    this.texArr = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArr);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.emptyVao = gl.createVertexArray()!;
    this.vao = gl.createVertexArray()!;
    this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const stride = FLOATS_PER_INSTANCE * 4;
    for (let i = 0; i < FLOATS_PER_INSTANCE / 4; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, stride, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
  }

  private ensureTargets(W: number, H: number) {
    if (this.scene && this.scene.w === W && this.scene.h === H) return;
    this.scene?.dispose();
    this.levels.forEach((l) => {
      l.t.dispose();
      l.tmp.dispose();
    });
    const gl = this.gl;
    this.scene = new Target(gl, W, H, 2, this.fmt);
    this.levels = [1, 2, 3].map((k) => {
      const w = Math.max(1, W >> k), h = Math.max(1, H >> k);
      return { t: new Target(gl, w, h, 1, this.fmt), tmp: new Target(gl, w, h, 1, this.fmt) };
    });
  }

  /** Run a fullscreen fragment pass into `target` (null = the canvas). */
  fullscreen(prog: Program, target: Target | null, uniforms: Record<string, UniformValue>) {
    const gl = this.gl;
    if (target) target.bind();
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    prog.use().set(uniforms);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private texArr: WebGLTexture;
  private texSeen = -1;
  private texBig = false;
  /** Per texture layer: half-width, flutter, own colours (sprite shaders). */
  private texInfo = new Float32Array(64);

  /** Upload the theme textures when they changed (256 × 256 × 16, premultiplied, mipmapped). */
  private syncTextures() {
    if (textureRevision() === this.texSeen) return;
    this.texSeen = textureRevision();
    const gl = this.gl, layers = textureLayers();
    if (!layers.length) return;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArr);
    if (!this.texBig) {
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 256, 256, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.texBig = true;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    for (const t of layers) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, t.layer, 256, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, t.image);
      this.texInfo.set([t.halfWidth, t.flutter, t.own ? 1 : 0, 0], t.layer * 4);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** GPU time of the last measured frame (ms), smoothed; -1 = no timer available. */
  gpuMs = -1;
  private tq: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null | undefined;
  private query: WebGLQuery | null = null;
  private timing = false;

  private beginTimer() {
    const gl = this.gl;
    if (this.tq === undefined) this.tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!this.tq) return;
    if (this.query) {
      // One query at a time: read the previous result when it is ready.
      if (!gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) return;
      const ms = (gl.getQueryParameter(this.query, gl.QUERY_RESULT) as number) / 1e6;
      if (!gl.getParameter(this.tq.GPU_DISJOINT_EXT)) this.gpuMs = this.gpuMs < 0 ? ms : this.gpuMs + (ms - this.gpuMs) * 0.1;
      gl.deleteQuery(this.query);
    }
    this.query = gl.createQuery();
    gl.beginQuery(this.tq.TIME_ELAPSED_EXT, this.query!);
    this.timing = true;
  }

  private endTimer() {
    if (!this.timing) return;
    this.gl.endQuery(this.tq!.TIME_ELAPSED_EXT);
    this.timing = false;
  }

  /** Which GPU draws this (SwiftShader / Basic Render Driver = software: far too slow). */
  gpuName(): string {
    const gl = this.gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  }

  render(batches: Batch[], layers: LayerUniforms, view: View, windT: number, glow: GlowSettings) {
    this.beginTimer();
    try {
      this.renderFrame(batches, layers, view, windT, glow);
    } finally {
      this.endTimer();
    }
  }

  private renderFrame(batches: Batch[], layers: LayerUniforms, view: View, windT: number, glow: GlowSettings) {
    const gl = this.gl;
    this.ensureTargets(view.W, view.H);
    const scene = this.scene!;

    // 1. Strokes and decorations, back to front, into colour + glow emission (two targets).
    scene.bind();
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.syncTextures();
    const common = {
      u_tex: this.texArr,
      u_texInfo: this.texInfo,
      u_org: layers.org,
      u_mat: layers.mat,
      u_mA: layers.mA,
      u_mB: layers.mB,
      u_mC: layers.mC,
      u_shape: layers.shape,
      u_windT: windT,
      u_glowTint: [...hexToRgb(glow.tint), Math.min(1, Math.max(0, glow.tintAmount))],
      u_view: [(2 * view.s) / view.W, (2 * view.s) / view.H, view.cx, view.cy],
      u_px: 1 / view.s,
    };
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    for (const b of batches) {
      if (b.inst.count === 0) continue;
      (b.kind === 'stroke' ? this.stroke : this.sprite).use().set(common);
      gl.bufferData(gl.ARRAY_BUFFER, b.inst.data.subarray(0, b.inst.count * FLOATS_PER_INSTANCE), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.inst.count);
    }
    gl.disable(gl.BLEND);

    // 2. Bloom: ½, ¼ and ⅛ resolution blurs of the glow emission.
    let src = scene.tex[1];
    for (const { t, tmp } of this.levels) {
      this.fullscreen(this.copy, t, { u_src: src });
      this.fullscreen(this.blur, tmp, { u_src: t.tex[0], u_dir: [glow.radius / t.w, 0] });
      this.fullscreen(this.blur, t, { u_src: tmp.tex[0], u_dir: [0, glow.radius / t.h] });
      src = t.tex[0];
    }

    // 3. Composite to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    // (no clear: the composite writes every pixel with blending off)
    this.fullscreen(this.composite, null, {
      u_base: scene.tex[0],
      u_g1: this.levels[0].t.tex[0],
      u_g2: this.levels[1].t.tex[0],
      u_g3: this.levels[2].t.tex[0],
      u_strength: glow.strength,
      u_wide: glow.wide,
      u_crowd: glow.crowd,
      u_inkMask: glow.inkMask,
      u_knee: glow.knee,
    });
  }
}
