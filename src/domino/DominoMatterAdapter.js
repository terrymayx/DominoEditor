// DominoEditor V24.3 Matter.js Domino Adapter
// Grounded domino dynamics: angular-only chain assistance, support tracking, no catapult impulses.

import { DominoMaterials } from './DominoPhysicsCore.js?v=24.3';

export class DominoMatterAdapter {
  constructor(Matter, engine, options = {}) {
    if (!Matter || !engine) throw new Error('DominoMatterAdapter requires Matter and engine');
    this.M = Matter;
    this.engine = engine;
    this.dominoes = new Map();
    this.minRelativeSpeed = options.minRelativeSpeed ?? 0.12;
    this.maxAngularVelocity = options.maxAngularVelocity ?? 0.115;
    this.maxGroundedHorizontalSpeed = options.maxGroundedHorizontalSpeed ?? 1.45;
    this.maxAirHorizontalSpeed = options.maxAirHorizontalSpeed ?? 2.8;
    this.maxRecentSupportUpwardSpeed = options.maxRecentSupportUpwardSpeed ?? 0.18;

    this._collisionStart = e => this.onCollisionStart(e.pairs || []);
    this._collisionEnd = e => this.onCollisionEnd(e.pairs || []);
    this._beforeUpdate = () => this._stabilizeBeforeUpdate();
  }

  attach() {
    this.M.Events.on(this.engine, 'collisionStart', this._collisionStart);
    this.M.Events.on(this.engine, 'collisionEnd', this._collisionEnd);
    this.M.Events.on(this.engine, 'beforeUpdate', this._beforeUpdate);
    return this;
  }

  detach() {
    this.M.Events.off(this.engine, 'collisionStart', this._collisionStart);
    this.M.Events.off(this.engine, 'collisionEnd', this._collisionEnd);
    this.M.Events.off(this.engine, 'beforeUpdate', this._beforeUpdate);
  }

  createBody(entity) {
    const material = DominoMaterials[entity.material || 'wood'] || DominoMaterials.wood;
    const w = entity.w ?? entity.width ?? 20;
    const h = entity.h ?? entity.height ?? 96;
    const initialAngle = (entity.r ?? entity.rotation ?? 0) * Math.PI / 180;
    const body = this.M.Bodies.rectangle(entity.x, entity.y, w, h, {
      angle: initialAngle,
      density: material.density ?? 0.0025,
      friction: material.friction ?? 0.78,
      frictionStatic: material.frictionStatic ?? 0.98,
      frictionAir: material.frictionAir ?? 0.01,
      restitution: material.restitution ?? 0,
      slop: 0.012,
      label: `domino:${entity.id}`
    });

    this.M.Body.setInertia(body, body.inertia * (material.inertiaScale ?? 1.35));

    body.plugin = body.plugin || {};
    body.plugin.domino = this._makeMeta(entity, material, w, h, initialAngle);
    this.dominoes.set(entity.id, body);
    return body;
  }

  registerBody(entity, body) {
    if (!entity?.id || !body) return;
    const material = DominoMaterials[entity.material || 'wood'] || DominoMaterials.wood;
    const initialAngle = (entity.r ?? entity.rotation ?? 0) * Math.PI / 180;
    body.plugin = body.plugin || {};
    body.plugin.domino = this._makeMeta(
      entity,
      material,
      entity.w ?? entity.width ?? 20,
      entity.h ?? entity.height ?? 96,
      initialAngle
    );
    body.friction = material.friction ?? 0.78;
    body.frictionStatic = material.frictionStatic ?? 0.98;
    body.frictionAir = material.frictionAir ?? 0.01;
    body.restitution = material.restitution ?? 0;
    this.M.Body.setInertia(body, body.inertia * (material.inertiaScale ?? 1.35));
    this.dominoes.set(entity.id, body);
  }

  _makeMeta(entity, material, w, h, initialAngle) {
    return {
      id: entity.id,
      material: entity.material || 'wood',
      height: h,
      width: w,
      sensitivity: entity.sensitivity ?? material.sensitivity ?? 1,
      impactMultiplier: entity.impactMultiplier ?? material.impact ?? 1,
      baseFrictionAir: material.frictionAir ?? 0.01,
      groundedSlide: material.groundedSlide ?? 0.8,
      initialAngle,
      fallen: false,
      armed: false,
      lastImpactAt: -Infinity,
      lastSupportAt: -Infinity,
      supportIds: new Set()
    };
  }

  onCollisionStart(pairs) {
    const now = this.engine.timing?.timestamp ?? 0;
    for (const pair of pairs) {
      this._trackSupport(pair.bodyA, pair.bodyB, true, now);
      this._trackSupport(pair.bodyB, pair.bodyA, true, now);
      this._handleDominoCollision(pair.bodyA, pair.bodyB, pair);
      this._handleDominoCollision(pair.bodyB, pair.bodyA, pair);
    }
  }

  onCollisionEnd(pairs) {
    const now = this.engine.timing?.timestamp ?? 0;
    for (const pair of pairs) {
      this._trackSupport(pair.bodyA, pair.bodyB, false, now);
      this._trackSupport(pair.bodyB, pair.bodyA, false, now);
    }
  }

  _trackSupport(domino, other, entering, now) {
    const meta = domino?.plugin?.domino;
    if (!meta || !other || !other.isStatic || other.isSensor) return;
    if (entering) meta.supportIds.add(other.id);
    else meta.supportIds.delete(other.id);
    meta.lastSupportAt = now;
  }

  update() {
    const now = this.engine.timing?.timestamp ?? 0;
    for (const body of this.dominoes.values()) {
      const meta = body.plugin?.domino;
      if (!meta) continue;

      const tilt = this._angleDelta(body.angle, meta.initialAngle);
      const abs = Math.abs(tilt);
      const grounded = meta.supportIds.size > 0;
      const recentlyGrounded = grounded || now - meta.lastSupportAt < 140;

      // Chain assistance is rotational only. No top-point force is ever injected,
      // so the helper cannot create sideways or upward launch energy.
      if (
        meta.armed &&
        now - meta.lastImpactAt < 1200 &&
        abs > 0.10 && abs < 1.08 &&
        Math.abs(body.angularVelocity) < 0.024
      ) {
        const sign = Math.sign(tilt || body.angularVelocity || 1);
        this.M.Body.setAngularVelocity(
          body,
          body.angularVelocity + sign * 0.0018 * (meta.sensitivity || 1)
        );
      }

      // Hard cap rotation before the solver can turn fast corner contact into a launch.
      if (Math.abs(body.angularVelocity) > this.maxAngularVelocity) {
        this.M.Body.setAngularVelocity(
          body,
          Math.sign(body.angularVelocity) * this.maxAngularVelocity
        );
      }

      let vx = body.velocity.x;
      let vy = body.velocity.y;

      if (grounded) {
        // A standing/falling tabletop domino should rotate around its lower edge,
        // not skate. Keep translation small while a support is actually touching it.
        const maxX = abs < 1.05 ? this.maxGroundedHorizontalSpeed : 0.85;
        vx = Math.max(-maxX, Math.min(maxX, vx));

        // Matter uses +Y downward. Suppress upward solver impulses while supported.
        if (vy < 0) vy = Math.max(vy, -0.06);
      } else {
        vx = Math.max(-this.maxAirHorizontalSpeed, Math.min(this.maxAirHorizontalSpeed, vx));
      }

      // Contact manifolds sometimes disappear for one frame exactly when a tile
      // reaches the floor. Keep a short anti-bounce window so that frame cannot launch it.
      if (recentlyGrounded && vy < -this.maxRecentSupportUpwardSpeed) {
        vy = -this.maxRecentSupportUpwardSpeed;
      }

      if (abs > 0.92) {
        body.frictionAir = Math.max(meta.baseFrictionAir || 0.01, grounded ? 0.035 : 0.018);
      } else {
        body.frictionAir = meta.baseFrictionAir || 0.01;
      }

      if (abs >= 1.18) {
        meta.fallen = true;
        if (grounded || recentlyGrounded) {
          // Large flat contact patch: rapidly dissipate residual slide without freezing.
          vx *= meta.groundedSlide ?? 0.80;
          if (Math.abs(vx) < 0.035) vx = 0;
          if (vy < 0) vy *= 0.18;
          if (Math.abs(body.angularVelocity) < 0.018) this.M.Body.setAngularVelocity(body, 0);
        }
      }

      if (vx !== body.velocity.x || vy !== body.velocity.y) {
        this.M.Body.setVelocity(body, { x: vx, y: vy });
      }
    }
  }

  _handleDominoCollision(domino, other) {
    const meta = domino?.plugin?.domino;
    if (!meta || meta.fallen || !other || other.isSensor || other.isStatic) return;

    const rvx = (other.velocity?.x || 0) - (domino.velocity?.x || 0);
    const rvy = (other.velocity?.y || 0) - (domino.velocity?.y || 0);
    const otherMeta = other.plugin?.domino;

    // Falling domino tips carry useful angular energy even when center-of-mass
    // horizontal velocity is small. Convert only that into a gentle angular kick.
    const otherTipSpeed = otherMeta
      ? Math.abs(other.angularVelocity || 0) * (otherMeta.height || 96) * 0.42
      : 0;
    const effectiveSpeed = Math.max(Math.abs(rvx), otherTipSpeed, Math.hypot(rvx, rvy) * 0.18);
    if (effectiveSpeed < this.minRelativeSpeed) return;

    const horizontal = Math.sign(domino.position.x - other.position.x) || Math.sign(rvx) || 1;
    const impact = Math.min(2.4, effectiveSpeed) * (meta.impactMultiplier || 1) * (meta.sensitivity || 1);
    const targetOmega = Math.min(
      0.060,
      Math.max(0.026, 0.020 + impact * 0.010)
    );

    meta.armed = true;
    meta.lastImpactAt = this.engine.timing?.timestamp ?? 0;

    const tilt = Math.abs(this._angleDelta(domino.angle, meta.initialAngle));
    if (tilt < 0.34 && Math.abs(domino.angularVelocity) < targetOmega) {
      this.M.Body.setAngularVelocity(domino, horizontal * targetOmega);
    }

    // Do not add linear force here. Real collision impulses remain in Matter.js;
    // the helper contributes rotation only.
  }

  _stabilizeBeforeUpdate() {
    const now = this.engine.timing?.timestamp ?? 0;
    for (const body of this.dominoes.values()) {
      const meta = body.plugin?.domino;
      if (!meta) continue;

      const forceMag = Math.hypot(body.force?.x || 0, body.force?.y || 0);
      const rawTorque = body.torque || 0;

      // Editor push / external mechanisms may still call Body.applyForce. Convert
      // oversized external pushes into a small rotational trigger and strip the
      // catapult-sized force before the physics step.
      if (
        !meta.armed &&
        (forceMag > body.mass * 0.00008 || Math.abs(rawTorque) > body.mass * 0.002 || Math.abs(body.angularVelocity) > 0.035)
      ) {
        meta.armed = true;
        meta.lastImpactAt = now;
      }

      const tilt = Math.abs(this._angleDelta(body.angle, meta.initialAngle));
      if (tilt < 0.28 && forceMag > body.mass * 0.00018) {
        const direction = Math.sign(body.force.x || body.angularVelocity || 1);
        body.force.x = 0;
        if (body.force.y < 0) body.force.y = 0;
        body.torque = 0;
        if (Math.abs(body.angularVelocity) < 0.045) {
          this.M.Body.setAngularVelocity(body, direction * 0.038);
        }
      } else {
        const maxForce = Math.max(0.00001, body.mass * 0.00030);
        if (forceMag > maxForce) {
          const s = maxForce / forceMag;
          body.force.x *= s;
          body.force.y *= s;
        }
        const maxTorque = Math.max(0.00008, body.mass * 0.010);
        if (Math.abs(body.torque || 0) > maxTorque) {
          body.torque = Math.sign(body.torque) * maxTorque;
        }
      }

      if (tilt < 0.20 && Math.abs(body.angularVelocity) > 0.060) {
        this.M.Body.setAngularVelocity(body, Math.sign(body.angularVelocity) * 0.060);
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
