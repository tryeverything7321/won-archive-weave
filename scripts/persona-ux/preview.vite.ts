import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'

// Isolated local verification: no env files, credentials, or provider connections.
const require = createRequire(import.meta.url)
const prefix = '\0weave-test:'
const real = (name: string) => JSON.stringify(require.resolve(name).replace(/index\.cjs\.js$/, 'index.mjs'))
const modules: Record<string, string> = {
  state: `
export const state = window.__weaveTest ||= {
 user: {uid:'synthetic-a',getIdToken:async()=> 'synthetic-token',getIdTokenResult:async()=>({claims:{role:'administrator',memberRead:true,memberPrivateRead:true}})},
 listeners:[], calls:[], posts:[{body:'처음 모임을 준비하는 분께 어떤 자료가 도움이 될까요?',purpose:'질문',pseudonym:'합성 참여자',commentCount:0}], materials:['pdf','pptx','csv'].map((format,i)=>({id:'synthetic-material-'+i,title:['모임 준비 안내서','활동 소개 발표 자료','참가 준비 체크표'][i],description:'합성 화면 검증 자료',status:'published',visibility:'public',sourceMode:'upload',attachmentStatus:'clean',approvedStoragePath:'synthetic/document.'+format,rights:{redistribution:'view_only'}})), activities:[], photo:'none', profile:'ready', photoDelay:0, profileDelay:0,
 authOutcome:'popup_closed', googleStatus:200, eventsDelay:0, deleted: false,
 switchUser(uid){ this.user=uid?{uid,getIdToken:async()=> 'synthetic-token',getIdTokenResult:async()=>({claims:{role:'administrator',memberRead:true,memberPrivateRead:true}})}:null; this.listeners.forEach(f=>f(this.user)); },
};
export const sleep = ms=>new Promise(r=>setTimeout(r,ms));
export const services={auth:{get currentUser(){return state.user}},firestore:{},functions:{},storage:{}};
`,
  client: `export { services } from 'weave-test:state'; import {services} from 'weave-test:state'; export const getFirebaseServices=()=>services; export const isFirebaseConfigured=true; export const isOAuthConfigured=true;`,
  auth: `export * from ${real('firebase/auth')}; import {state} from 'weave-test:state';
export function onAuthStateChanged(auth,cb){state.listeners.push(cb); queueMicrotask(()=>cb(state.user));return ()=>{state.listeners=state.listeners.filter(f=>f!==cb)}}
export async function getIdTokenResult(user){return user.getIdTokenResult()}
export async function signOut(){state.switchUser(null)}
export async function signInWithPopup(){if(state.googleLoginOutcome==='cancelled')throw Object.assign(new Error('cancelled'),{code:'auth/popup-closed-by-user'});state.switchUser('synthetic-google');return {user:state.user}}
`,
  firestore: `export * from ${real('firebase/firestore')}; import {state} from 'weave-test:state';
export const collection=(db,...parts)=>({path:parts.join('/')}); export const doc=collection;
export const query=(source,...constraints)=>({...source,constraints});
export const where=(...x)=>x; export const orderBy=(...x)=>x; export const limit=(...x)=>x; export const startAfter=(...x)=>x;
const account={pseudonym:'검증 사용자',provider:'kakao',connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20',onboardingVersion:'1'};
const snapshot={exists:()=>true,data:()=>({...account,requiredProfileVersion:state.registrationComplete===false?undefined:'2026-10-01'}),docs:[],size:0,empty:true};
const materialSnapshot=value=>({exists:()=>Boolean(value),id:value?.id,data:()=>value,get:key=>value?.[key]});
export async function getDoc(source){return source.path.startsWith('materials/')?materialSnapshot(state.materials.find(item=>item.id===source.path.split('/')[1])):source.path.startsWith('activities/')?materialSnapshot(state.activities.find(item=>item.slug===source.path.split('/')[1]||item.id===source.path.split('/')[1])):snapshot}
export async function getDocs(source){const values=source.path==='materials'?state.materials:source.path==='activities'?state.activities:[];const docs=values.map(materialSnapshot);return {...snapshot,docs,size:docs.length,empty:!docs.length}}
export const getDocFromServer=getDoc; export const getDocsFromServer=getDocs;
export function onSnapshot(...args){const callbacks=args.filter(x=>typeof x==='function');const cb=callbacks[0];const path=args[0]?.path;if(state.snapshotErrors?.includes(path)){queueMicrotask(()=>callbacks[1]?.(new Error('synthetic read failure')));return ()=>{}}const docs=state.snapshotRows?.[path]?.map(materialSnapshot)??(path==='communityPosts'?state.posts.map((p,i)=>({id:'synthetic-post-'+i,data:()=>({...p,createdAt:{toMillis:()=>1}})})):[]);queueMicrotask(()=>cb({...snapshot,docs,size:docs.length,empty:!docs.length}));return ()=>{}}
`,
  functions: `import {adminFixture} from '/scripts/persona-ux/admin-fixtures.mjs'; export * from ${real('firebase/functions')}; import {state,sleep} from 'weave-test:state';
export function httpsCallable(_functions,name){return async(input)=>{
 state.calls.push({name,input});
 if(state.callableResponses?.[name])return {data:await state.callableResponses[name](input)};
 const adminData=await adminFixture(name,input);if(adminData!==undefined)return {data:adminData};
 if(name==='getMyMemberProfile'){
  const mode=state.profile, uid=state.user?.uid; await sleep(state.profileDelay);
  if(mode==='denied')throw Object.assign(new Error('synthetic'),{code:'functions/permission-denied'});
  if(mode==='network')throw Object.assign(new Error('synthetic'),{code:'functions/unavailable'});
  if(mode==='malformed')return {data:{profile:'invalid'}};
  return {data:{profile:state.savedProfile??(mode==='empty'?{}:{bio:'합성 프로필 '+uid,region:'서울',organization:'검증 모임',realName:'시험 사용자'})}};
 }
 if(name==='updateMyMemberProfile'){state.savedProfile=input;state.registrationComplete=true;return {data:{profile:input}};}
 if(name==='getCommunityPostOwnership')return {data:{postIds:[],comments:[],hiddenPostIds:[],hiddenComments:[],canManageAll:false}};
 if(name==='submitSelectedGoogleCalendarEvents')return {data:{status:'published',submitted:input.events.length,duplicates:0,failed:0,results:input.events.map((_,index)=>({index,status:'published'}))}};
 if(name==='listOwnedEvents')return {data:{events:[]}};
 if(name==='listMySubmissions')return {data:{submissions:[],hasMore:false,limit:100}};
 if(name==='getMySubmissionManagement')return {data:{submissions:[]}};
 if(name==='getCommunityOwnership')return {data:{postIds:[],comments:[],hiddenPostIds:[],hiddenComments:[],canManageAll:false}};
 if(name==='listMyCommunityCases')return {data:{reports:[],appeals:[],blockedAuthors:[],moderatedPosts:[],moderationNotices:[]}};
 return {data:{postIds:[],hiddenPostIds:[],reports:[],appeals:[],blocks:[],items:[],submitted:0,duplicates:0}};
}}
`,
  storage: `export * from ${real('firebase/storage')}; import {state,sleep} from 'weave-test:state';
export const ref=(_storage,path)=>({path});
export async function listAll(){const mode=state.photo; await sleep(state.photoDelay); if(mode==='error')throw Object.assign(new Error('synthetic'),{code:'storage/unknown'});return {items:mode==='none'?[]:[{name:'avatar'}]}}
export async function getBlob(){const mode=state.photo; await sleep(state.photoDelay); if(mode==='error')throw Object.assign(new Error('synthetic'),{code:'storage/unknown'});if(mode==='denied')throw Object.assign(new Error('synthetic'),{code:'storage/unauthorized'});if(mode==='none')throw Object.assign(new Error('synthetic'),{code:'storage/object-not-found'});return new Blob(['synthetic'],{type:'image/png'})}
export async function uploadBytes(){return {}} export async function deleteObject(){}
`,
  calendar: `import {state,sleep} from 'weave-test:state';
function items(month){const params=new URLSearchParams(location.search);const requested=Number(params.get('upcomingCount'));const scenario=requested>=1&&requested<=3;if(scenario&&month!=='2026-10')return [];const count=scenario?requested:8;return Array.from({length:count},(_,i)=>({id:'synthetic-event-'+i,title:'합성 행사 '+i,summary:'탐색 복원 검증',description:'운영 데이터가 아닌 합성 일정입니다.',organizerName:i%2?'검증 모임':'서울 모임',region:i%2?'부산':'서울',locationName:'검증 장소',startAt:new Date(month+'-'+String(i+10).padStart(2,'0')+'T10:00:00+09:00'),endAt:new Date(month+'-'+String(i+10).padStart(2,'0')+'T12:00:00+09:00'),allDay:false,timeZone:'Asia/Seoul',visibility:'public',eventState:'confirmed',sourceType:'manual',origin:'published',registrationStatus:'not_required',...(params.get('upcomingPhoto')==='1'&&i===0?{thumbnail:{url:location.origin+'/src/features/landing/assets/home-calendar-v1.webp',alt:'합성 행사 대표 이미지',displayMode:'cover'}}:{})})).filter(event=>event.id!==state.deletedEventId)}
export const firestoreCalendarRepository={async listMonth(options){state.calendarCalls=(state.calendarCalls??0)+1;if(state.calendarResponse)return state.calendarResponse(options);await sleep(state.eventsDelay);if(state.paginationFailure){if(options.cursor)throw new Error('synthetic-page-unavailable');return {items:items(options.monthKey).slice(0,2),nextCursor:{id:'synthetic-page'},hasMore:true}}return {items:items(options.monthKey),nextCursor:null,hasMore:false}},async getVisibleEvent(id){if(state.deleted)return undefined;const found=items('2026-10').find(e=>e.id===id);return found?{...found,...state.eventExtras}:undefined}};
`,
  'entry.tsx': `
import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,Link} from 'react-router-dom';
import {AuthCompletePage} from '/src/features/auth/AuthCompletePage.tsx';
import {AdminPage} from '/src/routes/AdminPages.tsx';
import {AdminAccessGuard} from '/src/features/auth/AdminAccessGuard.tsx';
import {SiteLayout} from '/src/app/SiteLayout.tsx';
import {ArchivePage,ActivityPage as ActivityDetailPage} from '/src/routes/ArchivePages.tsx';
import {HomePage} from '/src/routes/HomePage.tsx';
import {AboutPage} from '/src/routes/InformationPages.tsx';
import {PolicyPage} from '/src/routes/PolicyPage.tsx';
import {ResourcesPage} from '/src/routes/ResourcesPage.tsx';
import {MaterialDetailPage} from '/src/routes/MaterialDetailPage.tsx';
import {ProfilePage,ContributePage} from '/src/routes/MemberPages.tsx';
import {CommunityExperience} from '/src/features/community/CommunityExperience.tsx';
import {PostThread} from '/src/features/community/PostThread.tsx';
import {CalendarPage,CalendarEventPage,CalendarEventCreatePage,CalendarConnectPage} from '/src/routes/CalendarPages.tsx';
import {GoogleCalendarImport} from '/src/features/calendar/GoogleCalendarImport.tsx';
import {MemberProfileForm} from '/src/features/profile/MemberProfileForm.tsx';
import {SubmissionManager} from '/src/features/uploads/SubmissionManager.tsx';
import {ContributionForm} from '/src/features/uploads/ContributionForm.tsx';
import {EventManager} from '/src/features/calendar/EventManager.tsx';
import {CalendarImportChanges} from '/src/features/admin/CalendarImportChanges.tsx';
import {ApprovedPdfPreview} from '/src/features/preview/ApprovedPdfPreview.tsx';
import {useFormDraft} from '/src/features/drafts/useFormDraft.ts';
import {DraftRecoveryPanel} from '/src/features/drafts/DraftRecoveryPanel.tsx';
import {state,services} from 'weave-test:state'; import '/src/styles.css';
window.google={accounts:{oauth2:{initTokenClient(options){return {requestAccessToken(){state.pendingGoogle=options;const mode=state.authOutcome;if(mode==='pending')return;if(mode==='success')options.callback({access_token:'synthetic-google-token'});else if(mode==='access_denied')options.callback({error:mode});else options.error_callback({type:mode});}}},revoke(_token,cb){cb?.()}}}};
const originalFetch=window.fetch.bind(window);window.fetch=async(input,init)=>{
 if(String(input).startsWith('https://www.googleapis.com/')){
  if(state.googleStatus==='network')throw new TypeError('synthetic-network');
  return new Response(JSON.stringify({items:String(input).includes('calendarList')?(state.googleCalendars??[{id:'synthetic-calendar',summary:'검증 캘린더',primary:true,timeZone:'Asia/Seoul'}]):(state.googleEvents??[])}),{status:state.googleStatus,headers:{'Content-Type':'application/json'}});
 }
 const url=new URL(String(input),location.href);if(url.origin!==location.origin)throw new Error('external network blocked');return originalFetch(input,init);
};
const h=React.createElement;
function Profile(){const [user,setUser]=useState(state.user);useEffect(()=>{state.listeners.push(setUser);return ()=>{state.listeners=state.listeners.filter(x=>x!==setUser)}},[]);return h('section',{className:'page-frame section-frame'},h('h1',null,'합성 프로필 검증'),h(MemberProfileForm,{user}))}
function Management(){return h('section',{className:'page-frame section-frame'},h('h1',null,'합성 관리 검증'),h(SubmissionManager,{onEdit:item=>{state.editedSubmission=item.id}}),h(EventManager,{onEdit:item=>{state.editedEvent=item.id}}),h(CalendarImportChanges,{candidateId:'synthetic-candidate'}))}
function PdfPreviewTest(){return h('main',null,h('h1',null,'합성 PDF 권한 응답 검증'),h(ApprovedPdfPreview,{materialId:'synthetic-material',title:'검증 문서'}))}
function ThreadTest(){const [user,setUser]=useState(state.user);useEffect(()=>{state.listeners.push(setUser);return()=>{state.listeners=state.listeners.filter(x=>x!==setUser)}},[]);return user?h('section',{className:'page-frame section-frame'},h(PostThread,{key:user.uid,post:{id:'synthetic-thread',body:'합성 원본 글',purpose:'생각 나눔',pseudonym:'검증 사용자',commentCount:0,createdAtMs:1},services,actorUid:user.uid,ownsPost:true,isAdministrator:false,ownershipLoading:false,ownershipUnavailable:false,topics:['나와 마음'],onBlockComplete(){}})):h('p',null,'로그인 필요')}
const draftCodec={encode:value=>({body:value.body}),decode:value=>{if(!value||typeof value.body!=='string')throw new Error('invalid');return {body:value.body}}};
function DraftTest(){const [value,setValue]=useState({body:''});const [user,setUser]=useState(state.user);useEffect(()=>{state.listeners.push(setUser);return ()=>{state.listeners=state.listeners.filter(x=>x!==setUser)}},[]);const draft=useFormDraft({identity:{ownerId:user?.uid??'signedout',kind:'synthetic',documentId:'new'},value,codec:draftCodec,onRestore:setValue});return h('section',null,h('h1',null,'초안 검증'),h(DraftRecoveryPanel,{state:draft.state,recovery:draft.recovery,onContinue:draft.continueDraft,onStartNew:draft.startNew,onDelete:draft.deleteDraft,onRetry:draft.retry}),h('label',null,'검증 본문',h('textarea',{value:value.body,onChange:e=>setValue({body:e.target.value})})),h(Link,{to:'/profile'},'다른 화면으로 이동'))}
const AdminPreview=({section})=>h(AdminAccessGuard,{members:section==='members'},h(AdminPage,{section}));
const nav=h('p',{style:{padding:'8px 24px',margin:0,fontSize:'13px',background:'#e9f6f2'}},'합성 검증 화면 · 운영 데이터와 연결되지 않음');
createRoot(document.getElementById('root')).render(h(BrowserRouter,null,h(SiteLayout,null,nav,h(Routes,null,...['home','members','audit','submissions','community','calendar'].map(section=>h(Route,{key:section,path:section==='home'?'/admin':'/admin/'+section,element:h(AdminPreview,{section})})),h(Route,{path:'/admin/members/:memberId',element:h(AdminPreview,{section:'members'})}),...[['/auth/complete',AuthCompletePage],['/',HomePage],['/about',AboutPage],['/policies/:policy',PolicyPage],['/pdf-test',PdfPreviewTest],['/archive',ArchivePage],['/resources',ResourcesPage],['/materials/:id',MaterialDetailPage],['/member-test',ProfilePage],['/activities/:slug',ActivityDetailPage],['/community',CommunityExperience],['/calendar',CalendarPage],['/calendar/new',CalendarEventCreatePage],['/calendar/connect',CalendarConnectPage],['/events/:eventId',CalendarEventPage],['/google',GoogleCalendarImport],['/profile',ProfilePage],['/management',Management],['/draft-test',DraftTest],['/contribute',ContributePage],['/thread-test',ThreadTest]].map(([path,Component])=>h(Route,{key:path,path,element:h(Component)}))))));
`,
}

export default defineConfig({
  envDir: false,
  define: { 'import.meta.env.VITE_GOOGLE_CALENDAR_CLIENT_ID': JSON.stringify('synthetic.apps.googleusercontent.com') },
  plugins: [{
    name: 'weave-local-synthetic-only',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.headers.accept?.includes('text/html')) {
          res.setHeader('Content-Type', 'text/html')
          res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weave local synthetic QA</title><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/@vite/client"></script><script type="module" src="/@id/__x00__weave-test:entry.tsx"></script></body></html>')
          return
        }
        next()
      })
    },
    resolveId(source) {
      if (source.startsWith('weave-test:')) return prefix + source.slice('weave-test:'.length)
      if (source.startsWith(prefix)) return source
      const sdk = { 'firebase/auth': 'auth', 'firebase/firestore': 'firestore', 'firebase/functions': 'functions', 'firebase/storage': 'storage' }[source]
      if (sdk) return prefix + sdk
      if (source.endsWith('/lib/firebase/client')) return prefix + 'client'
      if (source.endsWith('/firestore-calendar-repository')) return prefix + 'calendar'
      return null
    },
    load(id) { return id.startsWith(prefix) ? modules[id.slice(prefix.length)] : null },
  }, react()],
  server: { host: '127.0.0.1', port: 4193, strictPort: true },
})
