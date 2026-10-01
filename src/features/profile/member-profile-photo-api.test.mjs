import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true } })
const { readMyProfilePhoto } = await vite.ssrLoadModule('/src/features/profile/member-profile-api.ts')

after(async () => {
  await vite.close()
})

test('reads the owner avatar by its exact object path without listing the directory', async () => {
  const photo = new Blob(['avatar'], { type: 'image/webp' })
  const paths = []

  assert.equal(await readMyProfilePhoto('member-1', {
    currentUid: () => 'member-1',
    readObject: async (path) => {
      paths.push(path)
      return photo
    },
  }), photo)
  assert.deepEqual(paths, ['profile-photos/member-1/avatar'])
})

test('treats only an absent avatar object as an empty photo state', async () => {
  assert.equal(await readMyProfilePhoto('member-1', {
    currentUid: () => 'member-1',
    readObject: async () => {
      throw { code: 'storage/object-not-found' }
    },
  }), null)
})

test('preserves an avatar authorization failure for the caller to classify', async () => {
  const denied = { code: 'storage/unauthorized' }
  await assert.rejects(
    readMyProfilePhoto('member-1', {
      currentUid: () => 'member-1',
      readObject: async () => {
        throw denied
      },
    }),
    (error) => error === denied,
  )
})
