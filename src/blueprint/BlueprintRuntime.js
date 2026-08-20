// DominoEditor V23 Blueprint 2.0 Runtime
// Event -> condition -> action graph executor for physics mechanisms.

const BUILTIN = new Set([
  'event', 'delay', 'and', 'or', 'compare', 'counter',
  'activate', 'deactivate', 'toggle', 'emit', 'victory'
]);

export class BlueprintRuntime {
  constructor({ onAction, onVictory, now } = {}) {
    this.nodes = new Map();
    this.links = [];
    this.inbox = new Map();
    this.state = new Map();
    this.timers = [];
    this.onAction = onAction || (() => {});
    this.onVictory = onVictory || (() => {});
    this.now = now || (() => performance.now());
  }

  load({ nodes = [], links = [] } = {}) {
    this.nodes.clear();
    this.links = links.map(l => ({ ...l }));
    this.inbox.clear();
    this.state.clear();
    this.timers.length = 0;

    for (const node of nodes) {
      if (!node?.id) throw new Error('Blueprint node requires id');
      if (!BUILTIN.has(node.type)) throw new Error(`Unsupported blueprint node type: ${node.type}`);
      this.nodes.set(node.id, { ...node, params: { ...(node.params || {}) } });
      this.state.set(node.id, this._initialState(node));
    }
  }

  _initialState(node) {
    switch (node.type) {
      case 'and': return { sources: new Set() };
      case 'or': return {};
      case 'counter': return { count: 0 };
      case 'toggle': return { value: !!node.params?.initial };
      default: return {};
    }
  }

  emit(eventName, payload = {}) {
    for (const node of this.nodes.values()) {
      if (node.type !== 'event') continue;
      if ((node.params?.event || node.event) !== eventName) continue;
      this._propagate(node.id, { ...payload, event: eventName, sourceNode: node.id });
    }
  }

  triggerNode(nodeId, payload = {}, sourceId = null) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this._receive(node, payload, sourceId);
  }

  update() {
    const t = this.now();
    const ready = [];
    this.timers = this.timers.filter(timer => {
      if (timer.at <= t) {
        ready.push(timer);
        return false;
      }
      return true;
    });
    for (const timer of ready) this._propagate(timer.nodeId, timer.payload);
  }

  _receive(node, payload, sourceId) {
    const state = this.state.get(node.id) || {};

    switch (node.type) {
      case 'event':
        this._propagate(node.id, payload);
        break;
      case 'delay': {
        const ms = Math.max(0, Number(node.params?.ms ?? node.delay ?? 0));
        this.timers.push({ at: this.now() + ms, nodeId: node.id, payload });
        break;
      }
      case 'and': {
        if (sourceId) state.sources.add(sourceId);
        const required = this._incoming(node.id).map(l => l.from);
        if (required.length && required.every(id => state.sources.has(id))) {
          state.sources.clear();
          this._propagate(node.id, payload);
        }
        break;
      }
      case 'or':
        this._propagate(node.id, payload);
        break;
      case 'compare': {
        const key = node.params?.key || 'value';
        const op = node.params?.op || '>=';
        const expected = node.params?.value ?? 0;
        const actual = payload?.[key];
        if (this._compare(actual, expected, op)) this._propagate(node.id, payload);
        break;
      }
      case 'counter': {
        const step = Number(node.params?.step ?? 1);
        const target = Number(node.params?.target ?? 1);
        state.count += step;
        if (state.count >= target) {
          if (node.params?.reset !== false) state.count = 0;
          this._propagate(node.id, { ...payload, count: target });
        }
        break;
      }
      case 'activate':
        this.onAction({ type: 'activate', target: node.params?.target, payload, node });
        this._propagate(node.id, payload);
        break;
      case 'deactivate':
        this.onAction({ type: 'deactivate', target: node.params?.target, payload, node });
        this._propagate(node.id, payload);
        break;
      case 'toggle':
        state.value = !state.value;
        this.onAction({ type: 'toggle', target: node.params?.target, value: state.value, payload, node });
        this._propagate(node.id, { ...payload, value: state.value });
        break;
      case 'emit': {
        const name = node.params?.event || 'custom';
        this.emit(name, payload);
        this._propagate(node.id, payload);
        break;
      }
      case 'victory':
        this.onVictory({ payload, node });
        this._propagate(node.id, payload);
        break;
    }
  }

  _compare(actual, expected, op) {
    switch (op) {
      case '>': return actual > expected;
      case '>=': return actual >= expected;
      case '<': return actual < expected;
      case '<=': return actual <= expected;
      case '==': return actual == expected; // intentional loose compare for editor data
      case '===': return actual === expected;
      case '!=': return actual != expected;
      case '!==': return actual !== expected;
      default: return false;
    }
  }

  _incoming(nodeId) {
    return this.links.filter(l => l.to === nodeId && l.enabled !== false);
  }

  _outgoing(nodeId) {
    return this.links.filter(l => l.from === nodeId && l.enabled !== false);
  }

  _propagate(nodeId, payload) {
    for (const link of this._outgoing(nodeId)) {
      const next = this.nodes.get(link.to);
      if (!next) continue;
      this._receive(next, { ...payload, via: link.id || `${link.from}->${link.to}` }, nodeId);
    }
  }
}
