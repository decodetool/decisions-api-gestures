export function polyline(vertices, steps = 30) {
  return vertices.slice(1).flatMap((end, i) => Array.from({ length: steps }, (_, j) => ({
    x: vertices[i][0] + (end[0] - vertices[i][0]) * j / steps,
    y: vertices[i][1] + (end[1] - vertices[i][1]) * j / steps,
  }))).concat([{ x: vertices.at(-1)[0], y: vertices.at(-1)[1] }]);
}
const rotate = (points, angle) => points.map(({x,y}) => ({x:x*Math.cos(angle)-y*Math.sin(angle),y:x*Math.sin(angle)+y*Math.cos(angle)}));
const rectangle = polyline([[0,0],[240,0],[240,140],[0,140],[0,0]]);
const square = polyline([[0,0],[160,0],[160,160],[0,160],[0,0]]);
export const cases = [
  { name:'rectangle', expected:'rectangle', points:rectangle },
  { name:'square', expected:'rectangle', points:square },
  { name:'rotated rectangle', expected:'rectangle', points:rotate(rectangle,0.5) },
  { name:'square starting mid-side', expected:'rectangle', points:polyline([[80,0],[160,0],[160,160],[0,160],[0,0],[80,0]]) },
  { name:'rectangle with gap', expected:'rectangle', points:polyline([[0,0],[240,0],[240,140],[0,140],[0,12]]) },
  { name:'dense rectangle', expected:'rectangle', points:polyline([[0,0],[240,0],[240,140],[0,140],[0,0]],250) },
  { name:'uneven rectangle', expected:'rectangle', points:polyline([[0,0],[200,8],[209,150],[-8,140],[3,0]]) },
  { name:'circle', expected:'circle', points:Array.from({length:121},(_,i)=>({x:100*Math.cos(i/120*Math.PI*2),y:100*Math.sin(i/120*Math.PI*2)})) },
  { name:'line', expected:'line', points:polyline([[0,0],[200,50]]) },
  { name:'curved connector', expected:'arc', points:Array.from({length:61},(_,i)=>({x:155+295*i/60,y:300-65*Math.sin(Math.PI*i/60)})) },
  { name:'one-stroke arrow disabled', expected:'none', points:polyline([[0,0],[200,0],[170,-30],[200,0],[170,30]]) },
  { name:'one-stroke double arrow disabled', expected:'none', points:polyline([[30,-30],[0,0],[30,30],[0,0],[200,0],[170,-30],[200,0],[170,30]]) },
  { name:'triangle', expected:'none', points:polyline([[0,0],[160,0],[80,140],[0,0]]) },
];
if (process.argv[1] === new URL(import.meta.url).pathname) {
  for (const sample of cases) {
    const response = await fetch('http://127.0.0.1:5178/api/recognize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points:sample.points})});
    const r=await response.json();
    console.log(JSON.stringify({sample:sample.name,expected:sample.expected,status:response.status,label:r.label,confidence:r.confidence,accepted:r.label!=='none'&&r.confidence>=0.6,latencyMs:r.latencyMs,error:r.error}));
  }
}
