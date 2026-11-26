import type { FavoriteList, FavoriteState } from '../../shared/types/library.ts'
import type { UserRecord, UserStore } from '../db/users.ts'
import { LibraryError } from '../domain/errors.ts'
import type { LibraryStore } from '../db/library.ts'

// Favourites only ever reference catalog titles the public can already see.
export function createFavorites(users: UserStore, library: LibraryStore) {
  function assertVisible(titleId: string) {
    if (!library.detail(titleId)) throw new LibraryError(404, '未找到这部作品。')
  }
  return {
    list(user: UserRecord): FavoriteList {
      return { items: users.favorites(user.id) }
    },
    state(user: UserRecord, titleId: string): FavoriteState {
      return { favorited: users.hasFavorite(user.id, titleId) }
    },
    add(user: UserRecord, titleId: string): FavoriteState {
      assertVisible(titleId)
      users.addFavorite(user.id, titleId)
      return { favorited: true }
    },
    remove(user: UserRecord, titleId: string): FavoriteState {
      users.removeFavorite(user.id, titleId)
      return { favorited: false }
    },
  }
}
