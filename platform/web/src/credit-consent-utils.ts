export type CreditCosts={enabled:boolean;build:number;edit:number;images:number;research:number};
export type CreditAction='build'|'edit'|'images'|'research';
export function creditActionCost(costs:CreditCosts,action:CreditAction,hasFiles=false,regenerateImages=false){
 const base=action==='build'?(hasFiles?costs.edit:costs.build):costs[action];
 const surcharge=(action==='build'||action==='edit')&&regenerateImages?costs.images:0;
 if(![base,surcharge].every(value=>Number.isSafeInteger(value)&&value>=0))throw new Error('Could not verify the operation cost. Please try again.');
 const total=base+surcharge;
 if(!Number.isSafeInteger(total)||total<0)throw new Error('Could not verify the operation cost. Please try again.');
 return total;
}
