// DominoEditor V22.2 Mechanism Physics Adapter
// Bridges mechanism entities to Matter.js bodies and force-field behaviours.

const DEFAULTS = {
  spring: { width: 72, height: 18, power: 0.06 },
  piston: { width: 84, height: 26, stroke: 90, speed: 0.08 },
  gear: { radius: 34, angularSpeed: 0.04 },
  pulley: { radius: 24 },
  magnet: { radius: 180, force: 0.0009 },
  wind: { width: 220, height: 120, force: 0.0008 },
  water: { width: 240, height: 110, force: 0.00055, drag: 0.025 },
  ice: { width: 220, height: 20, friction: 0.005 }
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export class MechanismPhysicsAdapter {
  constructor(Matter, engine) {
    if (!Matter || !engine) throw new Error('MechanismPhysicsAdapter requires Matter and engine');
    this.M = Matter;
    this.engine = engine;
    this.instances = new Map();
    this._time = 0;
  }

  add(entity) {
    if (!entity?.id || !entity?.type) throw new Error('Invalid mechanism entity');
    if (this.instances.has(entity.id)) this.remove(entity.id);

    const cfg = { ...(DEFAULTS[entity.type] || {}), ...(entity.physics || {}) };
    const { Bodies, Composite } = this.M;
    const p = entity.position || { x: 0, y: 0 };
    const angle = entity.rotation || 0;
    let body = null;
    let sensor = null;

    switch (entity.type) {
      case 'spring':
        body = Bodies.rectangle(p.x, p.y, cfg.width, cfg.height, {
          isStatic: true, angle, friction: 0.6, label: `mechanism:spring:${entity.id}`
        });
        sensor = Bodies.rectangle(p.x, p.y - cfg.height, cfg.width, cfg.height * 2.5, {
          isStatic: true, isSensor: true, angle, label: `sensor:spring:${entity.id}`
        });
        break;
      case 'piston':
        body = Bodies.rectangle(p.x, p.y, cfg.width, cfg.height, {
          isStatic: true, angle, friction: 0.5, label: `mechanism:piston:${entity.id}`
        });
        break;
      case 'gear':
        body = Bodies.circle(p.x, p.y, cfg.radius, {
          isStatic: true, friction: 0.9, label: `mechanism:gear:${entity.id}`
        });
        this.M.Body.setAngle(body, angle);
        break;
      case 'pulley':
        body = Bodies.circle(p.x, p.y, cfg.radius, {
          isStatic: true, isSensor: true, label: `mechanism:pulley:${entity.id}`
        });
        break;
      case 'ice':
        body = Bodies.rectangle(p.x, p.y, cfg.width, cfg.height, {
          isStatic: true, angle, friction: cfg.friction, frictionStatic: 0,
          label: `mechanism:ice:${entity.id}`
        });
        break;
      case 'magnet':
      case 'wind':
      case 'water':
        sensor = Bodies.rectangle(p.x, p.y, cfg.width || cfg.radius * 2, cfg.height || cfg.radius * 2, {
          isStatic: true, isSensor: true, angle, label: `sensor:${entity.type}:${entity.id}`
        });
        break;
      default:
        throw new Error(`Unsupported mechanism type: ${entity.type}`);
    }

    const instance = {
      entity,
      cfg,
      body,
      sensor,
      active: entity.enabled !== false && entity.physics?.active !== false,
      origin: { x: p.x, y: p.y },
      phase: 0
    };

    const parts = [body, sensor].filter(Boolean);
    if (parts.length) Composite.add(this.engine.world, parts);
    this.instances.set(entity.id, instance);
    return instance;
  }

  remove(id) {
    const inst = this.instances.get(id);
    if (!inst) return;
    const { Composite } = this.M;
    if (inst.body) Composite.remove(this.engine.world, inst.body);
    if (inst.sensor) Composite.remove(this.engine.world, inst.sensor);
    this.instances.delete(id);
  }

  setActive(id, active) {
    const inst = this.instances.get(id);
    if (inst) inst.active = !!active;
  }

  activate(id, payload = {}) {
    const inst = this.instances.get(id);
    if (!inst) return false;
    inst.active = payload.active ?? true;
    if (inst.entity.type === 'spring' && payload.body) this._springKick(inst, payload.body);
    return true;
  }

  update(dtSeconds) {
    const dt = clamp(dtSeconds || 1 / 60, 1 / 240, 1 / 15);
    this._time += dt;
    const bodies = this.M.Composite.allBodies(this.engine.world);

    for (const inst of this.instances.values()) {
      if (!inst.active) continue;
      switch (inst.entity.type) {
        case 'piston': this._updatePiston(inst, dt); break;
        case 'gear': this._updateGear(inst, dt); break;
        case 'magnet': this._updateMagnet(inst, bodies); break;
        case 'wind': this._updateWind(inst, bodies); break;
        case 'water': this._updateWater(inst, bodies); break;
      }
    }
  }

  onCollisionPairs(pairs) {
    for (const pair of pairs || []) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      for (const inst of this.instances.values()) {
        if (inst.entity.type !== 'spring' || !inst.active || !inst.sensor) continue;
        if (a === inst.sensor && !b.isStatic) this._springKick(inst, b);
        if (b === inst.sensor && !a.isStatic) this._springKick(inst, a);
      }
    }
  }

  _springKick(inst, body) {
    const { Body } = this.M;
    const a = inst.entity.rotation || 0;
    const nx = Math.sin(a);
    const ny = -Math.cos(a);
    const power = inst.cfg.power;
    Body.applyForce(body, body.position, { x: nx * power * body.mass, y: ny * power * body.mass });
  }

  _updatePiston(inst, dt) {
    if (!inst.body) return;
    const { Body } = this.M;
    inst.phase += dt * inst.cfg.speed * Math.PI * 2;
    const travel = (Math.sin(inst.phase) * 0.5 + 0.5) * inst.cfg.stroke;
    const a = inst.entity.rotation || 0;
    Body.setPosition(inst.body, {
      x: inst.origin.x + Math.cos(a) * travel,
      y: inst.origin.y + Math.sin(a) * travel
    });
  }

  _updateGear(inst, dt) {
    if (!inst.body) return;
    this.M.Body.setAngle(inst.body, inst.body.angle + inst.cfg.angularSpeed * dt * 60);
  }

  _updateMagnet(inst, bodies) {
    const { Body } = this.M;
    const center = inst.origin;
    const r2 = inst.cfg.radius * inst.cfg.radius;
    for (const body of bodies) {
      if (body.isStatic || body === inst.sensor) continue;
      const d2 = distSq(body.position, center);
      if (!d2 || d2 > r2) continue;
      const d = Math.sqrt(d2);
      const strength = inst.cfg.force * (1 - d / inst.cfg.radius) * body.mass;
      Body.applyForce(body, body.position, {
        x: ((center.x - body.position.x) / d) * strength,
        y: ((center.y - body.position.y) / d) * strength
      });
    }
  }

  _inRect(inst, body) {
    const dx = Math.abs(body.position.x - inst.origin.x);
    const dy = Math.abs(body.position.y - inst.origin.y);
    return dx <= inst.cfg.width / 2 && dy <= inst.cfg.height / 2;
  }

  _updateWind(inst, bodies) {
    const { Body } = this.M;
    const a = inst.entity.rotation || 0;
    for (const body of bodies) {
      if (body.isStatic || !this._inRect(inst, body)) continue;
      Body.applyForce(body, body.position, {
        x: Math.cos(a) * inst.cfg.force * body.mass,
        y: Math.sin(a) * inst.cfg.force * body.mass
      });
    }
  }

  _updateWater(inst, bodies) {
    const { Body } = this.M;
    const a = inst.entity.rotation || 0;
    for (const body of bodies) {
      if (body.isStatic || !this._inRect(inst, body)) continue;
      Body.applyForce(body, body.position, {
        x: Math.cos(a) * inst.cfg.force * body.mass,
        y: Math.sin(a) * inst.cfg.force * body.mass
      });
      Body.setVelocity(body, {
        x: body.velocity.x * (1 - inst.cfg.drag),
        y: body.velocity.y * (1 - inst.cfg.drag)
      });
    }
  }
}
