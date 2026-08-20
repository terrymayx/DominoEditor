// DominoEditor V24 Domino Physics Core
// Shared material parameters and light-weight state helpers for Matter.js integration.

export const DominoMaterials = {
  wood: {
    label: '木牌', mass: 1.0, density: 0.0018,
    friction: 0.34, frictionStatic: 0.5, restitution: 0.015,
    sensitivity: 1.18, impact: 1.12, fallSpeed: 1.0
  },
  stone: {
    label: '石牌', mass: 2.4, density: 0.0038,
    friction: 0.48, frictionStatic: 0.62, restitution: 0.008,
    sensitivity: 0.78, impact: 1.2, fallSpeed: 0.72
  },
  metal: {
    label: '金属牌', mass: 1.8, density: 0.0029,
    friction: 0.28, frictionStatic: 0.42, restitution: 0.035,
    sensitivity: 0.96, impact: 1.4, fallSpeed: 1.08
  },
  ice: {
    label: '冰牌', mass: 0.82, density: 0.00145,
    friction: 0.055, frictionStatic: 0.12, restitution: 0.02,
    sensitivity: 1.28, impact: 0.95, fallSpeed: 1.2
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
    this.state = 'tilting';
  }

  update(dt) {
    if (this.state === 'standing' || this.state === 'fallen') return;
    const mat = DominoMaterials[this.material] || DominoMaterials.wood;
    const sign = Math.sign(this.angularVelocity || this.angle || 1);
    const gravityBias = Math.sin(Math.min(Math.PI / 2, Math.abs(this.angle))) * 4.2 * mat.fallSpeed;
    this.angularVelocity += sign * gravityBias * dt;
    this.angularVelocity *= Math.pow(0.992, dt * 60);
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
