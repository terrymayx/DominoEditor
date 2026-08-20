// DominoEditor V20 Domino Physics Core
// Experimental domino fall solver module

export class DominoPhysicsCore {
  constructor(options = {}) {
    this.material = options.material || 'wood';
    this.mass = options.mass || 1;
    this.pivotHeight = options.pivotHeight || 48;
    this.state = 'standing';
    this.angle = 0;
    this.angularVelocity = 0;
    this.hitPower = 0;
  }

  hit(force, offset = 1) {
    if (this.state === 'fallen') return;
    this.hitPower += force * offset;
    this.angularVelocity += this.hitPower / this.mass;
    this.state = 'tilting';
  }

  update(dt) {
    if (this.state === 'standing') return;

    this.angle += this.angularVelocity * dt;
    this.angularVelocity *= 0.96;

    if (Math.abs(this.angle) > Math.PI / 2) {
      this.angle = Math.sign(this.angle) * Math.PI / 2;
      this.state = 'fallen';
      this.angularVelocity = 0;
    }
  }

  serialize() {
    return {
      material: this.material,
      mass: this.mass,
      state: this.state,
      angle: this.angle
    };
  }
}

export const DominoMaterials = {
  wood: {mass:1, friction:0.35, fallSpeed:1},
  stone:{mass:5, friction:0.6, fallSpeed:0.5},
  metal:{mass:4, friction:0.2, fallSpeed:1.2},
  ice:{mass:0.8, friction:0.02, fallSpeed:1.5}
};
