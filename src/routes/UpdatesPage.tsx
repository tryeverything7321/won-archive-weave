import { useEffect, useMemo, useState } from 'react';
import { History, Search, GitCommitHorizontal, RefreshCw } from 'lucide-react';
import { parseUpdateHistory, filterUpdates, updateAreas, updateDay, updateTime, type UpdateHistory } from '../features/updates/update-history';
import styles from '../features/updates/Updates.module.css';
const remoteUrl='https://raw.githubusercontent.com/tryeverything7321/won-archive-weave/main/public/updates.json';
export function UpdatesPage(){
 const [history,setHistory]=useState<UpdateHistory|null>(null);
 const [state,setState]=useState<'loading'|'ready'|'cached'|'error'>('loading');
 const [retry,setRetry]=useState(0);
 const [area,setArea]=useState('전체'),[keyword,setKeyword]=useState(''),[date,setDate]=useState(''),[status,setStatus]=useState('all'),[limit,setLimit]=useState(30);
 useEffect(()=>{
  let active=true;
  const controller=new AbortController();
  const read=async(url:string)=>{const response=await fetch(url,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});if(!response.ok)throw Error('Unavailable');const text=await response.text();if(text.length>4_000_000)throw Error('Oversized');return parseUpdateHistory(JSON.parse(text));};
  void (async()=>{
   let cached:UpdateHistory|null=null;
   try{cached=await read('/updates.json');if(active)setHistory(cached);}catch{/* Try the current published feed. */}
   try{const latest=await read(remoteUrl);if(active){setHistory(cached&&Date.parse(cached.generatedAt)>Date.parse(latest.generatedAt)?cached:latest);setState('ready');}}
   catch{if(active)setState(cached?'cached':'error');}
  })();
  return ()=>{active=false;controller.abort();};
 },[retry]);
 const filtered=useMemo(()=>filterUpdates(history?.entries??[],area,keyword,date,status),[history,area,keyword,date,status]);
 const groups=new Map<string,typeof filtered>();
 for(const entry of filtered.slice(0,limit)){const key=updateDay(entry.committedAt);groups.set(key,[...(groups.get(key)??[]),entry]);}
 const reset=()=>{setArea('전체');setKeyword('');setDate('');setStatus('all');setLimit(30);};
 return <section className={`${styles.page} section-frame`}>
  <header className={styles.heading}><span><History size={20} aria-hidden="true" />함께 다듬는 위브</span><h1>업데이트 소식</h1><p>새로 생긴 기능과 더 편해진 점을 날짜별로 모았어요.</p></header>
  <div className={styles.filters}>
   <label className={styles.search}><Search size={18} aria-hidden="true" /><span className="sr-only">업데이트 검색</span><input type="search" value={keyword} placeholder="파일 업로드, 로그인, 행사…" onChange={e=>{setKeyword(e.target.value);setLimit(30);}} /></label>
   <label>날짜<input type="date" value={date} onChange={e=>{setDate(e.target.value);setLimit(30);}} /></label>
   <label>반영 상태<select value={status} onChange={e=>{setStatus(e.target.value);setLimit(30);}}><option value="all">전체 기록</option><option value="deployed">반영 완료</option><option value="development">개발 기록</option></select></label>
   <div className={styles.areas} role="group" aria-label="기능별 업데이트">{['전체',...updateAreas].map(label=><button type="button" key={label} aria-pressed={area===label} onClick={()=>{setArea(label);setLimit(30);}}>{label}</button>)}</div>
  </div>
  <div className={styles.summary}><p aria-live="polite">{history?`${filtered.length}개의 변경 소식`:'업데이트 기록을 불러오고 있어요'}</p><button type="button" onClick={reset}>조건 초기화</button></div>
  <p className={styles.note}>날짜·시간은 한국 시간의 변경 기록 기준입니다. ‘개발 기록’은 아직 서비스 반영이 확인되지 않은 변경입니다.</p>
  {(state==='cached'||state==='error')&&<div className={styles.notice} role="status"><p>{state==='cached'?'새 기록을 확인하지 못해 마지막으로 저장된 내용을 보여드려요.':'업데이트 기록을 불러오지 못했어요.'}</p><button type="button" onClick={()=>setRetry(n=>n+1)}><RefreshCw size={16} aria-hidden="true" />다시 확인</button></div>}
  {history&&filtered.length===0&&<div className={styles.empty}><h2>조건에 맞는 소식이 없어요</h2><p>검색어나 날짜를 바꾸거나 조건을 초기화해 보세요.</p></div>}
  {[...groups].map(([day,entries])=><section className={styles.day} aria-labelledby={`updates-${day}`} key={day}><h2 id={`updates-${day}`}>{day.replaceAll('-','. ')}</h2><ol className={styles.timeline}>{entries.map(entry=><li key={entry.id}><time dateTime={entry.committedAt}>{updateTime(entry.committedAt)}</time><article className={styles.card}><div className={styles.tags}><span>{entry.area}</span><span className={entry.status==='deployed'?styles.deployed:styles.development}>{entry.status==='deployed'?'반영 완료':'개발 기록'}</span></div><h3>{entry.title}</h3>{entry.details.length>0&&<ul>{entry.details.map((detail,i)=><li key={i}>{detail}</li>)}</ul>}<a href={`https://github.com/tryeverything7321/won-archive-weave/commit/${entry.commit}`} target="_blank" rel="noopener noreferrer" aria-label={`${entry.title} 코드 변경 기록 새 창에서 보기`}><GitCommitHorizontal size={16} aria-hidden="true" />변경 기록</a></article></li>)}</ol></section>)}
  {filtered.length>limit&&<button className={styles.more} type="button" onClick={()=>setLimit(n=>n+30)}>이전 소식 더 보기</button>}
 </section>;
}
