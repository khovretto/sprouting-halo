// A tree of nodes. Every node except a root has a parent; the renderer draws one tapered segment
// per (parent → node). Shared by the halo vine and the take plants.

export const enum NodeKind {
  Runner = 0, // halo vine main stem
  Sprout = 1, // halo side shoot
  Branch = 2, // take plant
}

export class Skeleton {
  n = 0;
  x: Float32Array;
  y: Float32Array;
  parent: Int32Array;
  w: Float32Array; // radius
  flex: Float32Array; // distance along the branch from its root, for sway / reveal order
  kind: Uint8Array;
  children: Uint16Array; // filled by computeChildren()

  constructor(private cap = 1024) {
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.parent = new Int32Array(cap);
    this.w = new Float32Array(cap);
    this.flex = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.children = new Uint16Array(cap);
  }

  reset() {
    this.n = 0;
  }

  private grow() {
    const cap = this.cap * 2;
    const g = <T extends Float32Array | Int32Array | Uint8Array | Uint16Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(cap);
      b.set(a);
      return b;
    };
    this.x = g(this.x);
    this.y = g(this.y);
    this.parent = g(this.parent);
    this.w = g(this.w);
    this.flex = g(this.flex);
    this.kind = g(this.kind);
    this.children = g(this.children);
    this.cap = cap;
  }

  add(x: number, y: number, parent: number, flex: number, width: number, kind: NodeKind) {
    if (this.n >= this.cap) this.grow();
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.parent[i] = parent;
    this.w[i] = width;
    this.flex[i] = flex;
    this.kind[i] = kind;
    return i;
  }

  computeChildren() {
    this.children.fill(0, 0, this.n);
    for (let i = 0; i < this.n; i++) if (this.parent[i] >= 0) this.children[this.parent[i]]++;
  }

  clone() {
    const c = new Skeleton(Math.max(16, this.n));
    c.n = this.n;
    c.x.set(this.x.subarray(0, this.n));
    c.y.set(this.y.subarray(0, this.n));
    c.parent.set(this.parent.subarray(0, this.n));
    c.w.set(this.w.subarray(0, this.n));
    c.flex.set(this.flex.subarray(0, this.n));
    c.kind.set(this.kind.subarray(0, this.n));
    c.children.set(this.children.subarray(0, this.n));
    return c;
  }
}
