// DominoEditor V24.5 Matter.js Domino Adapter
// Ground-pivot toppling + per-domino weight and gravity multipliers.

import { DominoMaterials } from './DominoPhysicsCore.js?v=24.5';

function clampNumber(value, min, max, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export class DominoMatterAdapter {
  constructor(Matter, engine, options = {}) {
    if (!Matter || !engine) throw new Error('DominoMatterAdapter requires Matter and engine');
    this.M = Matter;
    this.engine = engine;
    this.dominoes = new Map();
    this.minRelativeSpeed = options.minRelativeSpeed ?? 0.12;
    this.maxAngularVelocity = options.maxAngularVelocity ?? 0.105;
    this.maxGroundedHorizontalSpeed = options.maxGroundedHorizontalSpeed ?? 0.72;
    this.maxAirHorizontalSpeed = options.maxAirHorizontalSpeed ?? 2.2;
    this.pivotReleaseDelay = options.pivotReleaseDelay ?? 320;

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
    for (const body of this.dominoes.values()) this._removePivot(body);
  }

  _scales(entity) {
    const defaults = globalThis.DominoPhysicsDefaults || {};
    return {
      weightScale: clampNumber(entity?.weightScale ?? defaults.weightScale ?? 1, 0.25, 5, 1),
      gravityScale: clampNumber(entity?.gravityScale ?? defaults.gravityScale ?? 1, 0.25, 3, 1)
    };
  }

  createBody(entity) {
    const material = DominoMaterials[entity.material || 'wood'] || DominoMaterials.wood;
    const w = entity.w ?? entity.width ?? 20;
    const h = entity.h ?? entity.height ?? 96;
    const initialAngle = (entity.r ?? entity.rotation ?? 0) * Math.PI / 180;
    const scales = this._scales(entity);
    const body = this.M.Bodies.rectangle(entity.x, entity.y, w, h, {
      angle: initialAngle,
      density: (material.density ?? 0.0025) * scales.weightScale,
      friction: Math.max(material.friction ?? 0.78, 0.74),
      frictionStatic: Math.max(material.frictionStatic ?? 0.98, 0.92),
      frictionAir: material.frictionAir ?? 0.01,
      restitution: 0,
      slop: 0.01,
      label: `domino:${entity.id}`
    });

    // Density now carries the user's weight multiplier. Keep a moderate extra
    // inertia scale so a heavy tile feels planted instead of becoming a spinner.
    this.M.Body.setInertia(body, body.inertia * (material.inertiaScale ?? 1.48));

    body.plugin = body.plugin || {};
    body.plugin.domino = this._makeMeta(entity, material, w, h, initialAngle, scales);
    this.dominoes.set(entity.id, body);
    return body;
  }

  registerBody(entity, body) {
    if (!entity?.id || !body) return;
    const material = DominoMaterials[entity.material || 'wood'] || DominoMaterials.wood;
    const initialAngle = (entity.r ?? entity.rotation ?? 0) * Math.PI / 180;
    const scales = this._scales(entity);

    this.M.Body.setDensity(body, (material.density ?? 0.0025) * scales.weightScale);
    body.plugin = body.plugin || {};
    body.plugin.domino = this._makeMeta(
      entity,
      material,
      entity.w ?? entity.width ?? 20,
      entity.h ?? entity.height ?? 96,
      initialAngle,
      scales
    );
    body.friction = Math.max(material.friction ?? 0.78, 0.74);
    body.frictionStatic = Math.max(material.frictionStatic ?? 0.98, 0.92);
    body.frictionAir = material.frictionAir ?? 0.01;
    body.restitution = 0;
    this.M.Body.setInertia(body, body.inertia * (material.inertiaScale ?? 1.48));
    this.dominoes.set(entity.id, body);
  }

  _makeMeta(entity, material, w, h, initialAngle, scales = this._scales(entity)) {
    return {
      id: entity.id,
      material: entity.material || 'wood',
      height: h,
      width: w,
      sensitivity: entity.sensitivity ?? material.sensitivity ?? 1,
      impactMultiplier: entity.impactMultiplier ?? material.impact ?? 1,
      weightScale: scales.weightScale,
      gravityScale: scales.gravityScale,
      baseFrictionAir: material.frictionAir ?? 0.01,
      groundedSlide: material.groundedSlide ?? 0.72,
      initialAngle,
      fallen: false,
      fallenAt: Infinity,
      armed: false,
      lastImpactAt: -Infinity,
      lastSupportAt: -Infinity,
      supportIds: new Set(),
      pivotConstraint: null,
      pivotAnchor: null
    };
  }

  onCollisionStart(pairs) {
    const now = this.engine.timing?.timestamp ?? 0;
    for (const pair of pairs) {
      this._trackSupport(pair.bodyA, pair.bodyB, true, now);
      this._trackSupport(pair.bodyB, pair.bodyA, true, now);
      this._handleDominoCollision(pair.bodyA, pair.bodyB);
      this._handleDominoCollision(pair.bodyB, pair.bodyA);
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

    if (entering) {
      meta.supportIds.add(other.id);
      meta.lastSupportAt = now;

      const tilt = Math.abs(this._angleDelta(domino.angle, meta.initialAngle));
      if (tilt < 0.78 && Math.abs(domino.velocity.y) < 1.6) {
        this._ensurePivot(domino);
      }
    } else {
      meta.supportIds.delete(other.id);
      meta.lastSupportAt = now;
    }
  }

  _bottomLocal(meta) {
    return { x: 0, y: meta.height * 0.47 };
  }

  _worldPoint(body, local) {
    const c = Math.cos(body.angle), s = Math.sin(body.angle);
    return {
      x: body.position.x + local.x * c - local.y * s,
      y: body.position.y + local.x * s + local.y * c
    };
  }

  _ensurePivot(body) {
    const meta = body?.plugin?.domino;
    if (!meta || meta.pivotConstraint || meta.fallen) return;

    const pointB = this._bottomLocal(meta);
    const anchor = this._worldPoint(body, pointB);
    const constraint = this.M.Constraint.create({
      pointA: { x: anchor.x, y: anchor.y },
      bodyB: body,
      pointB,
      length: 0,
      stiffness: 0.94,
      damping: 0.34,
      angularStiffness: 0
    });

    meta.pivotAnchor = anchor;
    meta.pivotConstraint = constraint;
    this.M.Composite.add(this.engine.world, constraint);
  }

  _removePivot(body) {
    const meta = body?.plugin?.domino;
    if (!meta?.pivotConstraint) return;
    this.M.Composite.remove(this.engine.world, meta.pivotConstraint, true);
    meta.pivotConstraint = null;
    meta.pivotAnchor = null;
  }

  update() {
    const now = this.engine.timing?.timestamp ?? 0;

    for (const body of this.dominoes.values()) {
      const meta = body.plugin?.domino;
      if (!meta) continue;

      const tilt = this._angleDelta(body.angle, meta.initialAngle);
      const abs = Math.abs(tilt);
      const grounded = meta.supportIds.size > 0;
      const recentlyGrounded = grounded || now - meta.lastSupportAt < 180;
      const hasPivot = !!meta.pivotConstraint;

      if (!hasPivot && recentlyGrounded && !meta.fallen && abs < 0.82) {
        this._ensurePivot(body);
      }

      if (
        meta.armed &&
        now - meta.lastImpactAt < 1150 &&
        abs > 0.09 && abs < 1.10 &&
        Math.abs(body.angularVelocity) < 0.022
      ) {
        const sign = Math.sign(tilt || body.angularVelocity || 1);
        const weightResistance = Math.sqrt(meta.weightScale || 1);
        this.M.Body.setAngularVelocity(
          body,
          body.angularVelocity + sign * 0.0015 * (meta.sensitivity || 1) / weightResistance
        );
      }

      if (Math.abs(body.angularVelocity) > this.maxAngularVelocity) {
        this.M.Body.setAngularVelocity(
          body,
          Math.sign(body.angularVelocity) * this.maxAngularVelocity
        );
      }

      let vx = body.velocity.x;
      let vy = body.velocity.y;

      if (meta.pivotConstraint) {
        if (vy < 0) vy = 0;
        const maxX = abs < 1.15 ? this.maxGroundedHorizontalSpeed : 0.46;
        vx = Math.max(-maxX, Math.min(maxX, vx));

        if (abs > 1.30) {
          meta.pivotConstraint.stiffness = 0.72;
          meta.pivotConstraint.damping = 0.48;
        }
        if (abs > 1.43) {
          meta.pivotConstraint.stiffness = 0.46;
          meta.pivotConstraint.damping = 0.60;
        }
      } else if (grounded || recentlyGrounded) {
        const maxX = abs < 1.1 ? 0.95 : 0.62;
        vx = Math.max(-maxX, Math.min(maxX, vx));
        if (vy < -0.08) vy = -0.08;
      } else {
        vx = Math.max(-this.maxAirHorizontalSpeed, Math.min(this.maxAirHorizontalSpeed, vx));
        if (vy < -0.7) vy = -0.7;
      }

      if (abs > 0.92) {
        body.frictionAir = Math.max(meta.baseFrictionAir || 0.01, meta.pivotConstraint ? 0.045 : 0.026);
      } else {
        body.frictionAir = meta.baseFrictionAir || 0.01;
      }

      if (abs >= 1.18 && !meta.fallen) {
        meta.fallen = true;
        meta.fallenAt = now;
      }

      if (meta.fallen) {
        if (grounded || recentlyGrounded || meta.pivotConstraint) {
          vx *= 0.80;
          if (Math.abs(vx) < 0.025) vx = 0;
          if (vy < 0) vy = 0;
          if (Math.abs(body.angularVelocity) < 0.014) this.M.Body.setAngularVelocity(body, 0);
        }

        const speed = Math.hypot(vx, vy);
        if (
          meta.pivotConstraint &&
          now - meta.fallenAt > this.pivotReleaseDelay &&
          abs > 1.42 &&
          speed < 0.32 &&
          Math.abs(body.angularVelocity) < 0.020
        ) {
          this._removePivot(body);
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

    const otherTipSpeed = otherMeta
      ? Math.abs(other.angularVelocity || 0) * (otherMeta.height || 96) * 0.40
      : 0;
    const effectiveSpeed = Math.max(Math.abs(rvx), otherTipSpeed, Math.hypot(rvx, rvy) * 0.14);
    if (effectiveSpeed < this.minRelativeSpeed) return;

    const now = this.engine.timing?.timestamp ?? 0;
    const recentlyGrounded = meta.supportIds.size > 0 || now - meta.lastSupportAt < 180;
    if (recentlyGrounded) this._ensurePivot(domino);

    const horizontal = Math.sign(domino.position.x - other.position.x) || Math.sign(rvx) || 1;
    const impact = Math.min(2.0, effectiveSpeed) * (meta.impactMultiplier || 1) * (meta.sensitivity || 1);
    const weightResistance = Math.sqrt(meta.weightScale || 1);
    const targetOmega = Math.min(0.052, Math.max(0.018, (0.019 + impact * 0.008) / weightResistance));

    meta.armed = true;
    meta.lastImpactAt = now;

    const tilt = Math.abs(this._angleDelta(domino.angle, meta.initialAngle));
    if (tilt < 0.36 && Math.abs(domino.angularVelocity) < targetOmega) {
      this.M.Body.setAngularVelocity(domino, horizontal * targetOmega);
    }
  }

  _stabilizeBeforeUpdate() {
    const now = this.engine.timing?.timestamp ?? 0;

    for (const body of this.dominoes.values()) {
      const meta = body.plugin?.domino;
      if (!meta) continue;

      const forceMag = Math.hypot(body.force?.x || 0, body.force?.y || 0);
      const rawTorque = body.torque || 0;
      const tilt = Math.abs(this._angleDelta(body.angle, meta.initialAngle));
      const recentlyGrounded = meta.supportIds.size > 0 || now - meta.lastSupportAt < 180;

      if (
        !meta.armed &&
        (forceMag > body.mass * 0.00006 || Math.abs(rawTorque) > body.mass * 0.0015 || Math.abs(body.angularVelocity) > 0.030)
      ) {
        meta.armed = true;
        meta.lastImpactAt = now;
      }

      if (recentlyGrounded && tilt < 0.70 && forceMag > body.mass * 0.00008) {
        this._ensurePivot(body);
        const direction = Math.sign(body.force.x || body.angularVelocity || 1);
        body.force.x = 0;
        if (body.force.y < 0) body.force.y = 0;
        body.torque = 0;
        if (Math.abs(body.angularVelocity) < 0.040) {
          this.M.Body.setAngularVelocity(body, direction * 0.034 / Math.sqrt(meta.weightScale || 1));
        }
      } else {
        const maxForce = Math.max(0.00001, body.mass * 0.00022);
        if (forceMag > maxForce) {
          const s = maxForce / forceMag;
          body.force.x *= s;
          body.force.y *= s;
        }

        const maxTorque = Math.max(0.00006, body.mass * 0.0075);
        if (Math.abs(body.torque || 0) > maxTorque) {
          body.torque = Math.sign(body.torque) * maxTorque;
        }
      }

      if (tilt < 0.22 && Math.abs(body.angularVelocity) > 0.052) {
        this.M.Body.setAngularVelocity(body, Math.sign(body.angularVelocity) * 0.052);
      }

      // Matter.js applies normal world gravity after the beforeUpdate event.
      // Add only the delta here, so gravityScale=1 is unchanged, >1 is heavier
      // downward acceleration, and <1 reduces the effective gravity on this tile.
      const gravity = this.engine.gravity || { x: 0, y: 1, scale: 0.001 };
      const extraGravity = (meta.gravityScale || 1) - 1;
      if (Math.abs(extraGravity) > 1e-6) {
        const scale = gravity.scale ?? 0.001;
        body.force.x += body.mass * (gravity.x || 0) * scale * extraGravity;
        body.force.y += body.mass * (gravity.y || 0) * scale * extraGravity;
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
