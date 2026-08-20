// DominoEditor V24.2 Matter.js Domino Adapter
// Prevents spontaneous tipping, long post-fall sliding and unrealistic launch behaviour.

import { DominoMaterials } from './DominoPhysicsCore.js';

export class DominoMatterAdapter {
  constructor(Matter, engine, options = {}) {
    if (!Matter || !engine) throw new Error('DominoMatterAdapter requires Matter and engine');
    this.M = Matter;
    this.engine = engine;
    this.dominoes = new Map();
    this.minRelativeSpeed = options.minRelativeSpeed ?? 0.18;

    // V24.2 safety caps. Older callers used much larger force values; clamp them here
    // so stale app code cannot launch a domino across the scene.
    this.assistScale = Math.min(options.assistScale ?? 0.00012, 0.00018);
    this.maxAssist = Math.min(options.maxAssist ?? 0.00055, 0.0007);
    this.maxExternalForcePerMass = options.maxExternalForcePerMass ?? 0.00125;
    this.maxAngularVelocity = options.maxAngularVelocity ?? 0.19;
    this.maxHorizontalSpeed = options.maxHorizontalSpeed ?? 4.2;
    this.maxUpwardSpeed = options.maxUpwardSpeed ?? 1.2;

    this._collisionStart = e => this.onCollisionStart(e.pairs || []);
    this._beforeUpdate = () => this._stabilizeExternalForces();
  }

  attach() {
    this.M.Events.on(this.engine, 'collisionStart', this._collisionStart);
    this.M.Events.on(this.engine, 'beforeUpdate', this._beforeUpdate);
    return this;
  }

  detach() {
    this.M.Events.off(this.engine, 'collisionStart', this._collisionStart);
    this.M.Events.off(this.engine, 'beforeUpdate', this._beforeUpdate);
  }

  createBody(entity) {
    const material = DominoMaterials[entity.material || 'wood'] || DominoMaterials.wood;
    const w = entity.w ?? entity.width ?? 20;
    const h = entity.h ?? entity.height ?? 96;
    const initialAngle = (entity.r ?? entity.rotation ?? 0) * Math.PI / 180;
    const body = this.M.Bodies.rectangle(entity.x, entity.y, w, h, {
      angle: initialAngle,
      density: material.density ?? 0.0022,
      friction: material.friction ?? 0.62,
      frictionStatic: material.frictionStatic ?? 0.88,
      frictionAir: material.frictionAir ?? 0.006,
      restitution: material.restitution ?? 0.002,
      slop: 0.015,
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
      baseFrictionAir: material.frictionAir ?? 0.006,
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
      baseFrictionAir: material.frictionAir ?? 0.006,
      initialAngle,
      fallen: false,
      armed: false,
      lastImpactAt: -Infinity
    };
    body.friction = material.friction ?? 0.62;
    body.frictionStatic = material.frictionStatic ?? 0.88;
    body.frictionAir = material.frictionAir ?? 0.006;
    body.restitution = material.restitution ?? 0.002;
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

      // Only help a domino after a real dynamic-body impact. Assistance is now
      // angular-first and very small, so it rotates instead of translating/flying.
      if (
        meta.armed &&
        now - meta.lastImpactAt < 1400 &&
        abs > 0.10 &&
        abs < 1.12 &&
        Math.abs(body.angularVelocity) < 0.030
      ) {
        const sign = Math.sign(tilt || body.angularVelocity || 1);
        this.M.Body.setAngularVelocity(
          body,
          body.angularVelocity + sign * 0.0025 * (meta.sensitivity || 1)
        );
      }

      // Cap angular energy. A domino can still knock over its neighbour, but it
      // cannot spin so fast that the solver converts the contact into a launch.
      if (Math.abs(body.angularVelocity) > this.maxAngularVelocity) {
        this.M.Body.setAngularVelocity(
          body,
          Math.sign(body.angularVelocity) * this.maxAngularVelocity
        );
      }

      // As the tile reaches the floor, increase air damping slightly and cap only
      // obviously non-physical translation. This does not lock the body in place.
      if (abs > 0.92) {
        body.frictionAir = Math.max(meta.baseFrictionAir || 0.006, 0.018);
        const vx = Math.max(-this.maxHorizontalSpeed, Math.min(this.maxHorizontalSpeed, body.velocity.x));
        const vy = Math.max(-this.maxUpwardSpeed, Math.min(7.0, body.velocity.y));
        if (vx !== body.velocity.x || vy !== body.velocity.y) {
          this.M.Body.setVelocity(body, { x: vx, y: vy });
        }
      } else {
        body.frictionAir = meta.baseFrictionAir || 0.006;
      }

      if (abs >= 1.20) {
        meta.fallen = true;

        // Once almost horizontal, bleed residual sideways energy. This mimics the
        // large contact patch of a real domino lying flat and stops long skating.
        const vx = body.velocity.x * 0.94;
        const vy = body.velocity.y < 0 ? body.velocity.y * 0.35 : body.velocity.y;
        this.M.Body.setVelocity(body, { x: vx, y: vy });
      }
    }
  }

  _handleDominoCollision(domino, other, pair) {
    const meta = domino?.plugin?.domino;
    if (!meta || meta.fallen || !other || other.isSensor) return;

    // Ground, ramps and other static support surfaces are support contacts, not hits.
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

    const horizontal = Math.sign(domino.position.x - other.position.x) || Math.sign(rvx) || 1;

    // Weight horizontal impact more than vertical closing speed. Vertical landing
    // energy should not become a large sideways kick.
    const effectiveSpeed = Math.max(Math.abs(rvx), relativeSpeed * 0.32);
    const impact = effectiveSpeed * (meta.impactMultiplier || 1) * (meta.sensitivity || 1) * leverRatio;
    const assist = Math.min(this.maxAssist, Math.max(0.00008, impact * this.assistScale));

    const topPoint = {
      x: domino.position.x,
      y: domino.position.y - meta.height * 0.37
    };
    this.M.Body.applyForce(domino, topPoint, {
      x: horizontal * assist * domino.mass,
      y: 0
    });

    meta.armed = true;
    meta.lastImpactAt = this.engine.timing?.timestamp ?? 0;

    const tilt = Math.abs(this._angleDelta(domino.angle, meta.initialAngle));
    if (tilt < 0.22) {
      const minimumOmega = 0.030 * (meta.sensitivity || 1);
      if (Math.abs(domino.angularVelocity) < minimumOmega) {
        this.M.Body.setAngularVelocity(domino, horizontal * minimumOmega);
      }
    }
  }

  _stabilizeExternalForces() {
    for (const body of this.dominoes.values()) {
      const meta = body.plugin?.domino;
      if (!meta) continue;

      // Clamp queued external forces such as the editor's "push first" command.
      // Collision impulses are solved separately by Matter.js and are not erased.
      const maxForce = Math.max(0.00001, body.mass * this.maxExternalForcePerMass);
      const fx = body.force?.x || 0;
      const fy = body.force?.y || 0;
      const mag = Math.hypot(fx, fy);
      if (mag > maxForce) {
        const s = maxForce / mag;
        body.force.x *= s;
        body.force.y *= s;
      }

      // Body.applyForce at the top also queues torque. Keep that torque in the
      // range of a hand push rather than a catapult impulse.
      const maxTorque = Math.max(0.0001, body.mass * 0.026);
      if (Math.abs(body.torque || 0) > maxTorque) {
        body.torque = Math.sign(body.torque) * maxTorque;
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
