// DominoEditor V22.1 Mechanism Entity System
// Converts mechanism definitions into editor-ready physics entities.

export const MechanismEntitySystem = {
  create(type, options = {}) {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      type,
      enabled: true,
      position: options.position || { x: 0, y: 0 },
      rotation: options.rotation || 0,
      physics: {
        active: true,
        ...options.physics
      },
      blueprint: {
        inputs: [],
        outputs: []
      }
    };
  },

  supportedTypes() {
    return [
      'spring',
      'piston',
      'gear',
      'pulley',
      'magnet',
      'wind',
      'water',
      'ice'
    ];
  }
};
