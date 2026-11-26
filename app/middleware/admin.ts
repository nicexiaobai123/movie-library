import { adminErrorMessage, adminErrorStatus, useAdminApi } from '~/composables/useAdminApi'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/admin/login') return

  try {
    await useAdminApi().session()
  } catch (error) {
    const status = adminErrorStatus(error)
    if (status === 401) {
      return navigateTo('/admin/login', { replace: true })
    }
    return abortNavigation(createError({
      statusCode: status ?? 503,
      message: adminErrorMessage(error, '暂时无法验证管理员会话，请稍后重试。'),
    }))
  }
})
