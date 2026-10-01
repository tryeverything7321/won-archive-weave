import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const sha=process.argv[2];
if(!sha || !/^[a-f0-9]{40}$/.test(sha))throw Error('Pass the verified deployed commit SHA (40 characters)');
execFileSync('git',['cat-file','-e',`${sha}^{commit}`]);
const path='content/update-notes.json';
const notes=JSON.parse(readFileSync(path,'utf8'));notes.deployedThrough=sha;
writeFileSync(path,JSON.stringify(notes,null,2)+'\n');
console.log('Recorded the verified deployment boundary. Commit and push content/update-notes.json.');
