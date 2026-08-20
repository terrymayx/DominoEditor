// DominoEditor V24.1 Matter.js Domino Adapter
// Prevents spontaneous tipping while keeping impact-driven chain reactions reliable.

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
    const initialAngle = (entity.r ?? entity.rotation ?? 0) * Math.PI / 180;
    const body = this.M.Bodies.rectangle(entity.x, entity.y, w, h, {
      angle: initialAngle,
      density: 0.0018 * (material.mass ?? 1),
      friction: material.friction ?? 0.4,
      frictionStatic: material.frictionStatic ?? 0.5,
      frictionAir: 0.002,
      restitution: material.restitution ?? 0.01,
      slop: 0.02,
      label: `domino:${entity.id}`
    });

    body.plugin = body.plugin || {};
    body.plugin.domino = {
      id: entity.id,
      material: entity.material || 'wood',
      height: h,
      width: w,
      sensitivity: entity.sensitivity ?? material.sensitivity ?? 1,
      impactMultiplier: entity.impactMultiplier ?? material.impact ?? 1,
      initialAngle,
      fallen: false,
      armed: false,
      lastImpactAt: -Infinity
    };

    this.dominoes.set(entity.id, body);
    return body;
  }

  registerBody(entity, body) {
    if (!entity?.id || !body) return;
    const material = DominoMaterials[entity.material || 'wood'] || DominoMaterials.wood;
    const initialAngle = (entity.r ?? entity.rotation ?? 0) * Math.PI / 180;
    body.plugin = body.plugin || {};
    body.plugin.domino = {
      id: entity.id,
      material: entity.material || 'wood',
      height: entity.h ?? entity.height ?? 96,
      width: entity.w ?? entity.width ?? 20,
      sensitivity: entity.sensitivity ?? material.sensitivity ?? 1,
      impactMultiplier: entity.impactMultiplier ?? material.impact ?? 1,
      initialAngle,
      fallen: false,
      armed: false,
      lastImpactAt: -Infinity
    };
    body.friction = material.friction ?? 0.4;
    body.frictionStatic = material.frictionStatic ?? 0.5;
    body.restitution = material.restitution ?? 0.01;
    this.dominoes.set(entity.id, body);
  }

  onCollisionStart(pairs) {
    for (const pair of pairs) {
      this._handleDominoCollision(pair.bodyA, pair.bodyB, pair);
      this._handleDominoCollision(pair.bodyB, pair.bodyA, pair);
    }
  }

  update() {
    const now = this.engine.timing?.timestamp ?? 0;
    for (const body of this.dominoes.values()) {
      const meta = body.plugin?.domino;
      if (!meta) continue;

      const tilt = this._angleDelta(body.angle, meta.initialAngle);
      const abs = Math.abs(tilt);

      // Critical V24.1 fix:
      // Never add any tipping assistance until this domino has actually been hit.
      // Previously tiny settling errors (> ~3 degrees) were amplified and tiles fell by themselves.
      if (meta.armed && now - meta.lastImpactAt < 1800 && abs > 0.08 && abs < 1.30 && Math.abs(body.angularVelocity) < 0.045) {
        const sign = Math.sign(tilt || body.angularVelocity || 1);
        this.M.Body.setAngularVelocity(
          body,
          body.angularVelocity + sign * 0.006 * (meta.sensitivity || 1)
        );
      }

      if (abs >= 1.20) meta.fallen = true;
    }
  }

  _handleDominoCollision(domino, other, pair) {
    const meta = domino?.plugin?.domino;
    if (!meta || meta.fallen || !other || other.isSensor) return;

    // Ground, ramps and other static support surfaces must never "hit" a domino.
    // The old code treated the initial vertical landing on the floor as an impact,
    // which armed every domino and caused spontaneous chain collapse.
    if (other.isStatic) return;

    const rvx = (other.velocity?.x || 0) - (domino.velocity?.x || 0);
    const rvy = (other.velocity?.y || 0) - (domino.velocity?.y || 0);
    const relativeSpeed = Math.hypot(rvx, rvy);
    if (relativeSpeed < this.minRelativeSpeed) return;

    const support = pair.collision?.supports?.[0];
    const hitY = support?.y ?? domino.position.y - meta.height * 0.22;
    const leverRatio = Math.max(
      0.25,
      Math.min(1, Math.abs(domino.position.y - hitY) / (meta.height * 0.5))
    );

    // Tip away from the incoming moving body. This is more stable than using
    // vertical settling velocity as the direction signal.
    const horizontal = Math.sign(domino.position.x - other.position.x) || Math.sign(rvx) || 1;
    const impact = relativeSpeed * (meta.impactMultiplier || 1) * (meta.sensitivity || 1) * leverRatio;
    const assist = Math.min(this.maxAssist, Math.max(0.0012, impact * this.assistScale));

    const topPoint = {
      x: domino.position.x,
      y: domino.position.y - meta.height * 0.38
    };
    this.M.Body.applyForce(domino, topPoint, {
      x: horizontal * assist * domino.mass,
      y: 0
    });

    meta.armed = true;
    meta.lastImpactAt = this.engine.timing?.timestamp ?? 0;

    // Only provide a small angular kick after a real dynamic-body impact.
    const tilt = Math.abs(this._angleDelta(domino.angle, meta.initialAngle));
    if (tilt < 0.20) {
      const minimumOmega = 0.055 * (meta.sensitivity || 1);
      if (Math.abs(domino.angularVelocity) < minimumOmega) {
        this.M.Body.setAngularVelocity(domino, horizontal * minimumOmega);
      }
    }
  }

  _angleDelta(angle, reference) {
    let a = (angle - reference) % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
}
