import { contextForStroke } from "./arrow-evidence.mjs";
import { polyline } from './check-shapes.mjs';
const shaft = [{x:0,y:0},{x:200,y:0}];
const head = [{x:176,y:-16},{x:200,y:0},{x:176,y:16}];
const circle = Array.from({length:61},(_,i)=>({x:200+15*Math.cos(i/60*Math.PI*2),y:15*Math.sin(i/60*Math.PI*2)}));
const cases = [
  {name:'single shaft slash', expected:'delete_arrow', points:polyline([[100,-20],[100,20]]), contextStrokes:[shaft]},
  {name:'tiny body scribble', expected:'delete_arrow', points:polyline([[95,-5],[105,5],[95,3]]), contextStrokes:[shaft]},
  {name:'existing head slash', expected:'delete_head', points:polyline([[198,-30],[198,30]]), contextStrokes:[shaft,head]},
  {name:'closed circle at bare tip', expected:'keep', points:circle, contextStrokes:[shaft]},
  {name:'parallel stroke beside shaft', expected:'keep', points:polyline([[50,20],[150,20]]), contextStrokes:[shaft]},
  {name:'broad scratching over objects', expected:'scratch', points:polyline([[0,-20],[200,-10],[0,0],[200,10],[0,20]]), contextStrokes:[shaft]},
];
for(const c of cases){
  const response=await fetch('http://127.0.0.1:5178/api/recognize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points:c.points,...contextForStroke(c.points,c.contextStrokes)})});
  const r=await response.json();
  const scratch=c.expected==='scratch' ? await (await fetch('http://127.0.0.1:5178/api/recognize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points:c.points})})).json() : null;
  const observed=r.connectorEditProbability>=(r.connectorEdit?.startsWith('add_')?0.6:r.connectorEdit==='delete_arrow'?0.65:0.85)?r.connectorEdit:'keep', passed=c.expected==='scratch'?scratch.scratchOutProbability>=0.85 && observed==='delete_arrow':observed===c.expected;
  console.log(JSON.stringify({name:c.name,expected:c.expected,observed,probability:r.connectorEditProbability,scratch:scratch?.scratchOutProbability,passed,error:r.error}));
  if(!passed)process.exitCode=1;
}
