type GoogleLoginDependencies = {
  signIn(): Promise<void>
  provision(): Promise<void>
  signOut(): Promise<void>
  remember(): void
}

export async function finishGoogleLogin(dependencies: GoogleLoginDependencies): Promise<void> {
  let signedIn = false
  try {
    await dependencies.signIn()
    signedIn = true
    await dependencies.provision()
  } catch (error) {
    if (signedIn) await dependencies.signOut()
    throw error
  }
  dependencies.remember()
}
