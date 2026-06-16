// Enforce auth on the app surfaces. The NextAuth middleware redirects
// unauthenticated users to sign-in. API routes do their own getUserId() check,
// so they are not matched here (the answer route returns 401 itself).

export { default } from 'next-auth/middleware'

export const config = {
  matcher: ['/ask/:path*', '/today/:path*', '/relationships/:path*', '/search/:path*'],
}
