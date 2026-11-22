import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin})[Symbol.asyncIterator]();
const first=await lines.next();if(first.done)throw Error('SELECTION_REQUIRED');
const selection=JSON.parse(first.value);
const sdk=process.env.STARLI_COMPANY_PI_SDK;
if(!sdk?.startsWith('/')||sdk.split('/').includes('..'))throw Error('SDK_REQUIRED');
let input:string[]=[];
// These two company adapters register text-only physical models explicitly.
if(selection.provider==='hosted'||selection.credential?.endpointKind)input=['text'];
else{
 const {ModelRuntime}=await import(sdk+'/pi-coding-agent/dist/index.js');
 const credential=selection.credential;
 const runtime=await ModelRuntime.create({credentials:{async read(id:string){return id===selection.provider?credential:undefined;},async list(){return[{providerId:selection.provider,type:credential?.type}];},async modify(){throw Error('READ_ONLY');},async delete(){throw Error('READ_ONLY');}},modelsPath:null,modelsStore:{async read(id:string){return id===selection.provider?selection.catalogState:undefined;},async write(){throw Error('READ_ONLY');},async delete(){throw Error('READ_ONLY');}},allowModelNetwork:false,refreshOnCreate:false});
 const model=runtime.getPhysicalModel(selection.provider,selection.model);
 if(model?.id!==selection.model||model.provider!==selection.provider||!Array.isArray(model.input))throw Error('MODEL_CAPABILITY_UNAVAILABLE');
 input=model.input.filter((part:unknown)=>part==='text'||part==='image');
}
process.stdout.write(JSON.stringify({input,supportsImages:input.includes('image')})+'\n');

