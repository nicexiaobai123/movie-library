<script setup lang="ts">
import { adminErrorMessage, adminErrorStatus, useAdminApi } from '~/composables/useAdminApi'

useSeoMeta({ title: '管理员登录 · 夜灯', robots: 'noindex, nofollow' })

const api = useAdminApi()
const username = ref('')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')
let disposed = false

onBeforeUnmount(() => { disposed = true })

async function login() {
  if (submitting.value) return
  errorMessage.value = ''
  const name = username.value.trim()
  if (!name || !password.value) {
    errorMessage.value = '请输入管理员用户名和密码。'
    return
  }

  submitting.value = true
  try {
    await api.login({ username: name, password: password.value })
  } catch (error) {
    if (!disposed) {
      const fallback = adminErrorStatus(error) === 401
        ? '用户名或密码不正确，请重新输入。'
        : '暂时无法登录，请检查网络后重试。'
      errorMessage.value = adminErrorMessage(error, fallback)
      submitting.value = false
    }
    return
  }

  if (!disposed) {
    password.value = ''
    try {
      await navigateTo('/admin', { replace: true })
    } catch (error) {
      if (!disposed) errorMessage.value = adminErrorMessage(error, '已登录，但暂时无法打开管理后台。可从站点导航重试。')
    } finally {
      if (!disposed) submitting.value = false
    }
  }
}
</script>

<template>
  <div class="shell login-page">
    <section class="login-panel" aria-labelledby="admin-login-title">
      <div class="login-intro">
        <p class="login-kicker">夜灯 · 管理后台</p>
        <h1 id="admin-login-title">管理员登录</h1>
        <p class="login-description">登录后可上传视频、扫描目录，并整理电影与剧集资料。</p>
      </div>

      <div class="login-entry">
        <p class="login-form-heading">管理账户</p>
        <form class="login-form" method="post" action="/api/admin/login" :aria-busy="submitting" data-test="admin-login-form" @submit.prevent="login">
          <div class="login-field">
            <label for="admin-username">用户名</label>
            <input
              id="admin-username"
              v-model="username"
              class="field"
              name="username"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              required
              :readonly="submitting"
              data-test="admin-login-username"
            >
          </div>
          <div class="login-field">
            <label for="admin-password">密码</label>
            <input
              id="admin-password"
              v-model="password"
              class="field"
              type="password"
              name="password"
              autocomplete="current-password"
              required
              :readonly="submitting"
              data-test="admin-login-password"
            >
          </div>
          <p v-if="errorMessage" class="login-error" role="alert" data-test="admin-login-error">{{ errorMessage }}</p>
          <button class="btn btn--primary login-submit" type="submit" :disabled="submitting" data-test="admin-login-submit">
            {{ submitting ? '正在登录…' : '登录' }}
          </button>
        </form>
        <NuxtLink class="login-back" to="/"><span aria-hidden="true">←</span> 返回影视库</NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  display: grid;
  align-items: center;
  min-block-size: calc(100svh - var(--header-height) - 9rem);
  max-width: 78rem;
  padding-block: clamp(2.8rem, 7vw, 6rem);
}
.login-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: clamp(2.6rem, 6vw, 5rem);
  width: 100%;
  max-width: 67rem;
  margin-inline: auto;
}
.login-intro { max-width: 31rem; }
.login-kicker {
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.12em;
}
.login-intro h1 {
  margin-block: 0.8rem 0.75rem;
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 4.5vw, 3.5rem);
  font-weight: 500;
  letter-spacing: 0.02em;
  line-height: 1.2;
}
.login-description {
  max-width: 28rem;
  color: var(--text-muted);
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.login-entry {
  min-width: 0;
  padding-block-start: 1rem;
  border-block-start: 1px solid var(--border-strong);
}
.login-form-heading {
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 600;
}
.login-form {
  display: grid;
  gap: 1.2rem;
  margin-block: 1.45rem 1rem;
}
.login-field {
  display: grid;
  gap: 0.45rem;
  min-width: 0;
}
.login-field label {
  font-size: 0.9rem;
  font-weight: 600;
}
.login-field .field { min-height: 3rem; }
.login-error {
  color: var(--color-danger, var(--accent-strong));
  overflow-wrap: anywhere;
}
.login-submit {
  min-height: 3rem;
  margin-block-start: 0.3rem;
  font-size: 0.95rem;
}
.login-back {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 44px;
  color: var(--text-muted);
  text-underline-offset: 0.25em;
}
.login-back:hover {
  color: var(--accent);
  text-decoration: underline;
}
@media (min-width: 49rem) {
  .login-panel {
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 27rem);
    align-items: start;
  }
}
</style>
