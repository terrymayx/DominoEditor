// DominoEditor V20.1 Fall Solver
// Real domino fall calculation core

export class FallSolver {
  constructor(options = {}) {
    this.gravity = options.gravity ?? 9.8;
  }

  calculateTorque(hitPower, leverArm, mass) {
    return (hitPower * leverArm) / Math.max(mass, 0.001);
  }

  shouldFall(domino) {
    return Math.abs(domino.angle ?? 0) >= (domino.fallThreshold ?? 0.45);
  }

  update(domino, dt) {
    if (!domino) return;

    if (domino.state === 'tilting' || domino.state === 'falling') {
      domino.fallSpeed += this.gravity * dt;
      domino.angle += domino.fallSpeed * dt;

      if (this.shouldFall(domino)) {
        domino.state = 'fallen';
        domino.angle = Math.sign(domino.angle) * Math.PI / 2;
      }
    }
  }

  hit(domino, power, direction = 1) {
    if (domino.state === 'fallen') return;

    const torque = this.calculateTorque(
      power,
      domino.pivotHeight ?? 40,
      domino.mass ?? 1
    );

    domino.state = 'tilting';
    domino.fallSpeed = torque * direction;
  }
}

export default FallSolver;
