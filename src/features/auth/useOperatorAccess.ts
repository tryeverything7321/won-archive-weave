import { useEffect, useMemo, useState } from 'react';
import { getIdTokenResult, onAuthStateChanged } from 'firebase/auth';
import { getFirebaseServices } from '../../lib/firebase/client';

export type OperatorAccess = {
  state: 'checking' | 'signed-out' | 'allowed' | 'denied' | 'error';
  memberRead: boolean;
};

export function useOperatorAccess(): OperatorAccess {
  const services = useMemo(() => getFirebaseServices(), []);
  const [access, setAccess] = useState<OperatorAccess>({ state: services ? 'checking' : 'denied', memberRead: false });
  useEffect(() => {
    if (!services) return;
    let generation = 0;
    const unsubscribe = onAuthStateChanged(services.auth, user => {
      const request = ++generation;
      if (!user) { setAccess({ state: 'signed-out', memberRead: false }); return; }
      setAccess({ state: 'checking', memberRead: false });
      void getIdTokenResult(user, true).then(({ claims }) => {
        if (request !== generation) return;
        const operator = claims.role === 'administrator' || claims.role === 'moderator';
        setAccess({ state: operator ? 'allowed' : 'denied', memberRead: claims.role === 'administrator' && claims.memberRead === true });
      }).catch(() => {
        if (request === generation) setAccess({ state: 'error', memberRead: false });
      });
    });
    return () => { ++generation; unsubscribe(); };
  }, [services]);
  return access;
}
