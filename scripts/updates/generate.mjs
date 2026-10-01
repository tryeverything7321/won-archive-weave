import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const repository = 'tryeverything7321/won-archive-weave';
export const areas = ['화면·사용성','자료 등록','행사·탐색','가입·로그인','커뮤니티','운영·관리','개발·문서'];
export function inferArea(files) {
  if(files.some(f=>/features\/feedback|features\/community|community\//.test(f)))return '커뮤니티';
  if(files.some(f=>/bundles|uploads|text-content/.test(f)))return '자료 등록';
  if(files.some(f=>/calendar|event-archive|archive\//.test(f)))return '행사·탐색';
  if(files.some(f=>/auth|profile/.test(f)))return '가입·로그인';
  if(files.some(f=>/admin|operations/.test(f)))return '운영·관리';
  if(files.some(f=>f.startsWith('src/')))return '화면·사용성';
  return '개발·문서';
}
export function commitNotes(message, files, curated) {
  if(curated?.length)return curated;
  const title=message.match(/^Update-Title:\s*(.+)$/m)?.[1]?.trim() || message.split('\n')[0].trim();
  const area=message.match(/^Update-Area:\s*(.+)$/m)?.[1]?.trim();
  const details=[...message.matchAll(/^Update-Note:\s*(.+)$/gm)].map(m=>m[1].trim()).slice(0,8);
  return [{title:title.slice(0,160),area:areas.includes(area)?area:inferArea(files),details:details.map(s=>s.slice(0,600))}];
}
export function generate({repo,notesPath,out}) {
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',maxBuffer:8*1024*1024}).trim();
  const remote=git('remote','get-url','origin').replace(/\.git$/,'');
  if(![`https://github.com/${repository}`,`git@github.com:${repository}`].includes(remote))throw Error('Only the public Weave publishing repository is allowed');
  const notes=JSON.parse(readFileSync(notesPath,'utf8'));
  const hashes=git('log','--first-parent','--format=%H','-500').split('\n').filter(Boolean);
  const entries=[];
  for(const hash of hashes){
    const message=git('show','-s','--format=%B',hash);
    if(message.startsWith('chore(updates): refresh public history') || message.startsWith('chore(updates): mark deployed'))continue;
    const committedAt=git('show','-s','--format=%cI',hash);
    const files=git('diff-tree','--root','--no-commit-id','--name-only','-r',hash).split('\n');
    let deployed=false;
    if(notes.deployedThrough && /^[a-f0-9]{40}$/.test(notes.deployedThrough)) {
      try{git('merge-base','--is-ancestor',hash,notes.deployedThrough);deployed=true;}catch{/* Not released yet. */}
    }
    for(const [index,note] of commitNotes(message,files,notes.commits[hash]).entries()){
      if(!areas.includes(note.area)||!note.title?.trim()||!Array.isArray(note.details))throw Error('Invalid update note for '+hash);
      entries.push({id:`${hash}-${index}`,commit:hash,committedAt,area:note.area,title:note.title.slice(0,160),details:note.details.map(s=>String(s).slice(0,600)),status:deployed?'deployed':'development'});
    }
  }
  const result={schemaVersion:1,repository,generatedAt:new Date().toISOString(),entries};
  mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2)+'\n');
  return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const argv=process.argv.slice(2);const arg=(key,fallback)=>argv.includes(key)?argv[argv.indexOf(key)+1]:fallback;
 const result=generate({repo:resolve(arg('--repo','.')),notesPath:resolve(arg('--notes','content/update-notes.json')),out:resolve(arg('--out','public/updates.json'))});
 console.log(`Generated ${result.entries.length} update entries`);
}
