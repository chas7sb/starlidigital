export const tileSize=256;
export function mapPoint(latitude:number,longitude:number,zoom:number){const size=tileSize*2**zoom,lat=Math.max(-85.05112878,Math.min(85.05112878,latitude))*Math.PI/180;return{x:(longitude+180)/360*size,y:(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*size};}
export function mapCoordinate(x:number,y:number,zoom:number){const size=tileSize*2**zoom,n=Math.PI-2*Math.PI*y/size;return{latitude:Math.atan(Math.sinh(n))*180/Math.PI,longitude:((x/size*360)%360+360)%360-180};}
export function wrappedDelta(x:number,center:number,zoom:number){const size=tileSize*2**zoom;return ((x-center+size/2)%size+size)%size-size/2;}

export const standardTileURL=(zoom:number,x:number,y:number)=>'https://tile.openstreetmap.org/'+zoom+'/'+x+'/'+y+'.png';
