import {useState} from "react";
import {Link} from "react-router-dom";
import {httpsCallable} from "firebase/functions";
import {Pencil,Trash2} from "lucide-react";
import {getFirebaseServices} from "../../lib/firebase/client";
import {callableWriteErrorMessage} from "../../lib/firebase/callable-write-error";
import {withdrawMaterialBundleFile} from "../bundles/bundle-api";
import styles from "./EventArchive.module.css";

export function ResourceActions({id,type,fileId,onDeleted}:{id:string;type:"bundle"|"collection";fileId?:string;onDeleted:()=>void}){
 const [working,setWorking]=useState(false),[error,setError]=useState("");
 const remove=async()=>{
  if(!window.confirm(fileId?"이 파일을 삭제할까요? 다른 파일은 유지됩니다.":"이 자료를 삭제할까요? 목록과 연결된 화면에서 공개가 중단됩니다."))return;
  setWorking(true);setError("");
  try{
   if(fileId)await withdrawMaterialBundleFile(id,fileId);
   else{const services=getFirebaseServices();if(!services)throw Error("not configured");await httpsCallable(services.functions,"withdrawArchiveResource")({targetType:type,targetId:id})}
   onDeleted();
  }catch(e){setError(callableWriteErrorMessage(e,"자료·기록"))}finally{setWorking(false)}
 };
 return <div className={styles.rowActions}><Link aria-label="자료 수정" to={type==="bundle"?`/profile?tab=activity&bundleId=${encodeURIComponent(id)}`:`/collections/${encodeURIComponent(id)}/edit`}><Pencil size={16}/>수정</Link><button type="button" disabled={working} onClick={()=>void remove()} aria-label="자료 삭제"><Trash2 size={16}/>삭제</button>{error&&<span role="alert">{error}</span>}</div>
}
