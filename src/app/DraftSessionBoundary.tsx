import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { getFirebaseServices } from '../lib/firebase/client';
import { browserDraftStore } from '../features/drafts/draft-store';
import { bindDraftAuthSession } from './draft-session';

export function DraftSessionBoundary() {
  useEffect(() => {
    const services = getFirebaseServices();
    if (!services) return;
    return bindDraftAuthSession(
      callback => onAuthStateChanged(services.auth, callback),
      browserDraftStore(),
    );
  }, []);
  return null;
}
