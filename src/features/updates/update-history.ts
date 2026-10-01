export const updateAreas = ['화면·사용성','자료 등록','행사·탐색','가입·로그인','커뮤니티','운영·관리','개발·문서'] as const;
export type UpdateEntry = { id:string; commit:string; committedAt:string; area:typeof updateAreas[number]; title:string; details:string[]; status:'deployed'|'development' };
export type UpdateHistory = { schemaVersion:1; repository:'tryeverything7321/won-archive-weave'; generatedAt:string; entries:UpdateEntry[] };
export function parseUpdateHistory(value:unknown):UpdateHistory {
  if(!value || typeof value!=='object')throw Error('업데이트 기록을 읽지 못했어요');
  const data=value as Record<string,unknown>;
  if(data.schemaVersion!==1 || data.repository!=='tryeverything7321/won-archive-weave' || typeof data.generatedAt!=='string' || !Number.isFinite(Date.parse(data.generatedAt)) || !Array.isArray(data.entries) || data.entries.length>5000)throw Error('업데이트 기록 형식을 확인해 주세요');
  const ids=new Set<string>();
  const entries=data.entries.map((raw:unknown)=>{
    if(!raw || typeof raw!=='object')throw Error('업데이트 항목을 확인해 주세요');
    const row=raw as Record<string,unknown>;
    if(typeof row.id!=='string'||ids.has(row.id)||typeof row.commit!=='string'||!/^[a-f0-9]{40}$/.test(row.commit)||typeof row.committedAt!=='string'||!Number.isFinite(Date.parse(row.committedAt))||!updateAreas.includes(row.area as UpdateEntry['area'])||typeof row.title!=='string'||!row.title.trim()||row.title.length>160||!Array.isArray(row.details)||row.details.length>8||!row.details.every(v=>typeof v==='string'&&v.length<=600)||(row.status!=='deployed'&&row.status!=='development'))throw Error('업데이트 항목을 확인해 주세요');
    ids.add(row.id);
    return {id:row.id,commit:row.commit,committedAt:row.committedAt,area:row.area,title:row.title,details:row.details,status:row.status} as UpdateEntry;
  }).sort((a,b)=>Date.parse(b.committedAt)-Date.parse(a.committedAt)||a.id.localeCompare(b.id));
  return {schemaVersion:1,repository:'tryeverything7321/won-archive-weave',generatedAt:data.generatedAt,entries};
}
export function updateDay(iso:string) { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso)); }
export function updateTime(iso:string) { return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)); }
export function filterUpdates(entries:UpdateEntry[],area:string,keyword:string,date:string,status:string){
 const query=keyword.trim().toLocaleLowerCase('ko-KR');
 return entries.filter(item=>(area==='전체'||item.area===area)&&(!date||updateDay(item.committedAt)===date)&&(status==='all'||item.status===status)&&(!query||[item.title,...item.details].join(' ').toLocaleLowerCase('ko-KR').includes(query)));
}
