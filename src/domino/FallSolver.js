// DominoEditor V20.3 Fall Solver
// Shared helper for pivot-based domino tipping and impact transfer.

export class FallSolver {
  constructor(options = {}) {
    this.gravity = options.gravity ?? 980;
    this.defaultThreshold = options.defaultThreshold ?? 0.035;
    this.lockAngle = options.lockAngle ?? Math.PI * 0.48;
  }

  inertia(domino) {
    const mass = domino.mass ?? 1;
    const w = domino.width ?? domino.w ?? 20;
    const h = domino.height ?? domino.h ?? 96;
    return Math.max(1e-6, mass * (w * w + h * h) / 3);
  }

  calculateTorque(impulse, leverArm, mass = 1) {
    return Math.abs(impulse) * Math.max(1, leverArm) / Math.max(mass, 0.001);
  }

  shouldFall(domino) {
    return Math.abs(domino.angle ?? 0) >= (domino.tipThreshold ?? domino.fallThreshold ?? this.defaultThreshold);
  }

  hit(domino, impulse, direction = 1, hitHeight = null) {
    if (!domino || domino.state === 'fallen' || domino.fallen) return false;
    const h = domino.height ?? domino.h ?? 96;
    const lever = hitHeight ?? h * 0.72;
    const sign = Math.sign(direction || impulse || 1) || 1;
    const impact = domino.impactMultiplier ?? 1;
    const sensitivity = domino.sensitivity ?? 1;
    const I = this.inertia(domino);
    const minKick = domino.minKick ?? 0.24;
    const deltaOmega = Math.abs(impulse) * lever * impact * sensitivity / I;

    domino.state = 'tilting';
    domino.direction = sign;
    domino.angularVelocity = (domino.angularVelocity ?? domino.fallSpeed ?? 0) + sign * Math.max(deltaOmega, minKick * sensitivity);
    domino.fallSpeed = domino.angularVelocity;
    domino.angle = (domino.angle ?? 0) + sign * 0.004 * sensitivity;
    return true;
  }

  update(domino, dt) {
    if (!domino || domino.state === 'standing' || domino.state === 'fallen' || domino.fallen) return;
    const step = Math.max(1 / 300, Math.min(1 / 20, dt || 1 / 60));
    const mass = domino.mass ?? 1;
    const h = domino.height ?? domino.h ?? 96;
    const I = this.inertia(domino);
    const sign = Math.sign(domino.angle || domino.angularVelocity || domino.direction || 1);
    const angle = Math.abs(domino.angle ?? 0);
    const threshold = domino.tipThreshold ?? domino.fallThreshold ?? this.defaultThreshold;
    let omega = domino.angularVelocity ?? domino.fallSpeed ?? 0;

    if (angle >= threshold) {
      domino.state = 'falling';
      const gravityTorque = mass * this.gravity * (h * 0.5) * Math.sin(angle);
      omega += sign * (gravityTorque / I) * step;
    } else if (Math.abs(omega) > 0.02) {
      domino.state = 'tilting';
      omega += sign * 0.9 * (domino.sensitivity ?? 1) * step;
    }

    const damping = domino.angularDamping ?? 0.992;
    omega *= Math.pow(damping, step * 60);
    domino.angularVelocity = omega;
    domino.fallSpeed = omega;
    domino.angle = (domino.angle ?? 0) + omega * step;

    if (Math.abs(domino.angle) >= (domino.fallLockAngle ?? this.lockAngle)) {
      domino.angle = sign * Math.PI / 2;
      domino.angularVelocity = 0;
      domino.fallSpeed = 0;
      domino.state = 'fallen';
      domino.fallen = true;
    }
  }
}

export default FallSolver;
