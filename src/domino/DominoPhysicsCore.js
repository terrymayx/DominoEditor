// DominoEditor V20.3 Domino Physics Core
// Pivot-based domino tipping model. Angle is measured from vertical in radians.

export const DominoMaterials = {
  wood:  { mass: 1.00, friction: 0.32, restitution: 0.02, impact: 1.10, sensitivity: 1.30, damping: 0.992 },
  stone: { mass: 3.80, friction: 0.55, restitution: 0.01, impact: 0.82, sensitivity: 0.78, damping: 0.988 },
  metal: { mass: 2.60, friction: 0.24, restitution: 0.04, impact: 1.42, sensitivity: 1.02, damping: 0.994 },
  ice:   { mass: 0.72, friction: 0.025, restitution: 0.01, impact: 0.92, sensitivity: 1.48, damping: 0.996 }
};

export class DominoPhysicsCore {
  constructor(options = {}) {
    this.width = options.width ?? 20;
    this.height = options.height ?? 96;
    this.material = options.material || 'wood';
    this.gravity = options.gravity ?? 980; // px/s² for the editor world
    this.state = 'standing';
    this.angle = options.angle ?? 0;
    this.angularVelocity = 0;
    this.lastImpact = 0;
    this.direction = 0;
    this.fallen = false;
    this.applyMaterial(this.material, options);
  }

  applyMaterial(name = 'wood', overrides = {}) {
    const m = DominoMaterials[name] || DominoMaterials.wood;
    this.material = name;
    this.mass = overrides.mass ?? m.mass;
    this.friction = overrides.friction ?? m.friction;
    this.restitution = overrides.restitution ?? m.restitution;
    this.impactMultiplier = overrides.impactMultiplier ?? m.impact;
    this.sensitivity = overrides.sensitivity ?? m.sensitivity;
    this.angularDamping = overrides.angularDamping ?? m.damping;
    this.tipThreshold = overrides.tipThreshold ?? 0.035; // ~2 degrees: easy to start a fall
    this.fallLockAngle = overrides.fallLockAngle ?? Math.PI * 0.48;
    this.minKick = overrides.minKick ?? 0.24;
  }

  get inertiaAboutBase() {
    // Rectangle inertia around a bottom pivot using the parallel-axis theorem.
    return Math.max(1e-6, this.mass * (this.width * this.width + this.height * this.height) / 3);
  }

  hit(impulse, hitHeight = this.height * 0.72, direction = 1) {
    if (this.fallen) return false;
    const sign = Math.sign(direction || impulse || 1) || 1;
    const lever = Math.max(this.height * 0.18, Math.min(this.height, Math.abs(hitHeight)));
    const torqueImpulse = Math.abs(impulse) * lever * this.impactMultiplier * this.sensitivity;
    const deltaOmega = torqueImpulse / this.inertiaAboutBase;

    // Guarantee that a visible hit creates a small but meaningful tip instead of only sliding.
    this.angularVelocity += sign * Math.max(deltaOmega, this.minKick * this.sensitivity);
    this.angle += sign * 0.004 * this.sensitivity;
    this.direction = sign;
    this.lastImpact = Math.abs(impulse);
    this.state = 'tilting';
    return true;
  }

  update(dt) {
    if (this.fallen || this.state === 'standing') return;
    const step = Math.max(1 / 300, Math.min(1 / 20, dt || 1 / 60));
    const sign = Math.sign(this.angle || this.angularVelocity || this.direction || 1);

    // Gravity torque around the lower edge. Once the center of mass moves away
    // from vertical, gravity accelerates the fall instead of allowing the tile to recover.
    const com = this.height * 0.5;
    const gravityTorque = this.mass * this.gravity * com * Math.sin(Math.abs(this.angle));
    const alpha = gravityTorque / this.inertiaAboutBase;

    if (Math.abs(this.angle) >= this.tipThreshold) {
      this.state = 'falling';
      this.angularVelocity += sign * alpha * step;
    } else if (Math.abs(this.angularVelocity) > 0.02) {
      this.state = 'tilting';
      // Maintain a tiny gravity bias while near vertical so a hit does not die out instantly.
      this.angularVelocity += sign * 0.9 * this.sensitivity * step;
    }

    this.angularVelocity *= Math.pow(this.angularDamping, step * 60);
    this.angle += this.angularVelocity * step;

    if (Math.abs(this.angle) >= this.fallLockAngle) {
      this.angle = sign * Math.PI / 2;
      this.angularVelocity = 0;
      this.state = 'fallen';
      this.fallen = true;
    }
  }

  reset(angle = 0) {
    this.state = 'standing';
    this.angle = angle;
    this.angularVelocity = 0;
    this.lastImpact = 0;
    this.direction = 0;
    this.fallen = false;
  }

  serialize() {
    return {
      material: this.material,
      mass: this.mass,
      friction: this.friction,
      restitution: this.restitution,
      sensitivity: this.sensitivity,
      impactMultiplier: this.impactMultiplier,
      state: this.state,
      angle: this.angle,
      fallen: this.fallen
    };
  }
}
