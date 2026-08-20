// DominoEditor V24.2 Domino Physics Core
// Stable tabletop material presets: stronger ground grip, lower rebound, controlled fall energy.

export const DominoMaterials = {
  wood: {
    label: '木牌', mass: 1.0, density: 0.0022,
    friction: 0.62, frictionStatic: 0.88, restitution: 0.002,
    frictionAir: 0.006, sensitivity: 1.05, impact: 1.0, fallSpeed: 0.94
  },
  stone: {
    label: '石牌', mass: 2.0, density: 0.0042,
    friction: 0.72, frictionStatic: 0.95, restitution: 0.001,
    frictionAir: 0.008, sensitivity: 0.76, impact: 1.08, fallSpeed: 0.72
  },
  metal: {
    label: '金属牌', mass: 1.55, density: 0.0032,
    friction: 0.50, frictionStatic: 0.72, restitution: 0.008,
    frictionAir: 0.006, sensitivity: 0.90, impact: 1.12, fallSpeed: 0.96
  },
  ice: {
    label: '冰牌', mass: 0.9, density: 0.0018,
    friction: 0.07, frictionStatic: 0.12, restitution: 0.004,
    frictionAir: 0.004, sensitivity: 1.12, impact: 0.90, fallSpeed: 1.05
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
    this.angularVelocity = Math.max(-2.2, Math.min(2.2, this.angularVelocity));
    this.state = 'tilting';
  }

  update(dt) {
    if (this.state === 'standing' || this.state === 'fallen') return;
    const mat = DominoMaterials[this.material] || DominoMaterials.wood;
    const sign = Math.sign(this.angularVelocity || this.angle || 1);
    const gravityBias = Math.sin(Math.min(Math.PI / 2, Math.abs(this.angle))) * 3.6 * mat.fallSpeed;
    this.angularVelocity += sign * gravityBias * dt;
    this.angularVelocity *= Math.pow(0.988, dt * 60);
    this.angularVelocity = Math.max(-2.2, Math.min(2.2, this.angularVelocity));
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
