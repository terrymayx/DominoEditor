// DominoEditor V20.4 Matter.js Domino Adapter
// Makes tall domino bodies tip instead of simply sliding when struck.

import { DominoMaterials } from './DominoPhysicsCore.js';

export class DominoMatterAdapter {
  constructor(Matter, engine, options = {}) {
    if (!Matter || !engine) throw new Error('DominoMatterAdapter requires Matter and engine');
    this.M = Matter;
    this.engine = engine;
    this.dominoes = new Map();
    this.minRelativeSpeed = options.minRelativeSpeed ?? 0.18;
    this.assistScale = options.assistScale ?? 0.0011;
    this.maxAssist = options.maxAssist ?? 0.012;
    this._collisionStart = e => this.onCollisionStart(e.pairs || []);
  }

  attach() {
    this.M.Events.on(this.engine, 'collisionStart', this._collisionStart);
    return this;
  }

  detach() {
    this.M.Events.off(this.engine, 'collisionStart', this._collisionStart);
  }

  createBody(entity) {
    const material = DominoMaterials[entity.material || 'wood'] || DominoMaterials.wood;
    const w = entity.w ?? entity.width ?? 20;
    const h = entity.h ?? entity.height ?? 96;
    const body = this.M.Bodies.rectangle(entity.x, entity.y, w, h, {
      angle: (entity.r ?? entity.rotation ?? 0) * Math.PI / 180,
      density: 0.0018 * material.mass,
      friction: material.friction,
      frictionStatic: Math.min(material.friction * 0.65, 0.28),
      frictionAir: 0.002,
      restitution: material.restitution,
      slop: 0.02,
      label: `domino:${entity.id}`
    });

    body.plugin = body.plugin || {};
    body.plugin.domino = {
      id: entity.id,
      material: entity.material || 'wood',
      height: h,
      width: w,
      sensitivity: entity.sensitivity ?? material.sensitivity,
      impactMultiplier: entity.impactMultiplier ?? material.impact,
      fallen: false,
      assisted: false
    };

    this.dominoes.set(entity.id, body);
    return body;
  }

  registerBody(entity, body) {
    if (!entity?.id || !body) return;
    const material = DominoMaterials[entity.material || 'wood'] || DominoMaterials.wood;
    body.plugin = body.plugin || {};
    body.plugin.domino = {
      id: entity.id,
      material: entity.material || 'wood',
      height: entity.h ?? entity.height ?? 96,
      width: entity.w ?? entity.width ?? 20,
      sensitivity: entity.sensitivity ?? material.sensitivity,
      impactMultiplier: entity.impactMultiplier ?? material.impact,
      fallen: false,
      assisted: false
    };
    body.friction = material.friction;
    body.frictionStatic = Math.min(material.friction * 0.65, 0.28);
    body.restitution = material.restitution;
    this.dominoes.set(entity.id, body);
  }

  onCollisionStart(pairs) {
    for (const pair of pairs) {
      this._handleDominoCollision(pair.bodyA, pair.bodyB, pair);
      this._handleDominoCollision(pair.bodyB, pair.bodyA, pair);
    }
  }

  update() {
    for (const body of this.dominoes.values()) {
      const meta = body.plugin?.domino;
      if (!meta) continue;
      const uprightAngle = this._normalizeHalfTurn(body.angle);
      const abs = Math.abs(uprightAngle);

      if (abs > 0.05 && abs < 1.35 && Math.abs(body.angularVelocity) < 0.055) {
        // Once visibly tipped, add a very small gravity-direction angular bias.
        // This prevents the classic Matter.js behaviour where a domino rocks and settles upright.
        const sign = Math.sign(uprightAngle || body.angularVelocity || 1);
        this.M.Body.setAngularVelocity(body, body.angularVelocity + sign * 0.012 * (meta.sensitivity || 1));
      }

      if (abs >= 1.25) meta.fallen = true;
    }
  }

  _handleDominoCollision(domino, other, pair) {
    const meta = domino?.plugin?.domino;
    if (!meta || meta.fallen || !other || other.isSensor) return;

    const rvx = (other.velocity?.x || 0) - (domino.velocity?.x || 0);
    const rvy = (other.velocity?.y || 0) - (domino.velocity?.y || 0);
    const relativeSpeed = Math.hypot(rvx, rvy);
    if (relativeSpeed < this.minRelativeSpeed) return;

    const support = pair.collision?.supports?.[0];
    const hitY = support?.y ?? domino.position.y - meta.height * 0.22;
    const leverRatio = Math.max(0.28, Math.min(1, Math.abs(domino.position.y - hitY) / (meta.height * 0.5)));
    const horizontal = Math.abs(rvx) > 0.02 ? Math.sign(rvx) : Math.sign(other.position.x - domino.position.x) || 1;
    const impact = relativeSpeed * (meta.impactMultiplier || 1) * (meta.sensitivity || 1) * leverRatio;
    const assist = Math.min(this.maxAssist, Math.max(0.0018, impact * this.assistScale));

    // Apply at the upper part of the tile so the same linear force produces torque.
    const topPoint = {
      x: domino.position.x,
      y: domino.position.y - meta.height * 0.38
    };
    this.M.Body.applyForce(domino, topPoint, { x: horizontal * assist * domino.mass, y: 0 });

    // Give a small angular kick only on the first meaningful impact.
    if (!meta.assisted) {
      const minimumOmega = 0.075 * (meta.sensitivity || 1);
      if (Math.abs(domino.angularVelocity) < minimumOmega) {
        this.M.Body.setAngularVelocity(domino, horizontal * minimumOmega);
      }
      meta.assisted = true;
    }
  }

  _normalizeHalfTurn(angle) {
    let a = angle % Math.PI;
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    return a;
  }
}
