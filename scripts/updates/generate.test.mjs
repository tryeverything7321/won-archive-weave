import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {commitNotes,generate} from './generate.mjs';
test('curated copy and explicit public trailers take precedence over raw commit titles',()=>{
 const curated=[{title:'파일 등록 개선',area:'자료 등록',details:['다시 시도할 수 있어요']}];
 assert.deepEqual(commitNotes('internal',[],curated),curated);
 assert.deepEqual(commitNotes('feat: change\n\nUpdate-Title: 쉽게 올려요\nUpdate-Area: 자료 등록\nUpdate-Note: 파일부터 선택해요',['src/features/community/test.ts']),[{title:'쉽게 올려요',area:'자료 등록',details:['파일부터 선택해요']}]);
 assert.equal(commitNotes('fix: layout',['src/styles.css'])[0].area,'화면·사용성');
});
test('generator excludes its own commits, preserves real timestamps and never marks a newer commit deployed',()=>{
 mkdirSync('work',{recursive:true});const root=mkdtempSync(resolve('work/updates-test-'));const repo=join(root,'repo');mkdirSync(repo);
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
 try{
  git('init','-b','main');git('config','user.name','Synthetic test');git('config','user.email','synthetic@example.invalid');git('remote','add','origin','https://github.com/tryeverything7321/won-archive-weave.git');
  writeFileSync(join(repo,'one.txt'),'one');git('add','.');git('commit','-m','feat: first');const deployed=git('rev-parse','HEAD');const date=git('show','-s','--format=%cI','HEAD');
  writeFileSync(join(repo,'one.txt'),'two');git('add','.');git('commit','-m','fix: next');
  writeFileSync(join(repo,'one.txt'),'three');git('add','.');git('commit','-m','chore(updates): refresh public history');
  writeFileSync(join(repo,'one.txt'),'four');git('add','.');git('commit','-m','chore(updates): verify classification auth guard');
  const notesPath=join(root,'notes.json');writeFileSync(notesPath,JSON.stringify({deployedThrough:deployed,commits:{}}));
  const result=generate({repo,notesPath,out:join(root,'out.json')});assert.equal(result.entries.length,2);assert.equal(result.entries[0].status,'development');assert.equal(result.entries[1].status,'deployed');assert.equal(result.entries[1].committedAt,date);
  git('remote','set-url','origin','https://github.com/private/unrelated.git');assert.throws(()=>generate({repo,notesPath,out:join(root,'bad.json')}),/Only the public Weave/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
