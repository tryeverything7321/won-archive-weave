// Browser-only synthetic responses. Server authorization and scanner behavior are tested in emulators.
export function bundleFixture(name, input, state) {
  const store = state.bundleFixtures ??= { bundles: {}, requests: {}, sequence: 0 };
  const bundle = store.bundles[input?.bundleId];
  if (name === 'createMaterialBundle') {
    if (store.requests[input.requestId]) return store.requests[input.requestId];
    const bundleId = 'synthetic-bundle-' + (++store.sequence);
    store.bundles[bundleId] = { ...input, bundleId, ownerLabel: '합성 작성자', status: 'draft', files: [], createdAtMs: Date.now(), updatedAtMs: Date.now() };
    return store.requests[input.requestId] = { bundleId, status: 'draft' };
  }
  if (name === 'listMyMaterialBundles') return { items: Object.values(store.bundles), nextCursor: null };
  if (name === 'getMaterialBundle') {
    if (!bundle) throw new Error('synthetic bundle not found');
    return { bundle };
  }
  if (name === 'prepareMaterialBundleFiles') {
    if (!bundle) throw new Error('synthetic bundle not found');
    if (store.requests[input.requestId]) return store.requests[input.requestId];
    const files = input.files.map((descriptor) => {
      const prior = bundle.files.find(file => file.fileId === descriptor.replaceFileId);
      const fileId = prior?.fileId ?? 'synthetic-file-' + (++store.sequence);
      const revision = (prior?.revision ?? 0) + 1;
      const targetName = revision + '-' + descriptor.name;
      const storagePath = `quarantined/${state.user.uid}/material-bundles/${bundle.bundleId}/${fileId}/${targetName}`;
      const row = { ...descriptor, fileId, revision, originalName: descriptor.name, sizeBytes: descriptor.size, status: 'upload_pending', scanStatus: 'pending', storagePath };
      if (prior) Object.assign(prior, row); else bundle.files.push(row);
      return { clientFileId: descriptor.clientFileId, fileId, revision, targetName, storagePath, sha256: descriptor.sha256 };
    });
    return store.requests[input.requestId] = { bundleId: bundle.bundleId, reservationId: 'synthetic-reservation-' + (++store.sequence), expiresAtMs: Date.now() + 900000, files };
  }
  if (name === 'finalizeMaterialBundle') { bundle.status = 'active'; return { bundleId: bundle.bundleId, status: 'active' }; }
  if (name === 'updateMaterialBundle') { Object.assign(bundle, input, {updatedAtMs:Date.now()}); return {updated:true}; }
  if (name === 'updateMaterialBundleFiles') {
    for (const patch of input.files) Object.assign(bundle.files.find(file => file.fileId === patch.fileId), patch);
    return {updated:true};
  }
  if (name === 'withdrawMaterialBundleFile') { bundle.files.find(file=>file.fileId===input.fileId).status='withdrawn';return {withdrawn:true}; }
  if (name === 'createMaterialBundleFileAccess') {
    const file=bundle.files.find(file=>file.fileId===input.fileId);
    if(file?.status!=='ready')throw new Error('synthetic file unavailable');
    return {url:'https://example.invalid/synthetic-file',expiresAtMs:Date.now()+60000};
  }
  return undefined;
}

export function syntheticBundleUpload(reference, file, state, next, error, done) {
  state.bundleUploadAttempts ??= [];
  state.bundleUploadAttempts.push({ name:file.name, path:reference.path });
  next({bytesTransferred:file.size/2,totalBytes:file.size});
  if(state.failBundleUploadNames?.includes(file.name)) {
    error(Object.assign(new Error('synthetic upload failure'),{code:'storage/retry-limit-exceeded'}));return;
  }
  const rows=Object.values(state.bundleFixtures?.bundles??{}).flatMap(bundle=>bundle.files);
  const row=rows.find(candidate=>candidate.storagePath===reference.path);
  if(row) { row.status=state.bundleScanPending?'scanning':'ready';row.scanStatus=state.bundleScanPending?'pending':'clean'; }
  next({bytesTransferred:file.size,totalBytes:file.size});done();
}
