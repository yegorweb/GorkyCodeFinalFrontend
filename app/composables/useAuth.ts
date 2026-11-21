export const useAuth = <T extends boolean = false>(
  options?: UseAuthOptions<T>,
) => {
  const { $auth } = useNuxtApp()
  const user = useState<T extends true ? User : User | null | undefined>('user')
  const loggedIn = computed(() => !!user.value)

  return {
    ...$auth,
    user,
    loggedIn,
  }
}
