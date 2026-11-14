// Thin WebGL2 helpers: programs with uniform introspection, render targets, fullscreen passes.
// Adding a pass = write a .frag, make a Program, call Renderer.fullscreen().

export type GL = WebGL2RenderingContext;

export interface Format {
  internal: number;
  type: number;
}

export type UniformValue = number | ArrayLike<number> | WebGLTexture;

function compile(gl: GL, type: number, src: string, name: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(`Shader "${name}" failed to compile:\n${gl.getShaderInfoLog(s)}`);
  return s;
}

interface UniformInfo {
  loc: WebGLUniformLocation;
  type: number;
  unit: number;
}

export class Program {
  readonly prog: WebGLProgram;
  private uniforms = new Map<string, UniformInfo>();

  constructor(private gl: GL, vs: string, fs: string, readonly name: string) {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, name + '.vert'));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, name + '.frag'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(`Program "${name}" failed to link:\n${gl.getProgramInfoLog(p)}`);
    this.prog = p;
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    let unit = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!;
      const key = info.name.replace(/\[0\]$/, '');
      this.uniforms.set(key, {
        loc: gl.getUniformLocation(p, info.name)!,
        type: info.type,
        unit: info.type === gl.SAMPLER_2D ? unit++ : -1,
      });
    }
  }

  use() {
    this.gl.useProgram(this.prog);
    return this;
  }

  /** Set uniforms by name: numbers, arrays (incl. uniform arrays) and textures. Unknown names are ignored. */
  set(values: Record<string, UniformValue>) {
    const gl = this.gl;
    for (const [k, v] of Object.entries(values)) {
      const u = this.uniforms.get(k);
      if (!u) continue;
      switch (u.type) {
        case gl.SAMPLER_2D:
          gl.activeTexture(gl.TEXTURE0 + u.unit);
          gl.bindTexture(gl.TEXTURE_2D, v as WebGLTexture);
          gl.uniform1i(u.loc, u.unit);
          break;
        case gl.FLOAT:
          if (typeof v === 'number') gl.uniform1f(u.loc, v);
          else gl.uniform1fv(u.loc, v as Float32List);
          break;
        case gl.FLOAT_VEC2:
          gl.uniform2fv(u.loc, v as Float32List);
          break;
        case gl.FLOAT_VEC3:
          gl.uniform3fv(u.loc, v as Float32List);
          break;
        case gl.FLOAT_VEC4:
          gl.uniform4fv(u.loc, v as Float32List);
          break;
        case gl.INT:
        case gl.BOOL:
          gl.uniform1i(u.loc, v as number);
          break;
      }
    }
    return this;
  }
}

export class Target {
  readonly fb: WebGLFramebuffer;
  readonly tex: WebGLTexture[] = [];

  constructor(private gl: GL, readonly w: number, readonly h: number, count: number, fmt: Format) {
    this.fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    const bufs: number[] = [];
    for (let c = 0; c < count; c++) {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, gl.RGBA, fmt.type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + c, gl.TEXTURE_2D, t, 0);
      this.tex.push(t);
      bufs.push(gl.COLOR_ATTACHMENT0 + c);
    }
    gl.drawBuffers(bufs);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete (0x${status.toString(16)})`);
  }

  bind() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fb);
    this.gl.viewport(0, 0, this.w, this.h);
  }

  dispose() {
    this.gl.deleteFramebuffer(this.fb);
    this.tex.forEach((t) => this.gl.deleteTexture(t));
  }
}
