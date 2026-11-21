export default defineNuxtRouteMiddleware(to => {
  if (!to.meta.auth) return
  if (!useAuth().loggedIn.value) return navigateTo({ path: '/auth/login', query: { redirect: to.fullPath } })
})
