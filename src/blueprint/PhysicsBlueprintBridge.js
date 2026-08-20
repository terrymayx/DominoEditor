// DominoEditor V23.1 Physics <-> Blueprint Bridge
// Connects Matter.js collision events, mechanism activation, domino events and BlueprintRuntime.

export class PhysicsBlueprintBridge {
  constructor({ Matter, engine, blueprint, mechanisms, dominoEvents } = {}) {
    if (!Matter || !engine || !blueprint) throw new Error('PhysicsBlueprintBridge requires Matter, engine and blueprint');
    this.M = Matter;
    this.engine = engine;
    this.blueprint = blueprint;
    this.mechanisms = mechanisms || null;
    this.dominoEvents = dominoEvents || null;
    this._onCollisionStart = e => this._handleCollisions(e.pairs || []);
    this._onCollisionActive = e => this.mechanisms?.onCollisionPairs?.(e.pairs || []);
  }

  attach() {
    this.M.Events.on(this.engine, 'collisionStart', this._onCollisionStart);
    this.M.Events.on(this.engine, 'collisionActive', this._onCollisionActive);
    if (this.dominoEvents?.on) {
      this.dominoEvents.on('domino:hit', e => this.blueprint.emit('domino:hit', e));
      this.dominoEvents.on('domino:falling', e => this.blueprint.emit('domino:falling', e));
      this.dominoEvents.on('domino:fallen', e => this.blueprint.emit('domino:fallen', e));
      this.dominoEvents.on('chain:complete', e => this.blueprint.emit('chain:complete', e));
    }
    return this;
  }

  detach() {
    this.M.Events.off(this.engine, 'collisionStart', this._onCollisionStart);
    this.M.Events.off(this.engine, 'collisionActive', this._onCollisionActive);
  }

  update(dtSeconds) {
    this.mechanisms?.update?.(dtSeconds);
    this.blueprint.update();
  }

  handleBlueprintAction(action) {
    if (!action) return;
    const target = action.target;
    switch (action.type) {
      case 'activate':
        this.mechanisms?.setActive?.(target, true);
        this.mechanisms?.activate?.(target, action.payload || {});
        break;
      case 'deactivate':
        this.mechanisms?.setActive?.(target, false);
        break;
      case 'toggle':
        this.mechanisms?.setActive?.(target, !!action.value);
        break;
    }
  }

  _handleCollisions(pairs) {
    this.mechanisms?.onCollisionPairs?.(pairs);
    for (const pair of pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const payload = {
        bodyA: this._bodyInfo(a),
        bodyB: this._bodyInfo(b),
        x: pair.collision?.supports?.[0]?.x,
        y: pair.collision?.supports?.[0]?.y,
        speed: Math.max(this._speed(a), this._speed(b))
      };
      this.blueprint.emit('collision', payload);
      this._emitLabelSpecific(a, b, payload);
      this._emitLabelSpecific(b, a, payload);
    }
  }

  _emitLabelSpecific(source, other, payload) {
    if (!source?.label) return;
    if (source.label.startsWith('sensor:spring:')) {
      this.blueprint.emit('spring:contact', { ...payload, mechanismId: source.label.split(':')[2], other: this._bodyInfo(other) });
    }
    if (source.label.startsWith('mechanism:')) {
      const [, type, id] = source.label.split(':');
      this.blueprint.emit(`mechanism:${type}:collision`, { ...payload, mechanismId: id, other: this._bodyInfo(other) });
    }
  }

  _speed(body) {
    const v = body?.velocity || { x: 0, y: 0 };
    return Math.hypot(v.x || 0, v.y || 0);
  }

  _bodyInfo(body) {
    return {
      id: body?.id,
      label: body?.label,
      x: body?.position?.x,
      y: body?.position?.y,
      vx: body?.velocity?.x,
      vy: body?.velocity?.y,
      angle: body?.angle,
      isStatic: !!body?.isStatic
    };
  }
}
