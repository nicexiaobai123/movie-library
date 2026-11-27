<script setup lang="ts">
import { adminErrorMessage, adminErrorStatus } from '~/composables/useAdminApi'
import { useUserSession } from '~/composables/useUser'

useSeoMeta({ title: '我的账户 · 夜灯', robots: 'noindex, nofollow' })

const route = useRoute()
const { username, signedIn, login, register, logout, refresh } = await useUserSession()
const next = computed(() => typeof route.query.next === 'string' ? route.query.next : '/my-list')
const mode = ref<'login' | 'register'>('login')
const name = ref('')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')
const changing = ref(false)
const changeMessage = ref('')
const currentPassword = ref('')
const newPassword = ref('')
let disposed = false

onBeforeUnmount(() => { disposed = true })

async function submit() {
  if (submitting.value) return
  errorMessage.value = ''
  const account = name.value.trim()
  if (!account || !password.value) {
    errorMessage.value = '请输入用户名和密码。'
    return
  }
  if (mode.value === 'register' && password.value.length < 6) {
    errorMessage.value = '密码至少 6 位。'
    return
  }
  submitting.value = true
  try {
    if (mode.value === 'register') await register(account, password.value)
    else await login(account, password.value)
  } catch (error) {
    if (disposed) return
    const fallback = mode.value === 'register' ? '暂时无法注册，请稍后重试。' : '用户名或密码不正确，请重新输入。'
    errorMessage.value = adminErrorMessage(error, fallback)
    submitting.value = false
    return
  }
  if (disposed) return
  password.value = ''
  submitting.value = false
  await navigateTo(next.value, { replace: true })
}

async function signOut() {
  submitting.value = true
  try { await logout() } catch (error) {
    if (!disposed) errorMessage.value = adminErrorMessage(error, '未能退出登录，请重试。')
  } finally {
    if (!disposed) submitting.value = false
  }
}

function switchMode(value: 'login' | 'register') {
  mode.value = value
  errorMessage.value = ''
}

// Changing the password signs every session out, including this one.
async function changePassword() {
  if (changing.value) return
  changeMessage.value = ''
  errorMessage.value = ''
  if (newPassword.value.length < 6) {
    errorMessage.value = '新密码至少 6 位。'
    return
  }
  changing.value = true
  try {
    await $fetch('/api/user/password', {
      method: 'PUT',
      body: { currentPassword: currentPassword.value, newPassword: newPassword.value },
    })
    currentPassword.value = ''
    newPassword.value = ''
    changeMessage.value = '密码已更新，请用新密码重新登录。'
    await refresh()
  } catch (error) {
    if (disposed) return
    errorMessage.value = adminErrorMessage(error, '未能修改密码，请检查当前密码后重试。')
  } finally {
    if (!disposed) changing.value = false
  }
}
</script>

<template>
  <div class="shell user-page">
    <section class="user-intro">
      <p class="eyebrow">我的账户</p>
      <h1>{{ signedIn ? username : (mode === 'login' ? '登录' : '注册') }}</h1>
      <p class="user-description">
        {{ signedIn ? '登录状态下可以收藏喜欢的影片，收藏会保存在这台服务器上。' : '登录或注册一个账户，就能收藏影片。管理员仍使用独立的管理后台登录。' }}
      </p>
    </section>

    <section v-if="signedIn" class="user-card" aria-labelledby="user-current-title">
      <h2 id="user-current-title">已登录</h2>
      <p>当前账户：<strong>{{ username }}</strong></p>
      <div class="user-actions">
        <NuxtLink class="btn btn--primary" to="/my-list">查看收藏</NuxtLink>
        <button class="btn" type="button" :disabled="submitting" data-test="user-logout" @click="signOut">
          {{ submitting ? '正在退出…' : '退出登录' }}
        </button>
      </div>
      <p v-if="errorMessage" class="user-error" role="alert">{{ errorMessage }}</p>

      <form class="user-form change-password" aria-labelledby="user-password-title" @submit.prevent="changePassword">
        <h3 id="user-password-title">修改密码</h3>
        <div class="user-field">
          <label for="user-current-password">当前密码</label>
          <input
            id="user-current-password"
            v-model="currentPassword"
            class="field"
            type="password"
            autocomplete="current-password"
            required
            :readonly="changing"
            data-test="user-current-password"
          >
        </div>
        <div class="user-field">
          <label for="user-new-password">新密码</label>
          <input
            id="user-new-password"
            v-model="newPassword"
            class="field"
            type="password"
            autocomplete="new-password"
            required
            :readonly="changing"
            data-test="user-new-password"
          >
          <p class="user-hint">至少 6 位。修改后其他设备上的登录会失效。</p>
        </div>
        <p v-if="changeMessage" class="user-notice" role="status" data-test="user-password-status">{{ changeMessage }}</p>
        <button class="btn user-submit" type="submit" :disabled="changing" data-test="user-password-submit">
          {{ changing ? '正在修改…' : '修改密码' }}
        </button>
      </form>
    </section>

    <section v-else class="user-card" aria-labelledby="user-form-title">
      <div class="user-modes" role="tablist" aria-label="登录或注册">
        <button
          class="user-mode"
          type="button"
          role="tab"
          :aria-selected="mode === 'login'"
          data-test="user-mode-login"
          @click="switchMode('login')"
        >登录</button>
        <button
          class="user-mode"
          type="button"
          role="tab"
          :aria-selected="mode === 'register'"
          data-test="user-mode-register"
          @click="switchMode('register')"
        >注册</button>
      </div>
      <h2 id="user-form-title" class="visually-hidden">{{ mode === 'login' ? '登录' : '注册' }}</h2>
      <form class="user-form" :aria-busy="submitting" @submit.prevent="submit">
        <div class="user-field">
          <label for="user-username">用户名</label>
          <input
            id="user-username"
            v-model="name"
            class="field"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            required
            :readonly="submitting"
            data-test="user-username"
          >
        </div>
        <div class="user-field">
          <label for="user-password">密码</label>
          <input
            id="user-password"
            v-model="password"
            class="field"
            type="password"
            :name="mode === 'register' ? 'new-password' : 'password'"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            required
            :readonly="submitting"
            data-test="user-password"
          >
          <p v-if="mode === 'register'" class="user-hint">至少 6 位。</p>
        </div>
        <p v-if="errorMessage" class="user-error" role="alert" data-test="user-error">{{ errorMessage }}</p>
        <button class="btn btn--primary user-submit" type="submit" :disabled="submitting" data-test="user-submit">
          {{ submitting ? '请稍候…' : (mode === 'register' ? '注册并登录' : '登录') }}
        </button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.user-page {
  display: grid;
  gap: clamp(1.5rem, 4vw, 2.6rem);
  max-width: 56rem;
  padding-block: clamp(2rem, 5vw, 4rem) clamp(3rem, 7vw, 6rem);
}
.user-intro h1 {
  margin-block: .7rem .5rem;
  font-family: var(--font-display);
  font-size: clamp(2rem, 4.5vw, 2.9rem);
  font-weight: 500;
  line-height: 1.2;
}
.user-description { max-width: 36rem; color: var(--text-muted); line-height: 1.8; }
.user-card {
  max-width: 27rem;
  padding-block-start: 1.4rem;
  border-block-start: 1px solid var(--border-strong);
}
.user-card h2 { font-family: var(--font-display); font-size: 1.25rem; font-weight: 600; }
.user-card > p { margin-block-start: .5rem; color: var(--text-muted); }
.user-card > p strong { color: var(--text); }
.user-modes {
  display: flex;
  gap: 1.6rem;
  border-block-end: 1px solid var(--border);
}
.user-mode {
  min-height: 44px;
  margin-block-end: -1px;
  padding: .6rem 0;
  border: 0;
  border-block-end: 2px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: .95rem;
}
.user-mode[aria-selected='true'] {
  border-block-end-color: var(--accent);
  color: var(--text);
}
.user-form { display: grid; gap: 1.1rem; margin-block-start: 1.35rem; }
.user-field { display: grid; gap: .4rem; min-width: 0; }
.user-field label { font-size: .9rem; font-weight: 600; }
.user-hint { margin: 0; color: var(--text-muted); font-size: .82rem; }
.user-error { margin: 0; color: var(--danger); font-size: .9rem; overflow-wrap: anywhere; }
.user-submit { min-height: 3rem; font-size: .95rem; }
.user-actions { display: flex; flex-wrap: wrap; gap: .6rem; margin-block-start: 1.1rem; }
.change-password { margin-block-start: 1.8rem; padding-block-start: 1.4rem; border-block-start: 1px solid var(--border); }
.change-password h3 { margin: 0 0 .2rem; font-family: var(--font-display); font-size: 1rem; font-weight: 600; }
.user-notice { margin: 0; color: var(--accent); font-size: .88rem; }
</style>
