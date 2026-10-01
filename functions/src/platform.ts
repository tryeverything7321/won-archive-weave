export type PlatformStatus = {
  service: 'won-youth-archive'
  status: 'ready'
  capabilities: {
    archive: true
    authentication: 'planned'
    uploads: 'planned'
    community: 'planned'
    instagram: 'planned'
    externalAi: 'deferred'
  }
}

export function platformStatus(): PlatformStatus {
  return {
    service: 'won-youth-archive',
    status: 'ready',
    capabilities: {
      archive: true,
      authentication: 'planned',
      uploads: 'planned',
      community: 'planned',
      instagram: 'planned',
      externalAi: 'deferred',
    },
  }
}
