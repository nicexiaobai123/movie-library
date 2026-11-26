import type { FavoriteList, UserSession } from '#shared/types/library'

// Session state is fetched during SSR too, with the incoming cookies forwarded,
// so the server and the client render the same markup (no hydration mismatch)
// and a signed-in visitor sees their name in the first paint.
export async function useUserSession() {
  const request = useRequestFetch()
  const { data, refresh } = await useAsyncData<UserSession>('user-session',
    () => request<UserSession>('/api/user/session', { headers: useRequestHeaders(['cookie']) }),
    { default: () => ({ username: null }) })
  const username = computed(() => data.value?.username ?? null)
  const signedIn = computed(() => Boolean(username.value))

  async function login(name: string, password: string) {
    await $fetch('/api/user/login', { method: 'POST', body: { username: name, password } })
    await refresh()
  }

  async function register(name: string, password: string) {
    await $fetch('/api/user/register', { method: 'POST', body: { username: name, password } })
    await refresh()
  }

  async function logout() {
    await $fetch('/api/user/logout', { method: 'POST' })
    await refresh()
  }

  return { username, signedIn, login, register, logout, refresh }
}

export async function useFavorites() {
  const request = useRequestFetch()
  const { data, refresh } = await useAsyncData<FavoriteList>('user-favorites',
    () => request<FavoriteList>('/api/user/favorites', { headers: useRequestHeaders(['cookie']) }),
    { default: () => ({ items: [] }) })
  const items = computed(() => data.value?.items ?? [])

  async function set(titleId: string, favorited: boolean) {
    await $fetch(`/api/user/favorites/${encodeURIComponent(titleId)}`, { method: favorited ? 'PUT' : 'DELETE' })
    await Promise.all([refresh(), refreshNuxtData(`favorite-${titleId}`)])
  }

  return { items, refresh, set }
}

export async function favoriteState(titleId: string) {
  const request = useRequestFetch()
  return useAsyncData<{ favorited: boolean }>(`favorite-${titleId}`,
    () => request<{ favorited: boolean }>(`/api/user/favorites/${encodeURIComponent(titleId)}`, {
      headers: useRequestHeaders(['cookie']),
    }),
    { default: () => ({ favorited: false }) })
}
