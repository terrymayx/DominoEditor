// DominoEditor V21.0 Professional Domino Path Tool

export class DominoPathTool {
  constructor(options = {}) {
    this.spacing = options.spacing || 34;
  }

  line(start, end) {
    return this.interpolate(start, end);
  }

  interpolate(start, end) {
    const points = [];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const count = Math.max(1, Math.floor(distance / this.spacing));

    for (let i = 0; i <= count; i++) {
      const t = i / count;
      points.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        angle: Math.atan2(end.y - start.y, end.x - start.x)
      });
    }
    return points;
  }

  createDominoes(points, material = 'wood') {
    return points.map(p => ({
      type:'domino',
      x:p.x,
      y:p.y,
      rotation:p.angle,
      material
    }));
  }
}

export default DominoPathTool;
