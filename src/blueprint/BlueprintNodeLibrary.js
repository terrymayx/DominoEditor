// DominoEditor V23.2 Blueprint Node Library
// Factory helpers used by the visual blueprint editor.

function id(prefix='node') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export const BlueprintNodeLibrary = {
  event(event = 'collision', x = 0, y = 0) {
    return { id:id('event'), type:'event', x, y, title:`On ${event}`, params:{ event } };
  },
  delay(ms = 1000, x = 0, y = 0) {
    return { id:id('delay'), type:'delay', x, y, title:'Delay', params:{ ms } };
  },
  and(x = 0, y = 0) {
    return { id:id('and'), type:'and', x, y, title:'AND', params:{} };
  },
  or(x = 0, y = 0) {
    return { id:id('or'), type:'or', x, y, title:'OR', params:{} };
  },
  compare(key='value', op='>=', value=1, x=0, y=0) {
    return { id:id('compare'), type:'compare', x, y, title:`${key} ${op} ${value}`, params:{ key, op, value } };
  },
  counter(target=10, x=0, y=0) {
    return { id:id('counter'), type:'counter', x, y, title:`Counter ${target}`, params:{ target, step:1, reset:true } };
  },
  activate(target, x=0, y=0) {
    return { id:id('activate'), type:'activate', x, y, title:'Activate', params:{ target } };
  },
  deactivate(target, x=0, y=0) {
    return { id:id('deactivate'), type:'deactivate', x, y, title:'Deactivate', params:{ target } };
  },
  toggle(target, initial=false, x=0, y=0) {
    return { id:id('toggle'), type:'toggle', x, y, title:'Toggle', params:{ target, initial } };
  },
  emit(event='custom', x=0, y=0) {
    return { id:id('emit'), type:'emit', x, y, title:`Emit ${event}`, params:{ event } };
  },
  victory(x=0, y=0) {
    return { id:id('victory'), type:'victory', x, y, title:'Victory', params:{} };
  },
  link(from, to) {
    return { id:id('link'), from, to, enabled:true };
  },
  presetDoorAfterSwitch({ switchEvent='switch:on', doorId, delay=500 }={}) {
    const a=this.event(switchEvent,0,0), b=this.delay(delay,180,0), c=this.activate(doorId,360,0);
    return { nodes:[a,b,c], links:[this.link(a.id,b.id), this.link(b.id,c.id)] };
  },
  presetDominoGoal({ target=20 }={}) {
    const a=this.event('domino:fallen',0,0), b=this.counter(target,180,0), c=this.victory(360,0);
    return { nodes:[a,b,c], links:[this.link(a.id,b.id), this.link(b.id,c.id)] };
  }
};
