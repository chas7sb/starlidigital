<script lang="ts">
 import type {Panel,PanelHost} from './index.mjs';
 export let panel:Panel;export let host:PanelHost;
 let selected='';
 $: workbook=(panel.data||{}) as any;
 $: order=Array.isArray(workbook.sheetOrder)?workbook.sheetOrder:[];
 $: if(!order.includes(selected))selected=order[0]||'';
 $: sheet=workbook.sheets?.[selected];
 $: rowIndexes=Object.keys(sheet?.cellData||{}).map(Number).filter(Number.isInteger).sort((a,b)=>a-b).slice(0,100);
 $: columns=[...new Set<number>(rowIndexes.flatMap(row=>Object.keys(sheet?.cellData?.[row]||{}).map(Number)))].sort((a,b)=>a-b).slice(0,20);
 function columnLabel(index:number){let label='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))label=String.fromCharCode(65+(n-1)%26)+label;return label;}
 function content(row:number,col:number){const cell=sheet?.cellData?.[row]?.[col];return (cell?.f||cell?.v)??'';}
</script>
<div class="space-y-3">
 <div class="flex items-center justify-between gap-3"><label class="text-sm">Worksheet <select class="ml-2 rounded-lg border border-gray-200 bg-transparent px-2 py-1 dark:border-gray-700" bind:value={selected}>{#each order as id}<option value={id}>{workbook.sheets?.[id]?.name||id}</option>{/each}</select></label><button class="rounded-lg px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800" on:click={()=>host.setMode(panel.key,'expanded')}>Expand preview</button></div>
 <p class="text-xs leading-5 text-gray-500">Stored values and formulas are shown below. This preview does not recalculate formulas. Editing requires the verified Sheets editor.</p>
 {#if rowIndexes.length&&columns.length}<div class="overflow-auto rounded-xl border border-gray-200 dark:border-gray-800"><table class="w-full border-collapse text-left text-sm"><caption class="sr-only">{sheet?.name||'Worksheet'} stored cells</caption><thead class="bg-gray-50 dark:bg-gray-800"><tr><th scope="col" class="px-3 py-2">Row</th>{#each columns as col}<th scope="col" class="px-3 py-2">{columnLabel(col)}</th>{/each}</tr></thead><tbody>{#each rowIndexes as row}<tr class="border-t border-gray-100 dark:border-gray-800"><th scope="row" class="px-3 py-2 font-normal text-gray-500">{row+1}</th>{#each columns as col}<td class="max-w-xs truncate border-l border-gray-100 px-3 py-2 dark:border-gray-800" title={String(content(row,col))}>{content(row,col)}</td>{/each}</tr>{/each}</tbody></table></div>{:else}<p class="py-6 text-center text-sm text-gray-500">No stored cells in this worksheet.</p>{/if}
 <p class="text-xs text-gray-500">Preview limited to 100 stored rows and 20 columns.</p>
</div>
