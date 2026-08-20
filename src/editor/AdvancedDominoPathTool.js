// V21.1 Advanced Domino Path Tool
// Supports bezier, circle, spiral and branch path generation

export class AdvancedDominoPathTool {
  constructor(options={}) {
    this.spacing = options.spacing || 36;
  }

  generateLine(start,end){
    return this.interpolate(start,end);
  }

  generateBezier(p0,p1,p2,p3){
    const points=[];
    for(let t=0;t<=1;t+=0.02){
      const x=Math.pow(1-t,3)*p0.x+3*Math.pow(1-t,2)*t*p1.x+3*(1-t)*t*t*p2.x+t*t*t*p3.x;
      const y=Math.pow(1-t,3)*p0.y+3*Math.pow(1-t,2)*t*p1.y+3*(1-t)*t*t*p2.y+t*t*t*p3.y;
      points.push({x,y});
    }
    return this.sample(points);
  }

  generateCircle(cx,cy,r){
    const points=[];
    const count=Math.max(12,Math.floor((Math.PI*2*r)/this.spacing));
    for(let i=0;i<count;i++){
      const a=i/count*Math.PI*2;
      points.push({x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r});
    }
    return points;
  }

  generateSpiral(cx,cy,r){
    const points=[];
    for(let a=0;a<Math.PI*4;a+=0.08){
      const rr=r*a/(Math.PI*4);
      points.push({x:cx+Math.cos(a)*rr,y:cy+Math.sin(a)*rr});
    }
    return this.sample(points);
  }

  interpolate(a,b){
    const d=Math.hypot(b.x-a.x,b.y-a.y);
    const count=Math.max(1,Math.floor(d/this.spacing));
    return Array.from({length:count+1},(_,i)=>({
      x:a.x+(b.x-a.x)*i/count,
      y:a.y+(b.y-a.y)*i/count
    }));
  }

  sample(points){
    const out=[];
    let last=null;
    for(const p of points){
      if(!last||Math.hypot(p.x-last.x,p.y-last.y)>=this.spacing){
        out.push(p);last=p;
      }
    }
    return out;
  }
}
