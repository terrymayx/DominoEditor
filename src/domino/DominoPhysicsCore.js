// DominoEditor V24.3 Domino Physics Core
// Grounded tabletop presets: near-zero bounce, strong support grip, restrained fall energy.

export const DominoMaterials = {
  wood: {
    label: '木牌', mass: 1.0, density: 0.0025,
    friction: 0.78, frictionStatic: 0.98, restitution: 0,
    frictionAir: 0.010, sensitivity: 0.94, impact: 0.92, fallSpeed: 0.88,
    inertiaScale: 1.35, groundedSlide: 0.80
  },
  stone: {
    label: '石牌', mass: 2.0, density: 0.0045,
    friction: 0.84, frictionStatic: 1.0, restitution: 0,
    frictionAir: 0.012, sensitivity: 0.70, impact: 0.96, fallSpeed: 0.70,
    inertiaScale: 1.42, groundedSlide: 0.76
  },
  metal: {
    label: '金属牌', mass: 1.55, density: 0.0035,
    friction: 0.68, frictionStatic: 0.90, restitution: 0.001,
    frictionAir: 0.009, sensitivity: 0.84, impact: 1.00, fallSpeed: 0.90,
    inertiaScale: 1.38, groundedSlide: 0.82
  },
  ice: {
    label: '冰牌', mass: 0.9, density: 0.0020,
    friction: 0.09, frictionStatic: 0.14, restitution: 0,
    frictionAir: 0.006, sensitivity: 1.02, impact: 0.86, fallSpeed: 0.98,
    inertiaScale: 1.25, groundedSlide: 0.94
  }
};

export class DominoPhysicsCore {
  constructor(options = {}) {
    this.material = options.material || 'wood';
    const mat = DominoMaterials[this.material] || DominoMaterials.wood;
    this.mass = options.mass ?? mat.mass;
    this.pivotHeight = options.pivotHeight ?? 48;
    this.state = 'standing';
    this.angle = options.angle || 0;
    this.angularVelocity = 0;
    this.hitPower = 0;
  }

  hit(force, offset = 1, direction = 1) {
    if (this.state === 'fallen') return;
    const mat = DominoMaterials[this.material] || DominoMaterials.wood;
    this.hitPower = Math.max(this.hitPower, Math.abs(force) * Math.max(0.2, offset));
    this.angularVelocity += direction * this.hitPower * mat.sensitivity / Math.max(this.mass, 0.001);
    this.angularVelocity = Math.max(-1.8, Math.min(1.8, this.angularVelocity));
    this.state = 'tilting';
  }

  update(dt) {
    if (this.state === 'standing' || this.state === 'fallen') return;
    const mat = DominoMaterials[this.material] || DominoMaterials.wood;
    const sign = Math.sign(this.angularVelocity || this.angle || 1);
    const gravityBias = Math.sin(Math.min(Math.PI / 2, Math.abs(this.angle))) * 3.2 * mat.fallSpeed;
    this.angularVelocity += sign * gravityBias * dt;
    this.angularVelocity *= Math.pow(0.984, dt * 60);
    this.angularVelocity = Math.max(-1.8, Math.min(1.8, this.angularVelocity));
    this.angle += this.angularVelocity * dt;
    if (Math.abs(this.angle) > 0.16) this.state = 'falling';
    if (Math.abs(this.angle) >= Math.PI / 2) {
      this.angle = sign * Math.PI / 2;
      this.state = 'fallen';
      this.angularVelocity = 0;
    }
  }

  serialize() {
    return {
      material: this.material,
      mass: this.mass,
      pivotHeight: this.pivotHeight,
      state: this.state,
      angle: this.angle
    };
  }
}
