// DominoEditor V20.2 Chain Reaction Engine
// Handles energy transfer between falling domino pieces.

export class ChainReaction {
  constructor(options = {}) {
    this.radius = options.radius || 70;
    this.energyLoss = options.energyLoss || 0.82;
  }

  calculateImpact(source, target) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > this.radius) return 0;

    return Math.max(0, source.energy * this.energyLoss * (1 - distance / this.radius));
  }

  trigger(domino, energy) {
    if (!domino || domino.state === 'fallen') return;

    domino.state = 'falling';
    domino.hitPower = energy;
    domino.energy = energy;
  }

  propagate(source, neighbors) {
    const events = [];
    neighbors.forEach(target => {
      const energy = this.calculateImpact(source, target);
      if (energy > 0.1) {
        events.push({target, energy});
      }
    });
    return events;
  }
}

export default ChainReaction;
